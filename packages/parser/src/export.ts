import type { EdgeType, GraphData, GraphNode, NodeType } from "./types.js"

/** Catppuccin accents, so an exported diagram still reads like trame. */
const TYPE_COLOR: Record<NodeType, string> = {
  page: "#89b4fa",
  component: "#a6e3a1",
  hook: "#cba6f7",
  api: "#fab387",
  "query-key": "#f5c2e7",
  context: "#f9e2af",
  store: "#94e2d5",
  module: "#9399b2",
}

/** Mermaid node shapes, chosen to echo the 3D geometry per type. */
const MERMAID_SHAPE: Record<NodeType, [string, string]> = {
  page: ["{{", "}}"], // hexagon
  component: ["[", "]"], // box
  hook: ["((", "))"], // circle
  api: ["([", "])"], // stadium
  "query-key": [">", "]"], // flag
  context: ["[/", "/]"], // parallelogram
  store: ["[(", ")]"], // cylinder
  module: ["(", ")"], // rounded
}

const DOT_SHAPE: Record<NodeType, string> = {
  page: "hexagon",
  component: "box",
  hook: "circle",
  api: "cylinder",
  "query-key": "triangle",
  context: "parallelogram",
  store: "box3d",
  module: "ellipse",
}

const EDGE_STYLE: Record<EdgeType, { mermaid: string; dot: string }> = {
  import: { mermaid: "-.->", dot: "dashed" },
  "api-call": { mermaid: "-->", dot: "solid" },
  "query-key": { mermaid: "-->", dot: "solid" },
  component: { mermaid: "==>", dot: "bold" },
  context: { mermaid: "-.->", dot: "dotted" },
}

const EDGE_COLOR: Record<EdgeType, string> = {
  import: "#9399b2",
  "api-call": "#fab387",
  "query-key": "#f5c2e7",
  component: "#a6e3a1",
  context: "#f9e2af",
}

/** Mermaid and DOT ids must be identifier-safe; file paths are not. */
function safeId(id: string, seen: Map<string, string>): string {
  const existing = seen.get(id)
  if (existing) return existing
  const base = id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "n$1")
  let candidate = base
  let n = 1
  const taken = new Set(seen.values())
  while (taken.has(candidate)) candidate = `${base}_${n++}`
  seen.set(id, candidate)
  return candidate
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'")
}

export interface ExportOptions {
  /** Group nodes by folder into subgraphs. */
  groupByFolder?: boolean
  /** Keep only these node ids (used to render just a diff's changed part). */
  only?: Set<string>
}

/**
 * The nodes a diff actually touched, plus one hop of context so the change
 * has something to hang off. A whole-repo diagram in a PR comment is noise;
 * the neighbourhood of what moved is the review.
 */
export function changedScope(graph: GraphData): Set<string> {
  const changed = new Set(
    graph.nodes.filter((n) => n.diff && n.diff !== "same").map((n) => n.id),
  )
  const scope = new Set(changed)
  for (const edge of graph.edges) {
    if (changed.has(edge.source)) scope.add(edge.target)
    if (changed.has(edge.target)) scope.add(edge.source)
  }
  return scope
}

/**
 * Mermaid flowchart. GitHub renders these natively in issues, PRs and
 * READMEs, which is what makes an architecture diagram postable by a bot.
 */
export function toMermaid(graph: GraphData, options: ExportOptions = {}): string {
  const { groupByFolder = true, only } = options
  const nodes = only ? graph.nodes.filter((n) => only.has(n.id)) : graph.nodes
  const keep = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target))

  const ids = new Map<string, string>()
  const lines: string[] = ["flowchart LR"]

  const declare = (node: GraphNode, indent: string) => {
    const [open, close] = MERMAID_SHAPE[node.type]
    lines.push(`${indent}${safeId(node.id, ids)}${open}"${escapeLabel(node.label)}"${close}`)
  }

  if (groupByFolder) {
    const byFolder = new Map<string, GraphNode[]>()
    for (const node of nodes) {
      const list = byFolder.get(node.cluster) ?? []
      list.push(node)
      byFolder.set(node.cluster, list)
    }
    for (const [folder, members] of byFolder) {
      lines.push(`  subgraph ${safeId(`folder_${folder}`, ids)}["${escapeLabel(folder)}/"]`)
      for (const node of members) declare(node, "    ")
      lines.push("  end")
    }
  } else {
    for (const node of nodes) declare(node, "  ")
  }

  for (const edge of edges) {
    lines.push(
      `  ${safeId(edge.source, ids)} ${EDGE_STYLE[edge.type].mermaid} ${safeId(edge.target, ids)}`,
    )
  }

  // one class per type keeps the palette identical to the 3D view
  const used = new Set(nodes.map((n) => n.type))
  for (const type of used) {
    const color = TYPE_COLOR[type]
    lines.push(`  classDef ${type.replace(/-/g, "_")} fill:${color},stroke:${color},color:#11111b`)
  }
  for (const type of used) {
    const members = nodes.filter((n) => n.type === type).map((n) => safeId(n.id, ids))
    if (members.length) lines.push(`  class ${members.join(",")} ${type.replace(/-/g, "_")}`)
  }

  return lines.join("\n")
}

/** Graphviz DOT, for anyone who wants to run their own layout engine. */
export function toDot(graph: GraphData, options: ExportOptions = {}): string {
  const { groupByFolder = true, only } = options
  const nodes = only ? graph.nodes.filter((n) => only.has(n.id)) : graph.nodes
  const keep = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target))

  const ids = new Map<string, string>()
  const lines: string[] = [
    `digraph "${escapeLabel(graph.meta.project)}" {`,
    "  rankdir=LR;",
    '  bgcolor="#1e1e2e";',
    '  node [style="filled", fontname="SF Mono, monospace", fontsize=11, fontcolor="#11111b"];',
    '  edge [fontname="SF Mono, monospace", fontsize=9, color="#6c7086"];',
  ]

  const declare = (node: GraphNode, indent: string) => {
    lines.push(
      `${indent}${safeId(node.id, ids)} [label="${escapeLabel(node.label)}", ` +
        `shape=${DOT_SHAPE[node.type]}, fillcolor="${TYPE_COLOR[node.type]}"];`,
    )
  }

  if (groupByFolder) {
    const byFolder = new Map<string, GraphNode[]>()
    for (const node of nodes) {
      const list = byFolder.get(node.cluster) ?? []
      list.push(node)
      byFolder.set(node.cluster, list)
    }
    for (const [folder, members] of byFolder) {
      lines.push(`  subgraph cluster_${safeId(`folder_${folder}`, ids)} {`)
      lines.push(`    label="${escapeLabel(folder)}/";`)
      lines.push('    color="#45475a"; fontcolor="#a6adc8";')
      for (const node of members) declare(node, "    ")
      lines.push("  }")
    }
  } else {
    for (const node of nodes) declare(node, "  ")
  }

  for (const edge of edges) {
    lines.push(
      `  ${safeId(edge.source, ids)} -> ${safeId(edge.target, ids)} ` +
        `[style=${EDGE_STYLE[edge.type].dot}, color="${EDGE_COLOR[edge.type]}"];`,
    )
  }

  lines.push("}")
  return lines.join("\n")
}

/**
 * A PR comment. GitHub renders the Mermaid block natively, so this needs no
 * headless browser, no image hosting and no artifact upload: the diagram is
 * just text in the comment body.
 */
export function toMarkdown(graph: GraphData): string {
  const lines: string[] = ["<!-- trame-report -->", "## trame"]
  const d = graph.diff

  if (d) {
    const nodes =
      d.addedNodes === 0 && d.removedNodes === 0
        ? "no nodes added or removed"
        : `**+${d.addedNodes}** / **−${d.removedNodes}** nodes`
    lines.push("", `${nodes} · +${d.addedEdges} / −${d.removedEdges} edges`)
  } else {
    lines.push(
      "",
      `${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} edges · ${graph.clusters.length} folders`,
    )
  }

  const cycles = graph.analysis?.cycles ?? []
  const orphans = graph.analysis?.orphans ?? []
  const violations = graph.violations ?? []
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id

  if (violations.length > 0) {
    lines.push("", `### ✗ ${violations.length} rule violation${violations.length > 1 ? "s" : ""}`)
    for (const v of violations) lines.push(`- \`${v.rule}\` — ${v.message}`)
  }
  if (cycles.length > 0 && violations.every((v) => v.rule !== "no-cycles")) {
    lines.push("", `### ↻ ${cycles.length} dependency cycle${cycles.length > 1 ? "s" : ""}`)
    for (const cycle of cycles) {
      lines.push(`- ${cycle.map(label).join(" → ")} → ${label(cycle[0]!)}`)
    }
  }
  if (orphans.length > 0) {
    lines.push("", `### ⌀ ${orphans.length} unimported file${orphans.length > 1 ? "s" : ""}`)
    lines.push(orphans.map((id) => `\`${id}\``).join(", "))
  }
  if (violations.length === 0 && cycles.length === 0) {
    lines.push("", "✓ No rule violations, no cycles.")
  }

  // scope the diagram to what moved; fall back to the whole graph
  const scope = d ? changedScope(graph) : undefined
  if (!scope || scope.size > 0) {
    lines.push(
      "",
      "<details><summary>Architecture diagram</summary>",
      "",
      "```mermaid",
      toMermaid(graph, { only: scope }),
      "```",
      "",
      "</details>",
    )
  }

  return lines.join("\n") + "\n"
}
