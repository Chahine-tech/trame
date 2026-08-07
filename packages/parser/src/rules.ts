import { findCycles } from "./analysis.js"
import type { TrameConfig, GraphData, GraphEdge, Rule, RuleMatch, Violation } from "./types.js"

function edgeMatches(edge: GraphEdge, match: RuleMatch | undefined, graph: GraphData): boolean {
  if (!match) return true
  if (match.edgeType && edge.type !== match.edgeType) return false
  if (match.sourceType) {
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (source?.type !== match.sourceType) return false
  }
  if (match.targetType) {
    const target = graph.nodes.find((n) => n.id === edge.target)
    if (target?.type !== match.targetType) return false
  }
  return true
}

function checkUniqueCaller(rule: Rule, graph: GraphData): Violation[] {
  const byTarget = new Map<string, GraphEdge[]>()
  for (const edge of graph.edges) {
    if (!edgeMatches(edge, rule.match, graph)) continue
    const list = byTarget.get(edge.target) ?? []
    list.push(edge)
    byTarget.set(edge.target, list)
  }
  const violations: Violation[] = []
  for (const [target, edges] of byTarget) {
    if (edges.length <= 1) continue
    const label = graph.nodes.find((n) => n.id === target)?.label ?? target
    violations.push({
      rule: rule.type,
      message: `${rule.message} (${label}: ${edges.length} callers)`,
      nodeIds: [target, ...edges.map((e) => e.source)],
      edgeIds: edges.map((e) => e.id),
    })
  }
  return violations
}

function checkNoDirectImport(rule: Rule, graph: GraphData): Violation[] {
  const violations: Violation[] = []
  for (const edge of graph.edges) {
    if (!edgeMatches(edge, rule.match, graph)) continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    const target = graph.nodes.find((n) => n.id === edge.target)
    violations.push({
      rule: rule.type,
      message: `${rule.message} (${source?.label} → ${target?.label})`,
      nodeIds: [edge.source, edge.target],
      edgeIds: [edge.id],
    })
  }
  return violations
}

function checkNoCycles(rule: Rule, graph: GraphData): Violation[] {
  return findCycles(graph).map((cycle) => {
    const labels = cycle.map((id) => graph.nodes.find((n) => n.id === id)?.label ?? id)
    // edges that close the loop, including the wrap-around back to the start
    const edgeIds: string[] = []
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i]!
      const to = cycle[(i + 1) % cycle.length]!
      const edge = graph.edges.find((e) => e.source === from && e.target === to)
      if (edge) edgeIds.push(edge.id)
    }
    return {
      rule: rule.type,
      message: `${rule.message} (${labels.join(" → ")} → ${labels[0]})`,
      nodeIds: cycle,
      edgeIds,
    }
  })
}

export function evaluateRules(graph: GraphData, config: TrameConfig): Violation[] {
  const violations: Violation[] = []
  for (const rule of config.rules ?? []) {
    if (rule.type === "unique-caller") violations.push(...checkUniqueCaller(rule, graph))
    else if (rule.type === "no-direct-import") violations.push(...checkNoDirectImport(rule, graph))
    else if (rule.type === "no-cycles") violations.push(...checkNoCycles(rule, graph))
  }
  return violations
}
