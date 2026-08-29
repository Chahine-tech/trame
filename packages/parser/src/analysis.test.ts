import { describe, expect, it } from "vitest"
import { findCycles, findOrphans } from "./analysis.js"
import type { GraphData, GraphNode, NodeType } from "./types.js"

function node(id: string, type: NodeType = "module"): GraphNode {
  return { id, label: id.split("/").pop() ?? id, type, file: id, line: 1, cluster: "src" }
}

function graph(
  ids: string[],
  links: [string, string][],
  types: Record<string, NodeType> = {},
): GraphData {
  return {
    meta: { project: "t", generated: "", nodeCount: ids.length, edgeCount: links.length },
    nodes: ids.map((id) => node(id, types[id] ?? "module")),
    edges: links.map(([source, target], i) => ({
      id: `e${i}`,
      source,
      target,
      type: "import" as const,
    })),
    clusters: [],
  }
}

describe("findCycles", () => {
  it("reports nothing on an acyclic graph", () => {
    expect(
      findCycles(
        graph(
          ["a", "b", "c"],
          [
            ["a", "b"],
            ["b", "c"],
          ],
        ),
      ),
    ).toEqual([])
  })

  it("finds a two-node cycle", () => {
    const cycles = findCycles(
      graph(
        ["a", "b"],
        [
          ["a", "b"],
          ["b", "a"],
        ],
      ),
    )
    expect(cycles).toHaveLength(1)
    expect([...cycles[0]!].sort()).toEqual(["a", "b"])
  })

  it("finds a longer cycle without dragging in the nodes that merely reach it", () => {
    const cycles = findCycles(
      graph(
        ["entry", "a", "b", "c"],
        [
          ["entry", "a"],
          ["a", "b"],
          ["b", "c"],
          ["c", "a"],
        ],
      ),
    )
    expect(cycles).toHaveLength(1)
    expect([...cycles[0]!].sort()).toEqual(["a", "b", "c"])
  })

  it("separates two independent cycles", () => {
    const cycles = findCycles(
      graph(
        ["a", "b", "x", "y"],
        [
          ["a", "b"],
          ["b", "a"],
          ["x", "y"],
          ["y", "x"],
        ],
      ),
    )
    expect(cycles).toHaveLength(2)
    expect(cycles.map((c) => [...c].sort()).sort()).toEqual([
      ["a", "b"],
      ["x", "y"],
    ])
  })

  it("does not report a file that imports itself", () => {
    // documenting the current contract, not endorsing it: Tarjan yields a
    // single-node component here and the filter drops it. A self-import is
    // arguably a cycle; if that changes, this test should change with it.
    expect(findCycles(graph(["a"], [["a", "a"]]))).toEqual([])
  })

  it("survives a chain deep enough to blow a recursive implementation", () => {
    // the comment on findCycles promises "iterative to survive deep graphs";
    // 20k frames is well past the default call stack
    const ids = Array.from({ length: 20_000 }, (_, i) => `n${i}`)
    const links = ids.slice(0, -1).map((id, i) => [id, `n${i + 1}`] as [string, string])
    links.push(["n19999", "n0"]) // close it, so there is something to find
    const cycles = findCycles(graph(ids, links))
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toHaveLength(20_000)
  })
})

describe("findOrphans", () => {
  it("reports a module nothing imports", () => {
    expect(findOrphans(graph(["a", "b"], [["a", "b"]]))).toEqual(["a"])
  })

  it("never reports an entrypoint, whoever imports it", () => {
    const g = graph(["src/main.ts", "src/index.tsx", "src/App.tsx", "src/lonely.ts"], [])
    expect(findOrphans(g)).toEqual(["src/lonely.ts"])
  })

  it("never reports a file the router calls by name", () => {
    // dub reported 650 orphans, 481 of them `route.ts`. App Router calls
    // those; nothing in the repository imports them, by design.
    const g = graph(
      [
        "app/api/links/route.ts",
        "app/(dash)/page.tsx",
        "app/layout.tsx",
        "app/loading.tsx",
        "app/not-found.tsx",
        "app/sitemap.ts",
        "lib/lonely.ts",
      ],
      [],
    )
    expect(findOrphans(g)).toEqual(["lib/lonely.ts"])
  })

  it("never reports a file named for the tool that runs it", () => {
    const g = graph(
      [
        "vitest.config.ts",
        "playwright/auth.setup.ts",
        "env.d.ts",
        "middleware.ts",
        "lib/lonely.ts",
      ],
      [],
    )
    expect(findOrphans(g)).toEqual(["lib/lonely.ts"])
  })

  it("never reports a file run from outside the codebase", () => {
    // the callers are a shell prompt or a test runner. Worse for helpers: the
    // default exclude drops `*.test.ts`, so whatever imports them is not in
    // the graph, and they look abandoned by construction.
    const g = graph(
      [
        "scripts/backfill-sales.ts",
        "tests/utils/helpers.ts",
        "playwright/seed.ts",
        "lib/lonely.ts",
      ],
      [],
    )
    expect(findOrphans(g)).toEqual(["lib/lonely.ts"])
  })

  it("still reports a file that merely sits beside the conventions", () => {
    // the guard is on the filename, not the folder: dead code under app/
    // is still dead code
    const g = graph(["app/api/links/helpers.ts", "app/api/links/route.ts"], [])
    expect(findOrphans(g)).toEqual(["app/api/links/helpers.ts"])
  })

  it("never reports synthetic nodes, which are leaves by construction", () => {
    const g = graph(["p", "a", "q", "m"], [], {
      p: "page",
      a: "api",
      q: "query-key",
      m: "module",
    })
    expect(findOrphans(g)).toEqual(["m"])
  })
})
