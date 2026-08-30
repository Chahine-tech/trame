/**
 * A lens is a question asked of the graph: "what depends on this?", "what
 * would break?", "how did this branch change it?". Only one can be active,
 * because each one repaints every node and edge to answer *its* question.
 *
 * Before this existed the overlays were independent booleans that quietly
 * cancelled each other in a chain of if/else, and the reader had no way to
 * know which question the colours were currently answering.
 */
export type LensKind =
  | "none"
  | "impact"
  | "path"
  | "whatif"
  | "cochange"
  | "hotspots"
  | "diff"
  | "replay"

export interface LensInfo {
  /** short name shown in the top bar while the lens is on */
  label: string
  /** the palette token that carries this lens' meaning */
  accent: "yellow" | "lav" | "peach" | "green" | "teal" | "red"
  /** what the reader is looking at, in one line */
  hint: string
}

export const LENSES: Record<Exclude<LensKind, "none">, LensInfo> = {
  impact: {
    label: "impact",
    accent: "yellow",
    hint: "everything that transitively depends on the selection",
  },
  path: {
    label: "path",
    accent: "lav",
    hint: "the dependency chain between two nodes",
  },
  whatif: {
    label: "what if",
    accent: "peach",
    hint: "what deleting the selection would break",
  },
  cochange: {
    label: "co-change",
    accent: "teal",
    hint: "files the history moves with the selection that nothing imports",
  },
  hotspots: {
    label: "hotspots",
    accent: "red",
    hint: "files rewritten again and again that much of the codebase rests on",
  },
  diff: {
    label: "diff",
    accent: "green",
    hint: "what this branch added and removed",
  },
  replay: {
    label: "replay",
    accent: "lav",
    hint: "the architecture as it was, walking forward through git history",
  },
}

/** What the reader has, when a lens asks whether it can answer. */
export interface LensReadiness {
  selectedId: string | null
  hasTimeline: boolean
  /** whether the graph was parsed inside a repository with history to read */
  hasCoChange: boolean
  hasHotspots: boolean
}

/**
 * Why a lens cannot answer yet, or null when it can.
 *
 * A lens the reader cannot use is still part of the language, so the bar dims
 * it rather than hiding it and says what it is waiting for. The sentence is
 * the answer to "why is this greyed out", which is the question a dimmed
 * control always provokes.
 */
export function blockedBecause(
  kind: Exclude<LensKind, "none" | "diff">,
  { selectedId, hasTimeline, hasCoChange, hasHotspots }: LensReadiness,
): string | null {
  if (kind === "replay") return hasTimeline ? null : "Run trame replay to generate one"
  // two different absences, and a reader can act on each: one needs a click,
  // the other needs the graph reparsed somewhere git can be read
  if (kind === "cochange" && !hasCoChange) return "Reparse inside a git repository"
  // the only lens that asks nothing of the reader: it is a statement about the
  // whole codebase, so it answers the moment the history is there
  if (kind === "hotspots") return hasHotspots ? null : "Reparse inside a git repository"
  if (selectedId) return null
  return kind === "path" ? "Select a file, then shift-click a second" : "Select a file first"
}
