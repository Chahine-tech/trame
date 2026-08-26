import type * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import type { ComponentRef } from "react"
import { useGraphStore } from "../store/graph"

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>

/**
 * Semantic zoom, the Google Maps rule: far away you read districts, up close
 * you read streets. The two thresholds are deliberately apart: a single one
 * would flip the whole scene back and forth on the smallest camera drift.
 */
/**
 * As multiples of how far the arrangement reaches, not as distances.
 *
 * These were 115 and 85, which is right for a graph the size of trame's own and
 * hopelessly close for anything larger: on cal.com the camera opened at 80,
 * well inside a skeleton reaching 402, so a big repository dropped you into the
 * middle of the file level and never offered the map. The ratios below are the
 * ones those two numbers already had.
 */
const COLLAPSE_ABOVE = 1.95
const EXPAND_BELOW = 1.45

export function ZoomDirector({
  controls,
}: {
  controls: React.RefObject<OrbitControlsImpl | null>
}) {
  const camera = useThree((s) => s.camera)
  const setDistrictMode = useGraphStore((s) => s.setDistrictMode)

  useFrame(() => {
    const { districtMode: inDistricts, extent, focusTarget } = useGraphStore.getState()
    /**
     * A camera in flight is not a camera the reader has zoomed.
     *
     * Both sides of this comparison move, and they no longer move together. A
     * lens changes `extent` in one frame while the rig takes half a second to
     * fly the camera to match, so for that half second the ratio describes the
     * gap between the two rather than where anyone is standing. Turning the
     * impact lens off dropped `extent` from 427 back to 255 with the camera
     * still out at 577, which reads as 2.3x and trips the collapse.
     *
     * Entering the district level clears the selection, on purpose: it is the
     * file level you are leaving. So the cost of one frame of arithmetic on a
     * stale distance was the reader's selection, and spamming the key made it
     * certain.
     */
    if (focusTarget) return
    /**
     * How far from what you are looking at, not from the origin.
     *
     * `CameraRig` measures from the target and stops when the camera is
     * `extent * 1.35` away from it. This measured from the origin, and a
     * neighbourhood is a knot off to one side, so the two agreed only while the
     * subject happened to sit near the middle. Once the impact lens started
     * flying the camera to a far centroid, a settled camera could read 2.1x
     * here while the rig considered it parked at 1.35x, and the scene collapsed
     * to the district level on its own.
     */
    const target = (controls.current as unknown as { target?: THREE.Vector3 } | null)?.target
    const dist = target ? camera.position.distanceTo(target) : camera.position.length()
    // setState in useFrame is a pitfall only when it runs every frame; this
    // fires twice per round trip across the band
    if (!inDistricts && dist > COLLAPSE_ABOVE * extent) setDistrictMode(true)
    else if (inDistricts && dist < EXPAND_BELOW * extent) setDistrictMode(false)
  })

  return null
}
