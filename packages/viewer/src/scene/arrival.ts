/**
 * The entrance: the graph assembles itself instead of appearing.
 *
 * A landing visitor's first second decides whether they stay, and a static
 * graph fading in reads as an image. Building it in front of them — nodes
 * landing in a cascade, edges drawing between them — is the demonstration
 * itself, and it costs nothing extra: the positions are already known.
 *
 * The tool leaves this off. Someone who just saved a file wants their
 * architecture back, not a performance.
 */

/** How long one node takes to land. */
const NODE_ARRIVE_MS = 620

/** How long one edge takes to draw itself, once its endpoints are down. */
const EDGE_DRAW_MS = 420

/** Spacing between consecutive arrivals. */
const STAGGER_MS = 34

/** Distinct start slots — the cascade repeats past this, which keeps it tight. */
const SLOTS = 24

/**
 * A node's place in the cascade, derived from its id.
 *
 * Deterministic on purpose: every visitor sees the same choreography, and a
 * screenshot taken at 400 ms looks the same as the one in the README.
 */
function arrivalSlot(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % SLOTS
}

/**
 * How far along a node's landing is: 0 before it starts, 1 once it is home.
 * `arrivedAt` of 0 means no entrance was requested — everything is already home.
 */
export function nodeProgress(arrivedAt: number, id: string, now: number): number {
  if (arrivedAt <= 0) return 1
  const age = now - arrivedAt - arrivalSlot(id) * STAGGER_MS
  if (age <= 0) return 0
  return Math.min(age / NODE_ARRIVE_MS, 1)
}

/**
 * An edge waits for both of its ends, then draws from source to target.
 *
 * Drawing before the endpoints exist would show a line reaching into nothing,
 * which is exactly the "it was a picture all along" impression to avoid.
 */
export function edgeProgress(
  arrivedAt: number,
  source: string,
  target: string,
  now: number,
): number {
  if (arrivedAt <= 0) return 1
  const last = Math.max(arrivalSlot(source), arrivalSlot(target))
  const age = now - arrivedAt - last * STAGGER_MS - NODE_ARRIVE_MS * 0.45
  if (age <= 0) return 0
  return Math.min(age / EDGE_DRAW_MS, 1)
}

/** Overshoot-and-settle. Lands just past full size, then relaxes into it. */
export function overshoot(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const u = t - 1
  return 1 + 2.1 * u * u * u + 1.1 * u * u
}

/** Standard ease-out, for things that should arrive without bouncing. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3)
}
