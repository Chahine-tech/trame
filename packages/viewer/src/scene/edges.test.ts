import { describe, expect, it } from "vitest"
import { tubeGrowth } from "./EdgeMesh"

/** The lit tube radius in EdgeMesh, before growth. */
const LIT = 0.12

/**
 * A lit edge's width on screen, in CSS pixels.
 *
 * The camera sits at 1.35 × extent with a 60° field of view, so what a world
 * unit is worth in pixels follows from the extent alone.
 */
function widthOf(extent: number, canvasHeight = 950): number {
  const visible = 2 * (extent * 1.35) * Math.tan((60 / 2) * (Math.PI / 180))
  return LIT * tubeGrowth(extent) * 2 * (canvasHeight / visible)
}

describe("keeping an edge a line at any zoom", () => {
  it("leaves the hand-tuned arrangement exactly as it was", () => {
    // 60 is the store's default extent and the size of the graph these widths
    // were chosen against: trame's own
    expect(tubeGrowth(60)).toBe(1)
    expect(tubeGrowth(24)).toBe(1)
  })

  it("lifts a large arrangement back over one pixel", () => {
    // dub's tinybird neighbourhood spreads to 255, where an edge came out at
    // 0.57 CSS px, which is a wash rather than a thin line
    expect(widthOf(255)).toBeGreaterThan(1)
    expect(widthOf(453)).toBeGreaterThan(0.85)
  })

  it("does not restore the weight of a sparse map to a dense one", () => {
    /**
     * Growing straight with the extent was the first repair, and it put the
     * full 2.4 px back on a hub with 150 edges converging: the nodes vanished
     * under their own connections.
     *
     * The hand-tuned width encoded sparsity, not only scale: trame's own
     * graph is 24 files. A big arrangement is also a denser one, so the growth
     * has to stay well under proportional.
     */
    expect(widthOf(255)).toBeLessThan(widthOf(60) * 0.6)
    expect(tubeGrowth(255)).toBeLessThan(255 / 60)
  })

  it("keeps thickening as the view grows, never thinning", () => {
    const widths = [60, 120, 255, 453, 993].map((e) => tubeGrowth(e))
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
  })
})
