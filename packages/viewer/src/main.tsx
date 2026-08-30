import { createRoot } from "react-dom/client"
import { NodeLabels } from "./ui/NodeLabels"
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
      /**
       * Full resolution for the still image, half of it while the camera moves.
       *
       * R3F takes `window.devicePixelRatio` unless told otherwise, so a Retina
       * screen renders four times the pixels: this window at 1470x715 was being
       * drawn at 2940x1430, 4.2 million pixels a frame, with MSAA on top. That
       * is what a GPU and a compositor both scale with, and it is paid on every
       * frame whether anything changed or not.
       *
       * Capped rather than lowered, and regressed rather than capped low. The
       * reader looks at a settled picture, and the edge widths in `EdgeMesh`
       * were measured in CSS pixels against a sharp one — dropping the
       * resolution outright would thin lines that are already down to 0.89px on
       * a large graph. Movement is where the cost is and where nobody is reading
       * fine lines, so `<OrbitControls regress>` drops it there and
       * `<AdaptiveDpr>` puts it back the moment the camera stops.
       */
      dpr={[1, 2]}
      performance={{ min: 0.5 }}
      // a settled graph is a still image: draw on change, not 60 times a second.
      // Anything that animates asks for the next frame with invalidate().
      frameloop="demand"
      onPointerMissed={() => useGraphStore.getState().clearFromBackground()}
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
    {/* Over the canvas and under every panel, outside the 3D tree on purpose:
        inside it, R3F's reconciler resolves a `div` against the THREE
        namespace. See `NodeLabels`. */}
    <NodeLabels />
    <AppUI />
  </>,
)
