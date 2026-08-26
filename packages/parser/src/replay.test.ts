import { describe, expect, it } from "vitest"
import { pickEvenly } from "./replay.js"
import type { Commit } from "./replay.js"

const commits = (n: number): Commit[] =>
  Array.from({ length: n }, (_, i) => ({
    sha: `c${i}`,
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    subject: `commit ${i}`,
    author: "someone",
  }))

const shas = (c: Commit[]) => c.map((x) => x.sha)

describe("pickEvenly", () => {
  it("keeps everything when the history is shorter than the budget", () => {
    expect(shas(pickEvenly(commits(5), 40))).toEqual(["c0", "c1", "c2", "c3", "c4"])
  })

  it("keeps everything when the history is exactly the budget", () => {
    expect(pickEvenly(commits(14), 14)).toHaveLength(14)
  })

  it("never exceeds the budget", () => {
    // the budget is what a viewer can watch; going over it turns the replay
    // into something nobody sits through
    for (const n of [50, 500, 5000]) {
      expect(pickEvenly(commits(n), 40).length).toBeLessThanOrEqual(40)
    }
  })

  it("always keeps the first and the last commit", () => {
    // the two frames that carry the argument: where the codebase started and
    // where it arrived. A sampler that drops either one is telling a
    // different story than the repository's.
    const picked = pickEvenly(commits(1000), 12)
    expect(picked[0]!.sha).toBe("c0")
    expect(picked[picked.length - 1]!.sha).toBe("c999")
  })

  it("never repeats a commit", () => {
    // rounding a fractional stride can land on the same index twice, which
    // would show one commit as two identical frames
    const picked = pickEvenly(commits(43), 40)
    expect(new Set(shas(picked)).size).toBe(picked.length)
  })

  it("spreads the picks rather than clustering them", () => {
    const picked = pickEvenly(commits(100), 11)
    const gaps = picked
      .slice(1)
      .map((c, i) => Number(c.sha.slice(1)) - Number(picked[i]!.sha.slice(1)))
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it("returns nothing for an empty history", () => {
    expect(pickEvenly([], 40)).toEqual([])
  })

  it("degrades to the newest commit when the budget cannot hold two", () => {
    // guards the stride divisor: maxFrames of 1 would divide by zero
    expect(shas(pickEvenly(commits(10), 1))).toEqual(["c9"])
  })
})
