import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ConfigError, loadConfig, validateConfig } from "./config.js"

/** Everything wrong with a config, as one flat list of paths. */
function problems(value: unknown): string[] {
  try {
    validateConfig(value, "trame.config.json")
    return []
  } catch (error) {
    if (error instanceof ConfigError) return error.problems
    throw error
  }
}

const validRule = { type: "no-cycles", message: "no circular dependencies" }

describe("a config that is fine", () => {
  it("accepts an empty object: every field is optional", () => {
    expect(problems({})).toEqual([])
  })

  it("accepts rules, matches and excludes together", () => {
    expect(
      problems({
        rules: [
          validRule,
          {
            type: "no-direct-import",
            message: "pages must not import stores directly",
            match: { edgeType: "import", sourceType: "page", targetType: "store" },
          },
        ],
        exclude: ["generated", ".stories."],
      }),
    ).toEqual([])
  })

  it("returns the config itself, not a copy", () => {
    const config = { exclude: ["generated"] }
    expect(validateConfig(config, "f")).toBe(config)
  })
})

describe("the silent failures this exists to catch", () => {
  it("rejects a rule type that is one letter off", () => {
    // the headline case: evaluateRules dispatches through three ifs with no
    // else, so "no-cycle" matched nothing, reported nothing, and exited 0,
    // a green CI that checked nothing at all
    const found = problems({ rules: [{ type: "no-cycle", message: "m" }] })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("rules[0].type")
    expect(found[0]).toContain("no-cycles")
  })

  it("rejects a misspelt key inside match", () => {
    // edgeMatches returns true for every field it does not recognise, so this
    // widened a targeted rule into one that flags every edge in the codebase
    const found = problems({
      rules: [{ ...validRule, match: { sourceTyp: "page" } }],
    })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("rules[0].match.sourceTyp")
    expect(found[0]).toContain("unknown option")
  })

  it("rejects a match value that is not a real node type", () => {
    // the quiet direction of the same bug: nothing matches, so nothing is
    // reported, and the rule looks like it passed
    const found = problems({
      rules: [{ ...validRule, match: { sourceType: "components" } }],
    })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("rules[0].match.sourceType")
    expect(found[0]).toContain("component,")
  })

  it("rejects an unknown top-level option", () => {
    const found = problems({ excludes: ["generated"] })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("excludes")
    expect(found[0]).toContain("rules, exclude")
  })

  it("rejects a rule with no message, since the message is the whole report", () => {
    const found = problems({ rules: [{ type: "no-cycles" }] })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("rules[0].message")
  })

  it("rejects a message that is only whitespace", () => {
    expect(problems({ rules: [{ type: "no-cycles", message: "   " }] })).toHaveLength(1)
  })
})

describe("shapes that are not a config at all", () => {
  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "rules"],
    ["a number", 3],
  ])("rejects %s", (_name, value) => {
    expect(() => validateConfig(value, "f")).toThrow(ConfigError)
  })

  it("rejects rules that are not an array", () => {
    expect(problems({ rules: { type: "no-cycles" } })).toEqual([expect.stringContaining("rules:")])
  })

  it("rejects a non-string in exclude, and says which one", () => {
    const found = problems({ exclude: ["ok", 7] })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("exclude[1]")
  })

  it("rejects match when it is not an object", () => {
    expect(problems({ rules: [{ ...validRule, match: "page" }] })).toEqual([
      expect.stringContaining("rules[0].match:"),
    ])
  })
})

describe("reporting", () => {
  it("collects every problem instead of stopping at the first", () => {
    // fixing a config one error per run is a poor way to spend an afternoon
    const found = problems({
      excludes: [],
      rules: [
        { type: "no-cycle", message: "m" },
        { type: "unique-caller", message: "", match: { targetType: "widget" } },
      ],
    })
    expect(found).toHaveLength(4)
  })

  it("names every problem by its path so a large config stays navigable", () => {
    const found = problems({
      rules: [validRule, validRule, { type: "nope", message: "m" }],
    })
    expect(found[0]).toMatch(/^rules\[2]\.type:/)
  })

  it("puts the file and every problem in the thrown message", () => {
    try {
      validateConfig({ rules: [{ type: "no-cycle", message: "m" }] }, "/repo/trame.config.json")
      expect.unreachable()
    } catch (error) {
      const message = (error as ConfigError).message
      expect(message).toContain("/repo/trame.config.json")
      expect(message).toContain("rules[0].type")
    }
  })
})

describe("loadConfig", () => {
  function inTempDir(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trame-config-"))
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), body)
    }
    return dir
  }

  it("returns null when there is no config to find", async () => {
    expect(await loadConfig(undefined, inTempDir({}))).toBeNull()
  })

  it("reads and validates a json config", async () => {
    const dir = inTempDir({ "trame.config.json": JSON.stringify({ exclude: ["generated"] }) })
    expect(await loadConfig(undefined, dir)).toEqual({ exclude: ["generated"] })
  })

  it("refuses a json config whose rules are wrong", async () => {
    const dir = inTempDir({
      "trame.config.json": JSON.stringify({ rules: [{ type: "no-cycle", message: "m" }] }),
    })
    await expect(loadConfig(undefined, dir)).rejects.toThrow(ConfigError)
  })

  it("names the file when the json does not parse", async () => {
    const dir = inTempDir({ "trame.config.json": "{ rules: [" })
    await expect(loadConfig(undefined, dir)).rejects.toThrow(/trame\.config\.json/)
  })
})
