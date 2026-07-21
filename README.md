# @vibegameengine/shader-warmup

A lightweight utility for pre-compiling Three.js shaders to avoid runtime stutter (jank) when objects first appear in the scene. Designed for use with `@react-three/fiber`.

## Features

*   **Registry System**: Decoupled resource registration so assets can be registered from anywhere.
*   **Invisible Warmup**: Renders objects at microscopic scale to force shader compilation without visual artifacts.
*   **Ready Signal**: Provides a callback when compilation is complete, allowing you to hide a loading screen.

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

ShaderWarmupRegistry.register(
  'enemy-bot',
  botGeometry,
  botMaterial
);
```

### 2. Add to Canvas

Place the `ShaderWarmup` component inside your `<Canvas>`. It will automatically fetch registered resources. Use `ReadySignal` to know when it's safe to start the game.

```tsx
import { Canvas } from '@react-three/fiber';
import { ShaderWarmup, ReadySignal } from '@vibegameengine/shader-warmup';
import { useState } from 'react';

const GameScene = () => {
  const [isReady, setIsReady] = useState(false);

  return (
    <>
      {!isReady && <LoadingScreen />}
      
      <Canvas>
        {/* Signals 'true' after first frame render + small delay */}
        <ReadySignal setReady={setIsReady} />
        
        {/* Renders all registered resources invisibly */}
        <ShaderWarmup />
        
        {/* Your actual game content */}
        <GameWorld />
      </Canvas>
    </>
  );
};
```

### 3. Advanced Usage (Custom Resources)

You can also pass a specific list of resources directly to the component, bypassing the global registry.

```tsx
<ShaderWarmup resources={[
  { id: 'custom-1', geometry: geo1, material: mat1 }
]} />
```
