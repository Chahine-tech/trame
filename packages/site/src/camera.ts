/**
 * Where the orbit sits. Each scroll section names one of these, and the camera
 * eases between them, so scrolling reads as moving through the graph.
 */
export interface CameraPose {
  /** orbit radius: how far back the viewpoint stands */
  distance: number
  /** how high it rides — a change of angle, not only of zoom */
  height: number
}

/** The hero's camera pose, in one place so nothing can drift from it. */
export const HERO_CAMERA = {
  position: [0, 11, 61] as [number, number, number],
  fov: 55,
  /** Orbit radius at the reference aspect — the z of the initial position. */
  distance: 61,
}

/** The pose the page opens on, before any section has claimed the viewport. */
export const HERO_POSE: CameraPose = { distance: HERO_CAMERA.distance, height: 11 }

/**
 * The canvas shape this framing was tuned against (a wide window, where the
 * graph sits in the frame properly). Narrower canvases scale the camera back
 * from here so the horizontal span stays the same at any width.
 */
export const REFERENCE_ASPECT = 1.17
