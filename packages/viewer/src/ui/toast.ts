import { gooeyToast } from "goey-toast"
import { cycleEditor, EDITOR_LABEL } from "../editor"
import { getPalette } from "../theme"

/**
 * archviz speaks quietly: subtle preset, minimal bounce, Catppuccin fills,
 * mono type like the rest of the app. The morph stays, the playfulness
 * doesn't — this is a precision instrument, and toasts here are rare.
 */
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
 * Watch mode rewrote the graph — explain the layout that just moved.
 * Fixed id: saving several files in a row updates one toast in place
 * instead of stacking a wall of them.
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

/** A save just broke the architecture — say it now, not at CI time. */
export function toastViolations(count: number): void {
  const p = getPalette()
  gooeyToast.error(`${count} rule violation${count > 1 ? "s" : ""}`, {
    ...tinted(p.red),
    id: "violations",
    description: "Highlighted in red — select one to read the rule",
    duration: 5000,
  })
}

/** The code didn't compile — the graph on screen is no longer current. */
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

/** Shift-click found nothing — say so instead of doing nothing. */
export function toastNoPath(from: string, to: string): void {
  const p = getPalette()
  gooeyToast.warning("No dependency path", {
    ...tinted(p.yellow),
    description: `${from} and ${to} are not connected`,
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
 * Protocol handlers fail silently, so confirm we heard the key — and offer
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
