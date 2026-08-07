import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Billboard, Html } from "@react-three/drei"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { useGraphStore } from "../store/graph"
import { isDarkGround, mix, NODE_COLOR, usePalette, type Palette } from "../theme"
import type { GraphNode } from "../types"

/**
 * One geometry instance per type, shared by every node of that type.
 * Crystals (octa/tetra/dodeca/icosa) read best faceted → flat shading;
 * the component box gets rounded corners so it doesn't look like a raw
 * Three.js primitive.
 */
const GEOMETRY: Record<GraphNode["type"], () => THREE.BufferGeometry> = {
  page: () => new THREE.OctahedronGeometry(1.1),
  component: () => new RoundedBoxGeometry(1.5, 1.5, 1.5, 3, 0.22),
  hook: () => new THREE.SphereGeometry(0.95, 24, 16),
  api: () => new THREE.CylinderGeometry(0.7, 0.7, 1.6, 24),
  "query-key": () => new THREE.TetrahedronGeometry(1.2),
  context: () => new THREE.TorusGeometry(0.8, 0.3, 14, 28),
  store: () => new THREE.DodecahedronGeometry(1),
  module: () => new THREE.IcosahedronGeometry(0.65),
}

const FACETED: Set<GraphNode["type"]> = new Set(["page", "query-key", "store", "module"])

/** Delay per hop when impact propagates outward. Slow enough to read. */
const IMPACT_RING_MS = 90

interface Surface {
  color: string
  emissiveIntensity: number
  opacity: number
}

/**
 * Two grounds, two languages.
 *
 * On dark, attention adds light and what is unlit fades toward the void.
 * On paper it inverts: what matters is denser ink, and what recedes is washed
 * toward the page — still opaque, just pale. Fading by opacity on a light
 * ground pushes a node *into* the background instead of behind it, which is
 * how the lit/unlit hierarchy used to collapse.
 */
function recede(dark: boolean, p: Palette, amount: number): Surface {
  return dark
    ? { color: p.overlay, emissiveIntensity: 0, opacity: 1 - amount * 0.84 }
    : { color: mix(p.overlay, p.base, amount * 0.86), emissiveIntensity: 0, opacity: 1 }
}

function press(dark: boolean, p: Palette, ink: string, strength: number): Surface {
  return dark
    ? { color: ink, emissiveIntensity: strength, opacity: 1 }
    : { color: mix(ink, p.text, 0.12), emissiveIntensity: 0, opacity: 1 }
}

/** Shared soft radial halo — the moodboard glow, tinted per node via material color. */
let glowTexture: THREE.CanvasTexture | null = null
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, "rgba(255,255,255,0.85)")
  g.addColorStop(0.35, "rgba(255,255,255,0.28)")
  g.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}


const geometryCache = new Map<GraphNode["type"], THREE.BufferGeometry>()
function geometryFor(type: GraphNode["type"]): THREE.BufferGeometry {
  let g = geometryCache.get(type)
  if (!g) {
    g = GEOMETRY[type]()
    geometryCache.set(type, g)
  }
  return g
}

export function NodeMesh({ node }: { node: GraphNode }) {
  const palette = usePalette()
  const position = useGraphStore((s) => s.positions.get(node.id))
  const degree = useGraphStore((s) => s.adjacency.get(node.id)?.size ?? 0)
  const isLit = useGraphStore((s) => s.litSet.has(node.id))
  const hasActive = useGraphStore((s) => s.litSet.size > 0)
  const isHovered = useGraphStore((s) => s.hoverId === node.id)
  const isSelected = useGraphStore((s) => s.selectedId === node.id)
  const showLabels = useGraphStore((s) => s.showLabels)
  const setHover = useGraphStore((s) => s.setHover)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const moveNode = useGraphStore((s) => s.moveNode)
  const setControlsEnabled = useGraphStore((s) => s.setControlsEnabled)
  // only ever read inside handlers, so it must not cost a render: the visible
  // hover state already lives in the store
  const localHover = useRef(false)
  const meshRef = useRef<THREE.Mesh>(null)
  // drag with ~6px hysteresis: below it's a click (select), above it moves the node
  const drag = useRef<{
    moved: boolean
    startX: number
    startY: number
    plane: THREE.Plane
    hit: THREE.Vector3
  } | null>(null)

  const isViolated = useGraphStore((s) => s.violatedNodes.has(node.id))
  const isOrphan = useGraphStore((s) => s.orphans.has(node.id))
  const impactOn = useGraphStore((s) => s.impactOf !== null)
  const impactDepth = useGraphStore((s) => s.impactDepth.get(node.id))
  const impactStartedAt = useGraphStore((s) => s.impactStartedAt)
  const pathOn = useGraphStore((s) => s.pathNodes.length > 0)
  const onPath = useGraphStore((s) => s.pathNodes.includes(node.id))
  const tracePathTo = useGraphStore((s) => s.tracePathTo)

  const typeColor = palette[NODE_COLOR[node.type]]
  const dark = isDarkGround()

  // Size = importance: hubs read bigger at a glance
  const baseScale = Math.min(0.65 + Math.sqrt(degree) * 0.22, 1.7)


  // Colour = information: grey at rest, type colour only when attention lands.
  // Analysis overlays (path, impact, violations) take precedence — they are
  // the question the user just asked.
  const { color, emissiveIntensity, opacity } = useMemo(() => {
    // diff mode reframes the whole graph: what this branch added or removed
    if (node.diff === "added") return press(dark, palette, palette.green, 0.6)
    if (node.diff === "removed") {
      return dark
        ? { color: palette.red, emissiveIntensity: 0.25, opacity: 0.35 }
        : { color: mix(palette.red, palette.base, 0.55), emissiveIntensity: 0, opacity: 1 }
    }
    if (pathOn) return onPath ? press(dark, palette, palette.lav, 0.7) : recede(dark, palette, 1)
    if (impactOn) {
      if (impactDepth === undefined) return recede(dark, palette, 1)
      // fade with distance from the change — near dependents shout, far ones whisper
      const t = Math.min(impactDepth / 4, 1)
      const ink = impactDepth === 0 ? palette.peach : palette.yellow
      return dark
        ? { color: ink, emissiveIntensity: 0.75 - t * 0.5, opacity: 1 - t * 0.45 }
        : { color: mix(mix(ink, palette.text, 0.12), palette.base, t * 0.5), emissiveIntensity: 0, opacity: 1 }
    }
    if (isViolated) {
      if (!dark) return press(dark, palette, palette.red, 0)
      return { color: palette.red, emissiveIntensity: isLit ? 0.7 : 0.35, opacity: hasActive && !isLit ? 0.4 : 1 }
    }
    if (isLit) return press(dark, palette, typeColor, isHovered || isSelected ? 0.7 : 0.4)
    if (hasActive) return recede(dark, palette, 1)
    // at rest: neutral ink, present but quiet
    return dark
      ? { color: palette.overlay, emissiveIntensity: 0.12, opacity: 0.92 }
      : { color: mix(palette.overlay, palette.base, 0.42), emissiveIntensity: 0, opacity: 1 }
  }, [node.diff, pathOn, onPath, impactOn, impactDepth, isViolated, isLit, hasActive, isHovered, isSelected, typeColor, palette, dark])

  // Hover growth eased per-frame (interruptible), never snapped
  const targetScale = baseScale * (isHovered || isSelected ? 1.22 : 1)
  // Impact reveals ring by ring so the eye reads propagation, not a flat
  // highlight: each hop waits its turn, like a wave leaving the change.
  const waveRef = useRef<THREE.Mesh>(null)
  useFrame(({ invalidate }) => {
    const m = meshRef.current
    if (!m || !impactOn || impactDepth === undefined) return
    const age = performance.now() - impactStartedAt
    const due = impactDepth * IMPACT_RING_MS
    const t = THREE.MathUtils.clamp((age - due) / 260, 0, 1)
    m.visible = t > 0
    if (waveRef.current) {
      // a brief halo that swells and dies as the wave passes this ring
      const pulse = Math.sin(Math.PI * t)
      waveRef.current.scale.setScalar(1 + pulse * 1.6)
      const mat = waveRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = pulse * 0.35
    }
    if (t < 1) invalidate()
  })

  useFrame(({ invalidate }, dt) => {
    const m = meshRef.current
    if (!m) return
    const current = m.scale.x
    // damp approaches asymptotically and never lands: settle explicitly, then
    // do nothing. One subscriber per node runs every frame, and the scale is
    // already at rest almost all of the time.
    if (Math.abs(current - targetScale) < 0.001) {
      if (current !== targetScale) m.scale.setScalar(targetScale)
      return
    }
    m.scale.setScalar(THREE.MathUtils.damp(current, targetScale, 12, dt))
    invalidate() // under frameloop="demand", ask for the frame that continues this
  })

  if (!position) return null

  const showLabel =
    showLabels && (onPath || (isLit && (isHovered || isSelected || hasActive)))

  return (
    <mesh
      ref={meshRef}
      position={position}
      geometry={geometryFor(node.type)}
      scale={baseScale}
      onPointerOver={(e) => {
        e.stopPropagation()
        localHover.current = true
        setHover(node.id)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        if (localHover.current) {
          localHover.current = false
          setHover(null)
          document.body.style.cursor = ""
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        const camDir = e.camera.getWorldDirection(new THREE.Vector3())
        drag.current = {
          moved: false,
          startX: e.clientX,
          startY: e.clientY,
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
            camDir,
            new THREE.Vector3(...position),
          ),
          hit: new THREE.Vector3(),
        }
        ;(e.target as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return
          d.moved = true
          setControlsEnabled(false) // commit to the drag — freeze the camera
          document.body.style.cursor = "grabbing"
        }
        e.stopPropagation()
        if (e.ray.intersectPlane(d.plane, d.hit)) {
          moveNode(node.id, [d.hit.x, d.hit.y, d.hit.z])
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        ;(e.target as Element).releasePointerCapture(e.pointerId)
        if (d && !d.moved) {
          e.stopPropagation()
          // shift-click traces the dependency path from the current selection
          if (e.shiftKey) tracePathTo(node.id)
          else select(node.id) // it was a click, not a drag
        } else if (d?.moved) {
          setControlsEnabled(true)
          document.body.style.cursor = localHover.current ? "pointer" : ""
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        select(node.id)
        focus(node.id)
      }}
    >
      <meshStandardMaterial
        color={color}
        emissive={isViolated ? palette.red : isLit ? typeColor : palette.overlay}
        emissiveIntensity={emissiveIntensity}
        transparent
        opacity={opacity}
        roughness={0.5}
        metalness={0.12}
        flatShading={FACETED.has(node.type)}
        // hollow: dead code, or a node this branch removed (a ghost)
        wireframe={(isOrphan && !isLit) || node.diff === "removed"}
      />
      {/* On dark this is a glow: light added to the void. On paper the same
          shape becomes a shadow — importance reads as elevation, not emission. */}
      {(isLit || isViolated || onPath || (impactOn && impactDepth !== undefined)) &&
        (() => {
          const accent = onPath
            ? palette.lav
            : impactOn
              ? palette.yellow
              : isViolated
                ? palette.red
                : typeColor
          const strong = isHovered || isSelected
          return (
            <sprite scale={dark ? [5.2, 5.2, 1] : [4.4, 4.4, 1]} raycast={() => null}>
              <spriteMaterial
                map={getGlowTexture()}
                color={dark ? accent : mix(accent, palette.text, 0.55)}
                transparent
                opacity={dark ? (strong ? 0.55 : 0.32) : strong ? 0.3 : 0.16}
                blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
                depthWrite={false}
              />
            </sprite>
          )
        })()}

      {/* the crisp edge that replaces the glow as a "this one" marker on paper:
          an inverted hull, the classic way to outline a solid */}
      {!dark && (isLit || onPath || isViolated) && (
        <mesh geometry={geometryFor(node.type)} scale={1.14} raycast={() => null}>
          <meshBasicMaterial color={mix(color, palette.text, 0.55)} side={THREE.BackSide} />
        </mesh>
      )}

      {/* the wave front, alive only while the impact ripple passes this ring */}
      {impactOn && impactDepth !== undefined && (
        <mesh ref={waveRef} raycast={() => null}>
          <sphereGeometry args={[1.6, 16, 12]} />
          <meshBasicMaterial
            color={palette.yellow}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* static selection ring — state indication without motion on data */}
      {isSelected && (
        <Billboard>
          <mesh raycast={() => null}>
            <ringGeometry args={[1.75, 1.9, 48]} />
            <meshBasicMaterial
              color={isViolated ? palette.red : typeColor}
              transparent
              opacity={0.65}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      )}

      {showLabel && (
        <Html zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div className={`node-label${isHovered || isSelected ? "" : " dim"}`}>{node.label}</div>
        </Html>
      )}
    </mesh>
  )
}
