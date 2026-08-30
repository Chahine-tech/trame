import { describe, expect, it } from "vitest"
import { MARK_PX, markScale } from "./mark"

const FOV = 60
const H = 900

/** What the projection actually puts on screen: a diameter in CSS pixels. */
const apparentPx = (radius: number, scale: number, distance: number): number =>
  (2 * radius * scale * H) / (2 * Math.tan((FOV * Math.PI) / 360) * distance)

const mark = (distance: number) => markScale(distance, FOV, H, MARK_PX)

describe("the uniform mark", () => {
  it("is the same size on screen at every depth", () => {
    /**
     * The measurement this exists to answer. Framed on dub's densest folder the
     * camera parks 250 units out with the constellation spanning 128, so the
     * nearest ranked file sits at 122 and the furthest at 378 — a 3.1x spread
     * in apparent size, from nothing but where they happen to stand. In the
     * screenshot that started this it reached 20x, because the lens is a
     * question about the whole repository and the camera was inside a
     * neighbourhood of it.
     */
    const near = apparentPx(0.65, mark(122), 122)
    const far = apparentPx(0.65, mark(378), 378)
    expect(far).toBeCloseTo(near, 10)

    const veryFar = apparentPx(0.65, mark(2400), 2400)
    expect(veryFar).toBeCloseTo(near, 10)
  })

  it("grows in the world exactly as fast as the camera shrinks it", () => {
    expect(mark(400) / mark(200)).toBeCloseTo(2, 10)
  })

  it("holds its pixels when the window changes shape", () => {
    // half the viewport spreads the same frustum over half the pixels, so each
    // pixel is worth twice the world and a mark of the same width needs twice
    // as much of it. What is held constant is the pixels, which is the only
    // size a reader has
    expect(markScale(200, FOV, 450, MARK_PX)).toBeCloseTo(markScale(200, FOV, 900, MARK_PX) * 2, 10)
    expect(apparentPx(0.65, markScale(200, FOV, 450, MARK_PX), 200) * (450 / H)).toBeCloseTo(
      apparentPx(0.65, mark(200), 200),
      10,
    )
  })

  it("survives the camera passing through a node", () => {
    // damping means the scale is read on frames where the distance is anything
    // at all, including zero. A mark that divides to nothing there disappears
    // mid-flight and comes back, which reads as a bug in the data
    const s = mark(0)
    expect(s).toBeGreaterThan(0)
    expect(Number.isFinite(s)).toBe(true)
  })

  it("puts a module at a size a reader can point at", () => {
    // the mark is stated for a unit node, and every ranked node is drawn with
    // the module's icosahedron, so this is the size of all 150 of them
    const module = apparentPx(0.65, mark(250), 250)
    expect(module).toBeGreaterThan(8)
    expect(module).toBeLessThan(16)
  })
})
