import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

/**
 * Refuse to build a landing whose graph has not been baked.
 *
 * `runLayout` returns a fully seeded graph untouched, which is what lets the
 * page paint at its final shape with no solver on the critical path. Positions
 * are put there by `pnpm bake`, and nothing forces that to be re-run after the
 * demo graph is re-parsed — so the failure mode is silent: the file quietly
 * loses its coordinates, the page goes back to solving 300 ticks on load, and
 * the framing shifts under a camera tuned for something else.
 *
 * A build is the last moment anyone is paying attention. Checking here turns
 * that silence into a stop.
 */
function requireBakedLayout(): Plugin {
  return {
    name: "trame:require-baked-layout",
    apply: "build",
    buildStart() {
      const path = new URL("./public/demo.json", import.meta.url)
      const graph = JSON.parse(readFileSync(path, "utf8")) as {
        nodes: { id: string; x?: number }[]
      }
      const unbaked = graph.nodes.filter((n) => n.x === undefined)
      if (unbaked.length === 0) return
      this.error(
        `demo.json has ${unbaked.length} of ${graph.nodes.length} nodes without a baked position.\n` +
          `The landing would run the force solver on load instead of painting at its final shape.\n` +
          `Fix: pnpm --filter @trame/site bake`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), requireBakedLayout()],
})
