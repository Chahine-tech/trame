import { describe, expect, it } from "vitest"
import { folderAnchors } from "./folders"
import type { GraphCluster } from "../types"

type Vec3 = [number, number, number]

function folder(id: string, nodeIds: string[]): GraphCluster {
  return { id, label: id, color: "#fff", nodeIds }
}

function at(entries: Record<string, Vec3>) {
  return new Map(Object.entries(entries))
}

describe("naming a folder on the map", () => {
  it("names it from the files that are drawn, not the ones it holds", () => {
    // the detail view shows a neighbourhood; a folder whose drawn files sit on
    // the right must not be named from the ones parked off screen on the left
    const clusters = [folder("lib", ["here1", "here2", "away1", "away2"])]
    const positions = at({
      here1: [100, 0, 0],
      here2: [100, 4, 0],
      away1: [-900, 0, 0],
      away2: [-900, 4, 0],
    })
    const [anchor] = folderAnchors(clusters, positions, new Set(["here1", "here2"]))
    expect(anchor!.at[0]).toBe(100)
  })

  it("hangs the name on a file, never on the average of several", () => {
    /**
     * This is what put `app/` in open black on dub. A mean is a point no file
     * has to occupy: spread the folder out and it falls in the gap between its
     * members, and any lift proportional to the folder's own size, even the
     * typical radius rather than the farthest, carries the name further into
     * the emptiness.
     */
    const spread = at({ a: [0, 0, 0], b: [60, 0, 0], c: [30, 50, 0] })
    const [anchor] = folderAnchors([folder("app", ["a", "b", "c"])], spread, null)
    expect([...spread.values()]).toContainEqual(anchor!.at)
  })

  it("raises the name by the gap between files, not by the size of the folder", () => {
    // enough to clear the dot, and no more: a big folder of tightly packed
    // files gets the same small lift as a small one
    const tight = Array.from({ length: 30 }, (_, i) => `n${i}`)
    const [anchor] = folderAnchors(
      [folder("lib", tight)],
      new Map(tight.map((id, i) => [id, [(i % 6) * 2, Math.floor(i / 6) * 2, 0] as Vec3])),
      null,
    )
    expect(anchor!.lift).toBeLessThan(8)
  })

  it("says nothing about a folder that is everywhere at once", () => {
    // strewn between the other folders rather than owning a corner: every one
    // of its files has someone else's nearest, so its mean falls in a gap and
    // there is no place to name. The tight folder beside it keeps its label.
    const clusters = [
      folder("app", ["s1", "s2", "s3", "s4"]),
      folder("lib", ["t1", "t2", "t3"]),
    ]
    const positions = at({
      s1: [-100, -100, 0],
      s2: [100, 100, 0],
      s3: [-100, 100, 0],
      s4: [100, -100, 0],
      t1: [0, 0, 0],
      t2: [3, 0, 0],
      t3: [0, 3, 0],
    })
    expect(folderAnchors(clusters, positions, null).map((a) => a.id)).toEqual(["lib"])
  })

  it("leaves a lone file to its own label", () => {
    expect(folderAnchors([folder("scripts", ["only"])], at({ only: [0, 0, 0] }), null)).toEqual([])
  })

  it("stays quiet when none of a folder's files are drawn", () => {
    const anchors = folderAnchors(
      [folder("lib", ["a", "b"])],
      at({ a: [0, 0, 0], b: [1, 0, 0] }),
      new Set<string>(),
    )
    expect(anchors).toEqual([])
  })

  it("survives a folder whose files have no positions yet", () => {
    expect(folderAnchors([folder("lib", ["a", "b"])], at({}), null)).toEqual([])
  })

  it("still names a folder far too big to measure exhaustively", () => {
    // cohesion is estimated from a sample of the folder's files, because the
    // whole graph can be drawn and every-pair-against-every-pair would be
    // recomputed on each frame of a replay
    const ids = Array.from({ length: 2000 }, (_, i) => `n${i}`)
    const positions = new Map<string, Vec3>(
      ids.map((id, i) => [id, [(i % 40) * 2, Math.floor(i / 40) * 2, 0] as Vec3]),
    )
    const anchors = folderAnchors([folder("src", ids)], positions, null)
    expect(anchors.map((a) => a.id)).toEqual(["src"])
  })
})
