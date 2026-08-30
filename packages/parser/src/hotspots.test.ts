import { describe, expect, it } from "vitest"
import { DEFAULTS, hotspots } from "./hotspots.js"

/** Ten files, so a 0.9 percentile lands on a whole one rather than between two. */
const ids = Array.from({ length: 10 }, (_, i) => `f${i}.ts`)
const map = (pairs: [number, number][]) => ({
  churn: new Map(pairs.map(([c], i) => [ids[i]!, c])),
  degree: new Map(pairs.map(([, d], i) => [ids[i]!, d])),
})

describe("hotspots", () => {
  it("passes over a pillar: much rests on it, nothing changes it", () => {
    /**
     * `lib/prisma/index.ts` on dub carries 858 dependants and was touched once
     * in a year. Ranking by weight alone put it first; it is a structure doing
     * its job. The churn side of the product is what excludes it.
     */
    const rows: [number, number][] = [
      [1, 900],
      ...Array.from({ length: 9 }, () => [4, 4] as [number, number]),
    ]
    expect(hotspots(map(rows).churn, map(rows).degree, ids).map((h) => h.id)).not.toContain("f0.ts")
  })

  it("passes over a file rewritten constantly that nothing depends on", () => {
    const rows: [number, number][] = [
      [90, 0],
      ...Array.from({ length: 9 }, () => [4, 4] as [number, number]),
    ]
    expect(hotspots(map(rows).churn, map(rows).degree, ids).map((h) => h.id)).not.toContain("f0.ts")
  })

  it("keeps the file that is both, which is the whole claim", () => {
    const rows: [number, number][] = [
      [90, 900],
      ...Array.from({ length: 9 }, () => [4, 4] as [number, number]),
    ]
    const found = hotspots(map(rows).churn, map(rows).degree, ids)
    expect(found[0]).toMatchObject({ id: "f0.ts", churn: 90, degree: 900 })
  })

  it("ranks by the product, not by either count", () => {
    // measured on dub: `lib/types.ts` changes 132 times with 773 dependants and
    // `lib/zod/schemas/partners.ts` 133 times with 148, so churn alone would
    // invert them.
    // 0.8 because at 0.9 over ten files the cut is the maximum itself, and one
    // survivor per axis cannot be ranked against another
    const rows: [number, number][] = [
      [40, 80],
      [80, 20],
      ...Array.from({ length: 8 }, () => [4, 4] as [number, number]),
    ]
    const found = hotspots(map(rows).churn, map(rows).degree, ids, { ...DEFAULTS, percentile: 0.8 })
    expect(found.map((h) => h.id)).toEqual(["f0.ts", "f1.ts"])
  })

  it("cuts by share rather than by a number somebody wrote down", () => {
    // the same reason `impassable` takes a share: a threshold in commits means
    // something different on a repository of fifty files and one of five thousand
    const rows: [number, number][] = Array.from(
      { length: 10 },
      (_, i) => [i + 1, i + 1] as [number, number],
    )
    const strict = hotspots(map(rows).churn, map(rows).degree, ids, {
      ...DEFAULTS,
      percentile: 0.9,
    })
    const loose = hotspots(map(rows).churn, map(rows).degree, ids, { ...DEFAULTS, percentile: 0.5 })
    expect(strict.length).toBeLessThan(loose.length)
  })

  it("says nothing about a graph with no history behind it", () => {
    expect(hotspots(new Map(), new Map(), ids)).toHaveLength(0)
    expect(hotspots(new Map(), new Map(), [])).toHaveLength(0)
  })

  it("reports the recent count beside the total, and omits it when unknown", () => {
    /**
     * A count and not a decayed score. Google's study asks a prediction to bias
     * towards the new, and folding age into the product would have bought that
     * with a number nobody can check: the ranking is `churn x degree`, both of
     * which a reader can reproduce with `git log`, and a churn of 43.7 is
     * neither reproducible nor a number of anything. So the recency is a second
     * fact rather than a thumb on the first.
     */
    const rows: [number, number][] = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? [40, 40] : [1, 1],
    )
    const { churn, degree } = map(rows)
    const withDates = hotspots(churn, degree, ids, DEFAULTS, new Map([["f0.ts", 7]]))
    expect(withDates[0]).toMatchObject({ id: "f0.ts", churn: 40, recent: 7 })

    // a file the recent map does not mention was not touched recently; a graph
    // with no recent map at all does not know, and must not answer zero
    expect(hotspots(churn, degree, ids, DEFAULTS, new Map())[0]!.recent).toBe(0)
    expect(hotspots(churn, degree, ids)[0]).not.toHaveProperty("recent")
  })
})
