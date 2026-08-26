import { createRoot } from "react-dom/client"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import { WebGPURenderer } from "three/webgpu"
import { Scene } from "./scene/Scene"
import { AppUI } from "./App"
import { useGraphStore } from "./store/graph"
import { applyThemePref, getThemePref } from "./theme"
import "./styles.css"

// stamp the saved theme before first paint, so there is no flash
applyThemePref(getThemePref())

/**
 * Three.js r185: WebGPU is production-ready everywhere; WebGPURenderer
 * falls back to WebGL2 automatically when WebGPU isn't available.
 */
createRoot(document.getElementById("root")!).render(
  <>
    <Canvas
      style={{ position: "fixed", inset: 0 }}
      camera={{ position: [0, 0, 80], fov: 60 }}
      // a settled graph is a still image: draw on change, not 60 times a second.
      // Anything that animates asks for the next frame with invalidate().
      frameloop="demand"
      onPointerMissed={() => {
        // TEMPORARY INSTRUMENTATION — settles whether the miss belongs to the
        // gesture that just selected. A few ms means one gesture and the guard
        // below is doing real work; seconds means two clicks and the guard is
        // guarding nothing.
        const since = performance.now() - useGraphStore.getState().selectedAt
        console.log(`[miss] ${since.toFixed(1)}ms since the last select`)
        useGraphStore.getState().clearFromBackground()
      }}
      gl={async (props) => {
        const renderer = new WebGPURenderer({
          ...(props as ConstructorParameters<typeof WebGPURenderer>[0]),
          antialias: true,
        })
        // R3F defaults to ACES Filmic, which is right for photoreal renders and
        // wrong for a diagram: it crushed #1e1e2e toward black and desaturated
        // every accent, so the scene and the UI disagreed on the same token.
        // We want the Catppuccin values on screen exactly as written.
        renderer.toneMapping = THREE.NoToneMapping
        await renderer.init()
        return renderer
      }}
    >
      <Scene />
    </Canvas>
    <AppUI />
  </>,
)
