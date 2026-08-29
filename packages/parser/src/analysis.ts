import type { GraphData } from "./types.js"

/** Files that are entrypoints by convention, never dead whoever imports them. */
const ENTRY_BASENAMES = /^(main|index|app|root|setup|vite-env|middleware|instrumentation)$/i

/**
 * Filenames a router reserves. The framework calls these by name; no file in
 * the repository imports them, and that is the point of the convention.
 *
 * Leaving `route` off this list cost dub 481 of its 650 reported orphans:
 * three quarters of the finding was App Router doing what it promises. The list
 * is Next.js's, but the failure mode belongs to any convention-over-imports
 * framework, so it is deliberately generous.
 */
const ROUTER_FILES =
  /^(route|page|layout|template|default|loading|error|global-error|not-found|manifest|sitemap|robots|icon|apple-icon|opengraph-image|twitter-image)$/i

/**
 * `vitest.config.ts`, `auth.setup.ts`, `env.d.ts`: named for the tool that
 * reads them rather than for anything that imports them.
 */
const NAMED_FOR_A_TOOL = /\.(config|setup|d)$/i

/**
 * Directories whose contents are invoked from outside the codebase, so an
 * import graph has nothing to say about whether they are still wanted.
 *
 * Two ways the verdict goes wrong. Scripts are run by hand: 26 of dub's 28 are
 * not wired into a package.json script, which is normal. Test helpers are
 * worse, since the default exclude drops `*.test.ts`, so the files that import
 * them are not in the graph and every helper looks abandoned by construction.
 */
const RUN_FROM_OUTSIDE = /(^|\/)(scripts|bin|tests?|e2e|__tests__|playwright|cypress)\//i

/**
 * A node nothing imports, that isn't an entrypoint or a route, is probably
 * dead code. Synthetic nodes (API endpoints, query keys) are always leaves,
 * so they're excluded.
 *
 * The bar is deliberately high, because this prints as a headline count and a
 * list that is mostly wrong gets ignored whole, real findings included.
 */
export function findOrphans(graph: GraphData): string[] {
  const imported = new Set(graph.edges.map((e) => e.target))
  return graph.nodes
    .filter((n) => {
      if (imported.has(n.id)) return false
      if (n.type === "page" || n.type === "api" || n.type === "query-key") return false
      if (RUN_FROM_OUTSIDE.test(n.file)) return false
      const base = (n.id.split("/").pop() ?? "").replace(/\.[jt]sx?$/, "")
      if (ENTRY_BASENAMES.test(base)) return false
      if (ROUTER_FILES.test(base)) return false
      if (NAMED_FOR_A_TOOL.test(base)) return false
      return true
    })
    .map((n) => n.id)
}

/**
 * Tarjan's strongly-connected components: every SCC larger than one node is a
 * dependency cycle. Iterative to survive deep graphs.
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

      // done with this node: close its SCC or bubble the lowlink up
      work.pop()
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = []
        for (;;) {
          const id = stack.pop()!
          onStack.delete(id)
          component.push(id)
          if (id === frame.node) break
        }
        // built three lines up and handed over here: reversing it in place is
        // the last thing that happens to it
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
