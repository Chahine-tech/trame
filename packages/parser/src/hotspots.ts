import path from "node:path"
import { readCommitFiles } from "./cochange.js"
import type { GraphData, Hotspot } from "./types.js"

/**
 * Where change and consequence meet.
 *
 * Neither half is a finding on its own. Churn alone lists what people edit,
 * which on dub is mostly UI. Weight alone lists the pillars: `lib/prisma`
 * carries 858 dependants and was touched once all year, which is a structure
 * working, not a risk. It is the product that says something — a file many
 * others rest on, rewritten again and again, is where a mistake travels
 * furthest and where it is most likely to be made.
 */
export interface HotspotOptions {
  /**
   * How far into each tail a file must be, on both axes.
   *
   * A share rather than a count, so the rule survives a change of scale, the
   * same reason `impassable` takes one. Measured on dub over a year, 5103
   * commits touching 3025 of its 3547 files:
   *
   *   p80   churn >= 6    degree >= 9    409 files, 11.5% of the graph
   *   p90   churn >= 11   degree >= 12   150 files,  4.2%
   *   p95   churn >= 17   degree >= 17    60 files,  1.7%
   *
   * At 0.9 the list is `lib/types.ts` (132 changes, 773 dependants), then the
   * whole `lib/zod/schemas` layer, then `lib/api/create-id.ts`. That reads as
   * an architectural claim about dub rather than as a list of busy files.
   */
  percentile: number
}

export const DEFAULTS: HotspotOptions = { percentile: 0.9 }

function threshold(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)] ?? 0
}

/**
 * The pairs of counts that clear both tails, heaviest first.
 *
 * Separated from the git call so the arithmetic can be exercised without a
 * repository, the split `replay.ts` and `cochange.ts` both make.
 *
 * Ranked by the product, which is what orders `lib/types.ts` above a file
 * changed as often with a tenth of the dependants.
 */
export function hotspots(
  churn: Map<string, number>,
  degree: Map<string, number>,
  ids: string[],
  opts: HotspotOptions = DEFAULTS,
): Hotspot[] {
  if (ids.length === 0) return []
  const rows = ids.map((id) => ({
    id,
    churn: churn.get(id) ?? 0,
    degree: degree.get(id) ?? 0,
  }))
  const minChurn = threshold(
    rows.map((r) => r.churn),
    opts.percentile,
  )
  const minDegree = threshold(
    rows.map((r) => r.degree),
    opts.percentile,
  )

  return rows
    .filter((r) => r.churn > 0 && r.churn >= minChurn && r.degree >= minDegree)
    .sort((a, b) => b.churn * b.degree - a.churn * a.degree || a.id.localeCompare(b.id))
}

/**
 * The hotspots of a graph, in the ids the viewer uses.
 *
 * Reads the same log `coChangeFor` does, once more rather than once between
 * them: a second pass costs about a third of a second on dub's year, and
 * threading the commits through both would put the CLI in charge of a detail
 * neither analysis should expose.
 *
 * Returns nothing rather than throwing where there is no repository, no git or
 * no history: a graph may have hotspots, a parse does not depend on them.
 */
export function hotspotsFor(
  graph: GraphData,
  repo: string,
  srcRoot: string,
  since: string,
  opts: HotspotOptions = DEFAULTS,
): Hotspot[] {
  const prefix = path.relative(path.resolve(repo), path.resolve(srcRoot)).split(path.sep).join("/")
  if (prefix.startsWith("..")) return []
  const at = (id: string) => (prefix ? `${prefix}/${id}` : id)

  const known = new Map(graph.nodes.map((n) => [at(n.id), n.id]))
  const degree = new Map<string, number>()
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }

  let commits: string[][]
  try {
    commits = readCommitFiles(repo, since)
  } catch {
    return []
  }
  const churn = new Map<string, number>()
  for (const commit of commits) {
    for (const file of new Set(commit)) {
      const id = known.get(file)
      if (id) churn.set(id, (churn.get(id) ?? 0) + 1)
    }
  }
  return hotspots(
    churn,
    degree,
    graph.nodes.map((n) => n.id),
    opts,
  )
}
