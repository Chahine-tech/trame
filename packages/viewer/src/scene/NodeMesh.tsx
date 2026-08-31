import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { Billboard } from "@react-three/drei"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { positionOf, useGraphStore } from "../store/graph"
import { isDarkGround, mix, NODE_COLOR, usePalette } from "../theme"
import { nodeInk } from "./ink"
import { CONTEXT_PX, crowding, MARK_PX, marksMayGlow, RANKED_PX, markScale } from "./mark"
import { nodeProgress, overshoot } from "./arrival"
import type { GraphNode } from "../types"

/**
 * One geometry instance per type, shared by every node of that type.
 * Crystals (octa/tetra/dodeca/icosa) read best faceted → flat shading;
 * the component box gets rounded corners so it doesn't look like a raw
 * Three.js primitive.
 */
const GEOMETRY: Record<GraphNode["type"], () => THREE.BufferGeometry> = {
  page: () => new THREE.OctahedronGeometry(1.1),
  component: () => new RoundedBoxGeometry(1.5, 1.5, 1.5, 3, 0.22),
  hook: () => new THREE.SphereGeometry(0.95, 24, 16),
  api: () => new THREE.CylinderGeometry(0.7, 0.7, 1.6, 24),
  "query-key": () => new THREE.TetrahedronGeometry(1.2),
  context: () => new THREE.TorusGeometry(0.8, 0.3, 14, 28),
  store: () => new THREE.DodecahedronGeometry(1),
  module: () => new THREE.IcosahedronGeometry(0.65),
}

/** Reused for the world position read under the lens: one per module, not per frame. */
const scratch = new THREE.Vector3()
const GOAL = new THREE.Vector3()

/**
 * How fast a file travels when a lens gathers it, in "fraction of the remaining
 * distance per second". The camera rig eases at 5; this is a touch quicker,
 * because a hundred files moving at once reads as slower than one camera does.
 */
const GATHER_LAMBDA = 6.5

const FACETED: Set<GraphNode["type"]> = new Set(["page", "query-key", "store", "module"])

/** Delay per hop when impact propagates outward. Slow enough to read. */
const IMPACT_RING_MS = 90

/** Shared soft radial halo, tinted per node through the material colour. */
let glowTexture: THREE.CanvasTexture | null = null
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, "rgba(255,255,255,0.85)")
  g.addColorStop(0.35, "rgba(255,255,255,0.28)")
  g.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

/**
 * The same halo for paper: a soft ring around the node instead of a bloom over
 * it, so it marks without emitting and without painting over what it marks.
 *
 * Both are drawn inside the node's own scale, which is what makes them work at
 * any zoom: the halo is a multiple of the node, never a fraction of its edge.
 * The centre is left empty because this one is composited normally rather than
 * added: a filled disc would tint the node it is meant to point at.
 */
let haloTexture: THREE.CanvasTexture | null = null
function getHaloTexture(): THREE.CanvasTexture {
  if (haloTexture) return haloTexture
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  // the hole clears the largest geometry in the set: a component's rounded
  // box reaches a corner at about half the sprite's radius
  g.addColorStop(0, "rgba(255,255,255,0)")
  g.addColorStop(0.36, "rgba(255,255,255,0)")
  g.addColorStop(0.54, "rgba(255,255,255,0.95)")
  g.addColorStop(0.72, "rgba(255,255,255,0.4)")
  g.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  haloTexture = new THREE.CanvasTexture(canvas)
  return haloTexture
}

const geometryCache = new Map<GraphNode["type"], THREE.BufferGeometry>()
function geometryFor(type: GraphNode["type"]): THREE.BufferGeometry {
  let g = geometryCache.get(type)
  if (!g) {
    g = GEOMETRY[type]()
    geometryCache.set(type, g)
  }
  return g
}

export function NodeMesh({ node }: { node: GraphNode }) {
  const palette = usePalette()
  const position = useGraphStore((s) => positionOf(s, node.id))
  const degree = useGraphStore((s) => s.adjacency.get(node.id)?.size ?? 0)
  const isLit = useGraphStore((s) => s.litSet.has(node.id))
  const hasActive = useGraphStore((s) => s.litSet.size > 0)
  const isHovered = useGraphStore((s) => s.hoverId === node.id)
  const isSelected = useGraphStore((s) => s.selectedId === node.id)
  const setHover = useGraphStore((s) => s.setHover)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const moveNode = useGraphStore((s) => s.moveNode)
  const setControlsEnabled = useGraphStore((s) => s.setControlsEnabled)
  // only ever read inside handlers, so it must not cost a render: the visible
  // hover state already lives in the store
  const localHover = useRef(false)
  const meshRef = useRef<THREE.Mesh>(null)
  // drag with ~6px hysteresis: below it's a click (select), above it moves the node
  const drag = useRef<{
    moved: boolean
    startX: number
    startY: number
    plane: THREE.Plane
    hit: THREE.Vector3
  } | null>(null)

  // red is an accusation, so it goes on the file the rule is about. Being one
  // of an endpoint's callers is not a fault, and painting it red said it was
  const isViolated = useGraphStore((s) => (s.violatedNodes.get(node.id) ?? []).some((v) => v.about))
  const isOrphan = useGraphStore((s) => s.orphans.has(node.id))
  const impactOn = useGraphStore((s) => s.impactOf !== null)
  const impactDepth = useGraphStore((s) => s.impactDepth.get(node.id))
  const coChangeOn = useGraphStore((s) => s.coChangeOf !== null)
  // the file asked about, or one the history moves with it
  const coChanged = useGraphStore((s) => s.coChangeOf === node.id || s.coChangeWith.has(node.id))
  const hotspotsOn = useGraphStore((s) => s.hotspotHeat.size > 0)
  const heat = useGraphStore((s) => s.hotspotHeat.get(node.id))
  // in the ranking and inside an import cycle: what the lens is actually about
  const knotted = useGraphStore((s) => s.hotspotKnot.has(node.id))
  // how crowded the scene is, and how many marks are in it: the lens sizes
  // itself to what it found rather than to the graph it was tuned on
  const drawn = useGraphStore((s) => s.nearby?.size ?? s.data?.nodes.length ?? 0)
  const marks = useGraphStore((s) => s.hotspotHeat.size)
  const impactStartedAt = useGraphStore((s) => s.impactStartedAt)
  const pathOn = useGraphStore((s) => s.pathNodes.length > 0)
  const onPath = useGraphStore((s) => s.pathNodes.includes(node.id))
  const tracePathTo = useGraphStore((s) => s.tracePathTo)
  const justAdded = useGraphStore((s) => s.frameAdded.has(node.id))
  const arrivedAt = useGraphStore((s) => s.arrivedAt)
  const landed = useRef(false)
  // false until the first placement; afterwards the position is eased, never set
  const settled = useRef(false)
  const whatIfOn = useGraphStore((s) => s.whatIf !== null)
  const isDoomed = useGraphStore((s) => s.whatIf?.nodeId === node.id)
  const isStranded = useGraphStore((s) => s.whatIfOrphaned.has(node.id))
  const isBroken = useGraphStore((s) => s.whatIfBroken.has(node.id))

  const typeColor = palette[NODE_COLOR[node.type]]
  const dark = isDarkGround()

  /**
   * Size = importance: hubs read bigger at a glance. It says how much rests on
   * a file, and nothing else — a rank is never encoded here.
   *
   * The hotspot lens did encode one, briefly: 2.4 + rank × 3.4, so the top of
   * the ranking came out more than twice the size of the tail. It cannot work,
   * and the arithmetic says so without needing to look. Framed on dub's
   * `lib/zod` the camera parks 250 units out with the constellation spanning
   * 128, so the nearest file sits at 122 and the furthest at 378 — a 3.1x
   * spread in apparent size from depth alone, against the 2.4x the encoding
   * asked for. The last file in the ranking, close to the camera, came out
   * larger on screen than the first one behind it.
   *
   * Which is the same thing that rules the footprint out of a code city: in a
   * perspective scene, a magnitude cannot live in a size. It lives in colour
   * and light, which depth does not distort, and the exact order lives in the
   * panel, which is made of text.
   */
  const baseScale = Math.min(0.65 + Math.sqrt(degree) * 0.22, 1.7)

  // Colour = information: grey at rest, type colour only when attention lands.
  // Analysis overlays (path, impact, violations) take precedence, since they are
  // the question the user just asked.
  const { color, emissiveIntensity, opacity } = useMemo(
    () =>
      nodeInk(
        {
          diff: node.diff,
          whatIfOn,
          doomed: isDoomed,
          stranded: isStranded,
          breaks: isBroken,
          justAdded,
          pathOn,
          onPath,
          impactOn,
          impactDepth,
          coChangeOn,
          coChanged,
          hotspotsOn,
          heat,
          knotted,
          violated: isViolated,
          lit: isLit,
          hasActive,
          hovered: isHovered,
          selected: isSelected,
          typeColor,
        },
        palette,
        dark,
      ),
    [
      node.diff,
      justAdded,
      whatIfOn,
      isDoomed,
      isStranded,
      isBroken,
      pathOn,
      onPath,
      impactOn,
      impactDepth,
      coChangeOn,
      coChanged,
      hotspotsOn,
      heat,
      knotted,
      isViolated,
      isLit,
      hasActive,
      isHovered,
      isSelected,
      typeColor,
      palette,
      dark,
    ],
  )

  // Hover growth eased per-frame (interruptible), never snapped
  const lift = isHovered || isSelected ? 1.22 : 1
  const targetScale = baseScale * lift
  /**
   * A file in the ranking drops the size language entirely while the lens is up.
   *
   * `baseScale` says how much rests on a file, which is honest at rest and a lie
   * here: it is half of what the ranking is made of, so the map looks like it is
   * ranking and ranks by depth instead. `mark.ts` has the arithmetic.
   */
  const uniformMark = hotspotsOn && heat !== undefined

  /**
   * `flatShading` is part of the shader, not of the draw call.
   *
   * `flatShading` is one, and it had always been a constant here — a file's type
   * never changes — so the uniform mark makes it a value that flips, which is a
   * different thing
   * entirely: three compiles a program per material and only recompiles when
   * the material's version moves. React Three Fiber assigns changed props
   * straight onto the material and does not touch `needsUpdate` (checked in
   * fiber 9.7's dist: the only `needsUpdate` it writes is the shadow map's), so
   * without this the flag would be set and silently ignored, and half the
   * ranking would keep the shading of the shape it no longer has.
   *
   * `fog={!uniformMark}` used to live here too, holding the ranked marks out of
   * a fog that `extent` was pulling in around them. That was a patch on a
   * coupling, not a fix: the fog reads `depth` now and has no quarrel with the
   * marks, so the exemption is gone rather than kept.
   */
  /**
   * Placed before the browser paints, and moved by hand after that.
   *
   * `position` used to be a prop, which means React writes it the instant it
   * changes — right for a layout that only ever changes on a reload, wrong for
   * the hotspot lens, which gathers each knot onto itself and would teleport a
   * hundred files. A layout effect gets the first placement in before the first
   * paint, so nothing is ever seen at the origin, and `useFrame` owns it
   * afterwards.
   */
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    const m = meshRef.current
    if (!m || !position || settled.current) return
    m.position.set(...position)
    m.updateMatrix()
    settled.current = true
    invalidate()
  }, [position, invalidate])

  useLayoutEffect(() => {
    const material = meshRef.current?.material
    if (!material || Array.isArray(material)) return
    material.needsUpdate = true
    invalidate()
  }, [uniformMark, invalidate])
  // Impact reveals ring by ring so the eye reads propagation, not a flat
  // highlight: each hop waits its turn, like a wave leaving the change.
  const waveRef = useRef<THREE.Mesh>(null)
  useFrame(({ invalidate }) => {
    const m = meshRef.current
    if (!m || !impactOn || impactDepth === undefined) return
    const age = performance.now() - impactStartedAt
    const due = impactDepth * IMPACT_RING_MS
    const t = THREE.MathUtils.clamp((age - due) / 260, 0, 1)
    m.visible = t > 0
    if (waveRef.current) {
      // a brief halo that swells and dies as the wave passes this ring
      const pulse = Math.sin(Math.PI * t)
      waveRef.current.scale.setScalar(1 + pulse * 1.6)
      const mat = waveRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = pulse * 0.35
    }
    if (t < 1) invalidate()
  })

  useFrame(({ invalidate, camera, size }, dt) => {
    const m = meshRef.current
    if (!m) return

    /**
     * The arrival is the show, so it owns the scale until it lands.
     *
     * Filling the wait with something flat sold the product short; letting the
     * graph assemble itself when the engine appears turns the same moment into
     * the reason to keep watching. Nodes come in on a deterministic stagger so
     * every visitor sees the same cascade.
     */
    if (arrivedAt > 0 && !landed.current) {
      const t = nodeProgress(arrivedAt, node.id, performance.now())
      if (t < 1) {
        m.scale.setScalar(baseScale * overshoot(t))
        m.updateMatrix()
        m.visible = t > 0
        invalidate()
        return
      }
      // latched, as the edge draw-in already was. Nothing resets arrivedAt, so
      // without this every node re-hashes its id and rewrites `visible` on
      // every frame for the rest of the session.
      landed.current = true
      m.visible = true
    }

    /**
     * Recomputed every frame under the lens, because the target moves with the
     * camera: this scale exists to cancel the projection, and a projection the
     * camera is still flying through changes between frames.
     *
     * The settle below then does nothing for the rest of a still frame, exactly
     * as it did before — a parked camera gives the same distance twice, so the
     * cheap path is reached on the second one.
     */
    /**
     * Under this lens the ground is measured the way the mark is.
     *
     * The mark alone was fixed in pixels and everything else kept a size in
     * world units, so which of the two looked bigger depended on how far the
     * camera happened to be standing. `mark.ts` has the measurement that caught
     * it. Both are pinned now, so the answer is always the larger of the two.
     */
    let want = targetScale
    if (hotspotsOn) {
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 60
      // three registers, three sizes: the knot, the rest of the ranking, and
      // the map they sit on. `mark.ts` says why the middle one exists
      const px = (knotted ? MARK_PX : uniformMark ? RANKED_PX : CONTEXT_PX) * crowding(drawn)
      want =
        markScale(camera.position.distanceTo(m.getWorldPosition(scratch)), fov, size.height, px) *
        lift
    }

    /**
     * The knot gathering, eased. Snapped while a file is being dragged, because
     * a node that trails the cursor by a tenth of a second feels broken rather
     * than smooth — the same reason the drag has hysteresis rather than easing.
     */
    if (position) {
      if (drag.current?.moved) {
        m.position.set(...position)
        m.updateMatrix()
      } else if (m.position.distanceTo(GOAL.set(...position)) > 0.01) {
        m.position.lerp(GOAL, 1 - Math.exp(-GATHER_LAMBDA * dt))
        m.updateMatrix()
        invalidate()
      }
    }

    const current = m.scale.x
    // damp approaches asymptotically and never lands: settle explicitly, then
    // do nothing. One subscriber per node runs every frame, and the scale is
    // already at rest almost all of the time.
    if (Math.abs(current - want) < 0.001) {
      if (current !== want) {
        m.scale.setScalar(want)
        m.updateMatrix()
      }
      return
    }
    m.scale.setScalar(THREE.MathUtils.damp(current, want, 12, dt))
    m.updateMatrix()
    invalidate() // under frameloop="demand", ask for the frame that continues this
  })

  if (!position) return null

  // The name this node carries is drawn by `ui/NodeLabels`, outside the 3D
  // tree — see that file for why it cannot live in here.

  return (
    <mesh
      ref={meshRef}
      /**
       * One shape for the whole ranking, for the reason the size gave up first.
       *
       * The set is 98 modules, 47 components, 3 contexts and 2 pages, and those
       * geometries are not the same amount of ink: a module is an icosahedron
       * 1.3 across and a component is a filled cube of side 1.5, up to 2.12 in
       * silhouette on its diagonal — between 1.7x and 2.4x the mark at the same
       * scale. With depth cancelled it was the only variation left standing, so
       * it inherited the meaning depth had just been relieved of, and the four
       * big blocks in the picture were simply the components.
       *
       * A file's kind is a real fact and it is not this lens's fact. The
       * background keeps its shapes, because that is the map being itself.
       */
      geometry={geometryFor(uniformMark ? "module" : node.type)}
      scale={baseScale}
      onPointerOver={(e) => {
        e.stopPropagation()
        localHover.current = true
        setHover(node.id)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        if (localHover.current) {
          localHover.current = false
          setHover(null)
          document.body.style.cursor = ""
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        const camDir = e.camera.getWorldDirection(new THREE.Vector3())
        drag.current = {
          moved: false,
          startX: e.clientX,
          startY: e.clientY,
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
            camDir,
            new THREE.Vector3(...position),
          ),
          hit: new THREE.Vector3(),
        }
        ;(e.target as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return
          d.moved = true
          setControlsEnabled(false) // commit to the drag: freeze the camera
          document.body.style.cursor = "grabbing"
        }
        e.stopPropagation()
        if (e.ray.intersectPlane(d.plane, d.hit)) {
          moveNode(node.id, [d.hit.x, d.hit.y, d.hit.z])
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        ;(e.target as Element).releasePointerCapture(e.pointerId)
        if (d && !d.moved) {
          e.stopPropagation()
          // shift-click traces the dependency path from the current selection
          if (e.shiftKey) tracePathTo(node.id)
          else select(node.id) // it was a click, not a drag
        } else if (d?.moved) {
          setControlsEnabled(true)
          document.body.style.cursor = localHover.current ? "pointer" : ""
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        select(node.id)
        focus(node.id)
      }}
    >
      <meshStandardMaterial
        color={color}
        emissive={isViolated ? palette.red : isLit ? typeColor : palette.overlay}
        emissiveIntensity={emissiveIntensity}
        /**
         * Transparent only when it is: on paper every node the ink language
         * produces comes back at full opacity, so all of them were being sorted
         * into the transparent pass and drawn back to front for nothing.
         * "Transparent objects are slow, use as few as possible" is the one
         * rule in the three.js list that this scene was breaking on every
         * object it draws. On the dark ground most nodes really are see-through
         * and stay in that pass.
         */
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.5}
        metalness={0.12}
        flatShading={FACETED.has(uniformMark ? "module" : node.type)}
        // hollow: dead code, or a node this branch removed (a ghost)
        wireframe={(isOrphan && !isLit) || node.diff === "removed" || isDoomed}
      />
      {/* "this one": a bloom in the void, a ring on paper.
       *
       * Paper had an inverted hull at 1.14 instead, the classic way to outline
       * a solid, and it was right about emission and wrong about arithmetic. A
       * 14% hull is a fraction of the node's edge: on the tinybird
       * neighbourhood, 65 files across 1200px, a node is 5px and its outline
       * came to a third of one. The marker was not discreet, it was absent.
       *
       * A halo is a multiple of the node rather than a fraction of it, so it
       * survives any zoom the node itself survives. Both grounds get one now;
       * only how it composites differs.
       *
       * The hotspot lens keeps exactly one, on the row that was clicked. Left to
       * the rule below, roughly half the ranking wore a ring and half did not —
       * `isLit` means adjacent to the current selection, so a ranked file was
       * marked according to whether it happened to touch whatever had been
       * selected before the lens opened, and `isViolated` answers a different
       * question entirely. `lib/types` sat first in the ranking with no ring
       * while `cache` had one. Two tiers, carrying no fact: the same vice as the
       * gradient this lens started with. */}
      {(hotspotsOn
        ? isSelected || (uniformMark && marksMayGlow(marks))
        : isLit || isViolated || onPath || (impactOn && impactDepth !== undefined)) &&
        (() => {
          const accent = hotspotsOn
            ? palette.red
            : onPath
              ? palette.lav
              : impactOn
                ? palette.yellow
                : isViolated
                  ? palette.red
                  : typeColor
          const strong = isHovered || isSelected
          return (
            <sprite scale={[5.2, 5.2, 1]} raycast={() => null}>
              <spriteMaterial
                map={dark ? getGlowTexture() : getHaloTexture()}
                // on paper the accent alone is too pale to ring a dark dot, so
                // it is carried toward the ink the node is drawn in
                color={dark ? accent : mix(accent, palette.text, 0.45)}
                transparent
                opacity={dark ? (strong ? 0.55 : 0.32) : strong ? 0.85 : 0.55}
                blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
                depthWrite={false}
              />
            </sprite>
          )
        })()}

      {/* the wave front, alive only while the impact ripple passes this ring */}
      {impactOn && impactDepth !== undefined && (
        <mesh ref={waveRef} raycast={() => null}>
          <sphereGeometry args={[1.6, 16, 12]} />
          <meshBasicMaterial color={palette.yellow} transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* static selection ring: state without motion on the data */}
      {isSelected && (
        <Billboard>
          <mesh raycast={() => null}>
            <ringGeometry args={[1.75, 1.9, 48]} />
            <meshBasicMaterial
              color={isViolated ? palette.red : typeColor}
              transparent
              opacity={0.65}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      )}
    </mesh>
  )
}
