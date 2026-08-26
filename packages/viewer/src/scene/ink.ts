import { mix, type Palette } from "../theme"
import type { DiffStatus } from "../types"

/** How an edge is painted: a colour, and how much of the ground shows through. */
export interface Ink {
  color: string
  opacity: number
}

/**
 * How present an edge stays once a lens has pushed it into the background.
 *
 * It used to be 0.03, effectively deleted, while dimmed nodes stayed fully
 * opaque and merely turned pale. That asymmetry is what made a lens look
 * cloudy: the background kept its dots and lost its lines, and dots without
 * lines read as dirt on the screen rather than as distance.
 *
 * Low enough that the lit answer still shouts, high enough that the map
 * survives underneath it. Losing the structure is too high a price for
 * highlighting part of it.
 */
function dimmedEdge(dark: boolean): number {
  return dark ? 0.09 : 0.2
}

/**
 * Everything about an edge that decides how it is drawn.
 *
 * A flat bag rather than the store, so the decision can be tested against the
 * real palette without a canvas or a React tree.
 */
export interface EdgeMood {
  diff?: DiffStatus
  pathOn: boolean
  onPath: boolean
  impactOn: boolean
  impacted: boolean
  violated: boolean
  hovered: boolean
  lit: boolean
  selected: boolean
  hasActive: boolean
  typeColor: string
}

/**
 * What an edge looks like, given what the view is currently asking.
 *
 * The four analysis overlays (diff, path, impact, violation) used to name a
 * raw accent and an opacity chosen against the dark ground, on both grounds.
 * The resting language below them did not: it already walked the accent toward
 * the page's own ink and drew it at 0.95. Only the lenses were left behind,
 * and the lenses are the part of trame worth looking at.
 *
 * What that cost, measured on the impact lens over dub:
 *
 *            signal    ground   separation
 *   dark     5.50:1    1.05:1      5.2x
 *   paper    2.06:1    1.09:1      1.9x
 *
 * The hue was never the problem. Latte's yellow is a dark ochre, tuned by
 * `tokens.css` to reach 3:1 as a fill. It was drawn at 0.6 opacity, which
 * composites it to a pale tan and throws the tuning away before it reaches the
 * screen. On black, giving up 40% of a colour costs almost nothing, because
 * what shows through contributed no contrast to begin with. On white, what
 * shows through is where you started.
 */
export function edgeInk(mood: EdgeMood, p: Palette, dark: boolean): Ink {
  const dimmed = dimmedEdge(dark)

  /**
   * An accent drawn as an answer rather than as decoration.
   *
   * On paper that means ink: near-full strength, walked toward the colour the
   * page is written in. `mix` says why, for nodes: lowering opacity on
   * white pushes a mark toward the background, which is the opposite of
   * emphasis.
   */
  const answer = (accent: string, onDark: number, onPaper = 0.95): Ink =>
    dark
      ? { color: accent, opacity: onDark }
      : { color: mix(accent, p.text, 0.3), opacity: onPaper }

  const background: Ink = { color: p.surface1, opacity: dimmed }

  if (mood.diff === "added") return answer(p.green, 0.85)
  // a ghost stays a ghost: this edge is gone, and saying so loudly would make
  // the branch look like it broke something rather than removed it
  if (mood.diff === "removed") return answer(p.red, 0.3, 0.45)
  if (mood.pathOn) return mood.onPath ? answer(p.lav, 0.95) : background
  if (mood.impactOn) return mood.impacted ? answer(p.yellow, 0.6) : background
  if (mood.violated) {
    const near = mood.selected || mood.lit
    return answer(p.red, near ? 0.95 : 0.55, near ? 0.95 : 0.7)
  }
  if (mood.hovered) return answer(mood.typeColor, 0.9)

  // the resting language: no question is being asked, so the map is just itself
  if (dark) {
    return {
      color: mood.lit ? mood.typeColor : p.surface1,
      opacity: mood.selected ? 0.95 : mood.lit ? 0.75 : mood.hasActive ? 0.05 : 0.22,
    }
  }
  return {
    color: mood.lit || mood.selected ? mix(mood.typeColor, p.text, 0.3) : p.overlay,
    opacity: mood.lit || mood.selected ? 0.95 : mood.hasActive ? 0.3 : 0.6,
  }
}
