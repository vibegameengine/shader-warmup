import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

export type WarmupDrawMode = 'mesh' | 'instanced'

export interface WarmupResource {
  id: string
  /** Opaque Three geometry from the host application's peer dependency. */
  geometry: unknown
  /** Opaque Three material from the host application's peer dependency. */
  material: unknown
  drawMode: WarmupDrawMode
  castShadow: boolean
  receiveShadow: boolean
}

export interface WarmupResourceOptions {
  /** Object3D type used by the real draw. Defaults to an ordinary mesh. */
  drawMode?: WarmupDrawMode
  /** Match the real object's shadow participation when it matters to its program. */
  castShadow?: boolean
  /** Match the real object's shadow participation when it matters to its program. */
  receiveShadow?: boolean
}

interface WarmupResourcesProps {
  resources?: readonly WarmupResource[]
}

export interface ShaderWarmupProgress {
  status: 'warming' | 'ready' | 'context-lost' | 'error'
  resourceCount: number
  revision: number
  durationMs?: number
  error?: unknown
}

export interface ShaderWarmupProps {
  /** Uses the global registry when neither `resources` nor `registry` is passed. */
  registry?: ResourceRegistryService
  /** Opt out of the global registry for a Canvas that owns a fixed resource subset. */
  resources?: readonly WarmupResource[]
  /** Called after the current resource revision has been compiled and unmounted. */
  onReady?: (progress: ShaderWarmupProgress) => void
  /** Called whenever a new warmup cycle starts, including late registrations. */
  onWarming?: (progress: ShaderWarmupProgress) => void
  /** Optional diagnostics for splash screens and development tooling. */
  onProgress?: (progress: ShaderWarmupProgress) => void
}

type RegistryListener = (revision: number) => void

export class ResourceRegistryService {
  private resources = new Map<string, WarmupResource>()
  private listeners = new Set<RegistryListener>()
  private currentRevision = 0

  public register(
    id: string,
    geometry: unknown,
    material: unknown,
    options: WarmupResourceOptions = {},
  ): boolean {
    const next: WarmupResource = {
      id,
      geometry,
      material,
      drawMode: options.drawMode ?? 'mesh',
      castShadow: options.castShadow ?? false,
      receiveShadow: options.receiveShadow ?? false,
    }
    const existing = this.resources.get(id)
    if (existing) {
      if (
        existing.geometry !== next.geometry ||
        existing.material !== next.material ||
        existing.drawMode !== next.drawMode ||
        existing.castShadow !== next.castShadow ||
        existing.receiveShadow !== next.receiveShadow
      ) {
        console.warn(`[ShaderWarmupRegistry] Duplicate id "${id}" has a different resource; the first registration remains active.`)
      }
      return false
    }
    this.resources.set(id, next)
    this.currentRevision += 1
    for (const listener of this.listeners) listener(this.currentRevision)
    return true
  }

  public getAll(): WarmupResource[] {
    return Array.from(this.resources.values())
  }

  public get revision(): number {
    return this.currentRevision
  }

  /** Notifies boundaries that newly registered resources require another warmup pass. */
  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const ShaderWarmupRegistry = new ResourceRegistryService()

/** Renders registered resources invisibly. It never disposes caller-owned assets. */
const WarmupResources: React.FC<WarmupResourcesProps> = ({ resources }) => {
  const activeResources = resources ?? ShaderWarmupRegistry.getAll()

  return (
    <group position={[0, 0, 0]} scale={[0.0001, 0.0001, 0.0001]} dispose={null}>
      {activeResources.map((resource) => resource.drawMode === 'instanced' ? (
        <InstancedWarmupMesh key={resource.id} resource={resource} />
      ) : (
        <mesh
          key={resource.id}
          geometry={resource.geometry as THREE.BufferGeometry}
          material={resource.material as THREE.Material}
          castShadow={resource.castShadow}
          receiveShadow={resource.receiveShadow}
          frustumCulled={false}
          dispose={null}
        />
      ))}
    </group>
  )
}

const warmupMatrix = new THREE.Matrix4()

/** Compiles the same instancing variant as the runtime object without showing it. */
const InstancedWarmupMesh: React.FC<{ resource: WarmupResource }> = ({ resource }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.setMatrixAt(0, warmupMatrix)
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <instancedMesh
      ref={meshRef}
      args={[resource.geometry as THREE.BufferGeometry, resource.material as THREE.Material, 1]}
      count={1}
      castShadow={resource.castShadow}
      receiveShadow={resource.receiveShadow}
      frustumCulled={false}
      dispose={null}
    />
  )
}

function CompileReadySignal({
  resourceCount,
  revision,
  onReady,
  onProgress,
}: {
  resourceCount: number
  revision: number
  onReady: (progress: ShaderWarmupProgress) => void
  onProgress?: (progress: ShaderWarmupProgress) => void
}) {
  const { gl, scene, camera } = useThree()
  const onReadyRef = useRef(onReady)
  const onProgressRef = useRef(onProgress)

  useLayoutEffect(() => {
    onReadyRef.current = onReady
    onProgressRef.current = onProgress
  }, [onProgress, onReady])

  useEffect(() => {
    let cancelled = false
    const startedAt = performance.now()
    onProgressRef.current?.({ status: 'warming', resourceCount, revision })
    try {
      // compileAsync can wait forever for a changing live scene on some drivers.
      // `compile` initializes every program synchronously; one actual frame below
      // lets the renderer submit that already-initialized warmup scene.
      gl.compile(scene, camera)
    } catch (error) {
      onProgressRef.current?.({ status: 'error', resourceCount, revision, error })
    }
    const frame = requestAnimationFrame(() => {
      if (cancelled) return
      const progress = {
        status: 'ready' as const,
        resourceCount,
        revision,
        durationMs: performance.now() - startedAt,
      }
      onProgressRef.current?.(progress)
      onReadyRef.current(progress)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [camera, gl, resourceCount, revision, scene])

  return null
}

/**
 * Owns one warmup lifecycle: mount invisible resources, compile, then unmount.
 * It re-runs when the central registry changes or when WebGL restores its context.
 */
export const ShaderWarmup: React.FC<ShaderWarmupProps> = ({
  registry = ShaderWarmupRegistry,
  resources: explicitResources,
  onReady,
  onWarming,
  onProgress,
}) => {
  const { gl } = useThree()
  const usesRegistry = explicitResources === undefined
  const [resources, setResources] = useState<readonly WarmupResource[]>(() => explicitResources ?? registry.getAll())
  const [revision, setRevision] = useState(() => usesRegistry ? registry.revision : 0)
  const [cycle, setCycle] = useState(0)
  const [completedCycle, setCompletedCycle] = useState<number | null>(null)
  const [contextLost, setContextLost] = useState(false)
  const previousExplicitResources = useRef(explicitResources)

  useEffect(() => {
    if (!usesRegistry) {
      if (previousExplicitResources.current === explicitResources) return
      previousExplicitResources.current = explicitResources
      setResources(explicitResources ?? [])
      setRevision(0)
      setCycle((value) => value + 1)
      return
    }
    setResources(registry.getAll())
    setRevision(registry.revision)
    return registry.subscribe((nextRevision) => {
      setResources(registry.getAll())
      setRevision(nextRevision)
      setCycle((value) => value + 1)
    })
  }, [explicitResources, registry, usesRegistry])

  useEffect(() => {
    const canvas = gl.domElement
    const onContextLost = () => {
      setContextLost(true)
      const progress = { status: 'context-lost' as const, resourceCount: resources.length, revision }
      onProgress?.(progress)
      onWarming?.(progress)
    }
    const onContextRestored = () => {
      setContextLost(false)
      setResources(usesRegistry ? registry.getAll() : explicitResources ?? [])
      setRevision(usesRegistry ? registry.revision : 0)
      setCycle((value) => value + 1)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
    }
  }, [explicitResources, gl, onProgress, onWarming, registry, resources.length, revision, usesRegistry])

  const cycleResources = useMemo(() => resources, [cycle, resources])
  const warming = !contextLost && completedCycle !== cycle

  return warming ? (
    <React.Fragment key={cycle}>
      <WarmupResources resources={cycleResources} />
      <CompileReadySignal
        resourceCount={cycleResources.length}
        revision={revision}
        onProgress={(progress) => {
          onProgress?.(progress)
          if (progress.status === 'warming') onWarming?.(progress)
        }}
        onReady={(progress) => {
          setCompletedCycle(cycle)
          onReady?.(progress)
        }}
      />
    </React.Fragment>
  ) : null
}

/** @deprecated `ShaderWarmup` now owns the full lifecycle. */
export const ShaderWarmupBoundary = ShaderWarmup

/** @deprecated `ShaderWarmup` now owns the full lifecycle. */
export const ReadySignal = ({ setReady }: { setReady: (ready: boolean) => void }) => (
  <CompileReadySignal
    resourceCount={ShaderWarmupRegistry.getAll().length}
    revision={ShaderWarmupRegistry.revision}
    onReady={() => setReady(true)}
  />
)
