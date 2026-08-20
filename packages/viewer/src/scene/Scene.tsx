import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>
import { useGraphStore } from "../store/graph"
import { isDarkGround, usePalette } from "../theme"
import { Lighting } from "./Lighting"
import { NodeMesh } from "./NodeMesh"
import { EdgeMesh } from "./EdgeMesh"
import { Clusters } from "./Clusters"
import { Districts } from "./Districts"
import { ZoomDirector } from "./ZoomDirector"
import { CaptureFrame } from "./CaptureFrame"

/** Scratch vectors, reused every frame — always rewritten before they are read. */
const GOAL = new THREE.Vector3()
const DIR = new THREE.Vector3()

/** Convergence rate, in "fraction of the remaining distance closed per second". */
const FOCUS_LAMBDA = 5

/**
 * Pulls the fog in while something is selected so everything around it
 * recedes — the cheap half of a depth-of-field effect, no postprocessing.
 */
/**
 * Fog distances, as multiples of how far the arrangement reaches.
 *
 * These were absolute — 120 and 320 on paper — which frames a graph the size of
 * trame's own and swallows anything larger whole. Pulling the camera back to
 * suit cal.com's skeleton put every file past the far plane, so the scene was
 * painted entirely in the background colour and only the HTML labels came
 * through: a map of names floating over nothing. The ratios here are the ones
 * those absolute numbers already had.
 */
const FOG = {
  paper: { near: 2.0, far: 5.4 },
  void: { near: 1.0, far: 2.5 },
  attentive: { near: 0.44, far: 1.6 },
}

function FocusDepth() {
  const attentive = useGraphStore((s) => s.litSet.size > 0 || s.selectedEdgeId !== null)
  const extent = useGraphStore((s) => s.extent)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  const dark = isDarkGround()

  useFrame((_, dt) => {
    const fog = scene.fog as THREE.Fog | null
    if (!fog) return
    // Only on dark. Fog is the colour of the ground, so tightening it makes
    // things sink into the void — but on paper it bleaches them into the page,
    // on top of the dimming the ink language already does. Two washes, and the
    // scene faded out about a second after every hover.
    const band = dark && attentive ? FOG.attentive : dark ? FOG.void : FOG.paper
    const near = band.near * extent
    const far = band.far * extent
    const nextNear = THREE.MathUtils.damp(fog.near, near, 4, dt)
    const nextFar = THREE.MathUtils.damp(fog.far, far, 4, dt)
    if (Math.abs(nextFar - fog.far) < 0.05 && Math.abs(nextNear - fog.near) < 0.05) return
    fog.near = nextNear
    fog.far = nextFar
    invalidate()
  })

  return null
}

/** Eases the OrbitControls target toward the focused node, then lets go. */
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const focusTarget = useGraphStore((s) => s.focusTarget)
  const clearFocus = useGraphStore((s) => s.clearFocus)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  // kick the loop when a focus starts; controls.update() keeps it alive after
  useEffect(() => {
    if (focusTarget) invalidate()
  }, [focusTarget, invalidate])

  useFrame((_, delta) => {
    const c = controls.current
    if (!c || !focusTarget) return
    // damp, not lerp: a fixed per-frame step would fly twice as fast on a
    // 120 Hz display as on 60 Hz
    const t = 1 - Math.exp(-FOCUS_LAMBDA * delta)
    GOAL.set(...focusTarget)
    c.target.lerp(GOAL, t)

    // dolly toward a comfortable distance from the target
    const dist = camera.position.distanceTo(GOAL)
    const desired = focusTarget[0] === 0 && focusTarget[1] === 0 && focusTarget[2] === 0 ? 80 : 26
    DIR.copy(camera.position).sub(GOAL).normalize()
    camera.position.copy(GOAL).addScaledVector(DIR, THREE.MathUtils.lerp(dist, desired, t))

    if (c.target.distanceTo(GOAL) < 0.05 && Math.abs(dist - desired) < 0.5) {
      clearFocus() // settled — release so the user can orbit freely again
    }
    c.update()
  })

  return null
}

const REDUCE_MOTION =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** How long the graph turns on its own before going still. */
const INTRO_SPIN_MS = 12000

/**
 * The slow turn is an arrival, not a permanent state: it shows the scene has
 * depth, then stops. Under frameloop="demand" it is also the one thing that
 * would keep the render loop running forever, so it has to end.
 */
function useIntroSpin(): boolean {
  const [spinning, setSpinning] = useState(!REDUCE_MOTION)

  useEffect(() => {
    if (!spinning) return
    const stop = () => setSpinning(false)
    const timer = setTimeout(stop, INTRO_SPIN_MS)
    // the moment the user takes the camera, the introduction is over
    window.addEventListener("pointerdown", stop, { once: true })
    window.addEventListener("wheel", stop, { once: true, passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener("pointerdown", stop)
      window.removeEventListener("wheel", stop)
    }
  }, [spinning])

  return spinning
}

export function Scene() {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const controlsEnabled = useGraphStore((s) => s.controlsEnabled)
  const idle = useGraphStore(
    (s) => s.litSet.size === 0 && !s.selectedEdgeId && !s.focusTarget,
  )
  const introSpin = useIntroSpin()
  const districtMode = useGraphStore((s) => s.districtMode)
  const nearby = useGraphStore((s) => s.nearby)
  const extent = useGraphStore((s) => s.extent)
  const camera = useThree((s) => s.camera)
  const controls = useRef<OrbitControlsImpl | null>(null)
  const invalidate = useThree((s) => s.invalidate)

  /**
   * The detail view draws its neighbourhood, not the repository.
   *
   * An edge needs both ends present or it would trail off into nothing, which
   * reads as a bug rather than as a boundary. `nearby` is null whenever the
   * whole graph fits, and then this is the same list it always was.
   */
  const visible = useMemo(() => {
    if (!data || !nearby) return data
    return {
      ...data,
      nodes: data.nodes.filter((n) => nearby.has(n.id)),
      edges: data.edges.filter((e) => nearby.has(e.source) && nearby.has(e.target)),
    }
  }, [data, nearby])

  /**
   * Stand back far enough to see what was loaded.
   *
   * The canvas opens the camera at a fixed 80, which frames trame's own graph
   * and lands somewhere in the middle of a large one. Keyed on the extent, so a
   * watch-mode reload of the same codebase leaves the camera exactly where the
   * reader put it.
   */
  useEffect(() => {
    const want = extent * 1.35
    const dir = camera.position.length() > 0.01 ? camera.position.clone().normalize() : null
    if (dir) camera.position.copy(dir.multiplyScalar(want))
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [extent, camera, invalidate])

  // the spin pauses while a node is lit and resumes after; in demand mode the
  // loop has already stopped by then, so it needs an explicit restart
  useEffect(() => {
    invalidate()
  }, [introSpin, idle, invalidate])

  if (!data) return null

  return (
    <>
      <color attach="background" args={[palette.base]} />
      {/* depth fog — far nodes recede into the void, never a flat board.
          It tightens on selection: the surroundings lose contrast like a
          shallow depth of field, without paying for a blur pass. */}
      <fog attach="fog" args={[palette.base, extent, extent * 2.5]} />
      <FocusDepth />

      <Lighting />

      <ZoomDirector />

      {districtMode ? (
        <Districts />
      ) : (
        <>
          <Clusters />
          {visible!.edges.map((e) => (
            <EdgeMesh key={e.id} edge={e} />
          ))}
          {visible!.nodes.map((n) => (
            <NodeMesh key={n.id} node={n} />
          ))}
        </>
      )}

      <OrbitControls
        ref={controls}
        makeDefault
        enabled={controlsEnabled}
        enableDamping
        dampingFactor={0.08}
        autoRotate={introSpin && idle}
        autoRotateSpeed={0.4}
        minDistance={extent * 0.14}
        maxDistance={extent * 3.7}
      />
      <CameraRig controls={controls} />
      <CaptureFrame />
    </>
  )
}
