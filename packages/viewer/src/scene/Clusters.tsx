import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import { useGraphStore } from "../store/graph"

/**
 * Semantic zoom, like a map: folder names are the "district" layer.
 * Far away they read the structure; up close they fade out and node
 * labels (the "street" layer) take over.
 */
function FolderLabel({
  centroid,
  radius,
  color,
  label,
}: {
  centroid: THREE.Vector3
  radius: number
  color: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useFrame(({ camera }) => {
    const dist = camera.position.distanceTo(centroid)
    // hidden below 35, fully visible above 60
    const opacity = THREE.MathUtils.clamp((dist - 35) / 25, 0, 1) * 0.9
    if (ref.current) ref.current.style.opacity = String(opacity)
  })

  return (
    <Html position={[0, radius * 0.85, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
      <div ref={ref} className="cluster-label" style={{ color }}>
        <span className="dot" style={{ background: color }} />
        {label}/
      </div>
    </Html>
  )
}

/**
 * Folder labels only — no filled bubbles. Grouping is carried by the
 * layout's cluster force (proximity), the label just names the district.
 * Toggle with G.
 */
export function Clusters() {
  const data = useGraphStore((s) => s.data)
  const positions = useGraphStore((s) => s.positions)
  const show = useGraphStore((s) => s.showClusters)

  const bubbles = useMemo(() => {
    if (!data) return []
    return data.clusters
      .filter((c) => c.nodeIds.length >= 2)
      .map((cluster) => {
        const pts = cluster.nodeIds
          .map((id) => positions.get(id))
          .filter((p): p is [number, number, number] => Boolean(p))
        if (pts.length < 2) return null
        const centroid = new THREE.Vector3()
        for (const p of pts) centroid.add(new THREE.Vector3(...p))
        centroid.divideScalar(pts.length)
        let radius = 0
        for (const p of pts) radius = Math.max(radius, centroid.distanceTo(new THREE.Vector3(...p)))
        return { cluster, centroid, radius: radius + 3.5 }
      })
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
  }, [data, positions])

  if (!show || !data) return null

  return (
    <>
      {bubbles.map(({ cluster, centroid, radius }) => (
        <group key={cluster.id} position={centroid}>
          <FolderLabel centroid={centroid} radius={radius} color={cluster.color} label={cluster.label} />
        </group>
      ))}
    </>
  )
}
