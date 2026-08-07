import { useSyncExternalStore } from "react"
import type { EdgeType, NodeType } from "./types"

export interface Palette {
  crust: string
  mantle: string
  base: string
  surface0: string
  surface1: string
  overlay: string
  subtext: string
  text: string
  blue: string
  green: string
  mauve: string
  peach: string
  pink: string
  yellow: string
  teal: string
  lav: string
  red: string
}

const VARS: (keyof Palette)[] = [
  "crust", "mantle", "base", "surface0", "surface1", "overlay", "subtext", "text",
  "blue", "green", "mauve", "peach", "pink", "yellow", "teal", "lav", "red",
]

/** Color = information: each node type maps to one Catppuccin accent. */
export const NODE_COLOR: Record<NodeType, keyof Palette> = {
  page: "blue",
  component: "green",
  hook: "mauve",
  api: "peach",
  "query-key": "pink",
  context: "yellow",
  store: "teal",
  module: "subtext",
}

export const EDGE_COLOR: Record<EdgeType, keyof Palette> = {
  import: "overlay",
  "api-call": "peach",
  "query-key": "pink",
  component: "green",
  context: "yellow",
}

function read(): Palette {
  const style = getComputedStyle(document.documentElement)
  const p = {} as Palette
  for (const v of VARS) p[v] = style.getPropertyValue(`--${v}`).trim() || "#888888"
  return p
}

let current = typeof document !== "undefined" ? read() : ({} as Palette)
const listeners = new Set<() => void>()

function refresh() {
  current = read()
  for (const l of listeners) l()
}

if (typeof document !== "undefined") {
  new MutationObserver(refresh).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  })
  const mq = matchMedia("(prefers-color-scheme: dark)")
  // computed styles settle a tick after the media query flips
  mq.addEventListener("change", () => setTimeout(refresh, 50))
}

/** Non-reactive read, for code outside React (store, toasts). */
export function getPalette(): Palette {
  return current
}

/** Additive glow and toast chrome need to know which ground they sit on. */
export function isDarkGround(): boolean {
  const h = (current.base ?? "#1e1e2e").replace("#", "")
  if (h.length < 6) return true
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
}

export function usePalette(): Palette {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/* ---------- theme preference (auto → dark → light) ---------- */

export type ThemePref = "auto" | "dark" | "light"
const THEME_KEY = "trame-theme"

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(THEME_KEY)
  return v === "dark" || v === "light" ? v : "auto"
}

/** Stamp data-theme on the root — the MutationObserver refreshes the palette. */
export function applyThemePref(pref: ThemePref): void {
  if (pref === "auto") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = pref
}

export function setThemePref(pref: ThemePref): void {
  if (pref === "auto") localStorage.removeItem(THEME_KEY)
  else localStorage.setItem(THEME_KEY, pref)
  applyThemePref(pref)
}

export function cycleThemePref(): ThemePref {
  const order: ThemePref[] = ["auto", "dark", "light"]
  const next = order[(order.indexOf(getThemePref()) + 1) % order.length]!
  setThemePref(next)
  return next
}
