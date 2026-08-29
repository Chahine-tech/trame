import { useSyncExternalStore } from "react"
import type { EdgeType, NodeType } from "./types"

/**
 * The CSS custom properties the stylesheet defines, and the single source of
 * truth for what a palette contains.
 *
 * `Palette` is derived from this list rather than declared beside it: `read()`
 * builds its result by walking these names, so a colour declared in the type
 * but missing here would be typed `string` and be `undefined` at runtime. One
 * list means the two cannot drift.
 */
const VARS = [
  "crust",
  "mantle",
  "base",
  "surface0",
  "surface1",
  "overlay",
  "subtext",
  "text",
  "blue",
  "green",
  "mauve",
  "peach",
  "pink",
  "yellow",
  "teal",
  "lav",
  "red",
] as const

export type Palette = Record<(typeof VARS)[number], string>

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

/**
 * Read a colour, in either shape `mix` has to deal with.
 *
 * `mix` returns `rgb(…)` and used to accept only `#rrggbb`, so nesting two of
 * them fed a string starting with `rgb(` to a hex parser. It did not throw:
 * `"rgb(164, 108, 26)".slice(0, 2)` is `"rg"`, which parses as NaN, while the
 * later slices happen to yield digits. `mix(mix(a, b, t), c, u)` produced
 * `rgb(NaN, 126, 134)`, and that is the colour the impact lens drew on paper
 * for as long as the lens existed.
 */
function channels(color: string): [number, number, number] {
  const rgb = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const h = color.replace("#", "")
  const full = h.length === 3 ? h[0]! + h[0] + h[1] + h[1] + h[2] + h[2] : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/**
 * Blend two palette colours. On a light ground this is how a node is dimmed:
 * washed toward the paper, never made transparent. Lowering opacity on white
 * pushes a node toward the background, which is the opposite of receding.
 */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = channels(a)
  const [r2, g2, b2] = channels(b)
  const to = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${to(r1, r2)}, ${to(g1, g2)}, ${to(b1, b2)})`
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

export type ThemePref = "auto" | "dark" | "light"
const THEME_KEY = "trame-theme"

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(THEME_KEY)
  return v === "dark" || v === "light" ? v : "auto"
}

/** Stamp data-theme on the root; the MutationObserver refreshes the palette. */
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
