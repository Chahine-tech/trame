/** A label's footprint on screen, in pixels, and how much it deserves the space. */
export interface LabelBox {
  id: string
  /** centre, in pixels from the top left of the canvas */
  x: number
  y: number
  /**
   * Where the node itself projects to, which is where the name is anchored.
   *
   * Distinct from `x`/`y`, which is the middle of the rectangle the name
   * occupies: the label floats clear of its node, so the two differ by most of
   * a line's height. The arbitration wants the rectangle; the DOM wants the
   * anchor.
   *
   * Optional because the migration off drei's `Html` is per consumer. A box
   * without one is still positioned by drei, and writing a transform onto it
   * here would only fight whatever drei puts there on the next frame. File
   * names carry one; district names do not, yet.
   */
  at?: [number, number]
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

/** A rectangle already spoken for, in the same pixels as a `LabelBox`. */
export interface Reserved {
  /** top-left, not centre: this comes straight from `getBoundingClientRect` */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The labels a map can show: the most important, then whatever fits between.
 *
 * Everything drawing its own name works up to a handful. cal.com has 114
 * folders, so `i18n/ 1 file` printed straight through `trpc/ 398 files` and
 * neither could be read; opening on a file, its forty neighbours wrote their
 * names on the same knot. Dropping a name beats keeping two that cancel out.
 *
 * Most important first, then greedily: a name is kept when its box clears every
 * name already kept. Greedy is not optimal, since a maximum set of
 * non-overlapping boxes is NP-hard, but taking the most important first puts
 * the error where it costs least.
 */
export function withoutOverlap(boxes: LabelBox[], reserved: Reserved[] = []): Set<string> {
  /**
   * The chrome enters as a label that has already won.
   *
   * Names were drawn straight through the lens bar — `cron/groups/remap-de…`
   * crossing the `path` and `what if` chips — because the arbitration only ever
   * knew about other names. Anything fixed over the canvas occupies space on
   * the same terms, so it is seeded into the kept set rather than handled as a
   * special case afterwards.
   */
  const kept: LabelBox[] = reserved.map((r, i) => ({
    id: `reserved-${i}`,
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    width: r.width,
    height: r.height,
    tier: -1,
    rank: Number.MAX_SAFE_INTEGER,
  }))
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
 * The font is monospace, so the width follows from the character count, about
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
 * until something moved the camera, which on cal.com left the map labelled
 * with nothing but its smallest integrations.
 */
/**
 * Place the names that won, hide the rest.
 *
 * Placing them is this function's job now because the position was already
 * computed and thrown away: every box here carries the projection the
 * arbitration was decided on. It used to be drei's `Html`, one `useFrame` per
 * label, redoing the same projection and writing a z-index every frame — and
 * this runs only when the view has actually moved.
 *
 * A label that lost is left where it is rather than moved: it is invisible, and
 * moving it would cost a layout for something nobody can see.
 */
export function applyLabels(
  elements: Map<string, HTMLElement>,
  boxes: LabelBox[],
  keep: Set<string>,
): void {
  const considered = new Set(boxes.map((b) => b.id))
  for (const b of boxes) {
    if (!b.at || !keep.has(b.id)) continue
    const el = elements.get(b.id)
    if (!el) continue
    // rounded to whole pixels: a name on a half pixel is a blurry name, and
    // the arbitration that put it there worked in whole pixels anyway
    el.style.transform = `translate3d(${Math.round(b.at[0])}px, ${Math.round(b.at[1])}px, 0) translate(-50%, -180%)`
  }
  for (const [id, el] of elements) {
    if (!considered.has(id) && el.style.opacity === "") continue
    el.style.opacity = keep.has(id) ? "1" : "0"
  }
}
