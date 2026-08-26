import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { EdgeType, NodeType, Rule, RuleMatch, TrameConfig } from "./types.js"

const CONFIG_CANDIDATES = [
  "trame.config.ts",
  "trame.config.js",
  "trame.config.mjs",
  "trame.config.json",
]

/**
 * The config is the one file a person writes by hand, and every way of getting
 * it wrong used to pass in silence.
 *
 * `evaluateRules` dispatches on `rule.type` through three `if`s with no `else`,
 * so a rule typed `no-cycle` instead of `no-cycles` matches nothing, produces
 * no violations, and exits 0: a green CI that checks nothing. A misspelt key
 * inside `match` is the same bug pointing the other way, since `edgeMatches`
 * returns true for every field it does not recognise, so `sourceTyp` turns a
 * targeted rule into one that flags the whole codebase.
 *
 * So the shape is checked before it is trusted, and every problem is collected
 * rather than thrown on the first.
 */
export class ConfigError extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[],
  ) {
    super(`${file} is not a valid trame config\n\n${problems.map((p) => `  ${p}`).join("\n")}`)
    this.name = "ConfigError"
  }
}

/**
 * `satisfies` proves no listed value is outside its union, which is the
 * direction that matters: a stray value here would be accepted by the validator
 * and then quietly ignored by the code that consumes it. The reverse, a union
 * growing a member nobody added here, fails loudly the first time the new
 * option is used and needs no compile-time guard.
 */
const RULE_TYPES = ["unique-caller", "no-direct-import", "no-cycles"] as const satisfies readonly Rule["type"][]
const NODE_TYPES = [
  "page",
  "component",
  "hook",
  "api",
  "query-key",
  "context",
  "store",
  "module",
] as const satisfies readonly NodeType[]
const EDGE_TYPES = [
  "import",
  "api-call",
  "query-key",
  "component",
  "context",
] as const satisfies readonly EdgeType[]

const CONFIG_KEYS = ["rules", "exclude"] as const satisfies readonly (keyof TrameConfig)[]
const RULE_KEYS = ["type", "match", "message"] as const satisfies readonly (keyof Rule)[]
const MATCH_KEYS = ["edgeType", "sourceType", "targetType"] as const satisfies readonly (keyof RuleMatch)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `rules[0].match.sourceType`, built as the walk descends. */
function at(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`
}

function describe(value: unknown): string {
  if (value === undefined) return "missing"
  if (Array.isArray(value)) return "an array"
  return JSON.stringify(value) ?? typeof value
}

/**
 * An unknown key is an error, not a warning.
 *
 * It is nearly always a typo, and both things it can mean (a setting that does
 * nothing, or a `match` that silently widens to everything) are worse
 * than being told to fix it.
 */
function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  parent: string,
  problems: string[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    problems.push(`${at(parent, key)}: unknown option — expected one of ${allowed.join(", ")}`)
  }
}

function checkEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
  problems: string[],
): void {
  if (typeof value === "string" && allowed.includes(value)) return
  problems.push(`${path}: ${describe(value)} — expected one of ${allowed.join(", ")}`)
}

function checkMatch(value: unknown, parent: string, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${parent}: ${describe(value)} — expected an object`)
    return
  }
  checkKeys(value, MATCH_KEYS, parent, problems)
  if (value.edgeType !== undefined) {
    checkEnum(value.edgeType, EDGE_TYPES, at(parent, "edgeType"), problems)
  }
  if (value.sourceType !== undefined) {
    checkEnum(value.sourceType, NODE_TYPES, at(parent, "sourceType"), problems)
  }
  if (value.targetType !== undefined) {
    checkEnum(value.targetType, NODE_TYPES, at(parent, "targetType"), problems)
  }
}

function checkRule(value: unknown, parent: string, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${parent}: ${describe(value)} — expected an object`)
    return
  }
  checkKeys(value, RULE_KEYS, parent, problems)
  checkEnum(value.type, RULE_TYPES, at(parent, "type"), problems)
  if (typeof value.message !== "string" || value.message.trim() === "") {
    // the message is not decoration: it is the whole text of the violation
    problems.push(
      `${at(parent, "message")}: ${describe(value.message)} — expected a non-empty string, it is what the violation reports`,
    )
  }
  if (value.match !== undefined) checkMatch(value.match, at(parent, "match"), problems)
}

/** Throws `ConfigError` listing everything wrong at once, or returns the config. */
export function validateConfig(value: unknown, file: string): TrameConfig {
  if (!isRecord(value)) {
    throw new ConfigError(file, [`${describe(value)} — expected an object with rules and/or exclude`])
  }

  const problems: string[] = []
  checkKeys(value, CONFIG_KEYS, "", problems)

  if (value.rules !== undefined) {
    if (!Array.isArray(value.rules)) {
      problems.push(`rules: ${describe(value.rules)} — expected an array`)
    } else {
      value.rules.forEach((rule, i) => checkRule(rule, `rules[${i}]`, problems))
    }
  }

  if (value.exclude !== undefined) {
    if (!Array.isArray(value.exclude)) {
      problems.push(`exclude: ${describe(value.exclude)} — expected an array of strings`)
    } else {
      value.exclude.forEach((entry, i) => {
        if (typeof entry !== "string") {
          problems.push(`exclude[${i}]: ${describe(entry)} — expected a string`)
        }
      })
    }
  }

  if (problems.length > 0) throw new ConfigError(file, problems)
  return value as TrameConfig
}

/**
 * Load trame.config.*; .ts works directly on Node >=23.6 thanks to native
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
      let parsed: unknown
      try {
        parsed = JSON.parse(fs.readFileSync(p, "utf8"))
      } catch (error) {
        throw new ConfigError(p, [`not valid JSON — ${(error as Error).message}`])
      }
      return validateConfig(parsed, p)
    }
    // a module namespace is a record too, so a config written with named
    // exports rather than a default validates the same way
    const mod = (await import(pathToFileURL(p).href)) as { default?: unknown }
    return validateConfig(mod.default ?? mod, p)
  }
  return null
}
