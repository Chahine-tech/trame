import { describe, expect, it } from "vitest"
import { layOutKnot } from "./knot"
import type { Vec3 } from "../types"

const ring = (n: number) => Array.from({ length: n }, (_, i) => `f${i}.ts`)
const loop = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ source: `f${i}.ts`, target: `f${(i + 1) % n}.ts` }))

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe("the knot, laid out on its own", () => {
  it("produces a real arrangement rather than a pile of NaN", () => {
    /**
     * `forceManyBody` divides by the distance between two nodes, so seeding a
     * set of nodes at one point returns infinities and the whole thing comes
     * out NaN — which draws as nothing at all, silently.
     */
    const { at } = layOutKnot(ring(20), loop(20), [0, 0, 0])
    expect(at.size).toBe(20)
    for (const p of at.values()) for (const v of p) expect(Number.isFinite(v)).toBe(true)
  })

  it("is deterministic, so leaving the lens and coming back is not a reshuffle", () => {
    const a = layOutKnot(ring(30), loop(30), [0, 0, 0])
    const b = layOutKnot(ring(30), loop(30), [0, 0, 0])
    for (const [id, p] of a.at) expect(b.at.get(id)).toEqual(p)
  })

  it("stands where it is told, so the knot does not teleport across the map", () => {
    const here = layOutKnot(ring(20), loop(20), [0, 0, 0])
    const there = layOutKnot(ring(20), loop(20), [400, -50, 25])
    for (const [id, p] of here.at) {
      const moved = there.at.get(id)!
      expect(moved[0]).toBeCloseTo(p[0] + 400, 6)
      expect(moved[1]).toBeCloseTo(p[1] - 50, 6)
      expect(moved[2]).toBeCloseTo(p[2] + 25, 6)
    }
  })

  it("puts files that import each other nearer than files that do not", () => {
    /**
     * The claim the arrangement makes. Two clusters joined by a single import:
     * within a cluster everything is mutually reachable, between them almost
     * nothing, and the layout has to show that or it is saying nothing.
     */
    const members = [...ring(8), ...ring(8).map((id) => "g" + id)]
    const edges = [
      ...loop(8),
      ...loop(8).map((e) => ({ source: "g" + e.source, target: "g" + e.target })),
      { source: "f0.ts", target: "gf0.ts" },
    ]
    const { at } = layOutKnot(members, edges, [0, 0, 0])
    const within = dist(at.get("f0.ts")!, at.get("f1.ts")!)
    const across = dist(at.get("f4.ts")!, at.get("gf4.ts")!)
    expect(across).toBeGreaterThan(within * 2)
  })

  it("ignores an import that leaves the knot", () => {
    // the point of settling it alone: nothing outside gets a vote, which is
    // what stops the members being pulled apart the way the global layout does
    const inside = layOutKnot(ring(12), loop(12), [0, 0, 0])
    const withStray = layOutKnot(
      ring(12),
      [...loop(12), { source: "f0.ts", target: "somewhere-else.ts" }],
      [0, 0, 0],
    )
    for (const [id, p] of inside.at) expect(withStray.at.get(id)).toEqual(p)
  })

  it("says nothing about an empty knot", () => {
    expect(layOutKnot([], [], [0, 0, 0])).toEqual({ at: new Map(), spread: 0 })
  })
})
