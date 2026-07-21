import React, { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

export interface WarmupResource {
    id: string;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
}

export interface ShaderWarmupProps {
    resources?: WarmupResource[];
}

export class ResourceRegistryService {
    private resources: Map<string, WarmupResource> = new Map();

    /**
     * Registers a 3D resource to be warmed up by the ShaderWarmup system.
     * @param id Unique ID for debugging
     * @param geometry The geometry to render
     * @param material The material to compile
     */
    public register(id: string, geometry: THREE.BufferGeometry, material: THREE.Material) {
        if (this.resources.has(id)) {
            // console.warn(`[ResourceRegistry] Resource ${id} already registered.`);
            return;
        }
        this.resources.set(id, { id, geometry, material });
    }

    /**
     * Returns all registered resources for the warmup cycle.
     */
    public getAll(): WarmupResource[] {
        return Array.from(this.resources.values());
    }
}

// Singleton Instance
export const ShaderWarmupRegistry = new ResourceRegistryService();

export const ShaderWarmup: React.FC<ShaderWarmupProps> = ({ resources }) => {
  // Use passed resources, or fallback to global registry
  const activeResources = resources || ShaderWarmupRegistry.getAll();

  return (
    <group position={[0, 0, 0]} scale={[0.0001, 0.0001, 0.0001]}> 
      {activeResources.map((res) => (
          <mesh 
            key={res.id}
            geometry={res.geometry} 
            material={res.material} 
            frustumCulled={false}
          />
      ))}
    </group>
  );
};

export const ReadySignal = ({ setReady }: { setReady: (b: boolean) => void }) => {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        gl.compile(scene, camera);
        const t = setTimeout(() => setReady(true), 100);
        return () => clearTimeout(t);
    }, [gl, scene, camera, setReady]);
    return null;
}
