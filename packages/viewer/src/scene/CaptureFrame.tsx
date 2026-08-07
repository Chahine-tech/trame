import { useEffect } from "react"
import { useThree } from "@react-three/fiber"
import { useGraphStore } from "../store/graph"
import { toastExported } from "../ui/toast"

interface CapturableRenderer {
  render: (scene: unknown, camera: unknown) => void
  renderAsync?: (scene: unknown, camera: unknown) => Promise<void>
  domElement: HTMLCanvasElement
}

/** Lives inside the Canvas — renders a fresh frame, then downloads it (⌘E). */
export function CaptureFrame() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const requested = useGraphStore((s) => s.pngRequested)

  useEffect(() => {
    if (!requested) return
    const renderer = gl as unknown as CapturableRenderer
    void (async () => {
      // draw right before capture — the WebGPU canvas holds the last presented frame
      if (renderer.renderAsync) await renderer.renderAsync(scene, camera)
      else renderer.render(scene, camera)
      renderer.domElement.toBlob((blob) => {
        if (blob) {
          const project = useGraphStore.getState().data?.meta.project ?? "trame"
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = `${project}-trame.png`
          a.click()
          URL.revokeObjectURL(url)
          toastExported("PNG")
        }
        useGraphStore.getState().clearPng()
      })
    })()
  }, [requested, gl, scene, camera])

  return null
}
