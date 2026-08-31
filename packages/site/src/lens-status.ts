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
  const coChangeOf = useGraphStore((s) => s.coChangeOf)
  const coChangeWith = useGraphStore((s) => s.coChangeWith)
  const hotspotHeat = useGraphStore((s) => s.hotspotHeat)
  // read from the store rather than recomputed here: the viewer's panel and
  // this bubble have to be able to disagree about nothing
  const hotspotKnot = useGraphStore((s) => s.hotspotKnot)
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

  if (lens === "cochange" && coChangeOf) {
    const n = coChangeWith.size
    // the count and the strongest name: the claim is that these move together,
    // so the bubble carries how often rather than how many hops
    const [strongest] = [...coChangeWith].sort((a, b) => b[1] - a[1])
    return `co-change · ${label(coChangeOf)} moves with ${n} file${n === 1 ? "" : "s"} nothing imports${
      strongest ? ` — most often ${label(strongest[0])}` : ""
    }`
  }

  if (lens === "hotspots" && hotspotHeat.size > 0) {
    const n = hotspotHeat.size
    /**
     * The finding, not the size of the cut.
     *
     * This said "N of M files, hottest X — 22 changes, 29 dependants", which is
     * the headline the viewer itself dropped: a cut at the ninetieth percentile
     * of two distributions returns about a tenth of the files whatever the
     * repository looks like, so the number describes the cut and not the code.
     * What the lens reports is the part of that ranking nobody can change on
     * their own.
     *
     * And when there is no cycle to report it says so, which is the honest
     * thing and a good look: this landing runs on trame's own source, which has
     * none. A lens that invents a finding when there is none is a lens nobody
     * should trust with the times there is one.
     */
    if (hotspotKnot.size > 0) {
      return `hotspots · ${hotspotKnot.size} of ${n} caught in an import cycle`
    }
    return `hotspots · ${n} of ${total} files under pressure — none of them in a cycle`
  }

  if (lens === "replay" && timeline) {
    const frame = timeline.frames[frameIndex]
    if (!frame) return null
    // the real commit subject, walking past
    return `${frame.date.slice(0, 10)} · ${frame.subject} · ${frame.nodeCount} files`
  }

  return null
}
