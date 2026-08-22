import type { GraphCluster } from "../types"

type Vec3 = [number, number, number]

/** Where a folder's name goes: always on one of its files, raised a little. */
export interface FolderAnchor {
  id: string
  label: string
  color: string
  /** the position of an actual member — never a computed average */
  at: Vec3
  lift: number
}

/** Naming a folder from one file says nothing the file's own label doesn't. */
const MIN_MEMBERS = 2

/**
 * How much of a folder must sit next to its own kind before its name means
 * anything. Below this the folder is interleaved with the others rather than
 * occupying a corner of the map, and a single point cannot stand for it.
 */
const COHESION = 0.5

/**
 * Cohesion is a proportion, so it can be estimated from a sample. The whole
 * graph can be drawn — 2238 files on dub — and measuring every pair against
 * every other would be five million distances recomputed on every frame of a
 * replay.
 */
const SAMPLE = 40

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function meanOf(points: Vec3[]): Vec3 {
  const sum: Vec3 = [0, 0, 0]
  for (const p of points) {
    sum[0] += p[0]
    sum[1] += p[1]
    sum[2] += p[2]
  }
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length]
}

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)] ?? 0

/**
 * Two things read off the folder's nearest-neighbour distances at once.
 *
 * `cohesion` is the share of its files whose nearest drawn neighbour is also
 * theirs. Dispersion alone cannot tell a district from a scattering: a healthy
 * folder fills its own patch of the map and is therefore spread out too. What
 * separates them is company. A folder that owns a corner is surrounded by
 * itself; a folder strewn between the others has someone else's file nearest
 * to almost every one of its own.
 *
 * `spacing` is the typical gap between two files of this folder — the right
 * scale for lifting a name clear of a dot without drifting off it, and it
 * follows the local density rather than the size of the folder.
 */
function neighboursOf(
  mine: Vec3[],
  everyone: { at: Vec3; own: boolean }[],
): { cohesion: number; spacing: number } {
  const step = Math.max(1, Math.floor(mine.length / SAMPLE))
  const gaps: number[] = []
  let checked = 0
  let together = 0
  for (let i = 0; i < mine.length; i += step) {
    const p = mine[i]!
    let best = Infinity
    let bestOwn = false
    let nearestOwn = Infinity
    for (const other of everyone) {
      if (other.at === p) continue
      const d = distance(p, other.at)
      if (d < best) {
        best = d
        bestOwn = other.own
      }
      if (other.own && d < nearestOwn) nearestOwn = d
    }
    checked++
    if (bestOwn) together++
    if (Number.isFinite(nearestOwn)) gaps.push(nearestOwn)
  }
  return {
    cohesion: checked === 0 ? 1 : together / checked,
    spacing: median(gaps.sort((a, b) => a - b)),
  }
}

/**
 * Place a folder name over the files of that folder that are actually drawn.
 *
 * Two things went wrong before, and both put a name in empty space.
 *
 * The centre used to come from every file a folder holds, drawn or not — so a
 * detail view showing a subset had its labels describing a different
 * population than its dots. That is fixed by passing `nearby`.
 *
 * The position was the folder's mean, lifted by the distance to its farthest
 * drawn file — the top of a bounding sphere rather than anywhere near its
 * files. On a neighbourhood of dub's tinybird that put `app/` in open black
 * with its route handlers strewn below and to the left. Lifting by the typical
 * radius instead of the farthest one moved the name a little closer and left
 * it in the same emptiness, because a mean is a point no file has to occupy
 * and the radius of a spread folder is large whichever way you take it.
 *
 * So the name is hung on a file rather than on an average: the member nearest
 * the mean, raised by the typical gap between two of the folder's own files.
 * That is enough to clear the dot, follows the local density instead of the
 * size of the folder, and cannot land in a void — there is a file underneath
 * it by construction.
 */
export function folderAnchors(
  clusters: GraphCluster[],
  positions: Map<string, Vec3>,
  nearby: Set<string> | null,
): FolderAnchor[] {
  const drawn: { cluster: GraphCluster; points: Vec3[]; at: Vec3 }[] = []

  for (const cluster of clusters) {
    const points = cluster.nodeIds
      .filter((id) => !nearby || nearby.has(id))
      .map((id) => positions.get(id))
      .filter((p): p is Vec3 => Boolean(p))
    if (points.length < MIN_MEMBERS) continue
    drawn.push({ cluster, points, at: meanOf(points) })
  }

  const anchors: FolderAnchor[] = []
  for (const { cluster, points, at } of drawn) {
    const everyone = drawn.flatMap((d) =>
      d.points.map((p) => ({ at: p, own: d.cluster.id === cluster.id })),
    )
    const { cohesion, spacing } = neighboursOf(points, everyone)
    if (cohesion < COHESION) continue
    let host = points[0]!
    for (const p of points) if (distance(p, at) < distance(host, at)) host = p
    anchors.push({
      id: cluster.id,
      label: cluster.label,
      color: cluster.color,
      at: host,
      lift: spacing + 3.5,
    })
  }
  return anchors
}
