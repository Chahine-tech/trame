import { createRoot } from "react-dom/client"
import { Canvas } from "@react-three/fiber"
import { WebGPURenderer } from "three/webgpu"
import { Scene } from "./scene/Scene"
import { AppUI } from "./App"
import { useGraphStore } from "./store/graph"
import { applyThemePref, getThemePref } from "./theme"
import "./styles.css"

// stamp the saved theme before first paint — no flash
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
      onPointerMissed={() => useGraphStore.getState().clear()}
      gl={async (props) => {
        const renderer = new WebGPURenderer({
          ...(props as ConstructorParameters<typeof WebGPURenderer>[0]),
          antialias: true,
        })
        await renderer.init()
        return renderer
      }}
    >
      <Scene />
    </Canvas>
    <AppUI />
  </>,
)
