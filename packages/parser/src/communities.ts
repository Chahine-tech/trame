import type { GraphData } from "./types.js"

/**
 * Where the module boundaries actually are, as opposed to where the folders say.
 *
 * Finds the groups of files that depend on each other far more than on anything
 * else, then reports where that disagrees with the directories: a folder
 * holding three unrelated things, or two folders that are one module.
 *
 * Louvain, on the import graph treated as undirected: if A imports B the two
 * are coupled, and the arrow's direction says nothing about whether they
 * belong together.
 */

/** An undirected, weighted view of the graph; parallel edges become weight. */
interface Weighted {
  ids: string[]
  /** neighbour index mapped to weight, per node index */
  adj: Map<number, number>[]
  /** summed weight incident to each node, self-loops counted twice */
  degree: number[]
  /** total edge weight */
  m: number
}

function weigh(nodes: string[], links: { a: number; b: number; w: number }[]): Weighted {
  const adj: Map<number, number>[] = nodes.map(() => new Map())
  const degree = new Array(nodes.length).fill(0)
  let m = 0
  for (const { a, b, w } of links) {
    adj[a]!.set(b, (adj[a]!.get(b) ?? 0) + w)
    degree[a]! += w
    if (a !== b) {
      adj[b]!.set(a, (adj[b]!.get(a) ?? 0) + w)
      degree[b]! += w
    } else {
      // a self-loop contributes to its own degree twice, by convention
      degree[a]! += w
    }
    m += w
  }
  return { ids: nodes, adj, degree, m }
}

/**
 * Newman's modularity of a partition: how much more edge weight falls inside
 * the groups than chance would put there. Above roughly 0.3 is a real
 * structure; near 0 means the grouping says nothing the graph agrees with.
 */
export function modularity(g: Weighted, community: number[]): number {
  if (g.m === 0) return 0
  const inside = new Map<number, number>()
  const total = new Map<number, number>()
  for (let i = 0; i < g.ids.length; i++) {
    const c = community[i]!
    total.set(c, (total.get(c) ?? 0) + g.degree[i]!)
    for (const [j, w] of g.adj[i]!) {
      if (community[j] === c) inside.set(c, (inside.get(c) ?? 0) + w)
    }
  }
  let q = 0
  for (const [c, tot] of total) {
    // adjacency is stored both ways, so the inside sum is already doubled
    const inW = (inside.get(c) ?? 0) / 2
    q += inW / g.m - (tot / (2 * g.m)) ** 2
  }
  return q
}

/** One pass of moving each node to the neighbouring community that pays most. */
function localMoves(g: Weighted): { community: number[]; improved: boolean } {
  const community = g.ids.map((_, i) => i)
  const totals = [...g.degree]
  let improved = false

  // sorted visit order: Louvain depends on it, and two runs of a tool must
  // not disagree about the architecture of the same codebase
  const order = g.ids.map((_, i) => i).sort((x, y) => g.ids[x]!.localeCompare(g.ids[y]!))

  for (let sweep = 0; sweep < 20; sweep++) {
    let moved = false
    for (const i of order) {
      const from = community[i]!
      const ki = g.degree[i]!

      // weight from i into each candidate community
      const into = new Map<number, number>()
      for (const [j, w] of g.adj[i]!) {
        if (j === i) continue
        into.set(community[j]!, (into.get(community[j]!) ?? 0) + w)
      }

      totals[from]! -= ki
      let best = from
      let bestGain = (into.get(from) ?? 0) / g.m - (totals[from]! * ki) / (2 * g.m ** 2)
      for (const [c, w] of into) {
        if (c === from) continue
        const gain = w / g.m - (totals[c]! * ki) / (2 * g.m ** 2)
        if (gain > bestGain + 1e-12) {
          bestGain = gain
          best = c
        }
      }
      totals[best]! += ki
      if (best !== from) {
        community[i] = best
        moved = true
        improved = true
      }
    }
    if (!moved) break
  }
  return { community, improved }
}

/** Collapse each community into a single node, keeping the weights between them. */
function aggregate(g: Weighted, community: number[]): { next: Weighted; map: number[] } {
  const seen = new Map<number, number>()
  for (const c of community) if (!seen.has(c)) seen.set(c, seen.size)
  const map = community.map((c) => seen.get(c)!)

  const links: { a: number; b: number; w: number }[] = []
  const between = new Map<string, number>()
  for (let i = 0; i < g.ids.length; i++) {
    for (const [j, w] of g.adj[i]!) {
      if (j < i) continue // each undirected pair once
      const a = map[i]!
      const b = map[j]!
      const key = a <= b ? `${a},${b}` : `${b},${a}`
      between.set(key, (between.get(key) ?? 0) + w)
    }
  }
  for (const [key, w] of between) {
    const [a, b] = key.split(",").map(Number)
    links.push({ a: a!, b: b!, w })
  }
  const ids = Array.from({ length: seen.size }, (_, k) => `c${k}`)
  return { next: weigh(ids, links), map }
}

export interface Communities {
  /** file id → community number */
  of: Map<string, number>
  /** how well the found grouping explains the graph */
  quality: number
  /** how well the folder tree explains it, for comparison */
  folderQuality: number
}

/**
 * Endpoints and query keys are not files. They are synthetic nodes trame adds
 * to show what the code talks to, and they are leaves by construction: each
 * pulls its callers toward a community of its own and reports "api/ holds two
 * groups" about things that were never in a folder.
 */
const SYNTHETIC = new Set(["api", "query-key"])

export function findCommunities(graph: GraphData): Communities {
  const real = graph.nodes.filter((n) => !SYNTHETIC.has(n.type))
  graph = { ...graph, nodes: real, edges: graph.edges }
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const links: { a: number; b: number; w: number }[] = []
  for (const e of graph.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    links.push({ a, b, w: 1 })
  }

  const base = weigh(
    graph.nodes.map((n) => n.id),
    links,
  )

  // multi-level: solve, collapse, solve again, until a pass buys nothing
  let level = base
  let assignment = graph.nodes.map((_, i) => i)
  for (let depth = 0; depth < 10; depth++) {
    const { community, improved } = localMoves(level)
    if (!improved) break
    const { next, map } = aggregate(level, community)
    assignment = assignment.map((c) => map[c]!)
    if (next.ids.length === level.ids.length) break
    level = next
  }

  const of = new Map(graph.nodes.map((n, i) => [n.id, assignment[i]!]))

  // the folder tree, scored the same way, so the two numbers are comparable
  const folderId = new Map<string, number>()
  const folders = graph.nodes.map((n) => {
    if (!folderId.has(n.cluster)) folderId.set(n.cluster, folderId.size)
    return folderId.get(n.cluster)!
  })

  return {
    of,
    quality: modularity(base, assignment),
    folderQuality: modularity(base, folders),
  }
}

export interface Disagreement {
  /** a folder whose files fall into several communities */
  split: { folder: string; parts: string[][] }[]
  /** a community whose files come from several folders */
  merged: { folders: string[]; files: string[] }[]
}

/**
 * Where the tree and the graph disagree. The partition itself is an
 * implementation detail; what a person can act on is "this folder is three
 * things" and "these two folders are one".
 */
export function disagreements(graph: GraphData, found: Communities): Disagreement {
  graph = { ...graph, nodes: graph.nodes.filter((n) => found.of.has(n.id)) }
  const folderOf = new Map(graph.nodes.map((n) => [n.id, n.cluster]))
  const byFolder = new Map<string, string[]>()
  const byCommunity = new Map<number, string[]>()
  for (const n of graph.nodes) {
    if (!byFolder.has(n.cluster)) byFolder.set(n.cluster, [])
    byFolder.get(n.cluster)!.push(n.id)
    const c = found.of.get(n.id)!
    if (!byCommunity.has(c)) byCommunity.set(c, [])
    byCommunity.get(c)!.push(n.id)
  }

  const split: Disagreement["split"] = []
  for (const [folder, files] of [...byFolder].sort()) {
    const groups = new Map<number, string[]>()
    for (const f of files) {
      const c = found.of.get(f)!
      if (!groups.has(c)) groups.set(c, [])
      groups.get(c)!.push(f)
    }
    /**
     * Three files, and a real share of the folder. On cal.com's 607-file `v2`
     * package the loose threshold reported 28 groups, twenty-four of them
     * pairs: separate communities, and worthless as advice.
     */
    const parts = [...groups.values()].filter(
      (g) => g.length >= 3 && g.length >= files.length * 0.15,
    )
    // sorted through a copy: these arrays are the map's own values, and sorting
    // them in place reorders what `groups` holds for a caller that never asked
    if (parts.length > 1) split.push({ folder, parts: parts.map((p) => [...p].sort()) })
  }

  const merged: Disagreement["merged"] = []
  for (const [, files] of [...byCommunity].sort((a, b) => a[0] - b[0])) {
    const folders = new Map<string, number>()
    for (const f of files) {
      const folder = folderOf.get(f)!
      folders.set(folder, (folders.get(folder) ?? 0) + 1)
    }
    // only when each folder contributes real substance, not one stray import
    const substantial = [...folders].filter(([, n]) => n > 1).map(([f]) => f)
    // `substantial` was built here and is ours to sort; `files` belongs to
    // `byCommunity` and is only borrowed
    if (substantial.length > 1)
      merged.push({ folders: substantial.sort(), files: [...files].sort() })
  }

  /**
   * Ranked, because the folder that alphabetically comes first is not the one
   * worth reading. A split is as strong as its *second* part: a package cut
   * 219/246 is two packages wearing one name, while 400/4 is a stray file.
   */
  split.sort((a, b) => (b.parts[1]?.length ?? 0) - (a.parts[1]?.length ?? 0))
  merged.sort((a, b) => b.files.length - a.files.length)
  return { split, merged }
}
