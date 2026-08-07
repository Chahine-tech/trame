import type { GraphData } from "./types.js"

/** Files that are entrypoints by convention — never dead, whoever imports them. */
const ENTRY_BASENAMES = /^(main|index|app|root|layout|page|setup|vite-env)$/i

/**
 * A node nothing imports, that isn't an entrypoint or a route, is probably
 * dead code. Synthetic nodes (API endpoints, query keys) are always leaves,
 * so they're excluded.
 */
export function findOrphans(graph: GraphData): string[] {
  const imported = new Set(graph.edges.map((e) => e.target))
  return graph.nodes
    .filter((n) => {
      if (imported.has(n.id)) return false
      if (n.type === "page" || n.type === "api" || n.type === "query-key") return false
      const base = (n.id.split("/").pop() ?? "").replace(/\.[jt]sx?$/, "")
      if (ENTRY_BASENAMES.test(base)) return false
      return true
    })
    .map((n) => n.id)
}

/**
 * Tarjan's strongly-connected components — every SCC larger than one node
 * is a dependency cycle. Iterative to survive deep graphs.
 */
export function findCycles(graph: GraphData): string[][] {
  const adj = new Map<string, string[]>()
  for (const n of graph.nodes) adj.set(n.id, [])
  for (const e of graph.edges) adj.get(e.source)?.push(e.target)

  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  let counter = 0

  for (const start of adj.keys()) {
    if (index.has(start)) continue

    // frame: node + how many of its successors we've already walked
    const work: { node: string; i: number }[] = [{ node: start, i: 0 }]
    index.set(start, counter)
    low.set(start, counter)
    counter++
    stack.push(start)
    onStack.add(start)

    while (work.length > 0) {
      const frame = work[work.length - 1]!
      const successors = adj.get(frame.node) ?? []

      if (frame.i < successors.length) {
        const next = successors[frame.i]!
        frame.i++
        if (!index.has(next)) {
          index.set(next, counter)
          low.set(next, counter)
          counter++
          stack.push(next)
          onStack.add(next)
          work.push({ node: next, i: 0 })
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!))
        }
        continue
      }

      // done with this node — close its SCC or bubble the lowlink up
      work.pop()
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = []
        for (;;) {
          const id = stack.pop()!
          onStack.delete(id)
          component.push(id)
          if (id === frame.node) break
        }
        if (component.length > 1) cycles.push(component.reverse())
      }
      const parent = work[work.length - 1]
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!))
      }
    }
  }

  return cycles
}
