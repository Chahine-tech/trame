import { describe, expect, it } from "vitest"
import { withoutOverlap } from "./labels"

describe("space the chrome has already taken", () => {
  const box = (id: string, x: number, y: number, w = 60, h = 19) => ({
    id,
    x,
    y,
    width: w,
    height: h,
    tier: 0,
    rank: 1,
  })

  it("refuses a name written across the lens bar", () => {
    /**
     * `cron/groups/remap-de…` ran straight through the `path` and `what if`
     * chips: the arbitration only knew about other names, so anything fixed
     * over the canvas was invisible to it.
     */
    const lensbar = { x: 22, y: 472, width: 706, height: 29 }
    const over = box("over", 300, 486)
    const clear = box("clear", 300, 200)
    const kept = withoutOverlap([over, clear], [lensbar])
    expect(kept.has("clear")).toBe(true)
    expect(kept.has("over")).toBe(false)
  })

  it("still fills the space the chrome leaves", () => {
    // reserving must cost only what it covers: a bar along the bottom is not a
    // reason to stop naming the map
    const lensbar = { x: 22, y: 472, width: 706, height: 29 }
    const names = Array.from({ length: 6 }, (_, i) => box(`n${i}`, 100 + i * 80, 200))
    expect(withoutOverlap(names, [lensbar]).size).toBe(6)
  })

  it("behaves as before when nothing is reserved", () => {
    const a = box("a", 100, 100)
    const b = box("b", 110, 100)
    expect(withoutOverlap([a, b]).size).toBe(1)
  })
})
