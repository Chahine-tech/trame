import { isDarkGround, usePalette } from "../theme"

/**
 * The rig, in one place, because two surfaces render the same meshes.
 *
 * Dark is a lit space: a key light and a cool rim sculpt the facets. Light is a
 * printed plate, where strong lights would blow every colour toward white, so
 * the material colour carries and shading only hints at form. That is why the
 * light branch has no rim.
 *
 * Shared: which lamps exist, where they sit, what colour they are. Those were
 * copied byte for byte between viewer and landing, so re-aiming one left the
 * other behind.
 *
 * Not shared: the intensities. The landing runs brighter because a resting node
 * must read on near-black; the viewer is dimmer because contrast is spent on
 * the answer. The ratios are 1.73, 1.46 and 1.78, uneven enough that a single
 * "boost" factor would restyle one of the two.
 */
export function Lighting({
  hemisphere = 0.55,
  key = 1.3,
  rim = 0.45,
}: {
  hemisphere?: number
  key?: number
  rim?: number
}) {
  const palette = usePalette()

  if (!isDarkGround()) {
    return (
      <>
        <ambientLight intensity={2.1} />
        <directionalLight position={[30, 45, 40]} intensity={0.35} />
      </>
    )
  }

  return (
    <>
      <hemisphereLight args={[palette.text, palette.crust, hemisphere]} />
      <directionalLight position={[35, 45, 50]} intensity={key} />
      <directionalLight position={[-40, -15, -35]} intensity={rim} color={palette.lav} />
    </>
  )
}
