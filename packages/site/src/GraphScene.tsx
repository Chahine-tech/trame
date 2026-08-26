import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { useGraphStore } from "@trame/viewer/store/graph"
import { isDarkGround, usePalette } from "@trame/viewer/theme"
import { HERO_CAMERA, REFERENCE_ASPECT, type CameraPose } from "./camera"
import { Lighting } from "@trame/viewer/scene/Lighting"
import { NodeMesh } from "@trame/viewer/scene/NodeMesh"
import { EdgeMesh } from "@trame/viewer/scene/EdgeMesh"

/** The viewer's own meshes, without its chrome. */
export function GraphScene({ pose }: { pose: CameraPose }) {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const controlsEnabled = useGraphStore((s) => s.controlsEnabled)
  const dark = isDarkGround()

  if (!data) return null

  return (
    <>
      <color attach="background" args={[palette.base]} />
      {/* gentler than the viewer's, which pulls the far side into the void */}
      <fog attach="fog" args={[palette.base, dark ? 95 : 150, dark ? 260 : 360]} />

      {/* brighter than the viewer's: nothing lights a node here until hover */}
      <Lighting hemisphere={0.95} key={1.9} rim={0.8} />

      {data.edges.map((e) => (
        <EdgeMesh key={e.id} edge={e} />
      ))}
      {data.nodes.map((n) => (
        <NodeMesh key={n.id} node={n} />
      ))}

      <OrbitControls
        makeDefault
        enabled={controlsEnabled}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        /**
         * OrbitControls' wheel listener calls preventDefault. With the canvas
         * pinned across the viewport that swallowed every scroll, and the page
         * only moved when the pointer sat in the copy column. Drag still
         * takes the camera.
         */
        enableZoom={false}
        minDistance={30}
        maxDistance={140}
      />
      <SlowDrift pose={pose} />
      <StartArrival />
    </>
  )
}

/**
 * Starts the entrance on the first painted frame. Started from the data effect
 * instead, shader compilation eats the opening of the cascade.
 */
function StartArrival() {
  const started = useRef(false)
  useFrame(({ invalidate }) => {
    if (started.current) return
    started.current = true
    useGraphStore.getState().playArrival()
    invalidate()
  })
  return null
}

/** A slow orbit whose radius and height follow the section on screen. */
const REDUCE_MOTION =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

function SlowDrift({ pose }: { pose: CameraPose }) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  // reduced motion gets a still camera, not a slower one. Starting in the
  // "taken" state reuses the path a visitor who grabbed the camera takes.
  const taken = useRef(REDUCE_MOTION)
  const angle = useRef(0)
  const radius = useRef(HERO_CAMERA.distance)
  const height = useRef(HERO_CAMERA.position[1])

  /**
   * The canvas owns only part of the page, so a narrow window turns it
   * portrait and the horizontal field collapses: nodes fell outside the frame,
   * clipped mid-label. Scaling by the aspect shows the same span at any width.
   */
  const target = Math.min(
    Math.max(pose.distance * (REFERENCE_ASPECT / (size.width / size.height)), pose.distance),
    130,
  )

  useFrame((_, dt) => {
    if (taken.current) return
    angle.current += dt * 0.08

    // exponential approach, so a 120 Hz display and a slow laptop take the
    // same wall-clock time to arrive
    const k = 1 - Math.exp(-dt / 0.55)
    radius.current += (target - radius.current) * k
    height.current += (pose.height - height.current) * k

    const r = radius.current
    camera.position.set(
      Math.sin(angle.current) * r,
      height.current + Math.sin(angle.current * 0.6) * 8 * (r / HERO_CAMERA.distance),
      Math.cos(angle.current) * r,
    )
    camera.lookAt(0, 0, 0)
    invalidate()
  })

  useFrame(() => {
    // dragging a Bezier handle disables the controls; that counts as taking it
    if (!useGraphStore.getState().controlsEnabled) taken.current = true
  })

  // taking the camera is permanent: sections keep changing the lens, but the
  // viewpoint stays where the visitor put it
  const stop = () => {
    taken.current = true
  }
  return <mesh onPointerDown={stop} visible={false} scale={0} />
}
