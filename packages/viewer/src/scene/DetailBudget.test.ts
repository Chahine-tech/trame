import { describe, expect, it } from "vitest"
import { BUDGET, nearestTo } from "./DetailBudget"
import type { Vec3 } from "../types"

/** `count` files strung out along x, so distance and index agree. */
function line(count: number): { ids: string[]; positions: Map<string, Vec3> } {
  const ids = Array.from({ length: count }, (_, i) => `f${i}`)
  const positions = new Map<string, Vec3>(ids.map((id, i) => [id, [i, 0, 0]]))
  return { ids, positions }
}

describe("the detail budget", () => {
  it("holds nothing back when the whole graph fits", () => {
    // every repository the tool has drawn until now: withholding files there
    // would be a change nobody asked for
    const { ids, positions } = line(BUDGET)
    expect(nearestTo(ids, positions, [0, 0, 0])).toBeNull()
  })

  it("caps the count once the graph is bigger", () => {
    // a budget in files is a budget in draw calls, whatever the density of the
    // region — the frame rate must not depend on where the reader is standing
    const { ids, positions } = line(BUDGET + 500)
    expect(nearestTo(ids, positions, [0, 0, 0])!.size).toBe(BUDGET)
  })

  it("keeps what is nearest to where the camera is pointed", () => {
    const { ids, positions } = line(BUDGET + 100)
    const near = nearestTo(ids, positions, [0, 0, 0])!
    expect(near.has("f0")).toBe(true)
    expect(near.has(`f${BUDGET + 99}`)).toBe(false)
  })

  it("follows the camera rather than the origin", () => {
    const { ids, positions } = line(BUDGET + 100)
    const far = nearestTo(ids, positions, [BUDGET + 99, 0, 0])!
    expect(far.has(`f${BUDGET + 99}`)).toBe(true)
    expect(far.has("f0")).toBe(false)
  })

  it("does not drop a file just because it has no position yet", () => {
    // a node the layout has not placed sorts last rather than crashing
    const { ids, positions } = line(BUDGET + 10)
    positions.delete("f0")
    const near = nearestTo(ids, positions, [0, 0, 0])
    expect(near!.size).toBe(BUDGET)
    expect(near!.has("f0")).toBe(false)
  })
})
