import { describe, expect, it } from "vitest"
import { coChanges, DEFAULTS } from "./cochange.js"

const known = new Set(["a.ts", "b.ts", "c.ts", "sweep.ts"])
const nothingLinked = new Map<string, Set<string>>()
const together = (n: number, files: string[]) => Array.from({ length: n }, () => files)

describe("co-change", () => {
  it("pairs files that keep arriving in the same commit", () => {
    const found = coChanges(together(6, ["a.ts", "b.ts"]), known, nothingLinked)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ a: "a.ts", b: "b.ts", together: 6, jaccard: 1 })
  })

  it("scores a file that changes with everything low", () => {
    /**
     * `a` and `b` meet six times, but `a` also goes out with `c` twelve times:
     * 6 / (18 + 6 - 6) = 0.33, against 1.0 for a pair that only ever travels
     * together. Raw co-occurrence would rank the two the same.
     */
    const commits = [...together(6, ["a.ts", "b.ts"]), ...together(12, ["a.ts", "c.ts"])]
    const found = coChanges(commits, known, nothingLinked, { ...DEFAULTS, minJaccard: 0 })
    const ab = found.find((p) => p.a === "a.ts" && p.b === "b.ts")!
    expect(ab.together).toBe(6)
    expect(ab.jaccard).toBeCloseTo(0.33, 2)
  })

  it("ignores a sweep, which claims nothing about what belongs together", () => {
    const sweep = [["a.ts", "b.ts", "c.ts", "sweep.ts"]]
    const found = coChanges(
      Array.from({ length: 6 }, () => sweep[0]!),
      known,
      nothingLinked,
      {
        ...DEFAULTS,
        maxFilesPerCommit: 3,
      },
    )
    expect(found).toHaveLength(0)
  })

  it("drops a pair the import graph already draws", () => {
    // measured on trame's own history: this took 74 pairs down to 44, so two
    // in five of them were already on screen as an edge
    const linked = new Map([["a.ts", new Set(["b.ts"])]])
    expect(coChanges(together(6, ["a.ts", "b.ts"]), known, linked)).toHaveLength(0)
  })

  it("keeps out what the graph does not hold", () => {
    // history remembers deleted files, and the parser puts no tests in a graph
    const found = coChanges(together(6, ["a.ts", "gone.ts"]), known, nothingLinked)
    expect(found).toHaveLength(0)
  })

  it("needs a pair to have happened, not to have coincided once", () => {
    // five, measured: on dub three occurrences let 384 pairs through where five
    // lets 95, and the extra 289 are the weak tail
    expect(coChanges(together(4, ["a.ts", "b.ts"]), known, nothingLinked)).toHaveLength(0)
    expect(coChanges(together(5, ["a.ts", "b.ts"]), known, nothingLinked)).toHaveLength(1)
  })

  it("orders strongest first, so the same history writes the same file", () => {
    const commits = [
      ...together(9, ["a.ts", "b.ts"]),
      ...together(5, ["b.ts", "c.ts"]),
      ...together(5, ["a.ts", "c.ts"]),
    ]
    const found = coChanges(commits, known, nothingLinked, { ...DEFAULTS, minJaccard: 0 })
    const scores = found.map((p) => p.jaccard)
    expect(scores).toEqual([...scores].sort((x, y) => y - x))
  })
})
