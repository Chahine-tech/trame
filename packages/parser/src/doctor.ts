import { findCycles, findOrphans } from "./analysis.js"
import type { GraphData, GraphEdge } from "./types.js"

/**
 * What to fix, worst first.
 *
 * `check` answers "is anything broken" and gates CI on it. This answers the
 * question people actually have in front of a graph they did not draw: of
 * everything wrong here, what is worth my afternoon? A list of problems is not
 * advice until it is ordered and each item says what to do.
 */
export interface Finding {
  kind: "cycle" | "orphan" | "violation"
  /** what is wrong, in one line */
  title: string
  /** what to do about it */
  fix: string
  /** how much this one buys — the ranking key, comparable within a kind */
  impact: number
  nodeIds: string[]
}

/**
 * Above this many edges inside one cycle, stop searching for the cut.
 *
 * The search recomputes the components once per candidate edge, so it is
 * quadratic in a tangle's size. A knot that large is not going to be undone by
 * removing one import anyway, and saying so costs nothing.
 */
const CUT_SEARCH_LIMIT = 400

/** The graph reduced to a set of nodes, keeping only the edges between them. */
function subgraph(graph: GraphData, ids: Set<string>, without?: GraphEdge): GraphData {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => ids.has(n.id)),
    edges: graph.edges.filter(
      (e) => e !== without && ids.has(e.source) && ids.has(e.target),
    ),
  }
}

/** How many nodes remain caught in a cycle within this set of nodes. */
function tangled(graph: GraphData, ids: Set<string>, without?: GraphEdge): number {
  return findCycles(subgraph(graph, ids, without)).reduce((n, c) => n + c.length, 0)
}

/**
 * The single import whose removal frees the most files from a cycle.
 *
 * Found by trying, not by reasoning: `findCycles` returns strongly-connected
 * components, and an SCC of five files can hold many distinct loops, so
 * removing an edge that looks load-bearing may leave the tangle intact.
 * Recomputing after each candidate is the only way the advice can be stated as
 * a fact rather than a guess.
 */
function bestCut(
  graph: GraphData,
  cycle: string[],
): { edge: GraphEdge; frees: number } | null {
  const ids = new Set(cycle)
  const inside = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  if (inside.length === 0 || inside.length > CUT_SEARCH_LIMIT) return null

  const before = tangled(graph, ids)
  let best: { edge: GraphEdge; frees: number } | null = null
  for (const edge of inside) {
    const frees = before - tangled(graph, ids, edge)
    if (frees > 0 && (!best || frees > best.frees)) best = { edge, frees }
  }
  return best
}

/**
 * Everything that would disappear along with an unreferenced file.
 *
 * Dead code is rarely one file. A module nothing imports usually drags its own
 * private helpers with it, and those only look alive because it imports them —
 * so the honest cost of keeping it is the whole subtree, not the single node.
 */
function deadWeight(graph: GraphData, orphan: string): string[] {
  const importers = new Map<string, Set<string>>()
  const imports = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!importers.has(e.target)) importers.set(e.target, new Set())
    importers.get(e.target)!.add(e.source)
    if (!imports.has(e.source)) imports.set(e.source, [])
    imports.get(e.source)!.push(e.target)
  }

  const doomed = new Set([orphan])
  // grow the set while anything newly reachable has no surviving importer
  for (let changed = true; changed; ) {
    changed = false
    for (const id of [...doomed]) {
      for (const next of imports.get(id) ?? []) {
        if (doomed.has(next)) continue
        const alive = [...(importers.get(next) ?? [])].some((i) => !doomed.has(i))
        if (alive) continue
        doomed.add(next)
        changed = true
      }
    }
  }
  doomed.delete(orphan)
  return [...doomed]
}

export function diagnose(graph: GraphData): Finding[] {
  const findings: Finding[] = []
  // one index for the whole report: naming a cycle used to cost a linear scan
  // per file in it, so the report got slower the worse the news was
  const names = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const label = (id: string) => names.get(id) ?? id

  for (const cycle of findCycles(graph)) {
    const cut = bestCut(graph, cycle)
    const walk = cycle.map(label)
    findings.push({
      kind: "cycle",
      title: `${cycle.length} files depend on each other in a loop: ${walk.join(" → ")}`,
      fix: cut
        ? `Remove the import of ${label(cut.edge.target)} from ${label(cut.edge.source)} — verified to free ${cut.frees} of them.`
        : "No single import breaks this one; it needs more than one edge cut.",
      impact: cut ? cut.frees : cycle.length,
      nodeIds: cycle,
    })
  }

  for (const orphan of findOrphans(graph)) {
    const weight = deadWeight(graph, orphan)
    findings.push({
      kind: "orphan",
      title:
        weight.length > 0
          ? `${label(orphan)} is imported by nothing, and keeps ${weight.length} more file${weight.length === 1 ? "" : "s"} alive`
          : `${label(orphan)} is imported by nothing`,
      fix: `Delete it to remove ${weight.length + 1} file${weight.length === 0 ? "" : "s"} — or import it, if it is an entrypoint trame does not recognise.`,
      impact: weight.length + 1,
      nodeIds: [orphan, ...weight],
    })
  }

  for (const v of graph.violations ?? []) {
    findings.push({
      kind: "violation",
      title: v.message,
      fix: `Rule \`${v.rule}\` — ${v.nodeIds.length} file${v.nodeIds.length === 1 ? "" : "s"} involved.`,
      impact: v.nodeIds.length,
      nodeIds: v.nodeIds,
    })
  }

  // worst first, and a stable order within a tie so two runs agree
  return findings.sort((a, b) => b.impact - a.impact || a.title.localeCompare(b.title))
}
