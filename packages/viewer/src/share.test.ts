import { describe, expect, it } from "vitest"
import { decodeView, encodeView, type SharedView } from "./share"

/**
 * A link that drops half the view fails silently: the recipient sees *a*
 * graph, believes it is the one they were sent, and the conversation carries
 * on about two different things.
 */

describe("encodeView / decodeView", () => {
  const roundTrip = (view: SharedView) => decodeView(encodeView(view))

  it("carries a selection", () => {
    expect(roundTrip({ node: "src/App.tsx" })).toEqual({ node: "src/App.tsx" })
  })

  it("carries a lens with its selection", () => {
    const view: SharedView = { node: "store/graph.ts", lens: "impact" }
    expect(roundTrip(view)).toEqual(view)
  })

  it("carries a lens with no selection at all", () => {
    /**
     * The hotspot lens asks nothing of the reader, so its link names no file —
     * and this was the link that did not exist. `hotspots` was missing from the
     * shareable set, so it was never written into the address bar, and the
     * receiving end discarded any link without a file before looking at it.
     *
     * The consequence was not subtle: the one address worth sending anybody,
     * the one that opens on the finding, could not be produced or followed.
     */
    expect(roundTrip({ lens: "hotspots" })).toEqual({ lens: "hotspots" })
    expect(decodeView("#lens=hotspots")).toEqual({ lens: "hotspots" })
  })

  it("carries the coupling a reader wanted to show somebody", () => {
    // it answers about a file, so unlike hotspots its link names one — and
    // "these two move together and nothing imports either" is the sort of
    // thing that gets pasted into a review
    const view: SharedView = { node: "lib/types.ts", lens: "cochange" }
    expect(roundTrip(view)).toEqual(view)
  })

  it("carries both ends of a traced path", () => {
    const view: SharedView = { node: "a/one.ts", to: "b/two.ts", lens: "path" }
    expect(roundTrip(view)).toEqual(view)
  })

  it("survives the characters every real file id contains", () => {
    // slashes and dots are the whole point of a file path, and an unencoded
    // one would be read as another key/value pair
    const node = "packages/viewer/src/scene/NodeMesh.tsx"
    expect(roundTrip({ node }).node).toBe(node)
  })

  it("survives a path with a space or a hash in it", () => {
    const node = "src/my components/a#b.ts"
    expect(roundTrip({ node }).node).toBe(node)
  })

  it("produces nothing at all for an empty view", () => {
    // an empty hash would leave a bare "#" in the address bar on every deselect
    expect(encodeView({})).toBe("")
  })

  it("omits the lens when none is active", () => {
    expect(encodeView({ node: "a.ts", lens: "none" })).toBe("#node=a.ts")
  })

  it("refuses a lens the store cannot reproduce", () => {
    // hand-edited links, and lenses that need data a URL cannot carry: replay
    // depends on a timeline, diff on two graphs
    expect(decodeView("#node=a.ts&lens=replay").lens).toBeUndefined()
    expect(decodeView("#node=a.ts&lens=diff").lens).toBeUndefined()
    expect(decodeView("#node=a.ts&lens=nonsense").lens).toBeUndefined()
  })

  it("ignores a malformed hash rather than throwing", () => {
    expect(() => decodeView("#garbage")).not.toThrow()
    expect(decodeView("#garbage")).toEqual({})
    expect(decodeView("")).toEqual({})
  })
})
