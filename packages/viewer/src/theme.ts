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
}

const VARS: (keyof Palette)[] = [
  "crust", "mantle", "base", "surface0", "surface1", "overlay", "subtext", "text",
  "blue", "green", "mauve", "peach", "pink", "yellow", "teal", "lav",
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

export function usePalette(): Palette {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
