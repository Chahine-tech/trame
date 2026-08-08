import { useEffect, useState } from "react"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import { useGraphStore } from "@trame/viewer/store/graph"
import type { GraphData } from "@trame/viewer/types"
import { HeroScene } from "./HeroScene"
import { useHeroScript } from "./hero-script"
import { HERO_CAMERA } from "./camera"

/** Everything that pulls in Three.js lives behind this module boundary. */
export function HeroCanvas({ data }: { data: GraphData }) {
  const [ready, setReady] = useState(false)
  // the running commentary: names what the script is doing, as it does it
  const [caption, setCaption] = useState<string | null>(null)
  const load = useGraphStore((s) => s.load)

  useEffect(() => {
    // positions are baked into the file, so load() seeds from them instead of
    // running a solver — the flat preview and the scene agree exactly
    load(data)
    setReady(true)
  }, [data, load])

  useHeroScript(ready, setCaption)

  return (
    <div className="hero-canvas">
      <Canvas
        camera={{ position: [...HERO_CAMERA.position], fov: HERO_CAMERA.fov }}
        frameloop="demand"
        // WebGL, not WebGPU. The tool ships WebGPU because it runs locally for
        // one person; the landing loads for strangers over a link, and the
        // WebGPU build costs 300 kB more for nothing at this scale.
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
      >
        <HeroScene />
      </Canvas>

      {/* keyed on the text so each beat re-enters instead of mutating in place */}
      {caption && (
        <div key={caption} className="hero-caption">
          {caption}
        </div>
      )}
    </div>
  )
}
