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
