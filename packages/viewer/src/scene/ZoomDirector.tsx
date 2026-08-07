import { useFrame, useThree } from "@react-three/fiber"
import { useGraphStore } from "../store/graph"

/**
 * Semantic zoom, the Google Maps rule: far away you read districts, up close
 * you read streets. The two thresholds are deliberately apart — a single one
 * would flip the whole scene back and forth on the smallest camera drift.
 */
const COLLAPSE_ABOVE = 115
const EXPAND_BELOW = 85

export function ZoomDirector() {
  const camera = useThree((s) => s.camera)
  const setDistrictMode = useGraphStore((s) => s.setDistrictMode)

  useFrame(() => {
    const dist = camera.position.length()
    const inDistricts = useGraphStore.getState().districtMode
    // setState in useFrame is a pitfall only when it runs every frame; this
    // fires twice per round trip across the band
    if (!inDistricts && dist > COLLAPSE_ABOVE) setDistrictMode(true)
    else if (inDistricts && dist < EXPAND_BELOW) setDistrictMode(false)
  })

  return null
}
