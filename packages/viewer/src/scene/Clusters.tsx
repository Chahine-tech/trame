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

  const lastOpacity = useRef(-1)

  useFrame(({ camera }) => {
    const el = ref.current
    if (!el) return
    const dist = camera.position.distanceTo(centroid)
    // hidden below 35, fully visible above 60
    const opacity = THREE.MathUtils.clamp((dist - 35) / 25, 0, 1) * 0.9
    // only touch the DOM when the value actually moved — otherwise this is a
    // style write per label per frame, forever
    if (Math.abs(opacity - lastOpacity.current) < 0.01) return
    lastOpacity.current = opacity
    el.style.opacity = String(opacity)
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
  const nearby = useGraphStore((s) => s.nearby)
  const show = useGraphStore((s) => s.showClusters)

  /**
   * A folder is named from the files actually on screen, and stays silent when
   * none of them are.
   *
   * These centres used to come from every file the folder holds, drawn or not.
   * Once the detail view began showing a subset that stopped describing
   * anything: on cal.com some twenty labels — `matomo/`, `webex/`, `campfire/`,
   * all small integrations the skeleton peels away first — hung in an empty
   * corner naming files that were nowhere on screen, while the folders that
   * were drawn had their names buried in the crowd. Two populations at once,
   * nodes showing one and labels describing the other.
   */
  const bubbles = useMemo(() => {
    if (!data) return []
    return data.clusters
      .map((cluster) => {
        const drawn = nearby ? cluster.nodeIds.filter((id) => nearby.has(id)) : cluster.nodeIds
        const pts = drawn
          .map((id) => positions.get(id))
          .filter((p): p is [number, number, number] => Boolean(p))
        if (pts.length === 0) return null
        const centroid = new THREE.Vector3()
        for (const p of pts) centroid.add(new THREE.Vector3(...p))
        centroid.divideScalar(pts.length)
        let radius = 0
        for (const p of pts) radius = Math.max(radius, centroid.distanceTo(new THREE.Vector3(...p)))
        return { cluster, centroid, radius: radius + 3.5 }
      })
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
  }, [data, positions, nearby])

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
