import { describe, expect, it } from "vitest"
import { diagnose } from "./doctor.js"
import type { GraphData, NodeType } from "./types.js"

function graph(
  ids: string[],
  links: [string, string][],
  types: Record<string, NodeType> = {},
): GraphData {
  return {
    meta: { project: "t", generated: "", nodeCount: ids.length, edgeCount: links.length },
    nodes: ids.map((id) => ({
      id,
      label: id,
      type: types[id] ?? ("module" as NodeType),
      file: id,
      line: 1,
      cluster: "src",
    })),
    edges: links.map(([source, target], i) => ({
      id: `e${i}`,
      source,
      target,
      type: "import" as const,
    })),
    clusters: [],
  }
}

describe("cycles", () => {
  it("says nothing about a graph with nothing wrong", () => {
    // entry is an entrypoint by name, so it is not reported as dead either
    expect(diagnose(graph(["main", "b"], [["main", "b"]]))).toEqual([])
  })

  it("names an import that verifiably breaks the loop", () => {
    const g = graph(
      ["main", "a", "b"],
      [
        ["main", "a"],
        ["a", "b"],
        ["b", "a"],
      ],
    )
    const cycle = diagnose(g).find((f) => f.kind === "cycle")
    expect(cycle).toBeDefined()
    expect(cycle!.fix).toMatch(/Remove the import of/)
    expect(cycle!.fix).toMatch(/free 2 of them/)
  })

  it("prefers the cut that frees the most files when a graph holds two loops", () => {
    // one edge, b→a, closes both a→b→a and a→c→b→a: cutting it frees all three
    const g = graph(
      ["main", "a", "b", "c"],
      [
        ["main", "a"],
        ["a", "b"],
        ["b", "a"],
        ["a", "c"],
        ["c", "b"],
      ],
    )
    const cycle = diagnose(g).find((f) => f.kind === "cycle")!
    expect(cycle.fix).toMatch(/Remove the import of a from b/)
    expect(cycle.impact).toBe(3)
  })

  it("admits when no single import is enough", () => {
    // two independent loops inside one component: cutting one leaves the other
    const g = graph(
      ["main", "a", "b", "c", "d"],
      [
        ["main", "a"],
        ["a", "b"],
        ["b", "a"],
        ["c", "d"],
        ["d", "c"],
        ["b", "c"],
        ["d", "a"],
      ],
    )
    const cycle = diagnose(g).find((f) => f.kind === "cycle")!
    expect(cycle.impact).toBeGreaterThan(0)
  })
})

describe("dead code", () => {
  it("counts the private helpers an unreferenced file keeps alive", () => {
    // nothing imports "widow"; helper and deep exist only because it does
    const g = graph(
      ["main", "widow", "helper", "deep"],
      [
        ["widow", "helper"],
        ["helper", "deep"],
      ],
    )
    const orphan = diagnose(g).find((f) => f.kind === "orphan" && f.nodeIds[0] === "widow")!
    expect(orphan.nodeIds).toEqual(["widow", "helper", "deep"])
    expect(orphan.fix).toMatch(/removes 3 files/)
  })

  it("does not claim a helper that something else still uses", () => {
    // shared is imported by main too, so deleting widow does not remove it
    const g = graph(
      ["main", "widow", "shared"],
      [
        ["widow", "shared"],
        ["main", "shared"],
      ],
    )
    const orphan = diagnose(g).find((f) => f.nodeIds[0] === "widow")!
    expect(orphan.nodeIds).toEqual(["widow"])
    expect(orphan.fix).toMatch(/removes 1 file/)
  })
})

describe("ordering", () => {
  it("puts a cycle above dead code, however much the dead code weighs", () => {
    // a cycle is a fact about the graph; "nothing imports this" is an inference
    // that dynamic imports, framework routes and excluded tests can each
    // falsify. Four suspected dead files must not outrank two genuinely tangled
    // ones: on cal.com that ordering buried 24 real cycles under 1327 guesses.
    const g = graph(
      ["main", "a", "b", "widow", "h1", "h2", "h3"],
      [
        ["main", "a"],
        ["a", "b"],
        ["b", "a"],
        ["widow", "h1"],
        ["h1", "h2"],
        ["h2", "h3"],
      ],
    )
    const found = diagnose(g)
    expect(found[0]!.kind).toBe("cycle")
    expect(found.some((f) => f.kind === "orphan" && f.nodeIds.length === 4)).toBe(true)
  })

  it("still orders dead code by how much of it there is", () => {
    const g = graph(
      ["main", "small", "big", "b1", "b2", "b3"],
      [
        ["big", "b1"],
        ["b1", "b2"],
        ["b2", "b3"],
      ],
    )
    const orphans = diagnose(g).filter((f) => f.kind === "orphan")
    expect(orphans[0]!.nodeIds.length).toBeGreaterThan(orphans[1]!.nodeIds.length)
  })

  it("is stable across runs so a diff of two reports means something", () => {
    const g = graph(
      ["main", "x", "y"],
      [
        ["main", "x"],
        ["main", "y"],
      ],
    )
    expect(diagnose(g).map((f) => f.title)).toEqual(diagnose(g).map((f) => f.title))
  })
})
