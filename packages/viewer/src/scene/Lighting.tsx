import { isDarkGround, usePalette } from "../theme"

/**
 * The rig, in one place, because two surfaces render the same meshes.
 *
 * Dark is a lit space — a key light and a cool rim sculpt the facets. Light is
 * a printed plate: strong lights would blow every colour toward white, so the
 * material colour carries and shading only hints at form. Two physical models,
 * not one with a flipped switch, which is why the light branch has no rim.
 *
 * What is shared is the structure: which lamps exist, where they sit, what
 * colour they are. Those were copied byte for byte between the tool and the
 * landing, so re-aiming one silently left the other behind.
 *
 * The intensities are *not* shared. The landing runs brighter because a
 * resting node must read on near-black before anything lights it up; the tool
 * is dimmer because you are already working inside it and contrast is spent on
 * the answer. Those ratios are 1.73, 1.46 and 1.78 — deliberately uneven, so a
 * single "boost" factor would quietly restyle one of the two. They are
 * parameters with the tool's values as defaults.
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
