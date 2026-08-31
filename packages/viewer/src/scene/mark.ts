/**
 * A mark that is the same size on screen wherever it stands.
 *
 * The hotspot lens names a set — a hundred and fifty files out of three and a
 * half thousand — and the only thing the map is asked to say about a member of
 * it is *this one*. Every attempt to say more died on the same arithmetic:
 * apparent size is weight over distance, so whatever the encoding asks for, the
 * camera multiplies it by wherever the file happens to sit. Measured on dub,
 * the ranked nodes span 1.20x in world size (43 of the 150 are already at the
 * cap) and roughly 20x on screen. The 20x is depth, all of it — the loudest
 * mark in the picture belonged to whichever file was nearest, which is not a
 * fact about the repository.
 *
 * Depth carries no meaning in this lens, so it is not allowed to distort
 * anything. A ranked node takes a world scale proportional to its distance from
 * the camera, which is exactly what cancels the projection: 150 marks, the same
 * number of pixels each, laid over the geography they actually live in.
 *
 * This is the standard screen-space trick, written out rather than borrowed, so
 * the number in `px` means what it says. The visible height of the frustum at
 * distance `d` is `2 * d * tan(fov / 2)`; divide by the viewport in CSS pixels
 * and you have world units per pixel there.
 */
export function markScale(
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
  px: number,
): number {
  // a node the camera has flown inside would divide the scale to nothing and
  // take the mark with it; the floor keeps it drawn while it is passed through
  const d = Math.max(distance, 0.5)
  const perPx = (2 * Math.tan((fovDeg * Math.PI) / 360) * d) / viewportHeightPx
  return px * perPx
}

/**
 * The mark, as the radius of a unit node in CSS pixels.
 *
 * A unit node because the scale still multiplies a geometry, and every ranked
 * node borrows the same one — the module's icosahedron, radius 0.65 — so the
 * mark lands about eleven pixels across. `NodeMesh` says why they all borrow it:
 * with depth cancelled, the shapes were the last thing left varying, and a
 * component's cube carries over twice a module's ink.
 *
 * Big enough to be a mark and not a speck at 150 of them; small enough that the
 * dense folders stay countable instead of merging into one red field.
 */
export const MARK_PX = 8.5

/**
 * The rest of the map, while a lens holds a uniform mark, as the same measure.
 *
 * Locking the answer to a size in pixels and leaving everything else obeying
 * perspective only looks right at the distance the lens was tuned at. Anywhere
 * else the two registers drift apart, and they drifted the wrong way: on the
 * landing, whose hotspot beat stands 60 units off a 45-file graph, a context
 * node came to 29 pixels against the answer's 11 — the section's subject was
 * the smallest thing on its own screen, three of them against forty-two.
 *
 * So the ground is measured the same way. Both registers are then fixed in
 * pixels, the ratio between them is a constant the lens chooses rather than an
 * accident of where the camera stands, and it is the right way round: a mark is
 * a little under twice its ground.
 */
export const CONTEXT_PX = 4.5

/**
 * The ranking, minus the part of it the lens is actually reporting.
 *
 * Three registers had been sharing two sizes. The knot and the rest of the
 * ranking both took `MARK_PX`, separated only by how hard the ink is pressed,
 * and on dub that is 37 against 120 — so the register that is *not* the answer
 * filled the picture by weight of numbers, which is the same fault the ground
 * had one rung further down.
 *
 * Between the two and deliberately nearer the ground, because that is what it
 * is: still in the ranking, and not what the sentence is about. It was the
 * exact midpoint first, which the test caught — the halfway mark shares the gap
 * evenly and so says the middle register is as much the answer as it is the
 * map, which is not the claim. A module comes out at 11.0, 7.8 and 5.9 pixels.
 *
 * Three sizes for three categories — in the knot, in the ranking, neither —
 * which is allowed for the reason three colours are: these are
 * facts about a file, not places in an order.
 */
export const RANKED_PX = 6

/**
 * The arrangement these three sizes were measured against.
 *
 * dub's hotspot lens draws about two hundred and fifty files: 157 marks and the
 * folder around them. That is a crowd, and the sizes above are what keeps a
 * crowd countable.
 */
const REFERENCE_NODES = 250

/**
 * How much bigger everything may be drawn, given how little is on screen.
 *
 * The three sizes above are constants, and a constant tuned on one scene is a
 * constant that is wrong on every other. Measured on the landing, whose hotspot
 * beat draws 45 files: the answer came out at eleven pixels beside a co-change
 * beat whose answer is a 35-pixel cube with a halo and a tube. Same product,
 * same page, and only one of the two lenses announced what it had found.
 *
 * The mark's own documentation gives the reason without meaning to — "big
 * enough to be a mark and not a speck at 150 of them, small enough that the
 * dense folders stay countable". Every word of that is about the crowd. With
 * three marks there is no crowd to keep countable and no reason to whisper.
 *
 * So the family scales together and the ratios between the three registers do
 * not move: what the size says about any one file is still nothing, which is
 * the whole constraint. It is a body size for the set, not a channel.
 *
 * Square root rather than linear, for the reason a page of text does not double
 * its type when the page halves: the crowd thins faster than the eye needs. And
 * it only ever grows — below the reference the sizes stay as they were measured,
 * because a scene denser than dub's needs them small more, not less.
 */
export function crowding(drawn: number): number {
  if (drawn <= 0) return 1
  return Math.min(Math.max(Math.sqrt(REFERENCE_NODES / drawn), 1), 2.5)
}

/**
 * Whether a mark may carry a halo of its own.
 *
 * Every other lens rings its answer; this one reserves the ring for the row the
 * reader clicked, because 157 halos is a wash rather than an answer. That is
 * right for a crowd and wrong for a handful — on the landing the lens found
 * three files and gave them no ring at all, beside a co-change beat that rings
 * each of its three partners.
 *
 * Twelve is where a set stops being a list you can take in and starts being a
 * population. Below it, the answer announces itself the way every other lens
 * does.
 */
export function marksMayGlow(marks: number): boolean {
  return marks > 0 && marks <= 12
}
