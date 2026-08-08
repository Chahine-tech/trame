/** The hero's camera pose, in one place so nothing can drift from it. */
export const HERO_CAMERA = {
  position: [0, 14, 78] as [number, number, number],
  fov: 55,
  /** Orbit radius at the reference aspect — the z of the initial position. */
  distance: 78,
}

/**
 * The canvas shape this framing was tuned against (a wide window, where the
 * graph sits in the frame properly). Narrower canvases scale the camera back
 * from here so the horizontal span stays the same at any width.
 */
export const REFERENCE_ASPECT = 1.17
