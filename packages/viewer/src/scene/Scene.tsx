import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>
import { useGraphStore } from "../store/graph"
import { isDarkGround, usePalette } from "../theme"
import { Lighting } from "./Lighting"
import { NodeMesh } from "./NodeMesh"
import { CoChangeMesh } from "./CoChangeMesh"
import { EdgeMesh } from "./EdgeMesh"
import { Clusters } from "./Clusters"
import { Districts } from "./Districts"
import { ZoomDirector } from "./ZoomDirector"
import { CaptureFrame } from "./CaptureFrame"
import { applyLabels, textSize, withoutOverlap, type LabelBox } from "./labels"
import { labelElements } from "./nodeLabels"

/** Scratch vectors, reused every frame and always rewritten before read. */
const GOAL = new THREE.Vector3()
const DIR = new THREE.Vector3()
/** The side the camera has been asked to come back to, when it has been. */
const WANT = new THREE.Vector3()
const AT = new THREE.Vector3()

/**
 * Keeps file names from writing over one another.
 *
 * Labels cover the neighbourhood in hand, which is the right set to name and
 * too many to name at once: opening cal.com on `handleCancelBooking` put forty
 * on one knot. The file being asked about is ranked first and the rest fill the
 * gaps around it.
 *
 * Written straight to the DOM, only when the view has moved. Re-rendering forty
 * meshes several times a second costs more than the arithmetic deciding them.
 */
/** Above every depth rank, so what a lens is answering about keeps its name. */
const ANSWER = 1e9

function NameDirector() {
  const positions = useGraphStore((s) => s.positions)
  const selectedId = useGraphStore((s) => s.selectedId)
  const coChangeWith = useGraphStore((s) => s.coChangeWith)
  const hotspotHeat = useGraphStore((s) => s.hotspotHeat)
  const lastView = useRef("")

  useFrame(({ camera, size }) => {
    const elements = labelElements()
    const view = `${camera.position.toArray().join()}|${camera.quaternion.toArray().join()}|${elements.size}|${selectedId}|${coChangeWith.size}|${hotspotHeat.size}`
    if (view === lastView.current) return
    lastView.current = view

    const boxes: LabelBox[] = []
    for (const [id, el] of elements) {
      // a label switched off by the scene has no claim on the space
      if (el.offsetParent === null) continue
      const p = positions.get(id)
      if (!p) continue
      AT.set(p[0], p[1], p[2]).project(camera)
      if (AT.z > 1) continue
      const { width, height } = textSize(el.textContent ?? "", 11)
      boxes.push({
        id,
        x: ((AT.x + 1) / 2) * size.width,
        /**
         * Where the label sits, not where the node does. `.node-label` carries
         * `translate(-50%, -180%)` and drei anchors its top-left corner at the
         * projected point, so the box is centred 1.3 of its own heights above.
         * Reckoning on one height put the rectangles a third of a line low, and
         * names the arbitration believed were clear touched on screen.
         */
        y: ((1 - AT.y) / 2) * size.height - height * 1.3,
        width,
        height,
        tier: 0,
        /**
         * The file in hand always keeps its name, and so does anything a lens
         * is currently answering about.
         *
         * The co-change lens answers "what moves with this?", and the answer
         * was five lines pointing at unlabelled dots: the partners competed for
         * their names against the whole neighbourhood on camera depth alone,
         * which is the right rule for context and the wrong one for the answer.
         * The rest is still ranked by nearness, so the front of the knot stays
         * readable.
         */
        rank:
          id === selectedId
            ? Number.MAX_SAFE_INTEGER
            : coChangeWith.has(id)
              ? ANSWER
              : // and the hotspots, hottest first: where they crowd, the names
                // that survive are the ones at the top of the ranking
                hotspotHeat.has(id)
                ? ANSWER + (hotspotHeat.get(id) ?? 0)
                : -AT.z,
      })
    }

    applyLabels(elements, boxes, withoutOverlap(boxes))
  })

  return null
}

/**
 * Every camera distance in this scene is measured from `controls.target`, and
 * `extent` is the size of whatever sits there.
 *
 * Both halves matter and the second one is what kept breaking. `extent` is a
 * size; the store's `viewCentre` is the position that goes with it. Four things
 * turn the pair into a distance — this rig, the zoom director, OrbitControls'
 * min and max, and the fog — and for a while two of them measured from the
 * origin instead. They agree only on a graph that happens to be centred, and a
 * neighbourhood is a knot off to one side, so the disagreement was exactly how
 * far off to the side the reader had gone.
 *
 * A fifth used to exist: an opening shot that framed around the origin and
 * called `lookAt(0, 0, 0)`, fighting the target outright. It was deleted rather
 * than guarded, because the rig already does its job — `load` now asks for a
 * flight to the middle of what arrived, and the camera flies out from the
 * canvas's fixed 80 instead of being snapped there.
 *
 * If a new consumer needs a distance, it measures from the target. Anything
 * else reintroduces the same class of bug in a new place.
 */

/** Convergence rate, in "fraction of the remaining distance closed per second". */
const FOCUS_LAMBDA = 5

/**
 * Pulls the fog in while something is selected, so everything around it
 * recedes. The cheap half of a depth-of-field effect, no postprocessing.
 */
/**
 * Fog distances, as multiples of how far the arrangement reaches.
 *
 * These were absolute, 120 and 320 on paper, which frames a graph the size of
 * trame's own and swallows anything larger. Pulling the camera back for
 * cal.com's skeleton put every file past the far plane, so the scene painted
 * entirely in the background colour and only the HTML labels came through. The
 * ratios here are the ones those absolute numbers already had.
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
    // Only on dark. Fog is the colour of the ground, so tightening it sinks
    // things into the void; on paper it bleaches them into the page, on top of
    // the dimming the ink language already does. Two washes, and the scene
    // faded out about a second after every hover.
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
  const focusDir = useGraphStore((s) => s.focusDir)
  const extent = useGraphStore((s) => s.extent)
  const clearFocus = useGraphStore((s) => s.clearFocus)
  const setVantage = useGraphStore((s) => s.setVantage)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  // kick the loop when a focus starts; controls.update() keeps it alive after
  useEffect(() => {
    if (!focusTarget) return
    invalidate()
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
    /**
     * Outside what you are looking at, not inside it.
     *
     * This was 26 units: an arm's length from trame's own graph, and deep
     * inside a neighbourhood of cal.com's, where a tube seen from two units
     * away fills half the frame and every import passing near the lens becomes
     * a grey band. Those bands were blamed on the renderer for two days.
     *
     * The same ratio the opening shot uses, so flying somewhere frames it the
     * way arriving does.
     */
    const desired = extent * 1.35
    DIR.copy(camera.position).sub(GOAL).normalize()
    // Left alone a flight is radial: it slides along the ray it is already on
    // and keeps the angle, which is right for going somewhere new and wrong for
    // coming back, since the outward leg aimed at another centre. Eased on the
    // dolly's clock so the camera arcs home rather than turning after it lands.
    if (focusDir) {
      WANT.set(...focusDir)
      DIR.lerp(WANT, t).normalize()
    }
    camera.position.copy(GOAL).addScaledVector(DIR, THREE.MathUtils.lerp(dist, desired, t))

    // an arc that has not finished is not an arrival, so the angle gets a say
    // in the release alongside the distance. 0.9995 is about a fifth of a degree
    const aimed = !focusDir || DIR.dot(WANT) > 0.9995
    if (aimed && c.target.distanceTo(GOAL) < 0.05 && Math.abs(dist - desired) < 0.5) {
      // measured after the move, which is where the camera actually stops
      const d = DIR.copy(camera.position).sub(GOAL).normalize()
      // where the reader is standing now — the spot and the side, because a
      // lens has to give back both or neither
      setVantage([GOAL.x, GOAL.y, GOAL.z], [d.x, d.y, d.z])
      clearFocus() // settled: release so the user can orbit freely again
    }
    c.update()
  })

  return null
}

/** Matches `.inspector`'s width in styles.css. */
const PANEL = 300

/**
 * Centre the scene in the part of it the reader can see.
 *
 * The inspector covers the right three hundred pixels of the canvas while the
 * camera frames the whole thing, so the middle of the picture sits behind the
 * panel. Shifting the projection rather than the camera moves nothing in the
 * scene: the same view, recentred on the window that is left.
 *
 * Cleared when the panel is away, or every graph would sit permanently askew.
 */
function PanelOffset() {
  const open = useGraphStore((s) => s.selectedId !== null || s.selectedEdgeId !== null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    // too narrow to give a third of the screen away: the panel covers the scene
    // on a phone rather than sitting beside it
    if (open && size.width > PANEL * 3) {
      camera.setViewOffset(size.width, size.height, PANEL / 2, 0, size.width, size.height)
    } else {
      camera.clearViewOffset()
    }
    camera.updateProjectionMatrix()
    invalidate()
  }, [open, camera, size.width, size.height, invalidate])

  return null
}

const REDUCE_MOTION =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** How long the graph turns on its own before going still. */
const INTRO_SPIN_MS = 12000

/**
 * The slow turn is an arrival: it shows the scene has depth, then stops. Under
 * frameloop="demand" it is also the one thing that would keep the render loop
 * running forever, so it has to end.
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
  const idle = useGraphStore((s) => s.litSet.size === 0 && !s.selectedEdgeId && !s.focusTarget)
  const introSpin = useIntroSpin()
  const districtMode = useGraphStore((s) => s.districtMode)
  const nearby = useGraphStore((s) => s.nearby)
  const extent = useGraphStore((s) => s.extent)
  const controls = useRef<OrbitControlsImpl | null>(null)
  const invalidate = useThree((s) => s.invalidate)

  /**
   * The detail view draws its neighbourhood, not the repository. An edge needs
   * both ends present or it trails off into nothing, which reads as a bug
   * rather than a boundary. `nearby` is null whenever the whole graph fits.
   */
  const visible = useMemo(() => {
    if (!data || !nearby) return data
    return {
      ...data,
      nodes: data.nodes.filter((n) => nearby.has(n.id)),
      edges: data.edges.filter((e) => nearby.has(e.source) && nearby.has(e.target)),
    }
  }, [data, nearby])

  // the spin pauses while a node is lit and resumes after; in demand mode the
  // loop has already stopped by then, so it needs an explicit restart
  /**
   * The extra dependencies *are* the effect: under `frameloop="demand"` nothing
   * redraws unless something asks, and what this asks for is a frame whenever
   * either of those changes. There is nothing to read in the body.
   */
  useEffect(() => {
    invalidate()
  }, [introSpin, idle, invalidate])

  if (!data) return null

  return (
    <>
      <color attach="background" args={[palette.base]} />
      {/* depth fog: far nodes recede into the void, never a flat board.
          It tightens on selection: the surroundings lose contrast like a
          shallow depth of field, without paying for a blur pass. */}
      <fog attach="fog" args={[palette.base, extent, extent * 2.5]} />
      <FocusDepth />

      <Lighting />

      <ZoomDirector controls={controls} />
      <NameDirector />
      <PanelOffset />

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
          <CoChangeMesh />
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
