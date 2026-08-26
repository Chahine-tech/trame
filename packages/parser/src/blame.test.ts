import { describe, expect, it } from "vitest"
import { firstWhere } from "./blame.js"

/**
 * The search, without a repository.
 *
 * Every probe here is a git worktree and a full parse in real use, so the
 * count is not an implementation detail: it is what the command costs, and
 * the difference between a few seconds and a few minutes on a long history.
 */

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe("firstWhere", () => {
  it("finds the exact item where the fact starts", () => {
    // false up to 41, true from 42 on
    const { found } = firstWhere(range(100), (i) => i >= 42)
    expect(found).toBe(42)
  })

  it("stays logarithmic instead of walking the history", () => {
    const { probes } = firstWhere(range(5000), (i) => i >= 3771)
    // log₂(5000) ≈ 12, plus the two end checks
    expect(probes).toBeLessThan(16)
  })

  it("reports nothing when the fact was already true at the oldest commit", () => {
    // it predates everything we can see, so there is no commit to accuse
    const { found } = firstWhere(range(50), () => true)
    expect(found).toBeNull()
  })

  it("reports nothing when the fact is not true even today", () => {
    const { found } = firstWhere(range(50), () => false)
    expect(found).toBeNull()
  })

  it("spends only the two end checks when there is nothing to search", () => {
    // a report that costs 40 checkouts to say "nothing found" is a bad report
    expect(firstWhere(range(500), () => false).probes).toBe(1)
    expect(firstWhere(range(500), () => true).probes).toBe(2)
  })

  it("handles a history of one commit", () => {
    expect(firstWhere([7], () => true).found).toBeNull()
    expect(firstWhere([7], () => false).found).toBeNull()
  })

  it("handles an empty history without probing anything", () => {
    const { found, probes } = firstWhere([], () => true)
    expect(found).toBeNull()
    expect(probes).toBe(0)
  })

  it("finds a fact introduced by the very last commit", () => {
    const items = range(64)
    const { found } = firstWhere(items, (i) => i === 63)
    expect(found).toBe(63)
  })

  it("finds a fact introduced right after the oldest commit", () => {
    const { found } = firstWhere(range(64), (i) => i >= 1)
    expect(found).toBe(1)
  })
})
