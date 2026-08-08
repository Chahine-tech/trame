import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import { useGraphStore } from "@trame/viewer/store/graph"
import { isDarkGround, usePalette } from "@trame/viewer/theme"
import { HERO_CAMERA, REFERENCE_ASPECT } from "./camera"
import { NodeMesh } from "@trame/viewer/scene/NodeMesh"
import { EdgeMesh } from "@trame/viewer/scene/EdgeMesh"

/**
 * The product's own meshes, without the tool's chrome.
 *
 * No inspector, no palette, no top bar — the hero is the graph and nothing
 * else. Everything you see here is the code that ships in the viewer, so a
 * visitor who clicks through finds exactly what they were just watching.
 */
export function HeroScene() {
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

      {dark ? (
        <>
          {/* brighter than the tool's rig: on the landing a resting node has
              to read on near-black before the script ever lights one up */}
          <hemisphereLight args={[palette.text, palette.crust, 0.95]} />
          <directionalLight position={[35, 45, 50]} intensity={1.9} />
          <directionalLight position={[-40, -15, -35]} intensity={0.8} color={palette.lav} />
        </>
      ) : (
        <>
          <ambientLight intensity={2.1} />
          <directionalLight position={[30, 45, 40]} intensity={0.35} />
        </>
      )}

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
        minDistance={30}
        maxDistance={140}
      />
      <SlowDrift />
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
 * A continuous slow orbit — unlike the tool, where the spin is an arrival that
 * stops. A landing has to catch the eye of someone who has not asked for
 * anything, so here the motion is the invitation and it never fully settles.
 */
function SlowDrift() {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  const taken = useRef(false)
  const angle = useRef(0)

  /**
   * The orbit radius follows the canvas shape instead of being a fixed number.
   *
   * The canvas owns only the right 62% of the page, so a narrower window turns
   * it portrait and the horizontal field collapses — at a 0.80 aspect five
   * nodes fell outside the frame, clipped mid-label, which reads as broken
   * rather than as "there is more". Distance is scaled by the aspect so every
   * width shows the same horizontal span.
   *
   * REFERENCE_ASPECT is the wide layout, which already frames well: at or above
   * it nothing changes at all. The camera only ever pulls back, never closer.
   */
  const radius = Math.min(
    Math.max(HERO_CAMERA.distance * (REFERENCE_ASPECT / (size.width / size.height)), HERO_CAMERA.distance),
    130,
  )

  useFrame((_, dt) => {
    if (taken.current) return
    angle.current += dt * 0.08
    camera.position.set(
      Math.sin(angle.current) * radius,
      (radius / HERO_CAMERA.distance) * (14 + Math.sin(angle.current * 0.6) * 8),
      Math.cos(angle.current) * radius,
    )
    camera.lookAt(0, 0, 0)
    invalidate()
  })

  useFrame(() => {
    // the moment the visitor drags, the drift yields the camera for good
    if (!useGraphStore.getState().controlsEnabled) taken.current = true
  })

  const stop = () => {
    taken.current = true
  }
  return <mesh onPointerDown={stop} visible={false} scale={0} />
}
