import { useFrame, useThree } from "@react-three/fiber"
import { useGraphStore } from "../store/graph"

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

export function ZoomDirector() {
  const camera = useThree((s) => s.camera)
  const setDistrictMode = useGraphStore((s) => s.setDistrictMode)

  useFrame(() => {
    const dist = camera.position.length()
    const { districtMode: inDistricts, extent } = useGraphStore.getState()
    // setState in useFrame is a pitfall only when it runs every frame; this
    // fires twice per round trip across the band
    if (!inDistricts && dist > COLLAPSE_ABOVE * extent) setDistrictMode(true)
    else if (inDistricts && dist < EXPAND_BELOW * extent) setDistrictMode(false)
  })

  return null
}
