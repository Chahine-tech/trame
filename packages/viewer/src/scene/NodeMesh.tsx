import { useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Billboard, Html } from "@react-three/drei"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { useGraphStore } from "../store/graph"
import { NODE_COLOR, usePalette } from "../theme"
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

/** Additive glow sings on Mocha; on Latte it washes out, so blend normally. */
function isDarkGround(hex: string): boolean {
  const h = hex.replace("#", "")
  if (h.length < 6) return true
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
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
  const [localHover, setLocalHover] = useState(false)
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

  const typeColor = palette[NODE_COLOR[node.type]]

  // Size = importance: hubs read bigger at a glance
  const baseScale = Math.min(0.65 + Math.sqrt(degree) * 0.22, 1.7)

  // Colour = information: grey at rest, type colour only when attention lands.
  // Rule violations override everything — they must be visible at rest.
  const { color, emissiveIntensity, opacity } = useMemo(() => {
    if (isViolated) {
      return { color: palette.red, emissiveIntensity: isLit ? 0.7 : 0.35, opacity: hasActive && !isLit ? 0.4 : 1 }
    }
    if (isLit) return { color: typeColor, emissiveIntensity: isHovered || isSelected ? 0.7 : 0.4, opacity: 1 }
    if (hasActive) return { color: palette.overlay, emissiveIntensity: 0, opacity: 0.16 }
    return { color: palette.overlay, emissiveIntensity: 0.12, opacity: 0.92 }
  }, [isViolated, isLit, hasActive, isHovered, isSelected, typeColor, palette])

  // Hover growth eased per-frame (interruptible), never snapped
  const targetScale = baseScale * (isHovered || isSelected ? 1.22 : 1)
  useFrame((_, dt) => {
    const m = meshRef.current
    if (!m) return
    const s = THREE.MathUtils.damp(m.scale.x, targetScale, 12, dt)
    m.scale.setScalar(s)
  })

  if (!position) return null

  const showLabel = showLabels && isLit && (isHovered || isSelected || hasActive)

  return (
    <mesh
      ref={meshRef}
      position={position}
      geometry={geometryFor(node.type)}
      scale={baseScale}
      onPointerOver={(e) => {
        e.stopPropagation()
        setLocalHover(true)
        setHover(node.id)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        if (localHover) {
          setLocalHover(false)
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
          select(node.id) // it was a click, not a drag
        } else if (d?.moved) {
          setControlsEnabled(true)
          document.body.style.cursor = localHover ? "pointer" : ""
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
      />
      {/* soft luminous halo behind lit nodes — the moodboard glow */}
      {(isLit || isViolated) && (
        <sprite scale={[5.2, 5.2, 1]} raycast={() => null}>
          <spriteMaterial
            map={getGlowTexture()}
            color={isViolated ? palette.red : typeColor}
            transparent
            opacity={isDarkGround(palette.base) ? (isHovered || isSelected ? 0.55 : 0.32) : 0.22}
            blending={isDarkGround(palette.base) ? THREE.AdditiveBlending : THREE.NormalBlending}
            depthWrite={false}
          />
        </sprite>
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
