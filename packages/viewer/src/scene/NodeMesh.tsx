import { useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
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
  const setHover = useGraphStore((s) => s.setHover)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const [localHover, setLocalHover] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)

  const typeColor = palette[NODE_COLOR[node.type]]

  // Size = importance: hubs read bigger at a glance
  const baseScale = Math.min(0.65 + Math.sqrt(degree) * 0.22, 1.7)

  // Colour = information: grey at rest, type colour only when attention lands
  const { color, emissiveIntensity, opacity } = useMemo(() => {
    if (isLit) return { color: typeColor, emissiveIntensity: isHovered || isSelected ? 0.7 : 0.4, opacity: 1 }
    if (hasActive) return { color: palette.overlay, emissiveIntensity: 0, opacity: 0.16 }
    return { color: palette.overlay, emissiveIntensity: 0.12, opacity: 0.92 }
  }, [isLit, hasActive, isHovered, isSelected, typeColor, palette])

  // Hover growth eased per-frame (interruptible), never snapped
  const targetScale = baseScale * (isHovered || isSelected ? 1.22 : 1)
  useFrame((_, dt) => {
    const m = meshRef.current
    if (!m) return
    const s = THREE.MathUtils.damp(m.scale.x, targetScale, 12, dt)
    m.scale.setScalar(s)
  })

  if (!position) return null

  const showLabel = isLit && (isHovered || isSelected || hasActive)

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
      onClick={(e) => {
        e.stopPropagation()
        select(node.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        select(node.id)
        focus(node.id)
      }}
    >
      <meshStandardMaterial
        color={color}
        emissive={isLit ? typeColor : palette.overlay}
        emissiveIntensity={emissiveIntensity}
        transparent
        opacity={opacity}
        roughness={0.5}
        metalness={0.12}
        flatShading={FACETED.has(node.type)}
      />
      {showLabel && (
        <Html zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div className={`node-label${isHovered || isSelected ? "" : " dim"}`}>{node.label}</div>
        </Html>
      )}
    </mesh>
  )
}
