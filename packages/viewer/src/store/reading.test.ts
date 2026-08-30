import { describe, expect, it } from "vitest"
import {
  coChangeReading,
  knotOf,
  hotspotReading,
  impactReading,
  pathReading,
  whatIfReading,
} from "./reading"
import type { GraphData, GraphNode, Hotspot } from "../types"

const node = (id: string): GraphNode => ({
  id,
  label: id.split("/").pop() ?? id,
  type: "module",
  file: `/${id}`,
  line: 1,
  cluster: id.split("/")[0] ?? "src",
})

const graph = (ids: string[], hotspots: Hotspot[], edges: [string, string][] = []): GraphData => ({
  meta: { project: "t", generated: "now", nodeCount: ids.length, edgeCount: edges.length },
  nodes: ids.map(node),
  edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target, type: "import" })),
  clusters: [],
  hotspots,
})

const many = (dir: string, n: number) => Array.from({ length: n }, (_, i) => `${dir}/f${i}.ts`)

describe("the reading of the knot", () => {
  const knotted = (ids: string[], hotspots: Hotspot[], cycles: string[][]): GraphData => {
    const g = graph(ids, hotspots)
    g.analysis = { orphans: [], cycles }
    return g
  }

  it("ties the knot with imports that exist, never with the order of the array", () => {
    /**
     * The parser finds cycles with Tarjan, so a "cycle" is a strongly connected
     * component — a set of nodes, not a walk around a loop. Joining the array up
     * in order would draw lines nobody wrote. The induced subgraph invents
     * nothing: every line is an import that is in the graph.
     *
     * Measured on dub, 325 imports run inside a component and 273 inside one
     * that holds a hotspot, out of 13 014.
     */
    const g = graph(
      ["a.ts", "b.ts", "c.ts", "out.ts"],
      [{ id: "a.ts", churn: 9, degree: 9 }],
      [
        ["a.ts", "b.ts"],
        ["b.ts", "c.ts"],
        ["c.ts", "a.ts"],
        ["a.ts", "out.ts"],
      ],
    )
    // the component is listed in an order its imports do not follow
    g.analysis = { orphans: [], cycles: [["c.ts", "a.ts", "b.ts"]] }
    const knot = knotOf(g)
    expect([...knot.files]).toEqual(["a.ts"])
    // the three imports inside the component, and not the one leaving it
    expect([...knot.edges].sort()).toEqual(["e0", "e1", "e2"])
  })

  it("leaves alone a cycle the ranking never reaches", () => {
    // a cycle among files nobody is rewriting is a fact about the codebase, not
    // this lens's finding
    const g = graph(
      ["a.ts", "b.ts", "x.ts", "y.ts"],
      [{ id: "a.ts", churn: 9, degree: 9 }],
      [
        ["a.ts", "b.ts"],
        ["b.ts", "a.ts"],
        ["x.ts", "y.ts"],
        ["y.ts", "x.ts"],
      ],
    )
    g.analysis = {
      orphans: [],
      cycles: [
        ["a.ts", "b.ts"],
        ["x.ts", "y.ts"],
      ],
    }
    expect([...knotOf(g).edges].sort()).toEqual(["e0", "e1"])
  })

  it("leads with what cannot be changed alone, not with the size of the cut", () => {
    /**
     * "150 of 3562" is a percentile. A p90 cut on two distributions returns
     * about a tenth of the files whatever the repository looks like, so the
     * number is a property of the cut. Google deployed churn-based prediction
     * across its whole codebase and measured no change in developer behaviour;
     * the authors put it down to the output not being actionable. A file inside
     * an import cycle is actionable and its reason is showable, and it is the
     * one thing here that a history tool without an import graph cannot say.
     */
    const ids = many("lib/zod", 40)
    const hot = many("lib/zod", 20).map((id) => ({ id, churn: 20, degree: 20 }))
    const said = hotspotReading(knotted(ids, hot, [many("lib/zod", 6)])).join(" ")
    expect(said).toContain("6 of the 20 sit inside an import cycle")
    expect(said).toContain("none of them can be changed on its own")
  })

  it("says how far up the ranking the knot reaches, when it reaches", () => {
    // six files in a cycle is unremarkable among thousands; the top six of the
    // ranking being those six is a statement about how the codebase is built
    const ids = many("lib/zod", 40)
    const hot = many("lib/zod", 20).map((id) => ({ id, churn: 20, degree: 20 }))
    expect(hotspotReading(knotted(ids, hot, [many("lib/zod", 6)])).join(" ")).toContain(
      "The first 6 of the ranking are all in one",
    )
  })

  it("cannot be gerrymandered: one clean file at the top ends the run", () => {
    const ids = many("lib/zod", 40)
    const hot = many("lib/zod", 20).map((id) => ({ id, churn: 20, degree: 20 }))
    // everything from rank two on is knotted, and the claim is not made
    const said = hotspotReading(knotted(ids, hot, [many("lib/zod", 20).slice(1)])).join(" ")
    expect(said).not.toContain("The first")
  })

  it("stands the old shape sentences down once the knot has named the place", () => {
    // "21 of those 36 are in lib/zod" followed by "lib/zod is the densest" is
    // two sentences spent on one fact
    const ids = [...many("lib/zod", 40), ...many("app/web", 40)]
    const hot = [...many("lib/zod", 12), ...many("app/web", 4)].map((id) => ({
      id,
      churn: 20,
      degree: 20,
    }))
    const said = hotspotReading(knotted(ids, hot, [many("lib/zod", 10)]))
    expect(said.join(" ")).toContain("Every one of them is in lib/zod.")
    expect(said.join(" ")).not.toContain("is the densest")
  })

  it("says whether the knot is a problem now or a problem that was", () => {
    /**
     * The third of the three requirements from Google's study, and the one the
     * cycle does not cover: developers act on what is costing them today. A year
     * of history weighing every commit the same fails it, so the parser reports
     * the last quarter's count beside the total.
     */
    const ids = many("lib/zod", 40)
    const hot = (recents: number[]) =>
      many("lib/zod", 6).map((id, i) => ({ id, churn: 20, degree: 20, recent: recents[i]! }))
    const cycles = [many("lib/zod", 6)]

    expect(hotspotReading(knotted(ids, hot([3, 1, 2, 1, 4, 1]), cycles)).join(" ")).toContain(
      "All 6 were changed again in the last quarter",
    )
    expect(hotspotReading(knotted(ids, hot([3, 0, 0, 0, 4, 0]), cycles)).join(" ")).toContain(
      "2 of them were changed again in the last quarter",
    )
    // a knot nobody has touched in a quarter is not costing anything today,
    // which is worth knowing before anyone unpicks it
    expect(hotspotReading(knotted(ids, hot([0, 0, 0, 0, 0, 0]), cycles)).join(" ")).toContain(
      "None of them has been touched in the last quarter",
    )
  })

  it("says nothing about recency on a graph that carries no dates", () => {
    // parsed before the field existed, or parsed outside a repository: the
    // reading drops the claim rather than reading absence as zero
    const ids = many("lib/zod", 40)
    const hot = many("lib/zod", 6).map((id) => ({ id, churn: 20, degree: 20 }))
    expect(hotspotReading(knotted(ids, hot, [many("lib/zod", 6)])).join(" ")).not.toContain(
      "quarter",
    )
  })

  it("falls back to the ranking's shape where there are no cycles", () => {
    // the lens has to keep working on a repository whose imports are a tree
    const ids = [...many("lib/zod", 60), ...many("app/big", 300)]
    const hot = [...many("lib/zod", 23), ...many("app/big", 27)].map((id) => ({
      id,
      churn: 20,
      degree: 20,
    }))
    const said = hotspotReading(graph(ids, hot)).join(" ")
    expect(said).not.toContain("import cycle")
    expect(said).toContain("lib/zod is the densest")
  })

  it("reports that the rules and the pressure are elsewhere, when they are", () => {
    // a negative finding, and a real one: it says the violation list is not
    // where to look for what is expensive
    const ids = many("lib/zod", 40)
    const hot = many("lib/zod", 10).map((id) => ({ id, churn: 20, degree: 20 }))
    const g = graph(ids, hot)
    g.violations = [
      { rule: "no-direct-import", message: "x", subject: "app/other.ts", nodeIds: [], edgeIds: [] },
    ]
    expect(hotspotReading(g).join(" ")).toContain("None of the 10 breaks a rule")

    // and stays quiet when one of them does
    g.violations = [
      {
        rule: "no-direct-import",
        message: "x",
        subject: "lib/zod/f0.ts",
        nodeIds: [],
        edgeIds: [],
      },
    ]
    expect(hotspotReading(g).join(" ")).not.toContain("breaks a rule")
  })
})

describe("the reading of pressure", () => {
  it("says nothing at all when there is nothing to say", () => {
    // a reading is a finding, and a lens with no finding must stay quiet rather
    // than produce a sentence with no content in it
    expect(hotspotReading(graph(["a.ts"], []))).toEqual([])
  })

  it("claims concentration only when the pressure is concentrated", () => {
    const ids = [
      ...many("lib/zod", 30),
      ...many("lib/api", 30),
      ...many("app/web", 30),
      ...many("ui/parts", 30),
      ...many("lib/swr", 30),
      ...many("lib/auth", 30),
    ]
    const heaped: Hotspot[] = [
      ...many("lib/zod", 10).map((id) => ({ id, churn: 20, degree: 20 })),
      ...many("lib/api", 8).map((id) => ({ id, churn: 15, degree: 15 })),
      ...many("app/web", 7).map((id) => ({ id, churn: 12, degree: 12 })),
      { id: "ui/parts/f0.ts", churn: 11, degree: 11 },
      { id: "lib/swr/f0.ts", churn: 11, degree: 11 },
      { id: "lib/auth/f0.ts", churn: 11, degree: 11 },
    ]
    expect(hotspotReading(graph(ids, heaped)).join(" ")).toContain("half of them sit in")

    // spread thin across the same folders, the claim is false and must not be made
    const spread: Hotspot[] = [
      ...many("lib/zod", 5),
      ...many("lib/api", 5),
      ...many("app/web", 5),
      ...many("ui/parts", 5),
      ...many("lib/swr", 5),
      ...many("lib/auth", 5),
    ].map((id) => ({ id, churn: 12, degree: 12 }))
    expect(hotspotReading(graph(ids, spread)).join(" ")).not.toContain("half of them sit in")
  })

  it("names the densest folder by share, not by count", () => {
    /**
     * Twenty-seven hotspots in a folder of six hundred is not the problem
     * twenty-three in a folder of sixty-five is. Ranking by count would name
     * the first and say nothing useful.
     */
    const ids = [...many("app/big", 300), ...many("lib/zod", 60)]
    const hotspots: Hotspot[] = [
      ...many("app/big", 27).map((id) => ({ id, churn: 20, degree: 20 })),
      ...many("lib/zod", 23).map((id) => ({ id, churn: 20, degree: 20 })),
    ]
    const said = hotspotReading(graph(ids, hotspots)).join(" ")
    expect(said).toContain("lib/zod")
    expect(said).toContain("38%")
  })

  it("refuses to call a file the heaviest when something heavier exists", () => {
    /**
     * The exact trap on dub: `lib/types.ts` tops the ranking with 776
     * dependants, and `lib/prisma/index.ts` carries 858 while being touched
     * once all year. "Nothing else is heavier" would have been a lie, and a
     * lens that lies once is never trusted again.
     */
    const ids = ["lib/types.ts", "lib/prisma.ts", ...many("lib/x", 20)]
    const edges: [string, string][] = [
      ...many("lib/x", 14).map((id) => [id, "lib/types.ts"] as [string, string]),
      ...many("lib/x", 20).map((id) => [id, "lib/prisma.ts"] as [string, string]),
    ]
    const said = hotspotReading(
      graph(ids, [{ id: "lib/types.ts", churn: 129, degree: 14 }], edges),
    ).join(" ")
    expect(said).not.toContain("no file in this graph carries more")
    expect(said).toContain("lib/types.ts")
  })

  it("makes the claim when the file really is both", () => {
    const ids = ["lib/types.ts", ...many("lib/x", 14)]
    const edges = many("lib/x", 14).map((id) => [id, "lib/types.ts"] as [string, string])
    const said = hotspotReading(
      graph(ids, [{ id: "lib/types.ts", churn: 129, degree: 14 }], edges),
    ).join(" ")
    expect(said).toContain("no file in this graph carries more")
  })

  it("puts a number in every sentence it makes", () => {
    // the rule that keeps these from turning into a legend: no clause without a
    // figure this graph produced
    const ids = [...many("lib/zod", 60), ...many("app/big", 300)]
    const hotspots = [...many("lib/zod", 23), ...many("app/big", 27)].map((id) => ({
      id,
      churn: 20,
      degree: 20,
    }))
    for (const line of hotspotReading(graph(ids, hotspots))) expect(line).toMatch(/\d/)
  })
})

describe("the reading of a simulated deletion", () => {
  const base = {
    nodeId: "a.ts",
    label: "a",
    orphaned: [],
    broken: [],
    cyclesResolved: 0,
    violationsBefore: 0,
    violationsAfter: 0,
  }

  it("states that nothing imports it without saying to delete it", () => {
    /**
     * The one reading that could tempt a recommendation, and must not: this
     * graph cannot see a dynamic import, a test harness or a build script, so
     * "nothing imports it" is a fact and "you can remove it" is a guess.
     */
    const said = whatIfReading(base, 100).join(" ")
    expect(said).toContain("Nothing in this graph imports")
    expect(said.toLowerCase()).not.toMatch(/should|you can|safe to|remove it\b/)
  })

  it("gives the blast radius as a share, not a bare count", () => {
    const said = whatIfReading({ ...base, broken: ["b", "c"], orphaned: ["d"] }, 100).join(" ")
    expect(said).toContain("3%")
    expect(said).toContain("2 files import it directly")
  })

  it("says when a removal would untie a knot", () => {
    const said = whatIfReading({ ...base, broken: ["b"], cyclesResolved: 2 }, 100).join(" ")
    expect(said).toContain("closes 2 cycles")
  })
})

describe("the reading of impact", () => {
  const data = graph([...many("app", 60), "lib/core.ts"], [])

  it("gives the reach as a share of the repository", () => {
    const depth = new Map([
      ["lib/core.ts", 0],
      ...many("app", 30).map((id) => [id, 1] as [string, number]),
    ])
    expect(impactReading(depth, "core", data).join(" ")).toContain("49% of the repository")
  })

  it("separates what imports it from what only hears about it", () => {
    const depth = new Map<string, number>([["lib/core.ts", 0]])
    for (const [i, id] of many("app", 30).entries()) depth.set(id, i < 10 ? 1 : 3)
    const said = impactReading(depth, "core", data).join(" ")
    expect(said).toContain("10 import it directly")
    expect(said).toContain("2 more hops")
  })

  it("stays quiet when nothing depends on it", () => {
    expect(impactReading(new Map([["lib/core.ts", 0]]), "core", data)).toEqual([])
  })
})

describe("the reading of co-change", () => {
  it("recovers the denominator, because a count alone is not a strength", () => {
    // 38 times is meaningless until you know out of how many
    const data = graph(["a.ts", "b.ts"], [])
    data.coChange = [{ a: "a.ts", b: "b.ts", together: 38, jaccard: 38 / 47 }]
    const said = coChangeReading("a.ts", "a", data).join(" ")
    expect(said).toContain("38 of the 47 commits")
  })

  it("says nothing about a file the history never couples", () => {
    const data = graph(["a.ts"], [])
    data.coChange = []
    expect(coChangeReading("a.ts", "a", data)).toEqual([])
  })
})

describe("the reading of a path", () => {
  it("names the chokepoint, which is the part you cannot see", () => {
    const data = graph(["a.ts", "hub.ts", "b.ts"], [])
    const degree = new Map([["hub.ts", 140]])
    const said = pathReading(["a.ts", "hub.ts", "b.ts"], data, degree).join(" ")
    expect(said).toContain("2 hops")
    expect(said).toContain("hub.ts, which 140 files")
  })

  it("has nothing to add about a direct import", () => {
    const data = graph(["a.ts", "b.ts"], [])
    expect(pathReading(["a.ts", "b.ts"], data, new Map())).toHaveLength(1)
  })
})
