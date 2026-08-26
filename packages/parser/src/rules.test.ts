import { describe, expect, it } from "vitest"
import { evaluateRules } from "./rules.js"
import type { EdgeType, GraphData, GraphNode, NodeType } from "./types.js"

/**
 * These are the checks `trame check` exits non-zero on, so a false negative
 * here is a CI that waves through exactly what it was installed to stop.
 */

function node(id: string, type: NodeType = "module"): GraphNode {
  return { id, label: id, type, file: id, line: 1, cluster: "src" }
}

function graph(
  nodes: [string, NodeType][],
  edges: [string, string, EdgeType?][],
): GraphData {
  return {
    meta: { project: "t", generated: "", nodeCount: nodes.length, edgeCount: edges.length },
    nodes: nodes.map(([id, type]) => node(id, type)),
    edges: edges.map(([source, target, type], i) => ({
      id: `e${i}`,
      source,
      target,
      type: type ?? "import",
    })),
    clusters: [],
  }
}

describe("unique-caller", () => {
  const rule = { type: "unique-caller" as const, message: "one caller only" }

  it("passes when a target has a single caller", () => {
    const g = graph([["a", "module"], ["b", "module"]], [["a", "b"]])
    expect(evaluateRules(g, { rules: [rule] })).toEqual([])
  })

  it("fails when two callers reach the same target", () => {
    const g = graph([["a", "module"], ["b", "module"], ["t", "module"]], [["a", "t"], ["b", "t"]])
    const found = evaluateRules(g, { rules: [rule] })
    expect(found).toHaveLength(1)
    expect(found[0]!.nodeIds).toEqual(["t", "a", "b"])
    expect(found[0]!.edgeIds).toHaveLength(2)
  })

  it("only counts callers the match selects", () => {
    // one import edge and one api-call edge into the same target: with the
    // rule scoped to api-call there is a single matching caller, so no
    // violation: the filter must be applied before counting, not after
    const g = graph(
      [["a", "module"], ["b", "module"], ["t", "module"]],
      [["a", "t", "import"], ["b", "t", "api-call"]],
    )
    const scoped = { ...rule, match: { edgeType: "api-call" as const } }
    expect(evaluateRules(g, { rules: [scoped] })).toEqual([])
  })
})

describe("no-direct-import", () => {
  it("reports every edge the match selects, and only those", () => {
    const g = graph(
      [["page", "page"], ["store", "store"], ["hook", "hook"]],
      [["page", "store", "import"], ["hook", "store", "import"]],
    )
    const rule = {
      type: "no-direct-import" as const,
      message: "pages go through hooks",
      match: { sourceType: "page" as const },
    }
    const found = evaluateRules(g, { rules: [rule] })
    expect(found).toHaveLength(1)
    expect(found[0]!.nodeIds).toEqual(["page", "store"])
  })
})

describe("no-cycles", () => {
  it("reports the cycle and the edges that close it", () => {
    const g = graph([["a", "module"], ["b", "module"]], [["a", "b"], ["b", "a"]])
    const found = evaluateRules(g, { rules: [{ type: "no-cycles", message: "no cycles" }] })
    expect(found).toHaveLength(1)
    expect(found[0]!.edgeIds).toHaveLength(2)
  })
})

describe("evaluateRules", () => {
  it("returns nothing when no rules are configured", () => {
    const g = graph([["a", "module"], ["b", "module"]], [["a", "b"], ["b", "a"]])
    expect(evaluateRules(g, {})).toEqual([])
  })

  it("accumulates across rules rather than stopping at the first", () => {
    const g = graph(
      [["a", "module"], ["b", "module"], ["t", "module"]],
      [["a", "t"], ["b", "t"], ["a", "b"], ["b", "a"]],
    )
    const found = evaluateRules(g, {
      rules: [
        { type: "unique-caller", message: "one caller" },
        { type: "no-cycles", message: "no cycles" },
      ],
    })
    expect(found.map((v) => v.rule).sort()).toEqual(["no-cycles", "unique-caller"])
  })
})
