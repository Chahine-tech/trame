import { useGraphStore } from "@trame/viewer/store/graph"

/**
 * What the active lens found, in one line. Not a restatement of the section
 * headline: these numbers come from the graph on screen, through the same code
 * the viewer runs. Null when no lens is on, so no stale bubble lingers.
 */
export function useLensStatus(): string | null {
  const lens = useGraphStore((s) => s.lens)
  const total = useGraphStore((s) => s.data?.nodes.length ?? 0)
  const impactDepth = useGraphStore((s) => s.impactDepth)
  const pathNodes = useGraphStore((s) => s.pathNodes)
  const whatIf = useGraphStore((s) => s.whatIf)
  const timeline = useGraphStore((s) => s.timeline)
  const frameIndex = useGraphStore((s) => s.frameIndex)
  const data = useGraphStore((s) => s.data)

  if (!data) return null
  // a Map, not a scan per hop: a traced path can be long and this runs on
  // every frame the bubble is on screen
  const names = new Map(data.nodes.map((n) => [n.id, n.label]))
  const label = (id: string) => names.get(id) ?? id

  if (lens === "impact") {
    // the selection counts itself, and it is not something that "would break"
    const affected = Math.max(impactDepth.size - 1, 0)
    return `impact · ${affected} of ${total} files would break`
  }

  if (lens === "path" && pathNodes.length > 1) {
    return `path · ${pathNodes.map(label).join(" → ")}`
  }

  if (lens === "whatif" && whatIf) {
    const { orphaned, broken } = whatIf
    // plain counts, plainly plural: a bubble is not the place for a table
    const parts = [
      `${broken.length} import${broken.length === 1 ? "" : "s"} broken`,
      `${orphaned.length} file${orphaned.length === 1 ? "" : "s"} stranded`,
    ]
    return `what if · deleting ${whatIf.label} — ${parts.join(", ")}`
  }

  if (lens === "replay" && timeline) {
    const frame = timeline.frames[frameIndex]
    if (!frame) return null
    // the real commit subject, walking past
    return `${frame.date.slice(0, 10)} · ${frame.subject} · ${frame.nodeCount} files`
  }

  return null
}
