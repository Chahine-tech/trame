import { useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import { useGraphStore } from "../store/graph"
import { EDGE_COLOR, isDarkGround, mix, usePalette } from "../theme"
import type { GraphEdge, Vec3 } from "../types"
import { useDisposable } from "./useDisposable"

const UP = new THREE.Vector3(0, 1, 0)

/** Scratch hit point — written by intersectPlane and read in the same event. */
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
  /** seconds to wait before appearing — the two handles land one after the other */
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

/** Thin tube from a to b — guide line that works on every renderer. */
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

  const isLit = isSelected || (litSet.has(edge.source) && litSet.has(edge.target) && hasActive)

  const { geometry, arrowPos, arrowQuat } = useMemo(() => {
    if (!p0 || !p3 || !ctrl) return { geometry: null, arrowPos: null, arrowQuat: null }
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(...p0),
      new THREE.Vector3(...ctrl.c1),
      new THREE.Vector3(...ctrl.c2),
      new THREE.Vector3(...p3),
    )
    // thickens on hover so "this edge is clickable" needs no explaining
    const radius = isSelected ? 0.16 : hovered ? 0.17 : isLit ? 0.12 : 0.045
    const geometry = new THREE.TubeGeometry(curve, 40, radius, 6)
    // arrowhead just before the target node's surface
    const t = 0.93
    const arrowPos = curve.getPoint(t)
    const tangent = curve.getTangent(t)
    const arrowQuat = new THREE.Quaternion().setFromUnitVectors(UP, tangent)
    return { geometry, arrowPos, arrowQuat }
  }, [p0, p3, ctrl, isSelected, isLit, hovered])
  // the tube is rebuilt on every hover and selection change — release the old one
  useDisposable(geometry)

  const edgeFilter = useGraphStore((s) => s.edgeFilter)
  const pathOn = useGraphStore((s) => s.pathNodes.length > 0)
  const onPath = useGraphStore((s) => s.pathEdges.has(edge.id))
  const impactOn = useGraphStore((s) => s.impactOf !== null)
  const impactHasSource = useGraphStore((s) => s.impactDepth.has(edge.source))
  const impactHasTarget = useGraphStore((s) => s.impactDepth.has(edge.target))

  if (!p0 || !p3 || !ctrl || !geometry) return null
  if (edgeFilter && edge.type !== edgeFilter) return null

  const typeColor = palette[EDGE_COLOR[edge.type]]
  const dark = isDarkGround()

  // analysis overlays win over the resting language
  let color: string
  let opacity: number
  if (edge.diff === "added") {
    color = palette.green
    opacity = 0.85
  } else if (edge.diff === "removed") {
    color = palette.red
    opacity = 0.3
  } else if (pathOn) {
    color = onPath ? palette.lav : palette.surface1
    opacity = onPath ? 0.95 : 0.03
  } else if (impactOn) {
    const both = impactHasSource && impactHasTarget
    color = both ? palette.yellow : palette.surface1
    opacity = both ? 0.6 : 0.03
  } else if (isViolated) {
    color = palette.red
    opacity = isSelected || isLit ? 0.95 : 0.55
  } else if (hovered) {
    color = dark ? typeColor : mix(typeColor, palette.text, 0.3)
    opacity = 0.9
  } else if (dark) {
    color = isLit ? typeColor : palette.surface1
    opacity = isSelected ? 0.95 : isLit ? 0.75 : hasActive ? 0.05 : 0.22
  } else {
    // on paper a live edge is darker ink, not brighter light. Dimmed lines keep
    // a floor: the structure has to stay readable while part of it is lit.
    color = isLit || isSelected ? mix(typeColor, palette.text, 0.3) : palette.overlay
    opacity = isLit || isSelected ? 0.95 : hasActive ? 0.3 : 0.6
  }

  return (
    <group>
      <mesh
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

      <mesh position={arrowPos} quaternion={arrowQuat}>
        <coneGeometry args={[0.32, 0.9, 10]} />
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
