import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { TrameConfig } from "./types.js"

const CONFIG_CANDIDATES = [
  "trame.config.ts",
  "trame.config.js",
  "trame.config.mjs",
  "trame.config.json",
]

/**
 * Load trame.config.* — .ts works directly on Node ≥23.6 thanks to native
 * type stripping; .json is parsed as-is.
 *
 * Kept apart from rules.ts so the rule evaluation stays free of node builtins:
 * the viewer runs the very same checks in the browser to simulate a change.
 */
export async function loadConfig(explicit?: string, cwd = process.cwd()): Promise<TrameConfig | null> {
  const candidates = explicit ? [explicit] : CONFIG_CANDIDATES
  for (const candidate of candidates) {
    const p = path.resolve(cwd, candidate)
    if (!fs.existsSync(p)) continue
    if (p.endsWith(".json")) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as TrameConfig
    }
    const mod = (await import(pathToFileURL(p).href)) as { default?: TrameConfig }
    return mod.default ?? (mod as TrameConfig)
  }
  return null
}
