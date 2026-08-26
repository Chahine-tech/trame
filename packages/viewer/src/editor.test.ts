import { describe, expect, it } from "vitest"
import { locate } from "./editor"

describe("finding a node's file on this machine", () => {
  it("joins the relative path to the root the graph was parsed from", () => {
    expect(locate("src/App.tsx", "/home/me/project")).toBe("/home/me/project/src/App.tsx")
  })

  it("does not double the separator when the root ends in one", () => {
    expect(locate("src/App.tsx", "/home/me/project/")).toBe("/home/me/project/src/App.tsx")
  })

  it("refuses to guess when the graph carries no root", () => {
    // a published graph drops its root, and the file it names lives on somebody
    // else's disk, so sending the editor after it would open nothing, or worse,
    // open an unrelated file that happens to sit at the same relative path
    expect(locate("src/App.tsx", undefined)).toBeNull()
  })

  it("still opens graphs written before paths were made relative", () => {
    // every node used to carry the whole path; those files are already findable
    expect(locate("/home/me/project/src/App.tsx", undefined)).toBe(
      "/home/me/project/src/App.tsx",
    )
  })

  it("recognises a windows path as already absolute", () => {
    expect(locate("C:\\repo\\src\\App.tsx", undefined)).toBe("C:\\repo\\src\\App.tsx")
  })

  it("has nothing to open for a node with no file at all", () => {
    expect(locate(undefined, "/home/me/project")).toBeNull()
    expect(locate("", "/home/me/project")).toBeNull()
  })
})
