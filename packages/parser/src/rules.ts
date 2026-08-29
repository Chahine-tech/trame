import { findCycles } from "./analysis.js"
import type {
  TrameConfig,
  GraphData,
  GraphEdge,
  GraphNode,
  Rule,
  RuleMatch,
  Violation,
} from "./types.js"

/**
 * Indexes built once per evaluation, instead of a linear scan per lookup.
 *
 * Every one of these lookups used to be `graph.nodes.find(...)` inside a loop
 * over the edges, which makes the rule engine quadratic in the size of the
 * codebase, measured at x9.9 for a x4 graph where linear would be x4. It ran
 * in CI on every pull request, so the cost fell on the repositories least able
 * to afford it: the big ones.
 */
interface Index {
  node: Map<string, GraphNode>
  /** an edge by "source→target", for reconstructing the loop a cycle walks */
  edge: Map<string, GraphEdge>
}

function indexOf(graph: GraphData): Index {
  const node = new Map(graph.nodes.map((n) => [n.id, n]))
  const edge = new Map<string, GraphEdge>()
  for (const e of graph.edges) {
    const key = `${e.source}\u0000${e.target}`
    if (!edge.has(key)) edge.set(key, e)
  }
  return { node, edge }
}

function edgeMatches(edge: GraphEdge, match: RuleMatch | undefined, index: Index): boolean {
  if (!match) return true
  if (match.edgeType && edge.type !== match.edgeType) return false
  if (match.sourceType && index.node.get(edge.source)?.type !== match.sourceType) return false
  if (match.targetType && index.node.get(edge.target)?.type !== match.targetType) return false
  return true
}

function checkUniqueCaller(rule: Rule, graph: GraphData, index: Index): Violation[] {
  const byTarget = new Map<string, GraphEdge[]>()
  for (const edge of graph.edges) {
    if (!edgeMatches(edge, rule.match, index)) continue
    const list = byTarget.get(edge.target) ?? []
    list.push(edge)
    byTarget.set(edge.target, list)
  }
  const violations: Violation[] = []
  for (const [target, edges] of byTarget) {
    if (edges.length <= 1) continue
    const label = index.node.get(target)?.label ?? target
    violations.push({
      rule: rule.type,
      message: `${rule.message} (${label}: ${edges.length} callers)`,
      // the target has too many callers; the callers are only involved
      subject: target,
      nodeIds: [target, ...edges.map((e) => e.source)],
      edgeIds: edges.map((e) => e.id),
    })
  }
  return violations
}

function checkNoDirectImport(rule: Rule, graph: GraphData, index: Index): Violation[] {
  const violations: Violation[] = []
  for (const edge of graph.edges) {
    if (!edgeMatches(edge, rule.match, index)) continue
    const source = index.node.get(edge.source)
    const target = index.node.get(edge.target)
    violations.push({
      rule: rule.type,
      message: `${rule.message} (${source?.label} → ${target?.label})`,
      // the import is written in the source, so that is where the fix is
      subject: edge.source,
      nodeIds: [edge.source, edge.target],
      edgeIds: [edge.id],
    })
  }
  return violations
}

function checkNoCycles(rule: Rule, graph: GraphData, index: Index): Violation[] {
  return findCycles(graph).map((cycle) => {
    const labels = cycle.map((id) => index.node.get(id)?.label ?? id)
    // edges that close the loop, including the wrap-around back to the start
    const edgeIds: string[] = []
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i]!
      const to = cycle[(i + 1) % cycle.length]!
      const edge = index.edge.get(`${from}\u0000${to}`)
      if (edge) edgeIds.push(edge.id)
    }
    return {
      rule: rule.type,
      message: `${rule.message} (${labels.join(" → ")} → ${labels[0]})`,
      // deliberately no subject: every file in a loop holds it together
      nodeIds: cycle,
      edgeIds,
    }
  })
}

export function evaluateRules(graph: GraphData, config: TrameConfig): Violation[] {
  const violations: Violation[] = []
  // built once for the whole evaluation, not once per rule and never per edge
  const index = indexOf(graph)
  for (const rule of config.rules ?? []) {
    if (rule.type === "unique-caller") violations.push(...checkUniqueCaller(rule, graph, index))
    else if (rule.type === "no-direct-import")
      violations.push(...checkNoDirectImport(rule, graph, index))
    else if (rule.type === "no-cycles") violations.push(...checkNoCycles(rule, graph, index))
  }
  return violations
}
