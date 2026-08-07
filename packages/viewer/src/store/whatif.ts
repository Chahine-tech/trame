import { findCycles, findOrphans } from "@trame/parser/analysis"
import { evaluateRules } from "@trame/parser/rules"
import type { GraphData, Rule } from "../types"

export interface WhatIfReport {
  /** the node being removed in the simulation */
  nodeId: string
  label: string
  /** files that nothing would import any more — new dead code */
  orphaned: string[]
  /** files that import it directly, and would stop compiling */
  broken: string[]
  /** dependency cycles this removal would break */
  cyclesResolved: number
  /** rule violations before → after */
  violationsBefore: number
  violationsAfter: number
}

/**
 * Answer "what if I deleted this?" without touching the codebase.
 *
 * The whole graph is already in memory and the rule engine is pure, so the
 * simulation is just the same analysis run on a copy with one node removed —
 * which makes an architectural decision testable before it is made.
 */
export function simulateDelete(
  data: GraphData,
  nodeId: string,
  rules: Rule[] | undefined,
): WhatIfReport | null {
  const target = data.nodes.find((n) => n.id === nodeId)
  if (!target) return null

  const without: GraphData = {
    ...data,
    nodes: data.nodes.filter((n) => n.id !== nodeId),
    edges: data.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    clusters: data.clusters.map((c) => ({
      ...c,
      nodeIds: c.nodeIds.filter((id) => id !== nodeId),
    })),
  }

  // orphans that only appear once the node is gone — the node was their
  // last importer, so deleting it strands them
  const before = new Set(findOrphans(data))
  const orphaned = findOrphans(without).filter((id) => !before.has(id))

  // whoever imported it directly has a dangling reference
  const broken = new Set<string>()
  for (const edge of data.edges) if (edge.target === nodeId) broken.add(edge.source)

  const cyclesBefore = findCycles(data).length
  const cyclesAfter = findCycles(without).length

  const violationsBefore = rules ? evaluateRules(data, { rules }).length : 0
  const violationsAfter = rules ? evaluateRules(without, { rules }).length : 0

  return {
    nodeId,
    label: target.label,
    orphaned,
    broken: [...broken],
    cyclesResolved: Math.max(0, cyclesBefore - cyclesAfter),
    violationsBefore,
    violationsAfter,
  }
}
