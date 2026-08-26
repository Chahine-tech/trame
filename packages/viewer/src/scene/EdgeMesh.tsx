import { useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import { useGraphStore } from "../store/graph"
import { EDGE_COLOR, isDarkGround, usePalette } from "../theme"
import { edgeInk } from "./ink"
import type { GraphEdge, Vec3 } from "../types"
import { useDisposable } from "./useDisposable"
import { edgeProgress, easeOut } from "./arrival"

/** Sides of the extruded tube. Named because the draw-in steps by whole rings. */
const RADIAL_SEGMENTS = 6

/**
 * The arrangement these tube widths were chosen against: trame's own graph,
 * and still the store's default extent.
 */
const TUNED_AT = 60

/**
 * How much to thicken the tubes so a line stays a line at any zoom.
 *
 * A tube has a radius in world units, so it shrinks as the camera pulls back,
 * and every camera distance in this scene is a multiple of `extent`. The two
 * cancel: hold the radius fixed and an edge occupies a constant *fraction* of
 * the view, which on a large graph is a fraction of a pixel. At 60 units and a
 * 60° field of view a lit edge is 2.4 CSS pixels; around dub's tinybird, which
 * spreads to 255, the same edge is 0.57, antialiased into a wash rather than
 * drawn as a line. The dark ground got away with it, because a thin bright
 * line on black survives being smeared and a thin dark line on white does not.
 * It was never a colour problem, and no amount of opacity would have fixed it.
 *
 * Restoring the same width everywhere, growing straight with the extent,
 * was the obvious repair and it was wrong. It put 2.4 pixels back on a hub
 * with a hundred and fifty edges converging on it and buried the nodes under
 * their own connections. The hand-tuned width was never only a width: trame's
 * own graph is 24 files, and 2.4 pixels is what suits that sparsity. A big
 * arrangement is not just further away, it is denser, and lines that read when
 * they are few will blot when they are many.
 *
 * So the growth is sub-linear: the usual answer for a linear measure fighting
 * something that scales like an area. It buys back enough to clear a pixel,
 * not enough to restore the weight of a sparse map:
 *
 *   extent  60 → 2.44 CSS px   (unchanged, the floor holds)
 *   extent 255 → 1.18          (was 0.57)
 *   extent 453 → 0.89          (was 0.32)
 */
export function tubeGrowth(extent: number): number {
  return Math.max(1, Math.sqrt(extent / TUNED_AT))
}

const UP = new THREE.Vector3(0, 1, 0)

/** Scratch hit point, written by intersectPlane and read in the same event. */
const HIT = new THREE.Vector3()

/** Handle entrance, in ms. Short enough to feel like a response, not a show. */
const APPEAR_MS = 260

/** Deterministic default control points: a gentle perpendicular bow. */
function defaultCtrl(p0: Vec3, p3: Vec3, edgeId: string): { c1: Vec3; c2: Vec3 } {
  const a = new THREE.Vector3(...p0)
  const b = new THREE.Vector3(...p3)
  const dir = b.clone().sub(a)
  const len = dir.length() || 1
  // hash the id so parallel edges don't overlap perfectly
  let h = 0
  for (let i = 0; i < edgeId.length; i++) h = (h * 31 + edgeId.charCodeAt(i)) | 0
  const side = h % 2 === 0 ? 1 : -1
  const perp = dir.clone().normalize().cross(UP)
  if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0)
  perp.normalize().multiplyScalar(len * 0.14 * side)
  const c1 = a.clone().lerp(b, 1 / 3).add(perp)
  const c2 = a.clone().lerp(b, 2 / 3).add(perp)
  return { c1: [c1.x, c1.y, c1.z], c2: [c2.x, c2.y, c2.z] }
}

function DraggableHandle({
  position,
  color,
  delay,
  onDrag,
}: {
  position: Vec3
  color: string
  /** seconds to wait before appearing; the two handles land one after another */
  delay: number
  onDrag: (p: Vec3) => void
}) {
  const setControlsEnabled = useGraphStore((s) => s.setControlsEnabled)
  const invalidate = useThree((s) => s.invalidate)
  const meshRef = useRef<THREE.Mesh>(null)
  const elapsed = useRef(0)

  // the handles are the whole point of trame, so they arrive rather than
  // simply exist: a short overshoot, staggered, like a vector tool
  useFrame((_, dt) => {
    const m = meshRef.current
    if (!m || elapsed.current > APPEAR_MS) return
    elapsed.current += dt * 1000
    const t = THREE.MathUtils.clamp((elapsed.current - delay * 1000) / APPEAR_MS, 0, 1)
    // ease-out back: settles just past 1 then returns
    const eased = t === 0 ? 0 : 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)
    m.scale.setScalar(eased)
    m.visible = t > 0
    invalidate()
  })
  // the drag plane lives exactly as long as the gesture: built on press,
  // dropped on release. Per-handle, so multi-touch can drag two handles on
  // different planes at once.
  const drag = useRef<THREE.Plane | null>(null)

  return (
    <mesh
      ref={meshRef}
      position={position}
      scale={0}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        setControlsEnabled(false)
        // drag on the camera-facing plane through the handle
        const camDir = e.camera.getWorldDirection(new THREE.Vector3())
        drag.current = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camDir,
          new THREE.Vector3(...position),
        )
        ;(e.target as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        const plane = drag.current
        if (!plane) return
        e.stopPropagation()
        if (e.ray.intersectPlane(plane, HIT)) {
          onDrag([HIT.x, HIT.y, HIT.z])
        }
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        drag.current = null
        setControlsEnabled(true)
        ;(e.target as Element).releasePointerCapture(e.pointerId)
      }}
    >
      <sphereGeometry args={[0.55, 16, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

/** Thin tube from a to b: a guide line that works on every renderer. */
function GuideLine({ from, to, color }: { from: Vec3; to: Vec3; color: string }) {
  const geometry = useMemo(() => {
    const curve = new THREE.LineCurve3(new THREE.Vector3(...from), new THREE.Vector3(...to))
    return new THREE.TubeGeometry(curve, 1, 0.04, 4)
  }, [from, to])
  useDisposable(geometry)
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} transparent opacity={0.4} />
    </mesh>
  )
}

export function EdgeMesh({ edge }: { edge: GraphEdge }) {
  const palette = usePalette()
  const [hovered, setHovered] = useState(false)
  const p0 = useGraphStore((s) => s.positions.get(edge.source))
  const p3 = useGraphStore((s) => s.positions.get(edge.target))
  const edited = useGraphStore((s) => s.ctrl.get(edge.id))
  const isViolated = useGraphStore((s) => s.violatedEdges.has(edge.id))
  const isSelected = useGraphStore((s) => s.selectedEdgeId === edge.id)
  const litSet = useGraphStore((s) => s.litSet)
  const hasActive = useGraphStore((s) => s.litSet.size > 0)
  const selectEdge = useGraphStore((s) => s.selectEdge)
  const setCtrl = useGraphStore((s) => s.setCtrl)
  const resetCtrl = useGraphStore((s) => s.resetCtrl)

  const ctrl = useMemo(
    () => edited ?? (p0 && p3 ? defaultCtrl(p0, p3, edge.id) : null),
    [edited, p0, p3, edge.id],
  )

  const arrivedAt = useGraphStore((s) => s.arrivedAt)
  const tubeRef = useRef<THREE.Mesh>(null)
  const arrowRef = useRef<THREE.Mesh>(null)
  const drawn = useRef(false)

  /**
   * The edge draws itself from source to target rather than fading in.
   *
   * TubeGeometry indexes its triangles ring after ring along the curve, so a
   * draw range is a length: the tube genuinely grows toward its target instead
   * of appearing whole at low opacity. The arrowhead waits for it to land,
   * because an arrow ahead of its own line reads as a rendering glitch.
   */
  useFrame(({ invalidate }) => {
    // once drawn it stays drawn: without this every edge would keep paying for
    // a per-frame no-op for the rest of the session
    if (drawn.current) return
    const tube = tubeRef.current
    if (!tube) return
    const t = edgeProgress(arrivedAt, edge.source, edge.target, performance.now())
    const total = tube.geometry.index?.count ?? 0
    if (t >= 1) {
      tube.geometry.setDrawRange(0, Infinity)
      tube.visible = true
      if (arrowRef.current) arrowRef.current.visible = true
      drawn.current = true
      return
    }
    // rings are 6 indices per radial segment, so keep the range on a boundary
    const ring = RADIAL_SEGMENTS * 6
    tube.geometry.setDrawRange(0, Math.floor((total * easeOut(t)) / ring) * ring)
    tube.visible = t > 0
    if (arrowRef.current) arrowRef.current.visible = false
    invalidate()
  })

  const isLit = isSelected || (litSet.has(edge.source) && litSet.has(edge.target) && hasActive)
  // changes on load and on the opening move of a selection, never per frame,
  // so the tubes are not rebuilt while the camera turns
  const growth = tubeGrowth(useGraphStore((s) => s.extent))

  const { geometry, arrowPos, arrowQuat } = useMemo(() => {
    if (!p0 || !p3 || !ctrl) return { geometry: null, arrowPos: null, arrowQuat: null }
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(...p0),
      new THREE.Vector3(...ctrl.c1),
      new THREE.Vector3(...ctrl.c2),
      new THREE.Vector3(...p3),
    )
    // thickens on hover so "this edge is clickable" needs no explaining
    const radius = (isSelected ? 0.16 : hovered ? 0.17 : isLit ? 0.12 : 0.045) * growth
    const geometry = new THREE.TubeGeometry(curve, 40, radius, RADIAL_SEGMENTS)
    // arrowhead just before the target node's surface
    const t = 0.93
    const arrowPos = curve.getPoint(t)
    const tangent = curve.getTangent(t)
    const arrowQuat = new THREE.Quaternion().setFromUnitVectors(UP, tangent)
    return { geometry, arrowPos, arrowQuat }
  }, [p0, p3, ctrl, isSelected, isLit, hovered, growth])
  // the tube is rebuilt on every hover and selection change, so release the old
  useDisposable(geometry)

  const edgeFilter = useGraphStore((s) => s.edgeFilter)
  const pathOn = useGraphStore((s) => s.pathNodes.length > 0)
  const onPath = useGraphStore((s) => s.pathEdges.has(edge.id))
  const impactOn = useGraphStore((s) => s.impactOf !== null)
  const impactHasSource = useGraphStore((s) => s.impactDepth.has(edge.source))
  const impactHasTarget = useGraphStore((s) => s.impactDepth.has(edge.target))

  if (!p0 || !p3 || !ctrl || !geometry) return null
  if (edgeFilter && edge.type !== edgeFilter) return null

  const dark = isDarkGround()
  const { color, opacity } = edgeInk(
    {
      diff: edge.diff,
      pathOn,
      onPath,
      impactOn,
      impacted: impactHasSource && impactHasTarget,
      violated: isViolated,
      hovered,
      lit: isLit,
      selected: isSelected,
      hasActive,
      typeColor: palette[EDGE_COLOR[edge.type]],
    },
    palette,
    dark,
  )

  return (
    <group>
      <mesh
        ref={tubeRef}
        geometry={geometry}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = "pointer"
        }}
        onPointerOut={() => {
          setHovered(false)
          document.body.style.cursor = ""
        }}
        onClick={(e) => {
          e.stopPropagation()
          selectEdge(edge.id)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          resetCtrl(edge.id)
        }}
      >
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>

      <mesh ref={arrowRef} position={arrowPos} quaternion={arrowQuat}>
        {/* the head shrinks with the line it belongs to, or it stops reading
            as a direction and starts reading as a speck */}
        <coneGeometry args={[0.32 * growth, 0.9 * growth, 10]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>

      {isSelected && (
        <>
          <GuideLine from={p0} to={ctrl.c1} color={palette.lav} />
          <GuideLine from={p3} to={ctrl.c2} color={palette.lav} />
          <DraggableHandle
            position={ctrl.c1}
            color={palette.lav}
            delay={0}
            onDrag={(p) => setCtrl(edge.id, p, ctrl.c2)}
          />
          <DraggableHandle
            position={ctrl.c2}
            color={palette.lav}
            delay={0.06}
            onDrag={(p) => setCtrl(edge.id, ctrl.c1, p)}
          />
        </>
      )}
    </group>
  )
}
