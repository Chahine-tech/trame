import { useCallback, useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import { useGraphStore } from "../store/graph"
import { isDarkGround, usePalette } from "../theme"
import type { Vec3 } from "../types"

interface District {
  id: string
  label: string
  color: string
  centroid: THREE.Vector3
  /** world radius of the sphere standing in for the whole folder */
  radius: number
  fileCount: number
}

interface DistrictLink {
  id: string
  from: THREE.Vector3
  to: THREE.Vector3
  /** how many file-level edges this one line stands for */
  weight: number
}

/** Scratch vectors — rewritten before every read, never held across frames. */
const PROJECTED = new THREE.Vector3()
const MIDPOINT = new THREE.Vector3()

/** A folder reads as one body once you are far enough not to read filenames. */
function radiusFor(fileCount: number): number {
  return 2.2 + Math.sqrt(fileCount) * 1.5
}

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
 * Every district drawing its own name works until there are more than a
 * handful. cal.com has 114 folders, so `i18n/ 1 file` was printed straight
 * through the middle of `trpc/ 398 files` and neither could be read. A paper
 * map solves this by not labelling everything at once — the capital is named,
 * the village next to it waits until you are closer — and dropping a name is
 * better than keeping two that cancel each other out.
 *
 * Biggest first, then greedily: a name is kept when its box clears every name
 * already kept. Greedy is not optimal — choosing a maximum set of
 * non-overlapping boxes is NP-hard — but taking the largest first puts the
 * error where it costs least, on the folders with the fewest files in them.
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
 * Roughly how much room a district's name takes, without measuring the DOM.
 *
 * The font is monospace, so the width follows from the character count: about
 * 0.6 em, at 15px for the name and 10px for the file count beneath it. Reading
 * back the real rectangles would be exact and would also force a layout of
 * every label on every camera move, which is the cost this whole thing exists
 * to avoid.
 */
function labelSize(label: string, fileCount: number): { width: number; height: number } {
  const name = (label.length + 1) * 9
  const count = `${fileCount} files`.length * 6.2
  return { width: Math.max(name, count) + 10, height: 32 }
}

function centroidOf(ids: string[], positions: Map<string, Vec3>): THREE.Vector3 | null {
  const found = ids.map((id) => positions.get(id)).filter((p): p is Vec3 => Boolean(p))
  if (found.length === 0) return null
  const c = new THREE.Vector3()
  for (const p of found) c.add(new THREE.Vector3(...p))
  return c.divideScalar(found.length)
}

function DistrictBody({
  district,
  appear,
  showLabel,
  onLabel,
}: {
  district: District
  appear: React.RefObject<number>
  showLabel: boolean
  onLabel: (id: string, el: HTMLDivElement | null) => void
}) {
  const focus = useGraphStore((s) => s.focus)
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const hovered = useRef(false)

  // on a light ground an emissive translucent body turns to pastel mush;
  // lean on the base colour there and keep the glow for the dark theme
  const dark = isDarkGround()

  useFrame(() => {
    const t = appear.current
    const m = meshRef.current
    if (m) m.scale.setScalar(THREE.MathUtils.lerp(0.85, hovered.current ? 1.06 : 1, t))
    if (matRef.current) matRef.current.opacity = (dark ? 0.62 : 0.78) * t
  })

  return (
    <group position={district.centroid}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation()
          hovered.current = true
          document.body.style.cursor = "pointer"
        }}
        onPointerOut={() => {
          hovered.current = false
          document.body.style.cursor = ""
        }}
        onClick={(e) => {
          // clicking a district flies you into it — the camera crossing the
          // threshold is what expands it back into files
          e.stopPropagation()
          const first = useGraphStore
            .getState()
            .data?.clusters.find((c) => c.id === district.id)?.nodeIds[0]
          if (first) focus(first)
        }}
      >
        <icosahedronGeometry args={[district.radius, 2]} />
        <meshStandardMaterial
          ref={matRef}
          color={district.color}
          emissive={district.color}
          emissiveIntensity={dark ? 0.35 : 0.08}
          roughness={dark ? 0.55 : 0.35}
          metalness={0.1}
          flatShading
          transparent
          opacity={0}
        />
      </mesh>

      {/* the name sits on the region and always faces you, the way a map
          labels a district — an offset label gets swallowed by the body as
          soon as the camera orbits */}
      {showLabel && (
      <Html center zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}>
        <div className="district-label" ref={(el) => onLabel(district.id, el)}>
          <span className="name" style={{ color: district.color }}>
            {district.label}/
          </span>
          <span className="count">
            {district.fileCount} {district.fileCount === 1 ? "file" : "files"}
          </span>
        </div>
      </Html>
      )}

      {/* a faint shell so the body reads as a region, not a planet */}
      <mesh raycast={() => null}>
        <sphereGeometry args={[district.radius * 1.35, 20, 14]} />
        <meshBasicMaterial
          color={district.color}
          transparent
          opacity={0.05}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  )
}

function DistrictEdge({
  link,
  appear,
  onLabel,
}: {
  link: DistrictLink
  appear: React.RefObject<number>
  onLabel: (id: string, el: HTMLDivElement | null) => void
}) {
  const palette = usePalette()
  const matRef = useRef<THREE.MeshBasicMaterial>(null)

  const geometry = useMemo(() => {
    const curve = new THREE.LineCurve3(link.from, link.to)
    // one line stands for many imports: thickness carries the count
    const radius = Math.min(0.12 + Math.log2(link.weight + 1) * 0.14, 0.85)
    return new THREE.TubeGeometry(curve, 1, radius, 8)
  }, [link])

  useFrame(() => {
    if (matRef.current) matRef.current.opacity = 0.4 * appear.current
  })

  const mid = useMemo(() => link.from.clone().lerp(link.to, 0.5), [link])

  return (
    <group>
      <mesh geometry={geometry} raycast={() => null}>
        <meshBasicMaterial ref={matRef} color={palette.surface1} transparent opacity={0} />
      </mesh>
      {link.weight > 1 && (
        <Html position={mid} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
          <div className="district-weight" ref={(el) => onLabel(link.id, el)}>
            {link.weight}
          </div>
        </Html>
      )}
    </group>
  )
}

/**
 * The district layer: every folder becomes one body, and the imports between
 * two folders become one weighted line. This is the zoomed-out level of the
 * map — you read the shape of the system, not its filenames.
 */
export function Districts() {
  const data = useGraphStore((s) => s.data)
  const positions = useGraphStore((s) => s.positions)
  // the display toggles mean the same thing at both map levels; a key that
  // answers without acting is worse than a key that does nothing
  const edgeFilter = useGraphStore((s) => s.edgeFilter)
  const showLabels = useGraphStore((s) => s.showLabels)
  const showClusters = useGraphStore((s) => s.showClusters)
  const invalidate = useThree((s) => s.invalidate)
  // 0 → 1 entrance, driven imperatively so the crossfade costs no re-renders
  const appear = useRef(0)

  const { districts, links } = useMemo(() => {
    if (!data) return { districts: [] as District[], links: [] as DistrictLink[] }

    const districts: District[] = []
    const centre = new Map<string, THREE.Vector3>()
    for (const cluster of data.clusters) {
      const centroid = centroidOf(cluster.nodeIds, positions)
      if (!centroid) continue
      centre.set(cluster.id, centroid)
      districts.push({
        id: cluster.id,
        label: cluster.label,
        color: cluster.color,
        centroid,
        radius: radiusFor(cluster.nodeIds.length),
        fileCount: cluster.nodeIds.length,
      })
    }

    // collapse every file-level edge crossing two folders into one line
    const folderOf = new Map<string, string>()
    for (const node of data.nodes) folderOf.set(node.id, node.cluster)
    const weights = new Map<string, number>()
    for (const edge of data.edges) {
      // "show me only the API calls between my folders" is a real question
      if (edgeFilter && edge.type !== edgeFilter) continue
      const a = folderOf.get(edge.source)
      const b = folderOf.get(edge.target)
      if (!a || !b || a === b) continue
      const key = `${a}|${b}`
      weights.set(key, (weights.get(key) ?? 0) + 1)
    }

    const links: DistrictLink[] = []
    for (const [key, weight] of weights) {
      const [a, b] = key.split("|") as [string, string]
      const from = centre.get(a)
      const to = centre.get(b)
      if (from && to) links.push({ id: key, from, to, weight })
    }

    return { districts, links }
  }, [data, positions, edgeFilter])

  useFrame((_, dt) => {
    if (appear.current >= 1) return
    appear.current = Math.min(1, appear.current + dt * 3.5)
    invalidate() // keep the entrance running under frameloop="demand"
  })

  /**
   * Decide which names survive, and say so straight to the DOM.
   *
   * Written imperatively for the same reason the entrance is: 114 labels
   * re-rendering several times a second while the camera turns would cost far
   * more than the arithmetic that decides them. Recomputed only when the camera
   * has actually moved, which means a still scene costs nothing at all.
   */
  const labels = useRef(new Map<string, HTMLDivElement>())
  const onLabel = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) labels.current.set(id, el)
    else labels.current.delete(id)
  }, [])
  const lastView = useRef("")

  useFrame(({ camera, size }) => {
    /**
     * Recompute when the view moves — or when the cast changes.
     *
     * Labels attach through a ref callback, so some arrive a frame or two after
     * the first pass. Keying only on the camera meant those were never
     * considered, and since anything absent from the reckoning was switched off,
     * they stayed invisible until something else moved the camera. On cal.com
     * that hid the largest folders and left the map labelled with nothing but
     * its smallest integrations.
     */
    const view = `${camera.position.toArray().join()}|${camera.quaternion.toArray().join()}|${labels.current.size}`
    if (view === lastView.current) return
    lastView.current = view

    const boxes: LabelBox[] = []
    const place = (
      id: string,
      at: THREE.Vector3,
      width: number,
      height: number,
      tier: number,
      rank: number,
    ) => {
      if (!labels.current.has(id)) return
      PROJECTED.copy(at).project(camera)
      // behind the camera: drei still keeps the element around, and a name from
      // the far side of the graph must not take a place on this one
      if (PROJECTED.z > 1) return
      boxes.push({
        id,
        x: ((PROJECTED.x + 1) / 2) * size.width,
        y: ((1 - PROJECTED.y) / 2) * size.height,
        width,
        height,
        tier,
        rank,
      })
    }

    for (const district of districts) {
      const { width, height } = labelSize(district.label, district.fileCount)
      place(district.id, district.centroid, width, height, 0, district.fileCount)
    }

    /**
     * The counts on the lines compete for the same pixels as the names.
     *
     * They were left out of this at first, and they are the larger half of the
     * problem: cal.com draws 114 names and 293 of these, so three quarters of
     * the clutter was never being arbitrated at all. In the second tier, so a
     * number can fill a gap but never take a place a name wanted.
     */
    for (const link of links) {
      MIDPOINT.copy(link.from).lerp(link.to, 0.5)
      place(link.id, MIDPOINT, `${link.weight}`.length * 6.2 + 16, 18, 1, link.weight)
    }

    const keep = withoutOverlap(boxes)
    const considered = new Set(boxes.map((b) => b.id))
    for (const [id, el] of labels.current) {
      // an element that arrived mid-pass is not "rejected", merely not yet
      // judged; leaving it be until the next pass is kinder than blanking it
      if (!considered.has(id) && el.style.opacity === "") continue
      el.style.opacity = keep.has(id) ? "1" : "0"
    }
  })

  if (!data) return null

  return (
    <>
      {links.map((link) => (
        <DistrictEdge key={link.id} link={link} appear={appear} onLabel={onLabel} />
      ))}
      {districts.map((district) => (
        <DistrictBody
          key={district.id}
          district={district}
          appear={appear}
          showLabel={showLabels && showClusters}
          onLabel={onLabel}
        />
      ))}
    </>
  )
}
