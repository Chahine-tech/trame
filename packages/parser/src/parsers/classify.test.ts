import { describe, expect, it } from "vitest"
import { Project } from "ts-morph"
import { labelFor } from "./classify.js"

const project = new Project({ useInMemoryFileSystem: true })
// overwrite, because a couple of assertions ask about the same path twice
const label = (path: string) =>
  labelFor(project.createSourceFile(path, "", { overwrite: true }))

describe("labelFor", () => {
  it("uses the file's own name", () => {
    expect(label("/src/theme.ts")).toBe("theme")
    expect(label("/src/scene/NodeMesh.tsx")).toBe("NodeMesh")
  })

  it("gives an index file its folder's name", () => {
    // there is only ever one index per folder, so the folder name is unambiguous
    expect(label("/src/components/Button/index.tsx")).toBe("Button")
  })

  it("keeps page and layout apart when they share a folder", () => {
    // the Next.js app router puts both in the same directory. Handing them the
    // folder name alone produced two nodes called "app" in a real project —
    // indistinguishable in the graph, in a Mermaid export, and in any advice
    // that names them.
    expect(label("/app/page.tsx")).toBe("app/page")
    expect(label("/app/layout.tsx")).toBe("app/layout")
    expect(label("/app/page.tsx")).not.toBe(label("/app/layout.tsx"))
  })

  it("still carries the folder, so routes stay tellable apart", () => {
    expect(label("/app/about/page.tsx")).toBe("about/page")
    expect(label("/app/work/page.tsx")).toBe("work/page")
  })
})
