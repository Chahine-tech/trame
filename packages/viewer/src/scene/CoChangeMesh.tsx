import { useMemo } from "react"
import * as THREE from "three"
import { useGraphStore } from "../store/graph"
import { isDarkGround, usePalette } from "../theme"
import { tubeGrowth } from "./EdgeMesh"
import { useDisposable } from "./useDisposable"

/**
 * What the history couples, drawn as what it is: a straight line and no arrow.
 *
 * Every other edge in this scene is a Bézier with a head, because an import has
 * a direction and a shape the reader can bend. Co-change has neither. It is not
 * a dependency, it is an observation about commits, and drawing it in the same
 * language would claim a relationship the code does not have. Straight, thin,
 * headless, and in a colour no import uses.
 */
export function CoChangeMesh() {
  const palette = usePalette()
  const of = useGraphStore((s) => s.coChangeOf)
  const partners = useGraphStore((s) => s.coChangeWith)
  const positions = useGraphStore((s) => s.positions)
  const extent = useGraphStore((s) => s.extent)

  const growth = tubeGrowth(extent)

  const lines = useMemo(() => {
    const from = of ? positions.get(of) : null
    if (!from) return []
    const a = new THREE.Vector3(...from)
    return [...partners].flatMap(([id, jaccard]) => {
      const to = positions.get(id)
      if (!to) return []
      const b = new THREE.Vector3(...to)
      const curve = new THREE.LineCurve3(a, b)
      /**
       * The strength is in the width, not the colour: one hue means one idea,
       * and a second would read as a second kind of relationship.
       *
       * Anchored to the widths `tubeGrowth` already calibrated, not invented.
       * An unlit edge is 0.045 and a lit one 0.12, which at extent 255 measure
       * 0.7 and 1.9 CSS pixels. The first pass here ran 0.035 to 0.085, so the
       * answer to the reader's question was drawn thinner than the edges it was
       * supposed to stand out from, and at one pixel on a pale ground it was
       * invisible. It starts above a lit edge and ends near a hovered one.
       */
      const radius = (0.13 + 0.09 * jaccard) * growth
      return [{ id, geometry: new THREE.TubeGeometry(curve, 1, radius, 5), jaccard }]
    })
  }, [of, partners, positions, growth])

  useDisposableAll(lines)

  if (lines.length === 0) return null
  const dark = isDarkGround()

  return (
    <group>
      {lines.map(({ id, geometry, jaccard }) => (
        <mesh key={id} geometry={geometry}>
          <meshBasicMaterial
            color={palette.teal}
            transparent
            // on paper a pale line disappears, on a dark ground a bright one
            // shouts; the ratio between the weakest and strongest pair is what
            // has to survive, not the absolute value
            opacity={(dark ? 0.35 : 0.55) + 0.4 * jaccard}
          />
        </mesh>
      ))}
    </group>
  )
}

/** One hook cannot be called in a loop, and these are rebuilt as a set. */
function useDisposableAll(lines: { geometry: THREE.BufferGeometry }[]): void {
  const group = useMemo(
    () => ({ dispose: () => lines.forEach((l) => l.geometry.dispose()) }),
    [lines],
  )
  useDisposable(group)
}
