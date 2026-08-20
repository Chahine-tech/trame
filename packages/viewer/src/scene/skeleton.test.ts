import { describe, expect, it } from "vitest"
import { coreness, fittingNeighbourhood, impassable, neighbourhood, skeleton } from "./skeleton"
import type { GraphEdge } from "../types"

function links(pairs: [string, string][]): GraphEdge[] {
  return pairs.map(([source, target], i) => ({
    id: `e${i}`,
    source,
    target,
    type: "import" as const,
  }))
}

/** `n` files in a line, each importing the next. */
function chain(prefix: string, n: number): { ids: string[]; edges: GraphEdge[] } {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`)
  const pairs: [string, string][] = []
  for (let i = 1; i < n; i++) pairs.push([ids[i - 1]!, ids[i]!])
  return { ids, edges: links(pairs) }
}

/** Everything imports everything: the densest shape there is. */
function clique(prefix: string, n: number): { ids: string[]; edges: GraphEdge[] } {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`)
  const pairs: [string, string][] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([ids[i]!, ids[j]!])
  return { ids, edges: links(pairs) }
}

describe("coreness", () => {
  it("puts a chain in the first shell — every file is a leaf of the next", () => {
    const { ids, edges } = chain("c", 6)
    expect([...coreness(ids, edges).values()].every((k) => k === 1)).toBe(true)
  })

  it("gives a clique of four the third shell", () => {
    // each file has three neighbours and none can be peeled
    const { ids, edges } = clique("q", 4)
    expect([...coreness(ids, edges).values()]).toEqual([3, 3, 3, 3])
  })

  it("does not mistake a popular file for a deep one", () => {
    // a star: the hub has fifty neighbours, but each one has only the hub, so
    // they all peel at k=1 and take the hub with them
    const leaves = Array.from({ length: 50 }, (_, i) => `leaf${i}`)
    const ids = ["hub", ...leaves]
    const shell = coreness(ids, links(leaves.map((l) => [l, "hub"] as [string, string])))
    expect(shell.get("hub")).toBe(1)
  })

  it("leaves a file nothing touches in shell zero", () => {
    const { ids, edges } = chain("c", 3)
    expect(coreness([...ids, "alone"], edges).get("alone")).toBe(0)
  })
})

describe("the skeleton", () => {
  it("withholds nothing from a graph that already fits", () => {
    const { ids, edges } = chain("c", 40)
    expect(skeleton(ids, edges, 400)).toBeNull()
  })

  it("keeps the dense part and drops the fringe", () => {
    const core = clique("core", 12)
    const fringe = chain("fringe", 60)
    const ids = [...core.ids, ...fringe.ids]
    const edges = [...core.edges, ...fringe.edges, ...links([["fringe0", "core0"]])]
    const kept = skeleton(ids, edges, 20)!
    for (const id of core.ids) expect(kept.has(id)).toBe(true)
    expect(kept.has("fringe30")).toBe(false)
  })

  it("leaves the universal utilities out, though coreness puts them deepest", () => {
    // the correction that cost an evening: a file everything imports is as
    // densely connected as anything can be, so peeling never reaches it. On
    // cal.com ten such files carried 30% of the edges inside the core while
    // holding none of it together — traffic, not structure.
    const core = clique("core", 14)
    const rest = Array.from({ length: 90 }, (_, i) => `f${i}`)
    const ids = [...core.ids, ...rest, "logger"]
    const edges = [
      ...core.edges,
      ...links(rest.map((f) => [f, "logger"] as [string, string])),
      ...links(core.ids.map((c) => [c, "logger"] as [string, string])),
    ]
    expect(skeleton(ids, edges, 20)!.has("logger")).toBe(false)
  })

  it("takes the shallowest depth that fits, not the deepest", () => {
    // going too deep would throw away structure the screen had room for
    const big = clique("big", 30)
    const rest = chain("r", 200)
    const ids = [...big.ids, ...rest.ids]
    const edges = [...big.edges, ...rest.edges]
    expect(skeleton(ids, edges, 60)!.size).toBeGreaterThanOrEqual(30)
  })
})

describe("a neighbourhood", () => {
  const web = links([
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["a", "logger"],
    ["z", "logger"],
  ])

  it("reaches exactly one step for one hop", () => {
    expect(neighbourhood("b", web, 1, new Set())).toEqual(new Set(["b", "a", "c"]))
  })

  it("shows a utility it is next to, but does not travel through it", () => {
    // `z` is on the far side of logger and has nothing to do with `a`; without
    // this, one shared utility drags in every one of its two hundred users
    const near = neighbourhood("a", web, 2, new Set(["logger"]))
    expect(near.has("logger")).toBe(true)
    expect(near.has("z")).toBe(false)
  })

  it("still opens up when the file in hand is itself a utility", () => {
    // asking about `logger` on purpose must answer, not refuse
    expect(neighbourhood("logger", web, 1, new Set(["logger"])).has("a")).toBe(true)
  })
})

describe("what counts as traffic", () => {
  it("scales with the codebase instead of a fixed number", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `f${i}`)
    const ids = [...many, "hub"]
    // wired to 5% of the files: well past ordinary
    const edges = links(many.slice(0, 100).map((f) => [f, "hub"] as [string, string]))
    expect(impassable(ids, edges).has("hub")).toBe(true)
  })

  it("finds nothing to exclude in a small codebase", () => {
    // thirty files have no infrastructure layer worth naming, and withholding
    // one of them would be withholding a tenth of the map
    const { ids, edges } = clique("q", 12)
    expect(impassable(ids, edges).size).toBe(0)
  })
})

describe("choosing how far to look", () => {
  /** A hub with `n` neighbours, each of which has ten of its own. */
  function busy(n: number): GraphEdge[] {
    const pairs: [string, string][] = []
    for (let i = 0; i < n; i++) {
      pairs.push(["focus", `near${i}`])
      for (let j = 0; j < 10; j++) pairs.push([`near${i}`, `far${i}_${j}`])
    }
    return links(pairs)
  }

  it("takes two hops when they fit", () => {
    const near = fittingNeighbourhood("focus", busy(3), new Set(), 400)
    expect(near.size).toBe(34) // focus + 3 + 30
  })

  it("falls back to one hop rather than overflowing", () => {
    // opening on handleCancelBooking — exactly the sort of well-connected file
    // worth opening on — reached 426 at two hops, past the budget it exists to
    // respect. Better a smaller true view than a screenful nobody can read.
    const near = fittingNeighbourhood("focus", busy(60), new Set(), 400)
    expect(near.size).toBe(61) // focus + its 60 neighbours, and no further
  })

  it("never returns less than the file itself and what it touches", () => {
    const near = fittingNeighbourhood("focus", busy(2), new Set(), 1)
    expect(near.has("focus")).toBe(true)
    expect(near.size).toBeGreaterThan(1)
  })
})
