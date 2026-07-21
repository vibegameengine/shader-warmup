# @vibegameengine/shader-warmup

A lightweight utility for pre-compiling Three.js shaders to avoid runtime stutter (jank) when objects first appear in the scene. Designed for use with `@react-three/fiber`.

## Features

*   **Registry System**: Decoupled resource registration so assets can be registered from anywhere.
*   **Invisible Warmup**: Renders objects at microscopic scale to force shader compilation without visual artifacts.
*   **ShaderWarmup**: Owns mount → compile → unmount and reports when a splash can close.
*   **Variant-aware**: Supports ordinary mesh and `InstancedMesh` programs.
*   **Recovery-aware**: Re-runs after late registry entries or WebGL context restoration.

## Installation

```bash
npm install @vibegameengine/shader-warmup
```

## Usage

### 1. Register Resources

Register your geometries and materials *before* your scene renders, for example, during asset loading or initialization.

```typescript
import { ShaderWarmupRegistry } from '@vibegameengine/shader-warmup';
import * as THREE from 'three';

// Register duplicate materials/geometries only once
ShaderWarmupRegistry.register(
  'player-ship', 
  shipGeometry, 
  shipMaterial
);

// Use the real object type when a material is rendered through InstancedMesh.
ShaderWarmupRegistry.register(
  'level-up-spark',
  sparkGeometry,
  sparkMaterial,
  { drawMode: 'instanced' },
);

ShaderWarmupRegistry.register(
  'enemy-bot',
  botGeometry,
  botMaterial
);
```

### 2. Add one boundary to Canvas

Place `ShaderWarmup` inside your `<Canvas>`. It fetches the central
registry, compiles invisible resources, waits for the next real frame, then
unmounts them without disposing your shared assets.

```tsx
import { Canvas } from '@react-three/fiber';
import { ShaderWarmup } from '@vibegameengine/shader-warmup';
import { useState } from 'react';

const GameScene = () => {
  const [isReady, setIsReady] = useState(false);

  return (
    <>
      {!isReady && <LoadingScreen />}
      
      <Canvas>
        <ShaderWarmup
          onWarming={() => setIsReady(false)}
          onReady={() => setIsReady(true)}
        />
        
        {/* Your actual game content */}
        <GameWorld />
      </Canvas>
    </>
  );
};
```

The boundary re-warms automatically when a new resource enters its registry. In
development, registering a different resource under an existing ID logs a warning
instead of silently replacing the first shader variant.

`ShaderWarmup` warms registered geometry/material draw variants. Keep runtime
effect logic separate, and register every real mesh or instanced-mesh variant it
can create before the Canvas mounts.

### 3. Advanced Usage (Custom Resource Subset)

You can also pass a specific list of resources directly to the component, bypassing the global registry.

```tsx
<ShaderWarmup resources={[
  { id: 'custom-1', geometry: geo1, material: mat1, drawMode: 'mesh' }
]} onReady={() => setIsReady(true)} />
```

`ShaderWarmupBoundary` and `ReadySignal` remain exported for backwards
compatibility; new integrations use `ShaderWarmup`.
