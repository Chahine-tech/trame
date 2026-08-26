import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { edgeInk, type EdgeMood } from "./ink"
import type { Palette } from "../theme"

/**
 * The palettes as the stylesheet actually ships them.
 *
 * Read off disk rather than copied here, because the whole point of these
 * tests is that the rendering keeps the contrast the palette was tuned for. A
 * fixture that drifted from the stylesheet would assert nothing. `?raw` looks
 * like the tidier way and is not: the CSS pipeline processes the file first
 * and hands back an empty string.
 */
const TOKENS = readFileSync(fileURLToPath(new URL("../tokens.css", import.meta.url)), "utf8")

function paletteFrom(selector: string): Palette {
  const block = TOKENS.slice(TOKENS.indexOf(selector))
  const body = block.slice(block.indexOf("{"), block.indexOf("}"))
  const p = {} as Record<string, string>
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) {
    p[name!] = value!
  }
  return p as unknown as Palette
}

const LATTE = paletteFrom(':root[data-theme="light"]')
const MOCHA = paletteFrom(':root[data-theme="dark"]')

function channels(c: string): [number, number, number] {
  const rgb = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const h = c.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(c: string): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = channels(c)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** What the edge actually reads as, once the ground shows through it. */
function contrast(ink: { color: string; opacity: number }, ground: string): number {
  const [fr, fg, fb] = channels(ink.color)
  const [br, bg, bb] = channels(ground)
  const blend = (f: number, b: number) => Math.round(ink.opacity * f + (1 - ink.opacity) * b)
  const over = `rgb(${blend(fr, br)}, ${blend(fg, bg)}, ${blend(fb, bb)})`
  const [hi, lo] = [luminance(over), luminance(ground)].sort((a, b) => b - a)
  return (hi! + 0.05) / (lo! + 0.05)
}

const RESTING: EdgeMood = {
  pathOn: false,
  onPath: false,
  impactOn: false,
  impacted: false,
  violated: false,
  hovered: false,
  lit: false,
  selected: false,
  hasActive: false,
  typeColor: LATTE.overlay,
}

const mood = (over: Partial<EdgeMood>): EdgeMood => ({ ...RESTING, ...over })

const ANSWERS: [string, Partial<EdgeMood>][] = [
  ["impact", { impactOn: true, impacted: true }],
  ["path", { pathOn: true, onPath: true }],
  ["violation", { violated: true, lit: true }],
  ["diff added", { diff: "added" }],
]

describe("an answer is legible on the ground it is drawn on", () => {
  /**
   * 3:1 is what `tokens.css` tunes the light accents to reach as fills, and
   * what WCAG asks of a graphical mark. The impact lens shipped at 2.06:1 for
   * months because it named the accent and then drew it at 0.6 opacity: on
   * white, the 40% that shows through is the background you were trying to
   * stand out from.
   */
  for (const [name, over] of ANSWERS) {
    it(`${name} clears 3:1 on paper`, () => {
      expect(contrast(edgeInk(mood(over), LATTE, false), LATTE.base)).toBeGreaterThan(3)
    })

    it(`${name} clears 3:1 in the void`, () => {
      expect(contrast(edgeInk(mood(over), MOCHA, true), MOCHA.base)).toBeGreaterThan(3)
    })
  }
})

describe("an answer stands clear of the map it is drawn over", () => {
  /**
   * Contrast alone is not separation. What makes a lens read is the gap between
   * the edges that answer and the ones that merely stayed on screen: on paper
   * that gap was 1.9x against the dark ground's 5.2x.
   */
  for (const [name, over] of ANSWERS) {
    if (name.startsWith("diff")) continue // a diff dims nothing; every edge speaks
    it(`${name} stands at least 3x over the background it dims`, () => {
      for (const [palette, dark] of [
        [LATTE, false],
        [MOCHA, true],
      ] as const) {
        const answer = contrast(edgeInk(mood(over), palette, dark), palette.base)
        const ground = contrast(edgeInk(mood({ ...over, onPath: false, impacted: false, violated: false, lit: false }), palette, dark), palette.base)
        expect(answer / ground).toBeGreaterThan(3)
      }
    })
  }
})

describe("what the lens pushes back stays visible as distance", () => {
  it("keeps the dimmed map on the page rather than erasing it", () => {
    // the comment on dimmedEdge earned this: at 0.03 the background kept its
    // dots and lost its lines, and dots without lines read as dirt
    for (const [palette, dark] of [
      [LATTE, false],
      [MOCHA, true],
    ] as const) {
      const ground = edgeInk(mood({ impactOn: true }), palette, dark)
      expect(ground.opacity).toBeGreaterThan(0.05)
    }
  })

  it("leaves a removed edge a ghost, not an alarm", () => {
    const removed = contrast(edgeInk(mood({ diff: "removed" }), LATTE, false), LATTE.base)
    const added = contrast(edgeInk(mood({ diff: "added" }), LATTE, false), LATTE.base)
    expect(removed).toBeLessThan(added)
    expect(removed).toBeGreaterThan(1.5)
  })
})
