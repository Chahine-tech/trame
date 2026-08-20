import { describe, expect, it } from "vitest"
import { withoutOverlap, type LabelBox } from "./labels"

function box(id: string, x: number, y: number, rank = 1, width = 100, height = 32): LabelBox {
  return { id, x, y, width, height, tier: 0, rank }
}

/** A count on a line: same geometry, second tier. */
function pill(id: string, x: number, y: number, rank = 1): LabelBox {
  return { id, x, y, width: 30, height: 18, tier: 1, rank }
}

describe("labelling a map", () => {
  it("keeps every name when nothing collides", () => {
    const kept = withoutOverlap([box("a", 0, 0), box("b", 400, 0), box("c", 0, 200)])
    expect(kept.size).toBe(3)
  })

  it("drops the smaller of two names fighting for one spot", () => {
    // cal.com printed `i18n/ 1 file` straight through `trpc/ 398 files`;
    // neither could be read, and losing one of them is the better outcome
    const kept = withoutOverlap([box("trpc", 500, 300, 398), box("i18n", 510, 305, 1)])
    expect([...kept]).toEqual(["trpc"])
  })

  it("measures the gap from the edges, not the centres", () => {
    // two wide labels 120px apart do not touch at 100px wide, and do at 140
    expect(withoutOverlap([box("a", 0, 0, 2, 100), box("b", 120, 0, 1, 100)]).size).toBe(2)
    expect(withoutOverlap([box("a", 0, 0, 2, 140), box("b", 120, 0, 1, 140)]).size).toBe(1)
  })

  it("lets a third name through when it clears both winners", () => {
    const kept = withoutOverlap([
      box("big", 0, 0, 10),
      box("hidden", 20, 0, 5),
      box("far", 300, 0, 1),
    ])
    expect([...kept].sort()).toEqual(["big", "far"])
  })

  it("prefers the folder with more files, whatever the order given", () => {
    const forwards = withoutOverlap([box("small", 0, 0, 3), box("large", 10, 0, 300)])
    const backwards = withoutOverlap([box("large", 10, 0, 300), box("small", 0, 0, 3)])
    expect([...forwards]).toEqual(["large"])
    expect([...backwards]).toEqual(["large"])
  })

  it("settles ties the same way twice, so the map does not flicker", () => {
    // equal file counts must not swap places as the camera drifts
    const boxes = [box("beta", 0, 0, 7), box("alpha", 12, 0, 7)]
    expect([...withoutOverlap(boxes)]).toEqual([...withoutOverlap([...boxes].reverse())])
  })

  it("never lets a traffic count push out a place name", () => {
    // cal.com draws 114 names and 293 of these counts, so the numbers were
    // three quarters of the clutter. A huge number must still yield to a small
    // folder: knowing a region is `i18n/` beats knowing 443 imports cross here.
    const kept = withoutOverlap([pill("crossing", 100, 100, 443), box("i18n", 105, 100, 1)])
    expect([...kept]).toEqual(["i18n"])
  })

  it("lets a count fill a gap no name wanted", () => {
    const kept = withoutOverlap([box("features", 0, 0, 737), pill("crossing", 400, 0, 12)])
    expect(kept.size).toBe(2)
  })

  it("keeps nothing from nothing", () => {
    expect(withoutOverlap([]).size).toBe(0)
  })

  it("survives a hundred names stacked on one point", () => {
    // the far view of a crowded repository: exactly one name should win
    const stacked = Array.from({ length: 100 }, (_, i) => box(`d${i}`, 200, 200, i))
    expect(withoutOverlap(stacked)).toEqual(new Set(["d99"]))
  })
})
