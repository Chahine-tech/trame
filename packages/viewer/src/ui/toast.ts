import { gooeyToast } from "goey-toast"
import { cycleEditor, EDITOR_LABEL } from "../editor"
import { getPalette } from "../theme"

/** Subtle preset, minimal bounce, Catppuccin fills, mono type. */
const BASE = {
  preset: "subtle" as const,
  bounce: 0.08,
  duration: 3200,
  showTimestamp: false,
  classNames: { title: "gt-title", description: "gt-desc", actionButton: "gt-action" },
}

function tinted(color: string) {
  const p = getPalette()
  return { ...BASE, fillColor: p.mantle, borderColor: color }
}

/**
 * Watch mode rewrote the graph: explain the layout that just moved. Fixed id,
 * so saving several files updates one toast instead of stacking a wall.
 */
export function toastGraphUpdated(nodeCount: number, delta: number): void {
  const p = getPalette()
  const change = delta === 0 ? "no new nodes" : delta > 0 ? `+${delta} nodes` : `${delta} nodes`
  gooeyToast.success("Graph updated", {
    ...tinted(p.green),
    id: "graph-update",
    description: `${nodeCount} nodes · ${change}`,
  })
}

/** A save just broke the architecture: say it now, not at CI time. */
export function toastViolations(count: number): void {
  const p = getPalette()
  gooeyToast.error(`${count} rule violation${count > 1 ? "s" : ""}`, {
    ...tinted(p.red),
    id: "violations",
    description: "Highlighted in red. Select one to read the rule.",
    duration: 5000,
  })
}

/** The code didn't compile, so the graph on screen is no longer current. */
export function toastParseFailed(message: string): void {
  const p = getPalette()
  gooeyToast.error("Parse failed", {
    ...tinted(p.red),
    id: "parse-failed",
    description: `Showing the last good graph · ${message}`,
    duration: 6000,
  })
}

/** For toggles whose result isn't visible until you interact with the graph. */
export function toastToggled(what: string, on: boolean): void {
  const p = getPalette()
  gooeyToast(`${what} ${on ? "on" : "off"}`, {
    ...tinted(p.lav),
    id: `toggle-${what}`,
    duration: 1600,
  })
}

/** Shift-click found nothing: say so instead of doing nothing. */
export function toastNoPath(from: string, to: string): void {
  const p = getPalette()
  gooeyToast.warning("No dependency path", {
    ...tinted(p.yellow),
    description: `${from} and ${to} are not connected`,
  })
}

/** The replay exists only if someone generated it. */
export function toastNoReplay(): void {
  const p = getPalette()
  gooeyToast.info("No replay generated", {
    ...tinted(p.blue),
    description: "Run: trame replay --src ./src",
    duration: 4000,
  })
}

export function toastNeedsSelection(action: string): void {
  const p = getPalette()
  gooeyToast.info("Select a node first", {
    ...tinted(p.blue),
    description: `${action} works on the selected node`,
  })
}

export function toastExported(what: string): void {
  const p = getPalette()
  gooeyToast.success(`${what} exported`, { ...tinted(p.green) })
}

/**
 * Says *which* state was copied. While a replay is on screen the diagram is
 * history, and pasting a three-week-old architecture into a PR believing it
 * is today is a mistake the toast can prevent.
 */
export function toastCopied(what: string, state?: string): void {
  const p = getPalette()
  gooeyToast.success(`${what} copied`, {
    ...tinted(p.green),
    description: state
      ? `The architecture at ${state}, not the present`
      : "Paste it into a PR, an issue or a README",
    duration: state ? 5000 : 3200,
  })
}

/** Clipboard writes need a secure context and can be denied. */
export function toastCopyFailed(what: string): void {
  const p = getPalette()
  gooeyToast.error(`Could not copy ${what}`, {
    ...tinted(p.red),
    description: "Clipboard access was blocked. Use the CLI --format flag.",
  })
}

/**
 * Protocol handlers fail silently, so confirm we heard the key, and offer
 * the fix for the actual failure mode: the wrong editor is configured.
 */
export function toastOpeningEditor(editor: string, file: string): void {
  const p = getPalette()
  gooeyToast(`Opening in ${editor}`, {
    ...tinted(p.lav),
    id: "open-editor",
    description: file,
    duration: 3000,
    action: {
      label: "Wrong editor?",
      onClick: () => toastEditorSwitched(EDITOR_LABEL[cycleEditor()]),
      successLabel: "Switched",
    },
  })
}

export function toastEditorSwitched(editor: string): void {
  const p = getPalette()
  gooeyToast.info(`Editor set to ${editor}`, {
    ...tinted(p.lav),
    id: "editor-switched",
    duration: 2200,
  })
}

/** How long the offer to take a deselection back stands, in ms. */
export const UNDO_MS = 5000

/**
 * Letting go of a file is one click on a target that covers most of the screen,
 * and it drops the selection, the framing and the open lens at once. The way
 * back is to remember the filename and type it again, which on a repository of
 * three thousand files is not a way back.
 *
 * An offer rather than a confirmation: the deselection has already happened and
 * the map is already on screen, so anyone who meant it pays nothing and ignores
 * this. Only the slip has something to click.
 */
export function toastDeselected(label: string, file: string, undo: () => void): void {
  const p = getPalette()
  gooeyToast(`Deselected ${label}`, {
    ...tinted(p.overlay),
    id: "deselected",
    // the path, as `toastOpeningEditor` does: a basename is what fits on a
    // chip, not what tells two `index.ts` apart. It also gives the action a
    // line to sit under — without one the card is a title above an empty
    // middle with a button adrift in it
    description: file,
    duration: UNDO_MS,
    action: { label: "Undo", onClick: undo, successLabel: "Back" },
  })
}

/** The graph was parsed where no history could be read, so the lens has nothing. */
export function toastNoCoChange(): void {
  const p = getPalette()
  gooeyToast.info("No co-change in this graph", {
    ...tinted(p.teal),
    id: "no-cochange",
    description: "Reparse inside a git repository to read its history.",
    duration: 4000,
  })
}

export function toastNoHotspots(): void {
  const p = getPalette()
  gooeyToast.info("No hotspots in this graph", {
    ...tinted(p.red),
    id: "no-hotspots",
    description: "Reparse inside a git repository to read its history.",
    duration: 4000,
  })
}

/** The lens works, this file simply never travels with anything. */
export function toastNoCoChangeFor(label: string): void {
  const p = getPalette()
  gooeyToast(`${label} moves alone`, {
    ...tinted(p.teal),
    id: "no-cochange-for",
    description: "No other file changes with it often enough to count.",
    duration: 3000,
  })
}
