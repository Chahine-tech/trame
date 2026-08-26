/**
 * A lens is a question asked of the graph: "what depends on this?", "what
 * would break?", "how did this branch change it?". Only one can be active,
 * because each one repaints every node and edge to answer *its* question.
 *
 * Before this existed the overlays were independent booleans that quietly
 * cancelled each other in a chain of if/else, and the reader had no way to
 * know which question the colours were currently answering.
 */
export type LensKind = "none" | "impact" | "path" | "whatif" | "diff" | "replay"

export interface LensInfo {
  /** short name shown in the top bar while the lens is on */
  label: string
  /** the palette token that carries this lens' meaning */
  accent: "yellow" | "lav" | "peach" | "green"
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
