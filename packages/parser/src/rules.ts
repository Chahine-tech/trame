import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { ArchvizConfig, GraphData, GraphEdge, Rule, RuleMatch, Violation } from "./types.js"

const CONFIG_CANDIDATES = [
  "archviz.config.ts",
  "archviz.config.js",
  "archviz.config.mjs",
  "archviz.config.json",
]

/**
 * Load archviz.config.* — .ts works directly on Node ≥23.6 thanks to
 * native type stripping; .json is parsed as-is.
 */
export async function loadConfig(explicit?: string, cwd = process.cwd()): Promise<ArchvizConfig | null> {
  const candidates = explicit ? [explicit] : CONFIG_CANDIDATES
  for (const candidate of candidates) {
    const p = path.resolve(cwd, candidate)
    if (!fs.existsSync(p)) continue
    if (p.endsWith(".json")) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as ArchvizConfig
    }
    const mod = (await import(pathToFileURL(p).href)) as { default?: ArchvizConfig }
    return mod.default ?? (mod as ArchvizConfig)
  }
  return null
}

function edgeMatches(edge: GraphEdge, match: RuleMatch, graph: GraphData): boolean {
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

export function evaluateRules(graph: GraphData, config: ArchvizConfig): Violation[] {
  const violations: Violation[] = []
  for (const rule of config.rules ?? []) {
    if (rule.type === "unique-caller") violations.push(...checkUniqueCaller(rule, graph))
    else if (rule.type === "no-direct-import") violations.push(...checkNoDirectImport(rule, graph))
  }
  return violations
}
