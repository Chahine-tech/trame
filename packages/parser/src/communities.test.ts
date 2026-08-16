import { describe, expect, it } from "vitest"
import { disagreements, findCommunities } from "./communities.js"
import type { GraphData } from "./types.js"

function graph(links: [string, string][], folderOf: (id: string) => string = () => "src"): GraphData {
  const ids = [...new Set(links.flat())].sort()
  return {
    meta: { project: "t", generated: "", nodeCount: ids.length, edgeCount: links.length },
    nodes: ids.map((id) => ({
      id,
      label: id,
      type: "module" as const,
      file: id,
      line: 1,
      cluster: folderOf(id),
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

/** Every pair inside a group, so the group is unmistakably one community. */
const clique = (names: string[]): [string, string][] =>
  names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b] as [string, string]))

describe("findCommunities", () => {
  it("separates two clusters joined by a single import", () => {
    // the textbook case: two tight groups, one thread between them
    const g = graph([...clique(["a1", "a2", "a3", "a4"]), ...clique(["b1", "b2", "b3", "b4"]), ["a1", "b1"]])
    const { of, quality } = findCommunities(g)
    expect(of.get("a1")).toBe(of.get("a4"))
    expect(of.get("b1")).toBe(of.get("b4"))
    expect(of.get("a1")).not.toBe(of.get("b1"))
    // a real split scores well above the 0.3 that means "structure exists"
    expect(quality).toBeGreaterThan(0.3)
  })

  it("finds no structure in a graph that has none", () => {
    // everything connected to everything: no grouping beats chance
    const g = graph(clique(["a", "b", "c", "d", "e"]))
    expect(findCommunities(g).quality).toBeLessThan(0.1)
  })

  it("gives the same answer twice", () => {
    // Louvain depends on visit order, and a tool that changes its mind about
    // the same codebase between two runs cannot be believed
    const g = graph([...clique(["x1", "x2", "x3"]), ...clique(["y1", "y2", "y3"]), ["x1", "y1"]])
    const a = [...findCommunities(g).of.entries()].sort()
    const b = [...findCommunities(g).of.entries()].sort()
    expect(a).toEqual(b)
  })

  it("survives a graph with no edges at all", () => {
    const g: GraphData = {
      meta: { project: "t", generated: "", nodeCount: 1, edgeCount: 0 },
      nodes: [{ id: "lonely", label: "lonely", type: "module", file: "lonely", line: 1, cluster: "src" }],
      edges: [],
      clusters: [],
    }
    expect(() => findCommunities(g)).not.toThrow()
    expect(findCommunities(g).quality).toBe(0)
  })
})

describe("disagreements", () => {
  it("reports a folder that holds two unrelated things", () => {
    // one folder, two groups that never touch: the directory is a filing
    // decision, not an architectural one
    const g = graph(
      [...clique(["utils/a1", "utils/a2", "utils/a3"]), ...clique(["utils/b1", "utils/b2", "utils/b3"])],
      () => "utils",
    )
    const { split } = disagreements(g, findCommunities(g))
    expect(split).toHaveLength(1)
    expect(split[0]!.folder).toBe("utils")
    expect(split[0]!.parts).toHaveLength(2)
  })

  it("reports two folders that are really one module", () => {
    const g = graph(
      clique(["chart/a", "chart/b", "series/a", "series/b"]),
      (id) => id.split("/")[0]!,
    )
    const { merged } = disagreements(g, findCommunities(g))
    expect(merged).toHaveLength(1)
    expect(merged[0]!.folders).toEqual(["chart", "series"])
  })

  it("stays quiet when the folders already match the structure", () => {
    // two folders, two communities, one thread between them: nothing to say
    const g = graph(
      [...clique(["ui/a", "ui/b", "ui/c"]), ...clique(["db/a", "db/b", "db/c"]), ["ui/a", "db/a"]],
      (id) => id.split("/")[0]!,
    )
    const found = disagreements(g, findCommunities(g))
    expect(found.split).toEqual([])
    expect(found.merged).toEqual([])
  })

  it("ignores a single stray file rather than calling it a module", () => {
    // one file drifting into another community is noise, not a boundary
    const g = graph(
      [...clique(["ui/a", "ui/b", "ui/c"]), ["ui/stray", "db/a"], ...clique(["db/a", "db/b", "db/c"])],
      (id) => id.split("/")[0]!,
    )
    const { split } = disagreements(g, findCommunities(g))
    expect(split).toEqual([])
  })
})
