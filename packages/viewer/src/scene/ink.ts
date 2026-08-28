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
  /** which ring of the propagation this edge carries, when it carries one */
  impactRing: number | undefined
  coChangeOn: boolean
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
  if (mood.impactOn) {
    if (!mood.impacted) return background
    /**
     * The wave has to be drawn where the reader is looking, and that is the
     * edges: they cover a hundred times the area of the dots.
     *
     * The node fade was corrected first and it changed almost nothing on
     * screen, because widening the view to four rings pulled the camera back
     * until a node was 1.9 CSS pixels. Meanwhile every impacted edge was one
     * flat ochre, so the surface that fills the picture said nothing about
     * distance at all.
     *
     * Same law as the nodes: on paper the hue drains toward the resting grey,
     * on dark the light dims. Every ring holds between 3.96:1 and 4.11:1
     * against the page while chroma falls from 104 to 9.
     */
    const t = Math.min((mood.impactRing ?? 0) / 4, 1)
    return dark
      ? { color: p.yellow, opacity: 0.75 - t * 0.35 }
      : { color: mix(mix(p.yellow, p.text, 0.3), p.subtext, t), opacity: 0.95 }
  }
  /**
   * Every import recedes while this lens is open, without exception.
   *
   * The other lenses split the edges into answer and context. This one cannot:
   * a pair only reaches the graph if no import connects it, so no edge here is
   * ever part of the answer. The answer is drawn by `CoChangeMesh`, in a
   * straight teal line with no head, and the imports are the ground it needs to
   * stand out from.
   */
  if (mood.coChangeOn) return background
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

/** How a node is painted. `emissiveIntensity` is dark-ground only. */
export interface Surface {
  color: string
  emissiveIntensity: number
  opacity: number
}

/** Everything about a node that decides how it is drawn. */
export interface NodeMood {
  diff?: DiffStatus
  whatIfOn: boolean
  doomed: boolean
  stranded: boolean
  breaks: boolean
  justAdded: boolean
  pathOn: boolean
  onPath: boolean
  impactOn: boolean
  /** hops from the change, or undefined when this node is not in the set */
  impactDepth: number | undefined
  /** the selection or one of the files the history moves with it */
  coChanged: boolean
  coChangeOn: boolean
  violated: boolean
  lit: boolean
  hasActive: boolean
  hovered: boolean
  selected: boolean
  typeColor: string
}

/**
 * Pushed into the background by a lens.
 *
 * Each ground picks its neutrals against its own surface. On dark, dimming
 * drops opacity toward the void. On paper it washes toward the page, because
 * lowering opacity there pushes a mark toward the background rather than away
 * from the reader. It stops at a visible floor: losing the map is too high a
 * price for highlighting part of it.
 */
function recede(dark: boolean, p: Palette, amount: number): Surface {
  return dark
    ? { color: p.overlay, emissiveIntensity: 0, opacity: 1 - amount * 0.84 }
    : { color: mix(p.overlay, p.base, amount * 0.68), emissiveIntensity: 0, opacity: 1 }
}

/** An answer. On dark it emits; on paper it is ink, walked toward the text. */
function press(dark: boolean, p: Palette, ink: string, strength: number): Surface {
  return dark
    ? { color: ink, emissiveIntensity: strength, opacity: 1 }
    : { color: mix(ink, p.text, 0.12), emissiveIntensity: 0, opacity: 1 }
}

/**
 * How far the impact wave has travelled, drawn as distance rather than as
 * absence.
 *
 * On dark the wave dims: less emission and less opacity, which on a black
 * ground still leaves gold on black. Paper used to do the same thing by mixing
 * toward `base`, and that is mixing toward white. Measured on Latte, a node
 * four hops out came to 1.86:1 against the page and 1.39x against a node the
 * lens had pushed away entirely: the far half of the wave had dropped out of
 * the set it was meant to belong to.
 *
 * So on paper the hue drains instead of the ink. Chroma falls 185 to 25 across
 * the four rings while contrast holds between 3.8:1 and 4.4:1, and the far end
 * lands exactly on the resting grey, which is what a distant dependent is: an
 * ordinary node, still drawn, no longer the story.
 */
function wave(dark: boolean, p: Palette, ink: string, t: number): Surface {
  return dark
    ? { color: ink, emissiveIntensity: 0.75 - t * 0.5, opacity: 1 - t * 0.45 }
    : { color: mix(mix(ink, p.text, 0.12), p.subtext, t), emissiveIntensity: 0, opacity: 1 }
}

/**
 * What a node looks like, given what the view is currently asking.
 *
 * The order is the precedence: a simulation reframes everything, a replay's
 * arrivals announce themselves, a diff reframes the whole graph, and the lenses
 * come before the resting language.
 */
export function nodeInk(mood: NodeMood, p: Palette, dark: boolean): Surface {
  if (mood.whatIfOn) {
    if (mood.doomed) return press(dark, p, p.red, 0.7)
    if (mood.stranded) return press(dark, p, p.yellow, 0.5)
    if (mood.breaks) return press(dark, p, p.peach, 0.45)
    return recede(dark, p, 1)
  }
  if (mood.justAdded) return press(dark, p, p.green, 0.7)
  if (mood.diff === "added") return press(dark, p, p.green, 0.6)
  if (mood.diff === "removed") {
    // a ghost stays a ghost: this file is gone on the other branch
    return dark
      ? { color: p.red, emissiveIntensity: 0.25, opacity: 0.35 }
      : { color: mix(p.red, p.base, 0.55), emissiveIntensity: 0, opacity: 1 }
  }
  if (mood.pathOn) return mood.onPath ? press(dark, p, p.lav, 0.7) : recede(dark, p, 1)
  if (mood.impactOn) {
    if (mood.impactDepth === undefined) return recede(dark, p, 1)
    const t = Math.min(mood.impactDepth / 4, 1)
    return wave(dark, p, mood.impactDepth === 0 ? p.peach : p.yellow, t)
  }
  // the file asked about and the files that move with it; everything else is
  // the neighbourhood they sit in, which is context and not the answer
  if (mood.coChangeOn) return mood.coChanged ? press(dark, p, p.teal, 0.7) : recede(dark, p, 1)
  if (mood.violated) {
    if (!dark) return press(dark, p, p.red, 0)
    return {
      color: p.red,
      emissiveIntensity: mood.lit ? 0.7 : 0.35,
      opacity: mood.hasActive && !mood.lit ? 0.4 : 1,
    }
  }
  if (mood.lit) return press(dark, p, mood.typeColor, mood.hovered || mood.selected ? 0.7 : 0.4)
  if (mood.hasActive) return recede(dark, p, 1)
  // at rest: neutral ink, present but quiet. On paper a pencil construction
  // line, grey but unmistakably drawn.
  return dark
    ? { color: p.overlay, emissiveIntensity: 0.12, opacity: 0.92 }
    : { color: p.subtext, emissiveIntensity: 0, opacity: 1 }
}
