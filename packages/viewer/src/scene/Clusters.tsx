import { useMemo } from "react"
import * as THREE from "three"
import { Html } from "@react-three/drei"
import { useGraphStore } from "../store/graph"

/** Soft translucent bubble + label per feature cluster. Toggle with G. */
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
          {/* raycast disabled — bubbles must never steal hover/click from nodes */}
          <mesh raycast={() => null}>
            <sphereGeometry args={[radius, 24, 16]} />
            <meshBasicMaterial color={cluster.color} transparent opacity={0.05} depthWrite={false} />
          </mesh>
          <Html position={[0, radius * 0.85, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
            <div className="cluster-label" style={{ color: cluster.color }}>
              {cluster.label}
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}
