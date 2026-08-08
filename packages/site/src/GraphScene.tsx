import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { useGraphStore } from "@trame/viewer/store/graph"
import { isDarkGround, usePalette } from "@trame/viewer/theme"
import { HERO_CAMERA, REFERENCE_ASPECT, type CameraPose } from "./camera"
import { Lighting } from "@trame/viewer/scene/Lighting"
import { NodeMesh } from "@trame/viewer/scene/NodeMesh"
import { EdgeMesh } from "@trame/viewer/scene/EdgeMesh"

/**
 * The product's own meshes, without the tool's chrome.
 *
 * No inspector, no palette, no top bar — the page is the graph and nothing
 * else. Everything you see here is the code that ships in the viewer, so a
 * visitor who clicks through finds exactly what they were just watching.
 */
export function GraphScene({ pose }: { pose: CameraPose }) {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const controlsEnabled = useGraphStore((s) => s.controlsEnabled)
  const dark = isDarkGround()

  if (!data) return null

  return (
    <>
      <color attach="background" args={[palette.base]} />
      {/* The tool's fog pulls the far side into the void, which is right when
          you are already working in it. A landing has a second and a half to
          be inviting, so the depth here is gentler: the graph stays present
          before anything has been asked of it. */}
      <fog attach="fog" args={[palette.base, dark ? 95 : 150, dark ? 260 : 360]} />

      {/* brighter than the tool's: on a landing a resting node has to read on
          near-black before anything lights it up. Same values as before, now
          stated as arguments instead of a second copy of the rig. */}
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
         * The wheel belongs to the page, not to the camera.
         *
         * enableZoom defaults to true, and three's OrbitControls then attaches
         * a wheel listener that calls preventDefault — so with the canvas
         * pinned across most of the viewport, scrolling anywhere over the
         * graph zoomed the camera and never reached the document. The page
         * simply would not scroll unless the pointer sat in the copy column.
         *
         * Dragging still takes the camera, which is the gesture that was
         * always meant to mean "I want to look around".
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
 * Starts the entrance on the first frame the GPU actually paints.
 *
 * Starting it from the effect that loads the data would burn the opening of
 * the cascade on shader compilation: the visitor would arrive mid-build, which
 * is the one part of it that looks broken rather than deliberate.
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

/**
 * A continuous slow orbit whose radius and height follow the section on screen.
 *
 * Unlike the tool, where the spin is an arrival that stops, here the motion is
 * the invitation and it never fully settles. Scrolling changes where it orbits
 * from, so moving down the page reads as moving through the graph rather than
 * as a slideshow of overlays laid over a fixed picture.
 */
const REDUCE_MOTION =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

function SlowDrift({ pose }: { pose: CameraPose }) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  /**
   * Someone who asked for less motion gets a still graph, not a slower orbit.
   *
   * The page's argument is motion, so the sections still change what is lit and
   * the copy still appears — but a camera that never stops turning is exactly
   * the sustained movement this preference is about. Starting in the "taken"
   * state reuses the path that already exists for a visitor who grabbed it.
   */
  const taken = useRef(REDUCE_MOTION)
  const angle = useRef(0)
  const radius = useRef(HERO_CAMERA.distance)
  const height = useRef(HERO_CAMERA.position[1])

  /**
   * The requested distance, widened for narrow canvases.
   *
   * The canvas owns only the right part of the page, so a narrower window
   * turns it portrait and the horizontal field collapses — nodes fell outside
   * the frame, clipped mid-label, which reads as broken rather than as "there
   * is more". Scaling by the aspect makes every width show the same span.
   */
  const target = Math.min(
    Math.max(pose.distance * (REFERENCE_ASPECT / (size.width / size.height)), pose.distance),
    130,
  )

  useFrame((_, dt) => {
    if (taken.current) return
    angle.current += dt * 0.08

    /**
     * The pose is eased, never snapped.
     *
     * A camera that teleports on a scroll boundary announces "a section
     * changed", which is exactly the seam a continuous experience must not
     * have. Exponential approach: the shape of a spring coming to rest, in one
     * line, and frame-rate independent — a 120 Hz display and a struggling
     * laptop take the same wall-clock time to arrive.
     */
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
    // dragging a Bézier handle disables the controls — that counts as taking it
    if (!useGraphStore.getState().controlsEnabled) taken.current = true
  })

  /**
   * Taking the camera is permanent, and scrolling never takes it back.
   *
   * Sections keep narrating with colour afterwards — the lens still changes as
   * you scroll — but the viewpoint stays where the visitor put it. Fighting
   * someone for control of a camera they just grabbed is the worst thing a
   * scroll-driven page can do, and it is why most of them feel cheap.
   */
  const stop = () => {
    taken.current = true
  }
  return <mesh onPointerDown={stop} visible={false} scale={0} />
}
