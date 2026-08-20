/** A label's footprint on screen, in pixels, and how much it deserves the space. */
export interface LabelBox {
  id: string
  /** centre, in pixels from the top left of the canvas */
  x: number
  y: number
  width: number
  height: number
  /**
   * What kind of thing this is, lowest first. A place name beats a traffic
   * count: knowing a region is `features/` is worth more than knowing that 43
   * imports cross a particular line, so no number ever pushes out a name.
   */
  tier: number
  /** within a tier, bigger wins; ties break on id, so runs agree */
  rank: number
}

/**
 * The labels a map can actually show: the most important ones, and then
 * whatever still fits between them.
 *
 * Everything drawing its own name works until there are more than a handful.
 * cal.com has 114 folders, so `i18n/ 1 file` was printed straight through the
 * middle of `trpc/ 398 files` and neither could be read; opening on a file, its
 * forty neighbours all wrote their names on the same knot. A paper map solves
 * this by not labelling everything at once — the capital is named, the village
 * beside it waits until you are closer — and dropping a name is better than
 * keeping two that cancel each other out.
 *
 * Most important first, then greedily: a name is kept when its box clears every
 * name already kept. Greedy is not optimal — choosing a maximum set of
 * non-overlapping boxes is NP-hard — but taking the most important first puts
 * the error where it costs least.
 */
export function withoutOverlap(boxes: LabelBox[]): Set<string> {
  const kept: LabelBox[] = []
  const ids = new Set<string>()
  const ordered = [...boxes].sort(
    (a, b) => a.tier - b.tier || b.rank - a.rank || a.id.localeCompare(b.id),
  )

  for (const box of ordered) {
    const clashes = kept.some(
      (other) =>
        Math.abs(box.x - other.x) * 2 < box.width + other.width &&
        Math.abs(box.y - other.y) * 2 < box.height + other.height,
    )
    if (clashes) continue
    kept.push(box)
    ids.add(box.id)
  }
  return ids
}

/**
 * Roughly how much room a piece of text takes, without measuring the DOM.
 *
 * The font is monospace, so the width follows from the character count — about
 * 0.6 em. Reading back the real rectangles would be exact and would also force
 * a layout of every label on every camera move, which is the cost this whole
 * thing exists to avoid.
 */
export function textSize(text: string, fontSize: number): { width: number; height: number } {
  return { width: text.length * fontSize * 0.6 + 10, height: fontSize + 8 }
}

/**
 * Show the names that were kept, hide the rest, and leave alone anything that
 * arrived too late to be judged.
 *
 * Labels attach through a ref callback, so some appear a frame or two after a
 * pass has run. Switching those off as though they had lost would hide them
 * until something moved the camera — which on cal.com left the map labelled
 * with nothing but its smallest integrations.
 */
export function applyLabels(
  elements: Map<string, HTMLElement>,
  boxes: LabelBox[],
  keep: Set<string>,
): void {
  const considered = new Set(boxes.map((b) => b.id))
  for (const [id, el] of elements) {
    if (!considered.has(id) && el.style.opacity === "") continue
    el.style.opacity = keep.has(id) ? "1" : "0"
  }
}
