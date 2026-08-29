import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import { useGraphStore } from "../store/graph"
import { folderAnchors } from "./folders"

/**
 * Semantic zoom, like a map: folder names are the "district" layer.
 * Far away they read the structure; up close they fade out and node
 * labels (the "street" layer) take over.
 */
function FolderLabel({
  centroid,
  lift,
  color,
  label,
}: {
  centroid: THREE.Vector3
  lift: number
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
    // only touch the DOM when the value actually moved, or this becomes a
    // style write per label per frame, forever
    if (Math.abs(opacity - lastOpacity.current) < 0.01) return
    lastOpacity.current = opacity
    el.style.opacity = String(opacity)
  })

  return (
    <Html position={[0, lift, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
      <div ref={ref} className="cluster-label" style={{ color }}>
        <span className="dot" style={{ background: color }} />
        {label}/
      </div>
    </Html>
  )
}

/**
 * Folder labels only, no filled bubbles. Grouping is carried by the
 * layout's cluster force (proximity), the label just names the district.
 * Toggle with G.
 */
export function Clusters() {
  const data = useGraphStore((s) => s.data)
  const positions = useGraphStore((s) => s.positions)
  const nearby = useGraphStore((s) => s.nearby)
  const show = useGraphStore((s) => s.showClusters)
  /**
   * A lens repaints everything, and that has to include the folders.
   *
   * These were the only saturated marks left on screen under the hotspot lens —
   * a green pip and a blue one among a hundred and fifty red squares — and a
   * saturated mark inside a lens reads as part of its answer. The name is still
   * worth having, so the label stays and only its colour stands down.
   */
  const lensOn = useGraphStore((s) => s.lens !== "none")

  /**
   * A folder is named from the files actually on screen, and stays silent when
   * there is no centre worth naming. The arithmetic lives in `folderAnchors`,
   * where it can be tested without a canvas.
   */
  const anchors = useMemo(
    () => (data ? folderAnchors(data.clusters, positions, nearby) : []),
    [data, positions, nearby],
  )

  if (!show || !data) return null

  return (
    <>
      {anchors.map((anchor) => {
        const centroid = new THREE.Vector3(...anchor.at)
        return (
          <group key={anchor.id} position={centroid}>
            <FolderLabel
              centroid={centroid}
              lift={anchor.lift}
              color={lensOn ? "var(--overlay)" : anchor.color}
              label={anchor.label}
            />
          </group>
        )
      })}
    </>
  )
}
