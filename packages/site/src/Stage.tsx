import { useEffect, useState } from "react"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import { useGraphStore } from "@trame/viewer/store/graph"
import { LENSES } from "@trame/viewer/store/lens"
import type { GraphData } from "@trame/viewer/types"
import { GraphScene } from "./GraphScene"
import { useHeroScript } from "./hero-script"
import { useLensStatus } from "./lens-status"
import { HERO_CAMERA, type CameraPose } from "./camera"

/** Everything that pulls in Three.js lives behind this module boundary. */
export function Stage({
  data,
  pose,
  /** the hero's timed loop runs only while the hero holds the viewport */
  scripted,
}: {
  data: GraphData
  pose: CameraPose
  scripted: boolean
}) {
  const [ready, setReady] = useState(false)
  // the running commentary: names what the script is doing, as it does it
  const [caption, setCaption] = useState<string | null>(null)
  const load = useGraphStore((s) => s.load)
  const lens = useGraphStore((s) => s.lens)

  useEffect(() => {
    // positions are baked into the file, so load() seeds from them instead of
    // solving, and the flat preview matches the scene exactly
    load(data)
    setReady(true)
  }, [data, load])

  useHeroScript(ready && scripted, setCaption)

  // one bubble, two sources: the hero's caption, then whatever the lens found
  const status = useLensStatus()
  const line = scripted ? caption : status

  return (
    <div className="stage">
      <Canvas
        camera={{ position: [...HERO_CAMERA.position], fov: HERO_CAMERA.fov }}
        frameloop="demand"
        // WebGL, not WebGPU. The tool ships WebGPU because it runs locally for
        // one person; the landing loads for strangers over a link, and the
        // WebGPU build costs 300 kB more for nothing at this scale.
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
      >
        <GraphScene pose={pose} />
      </Canvas>

      {/* The dot carries the colour of the lens currently repainting the graph,
       * read from the product's own table so the two can never disagree.
       *
       * It was a fixed lavender, which was worse than decorative: lavender is
       * already the path lens' colour, so it announced the wrong feature while
       * impact washed the graph amber. Now the sentence, the dot and the
       * propagating colour are the same statement, and nobody has to be told
       * that amber means impact.
       *
       * Keyed on the text so each beat re-enters instead of mutating in place. */}
      {line && (
        <div
          key={line}
          className="status"
          style={
            {
              "--dot": lens === "none" ? "var(--overlay)" : `var(--${LENSES[lens].accent})`,
            } as React.CSSProperties
          }
        >
          {line}
        </div>
      )}
    </div>
  )
}
