import { useGraphStore } from "../store/graph"
import { registerLabel } from "../scene/nodeLabels"

/**
 * Every file name on the map, in one layer of plain DOM.
 *
 * These were drei `Html` portals, one per node. Each of those registers its own
 * `useFrame` and, inside it, projects the node and writes `el.style.zIndex` —
 * on every rendered frame, for every label. Under the hotspot lens that is 150
 * subscribers and 150 style writes a frame, redoing a projection `NameDirector`
 * has already done: it projects all of them to arbitrate the overlaps, and was
 * throwing the coordinates away after deciding with them. It places them now,
 * and it begins by returning early when the view has not moved, so a still
 * camera costs nothing at all.
 *
 * Outside the canvas, and that part is not a preference. Inside it, JSX is
 * handled by React Three Fiber's reconciler, which looks up every element in
 * the three.js namespace — a `div` there is not a div, it is an error saying
 * `Div is not part of the THREE namespace`. So the labels live in the ordinary
 * React tree and read the same store the meshes read.
 */
export function NodeLabels() {
  const data = useGraphStore((s) => s.data)
  const nearby = useGraphStore((s) => s.nearby)
  const names = useGraphStore((s) => s.names)
  const showLabels = useGraphStore((s) => s.showLabels)
  const litSet = useGraphStore((s) => s.litSet)
  const selectedId = useGraphStore((s) => s.selectedId)
  const hoverId = useGraphStore((s) => s.hoverId)
  const pathNodes = useGraphStore((s) => s.pathNodes)
  const coChangeWith = useGraphStore((s) => s.coChangeWith)
  const coChangeOf = useGraphStore((s) => s.coChangeOf)
  const hotspotHeat = useGraphStore((s) => s.hotspotHeat)

  if (!showLabels || !data) return <div id="node-labels" aria-hidden />

  const onPath = new Set(pathNodes)
  const hasActive = litSet.size > 0

  return (
    <div id="node-labels" aria-hidden>
      {data.nodes.map((node) => {
        // the scene draws its neighbourhood, not the repository; a name for a
        // file that is not on screen would take a place from one that is
        if (nearby && !nearby.has(node.id)) return null
        const lit = litSet.has(node.id)
        const selected = selectedId === node.id
        const hovered = hoverId === node.id
        /**
         * A lens names what it is answering about, whether or not it is a
         * neighbour. The rule was "lit, or on the traced path", and lit means
         * adjacent to the selection — a co-change partner is by definition not
         * adjacent, so the lens drew five lines to five unlabelled dots.
         */
        const show =
          onPath.has(node.id) ||
          coChangeOf === node.id ||
          coChangeWith.has(node.id) ||
          hotspotHeat.has(node.id) ||
          (lit && (hovered || selected || hasActive))
        if (!show) return null
        return (
          <div
            key={node.id}
            className={`node-label${hovered || selected ? "" : " dim"}`}
            ref={(el) => registerLabel(node.id, el)}
          >
            {names.get(node.id) ?? node.label}
          </div>
        )
      })}
    </div>
  )
}
