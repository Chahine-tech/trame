import { useRef, type ComponentRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>
import { useGraphStore } from "../store/graph"
import { usePalette } from "../theme"
import { NodeMesh } from "./NodeMesh"
import { EdgeMesh } from "./EdgeMesh"
import { Clusters } from "./Clusters"

/** Eases the OrbitControls target toward the focused node, then lets go. */
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const focusTarget = useGraphStore((s) => s.focusTarget)
  const clearFocus = useGraphStore((s) => s.clearFocus)
  const camera = useThree((s) => s.camera)
  const goal = useRef(new THREE.Vector3())

  useFrame(() => {
    const c = controls.current
    if (!c || !focusTarget) return
    goal.current.set(...focusTarget)
    c.target.lerp(goal.current, 0.08)

    // dolly toward a comfortable distance from the target
    const dist = camera.position.distanceTo(goal.current)
    const desired = focusTarget[0] === 0 && focusTarget[1] === 0 && focusTarget[2] === 0 ? 80 : 26
    const dir = camera.position.clone().sub(goal.current).normalize()
    const targetPos = goal.current.clone().add(dir.multiplyScalar(THREE.MathUtils.lerp(dist, desired, 0.08)))
    camera.position.copy(targetPos)

    if (c.target.distanceTo(goal.current) < 0.05 && Math.abs(dist - desired) < 0.5) {
      clearFocus() // settled — release so the user can orbit freely again
    }
    c.update()
  })

  return null
}

const REDUCE_MOTION =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

export function Scene() {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const controlsEnabled = useGraphStore((s) => s.controlsEnabled)
  const idle = useGraphStore(
    (s) => s.litSet.size === 0 && !s.selectedEdgeId && !s.focusTarget,
  )
  const controls = useRef<OrbitControlsImpl | null>(null)

  if (!data) return null

  return (
    <>
      <color attach="background" args={[palette.base]} />
      {/* depth fog — far nodes recede into the void, never a flat board */}
      <fog attach="fog" args={[palette.base, 60, 150]} />

      {/* sky/ground ambience + key + cool rim: sculpts the facets */}
      <hemisphereLight args={[palette.text, palette.crust, 0.55]} />
      <directionalLight position={[35, 45, 50]} intensity={1.3} />
      <directionalLight position={[-40, -15, -35]} intensity={0.45} color={palette.lav} />

      <Clusters />

      {data.edges.map((e) => (
        <EdgeMesh key={e.id} edge={e} />
      ))}
      {data.nodes.map((n) => (
        <NodeMesh key={n.id} node={n} />
      ))}

      <OrbitControls
        ref={controls}
        makeDefault
        enabled={controlsEnabled}
        enableDamping
        dampingFactor={0.08}
        autoRotate={idle && !REDUCE_MOTION}
        autoRotateSpeed={0.4}
        minDistance={8}
        maxDistance={220}
      />
      <CameraRig controls={controls} />
    </>
  )
}
