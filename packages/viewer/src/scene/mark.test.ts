import { describe, expect, it } from "vitest"
import { CONTEXT_PX, crowding, MARK_PX, marksMayGlow, RANKED_PX, markScale } from "./mark"

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

  it("gives each of the three registers its own size, in that order", () => {
    /**
     * The knot, the rest of the ranking, and the map underneath. They had two
     * sizes between them for a while: the ranking took the mark's, so on dub
     * 120 files that are not the answer were drawn exactly as large as the 37
     * that are, and outnumbered them three to one.
     *
     * Three sizes for three categories — in the knot, in the ranking, neither —
     * which is the same rule that allows them three colours. A rank would not
     * be allowed; membership is.
     */
    const at = (px: number, d: number) => apparentPx(0.65, markScale(d, FOV, H, px), d)
    for (const d of [40, 60, 250, 809]) {
      expect(at(MARK_PX, d)).toBeGreaterThan(at(RANKED_PX, d))
      expect(at(RANKED_PX, d)).toBeGreaterThan(at(CONTEXT_PX, d))
      // and the ranking sits nearer the ground than the mark: it is context for
      // the finding, not a second answer
      expect(at(RANKED_PX, d) - at(CONTEXT_PX, d)).toBeLessThan(at(MARK_PX, d) - at(RANKED_PX, d))
    }
  })

  it("keeps the answer larger than its ground, wherever the camera stands", () => {
    /**
     * The half of this that was missing. The mark was pinned in pixels and the
     * rest of the map kept a size in world units, so which looked bigger came
     * down to camera distance — and on the landing's hotspot beat, 60 units off
     * a 45-file graph, a context node measured 29 pixels against the answer's
     * 11. The section's own subject was the smallest thing on its screen.
     */
    const mk = (d: number) => apparentPx(0.65, markScale(d, FOV, H, MARK_PX), d)
    const ground = (d: number) => apparentPx(0.65, markScale(d, FOV, H, CONTEXT_PX), d)
    for (const d of [40, 60, 250, 809, 2400]) {
      expect(mk(d)).toBeGreaterThan(ground(d) * 1.5)
      // and the ratio is the lens's choice, not the camera's
      expect(mk(d) / ground(d)).toBeCloseTo(mk(60) / ground(60), 10)
    }
  })

  it("puts a module at a size a reader can point at", () => {
    // the mark is stated for a unit node, and every ranked node is drawn with
    // the module's icosahedron, so this is the size of all 150 of them
    const module = apparentPx(0.65, mark(250), 250)
    expect(module).toBeGreaterThan(8)
    expect(module).toBeLessThan(16)
  })

  it("draws bigger when there is less on screen, and never smaller", () => {
    /**
     * The three sizes were measured on dub, which draws about 250 files under
     * this lens. The landing draws 45, and there the answer came out at eleven
     * pixels beside a co-change beat whose answer is a 35-pixel cube with a halo
     * and a tube — same product, same page, one lens announcing itself and one
     * not.
     *
     * It only ever grows: a scene denser than the reference needs the sizes
     * small more than the reference did, not less.
     */
    expect(crowding(250)).toBe(1)
    expect(crowding(600)).toBe(1)
    expect(crowding(45)).toBeGreaterThan(2)
    expect(crowding(45)).toBeLessThan(crowding(10))
    // and it is bounded, so a two-file graph does not fill the screen with two
    // enormous marks
    expect(crowding(1)).toBeLessThanOrEqual(2.5)
    expect(crowding(0)).toBe(1)
  })

  it("scales the three registers together, so the ratios never move", () => {
    // the size still says nothing about any one file, which is the whole
    // constraint: it is a body size for the set, not a channel
    for (const drawn of [45, 120, 250, 800]) {
      const f = crowding(drawn)
      expect((MARK_PX * f) / (RANKED_PX * f)).toBeCloseTo(MARK_PX / RANKED_PX, 12)
      expect((RANKED_PX * f) / (CONTEXT_PX * f)).toBeCloseTo(RANKED_PX / CONTEXT_PX, 12)
    }
  })

  it("lets a handful of marks announce themselves, and a crowd not", () => {
    // every other lens rings its answer; this one reserved the ring for the
    // clicked row, which on a graph with three findings meant no ring at all
    expect(marksMayGlow(3)).toBe(true)
    expect(marksMayGlow(12)).toBe(true)
    expect(marksMayGlow(37)).toBe(false)
    expect(marksMayGlow(157)).toBe(false)
    expect(marksMayGlow(0)).toBe(false)
  })
})
