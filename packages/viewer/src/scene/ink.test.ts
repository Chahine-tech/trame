import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { edgeInk, nodeInk, type EdgeMood, type NodeMood } from "./ink"
import { mix, type Palette } from "../theme"

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
  impactRing: undefined,
  coChangeOn: false,
  hotspotsOn: false,
  knotEdge: false,
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
        const ground = contrast(
          edgeInk(
            mood({ ...over, onPath: false, impacted: false, violated: false, lit: false }),
            palette,
            dark,
          ),
          palette.base,
        )
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

const RESTING_NODE: NodeMood = {
  whatIfOn: false,
  doomed: false,
  stranded: false,
  breaks: false,
  justAdded: false,
  pathOn: false,
  onPath: false,
  impactOn: false,
  impactDepth: undefined,
  coChanged: false,
  coChangeOn: false,
  hotspotsOn: false,
  heat: undefined,
  knotted: false,
  violated: false,
  lit: false,
  hasActive: false,
  hovered: false,
  selected: false,
  typeColor: LATTE.blue,
}

const node = (over: Partial<NodeMood>): NodeMood => ({ ...RESTING_NODE, ...over })

/** How far a colour has drained toward grey, 0 to 255. */
function chroma(c: string): number {
  const [r, g, b] = channels(c)
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!)
}

describe("the impact wave stays in the set it belongs to", () => {
  /**
   * Paper used to draw distance by mixing toward `base`, which is mixing
   * toward the page. Four hops out came to 1.86:1 against it and 1.39x against
   * a node the lens had pushed away entirely, so the far half of the wave had
   * dropped out of the set it was supposed to show.
   *
   * The hue drains toward the resting grey instead, so a distant dependent
   * ends up looking like an ordinary node rather than like an absent one.
   */
  const rings = [0, 1, 2, 3, 4]
  const onPaper = (d: number) => nodeInk(node({ impactOn: true, impactDepth: d }), LATTE, false)
  const pushedAway = nodeInk(node({ impactOn: true }), LATTE, false)

  it("keeps every ring legible against the page", () => {
    for (const d of rings) {
      expect(contrast(onPaper(d), LATTE.base)).toBeGreaterThan(3)
    }
  })

  it("keeps the far end clear of what the lens dimmed", () => {
    for (const d of rings) {
      const ratio = contrast(onPaper(d), LATTE.base) / contrast(pushedAway, LATTE.base)
      expect(ratio).toBeGreaterThan(2.5)
    }
  })

  it("reads distance as drained colour, not as a fading node", () => {
    const drained = rings.map((d) => chroma(onPaper(d).color))
    expect(drained[0]).toBeGreaterThan(150)
    expect(drained[4]).toBeLessThan(40)
    // and the ink never gets lighter on the way out
    expect(contrast(onPaper(4), LATTE.base)).toBeGreaterThan(contrast(onPaper(0), LATTE.base))
  })

  it("leaves the void alone, where dimming light is the right move", () => {
    const near = nodeInk(node({ impactOn: true, impactDepth: 0 }), MOCHA, true)
    const far = nodeInk(node({ impactOn: true, impactDepth: 4 }), MOCHA, true)
    expect(near.emissiveIntensity).toBeGreaterThan(far.emissiveIntensity)
    expect(near.opacity).toBeGreaterThan(far.opacity)
  })
})

describe("a node answering is not a node the lens dimmed", () => {
  const answers: [string, Partial<NodeMood>][] = [
    ["lit", { lit: true }],
    ["on the path", { pathOn: true, onPath: true }],
    ["violated", { violated: true }],
    ["doomed by a simulation", { whatIfOn: true, doomed: true }],
    ["stranded by a simulation", { whatIfOn: true, stranded: true }],
  ]
  for (const [name, over] of answers) {
    it(`${name} clears 3:1 on paper`, () => {
      expect(contrast(nodeInk(node(over), LATTE, false), LATTE.base)).toBeGreaterThan(3)
    })
  }

  it("still draws the map underneath rather than erasing it", () => {
    // dimmed nodes kept their dots while their edges vanished once, and dots
    // without lines read as dirt on the screen
    const dimmed = nodeInk(node({ pathOn: true }), LATTE, false)
    expect(contrast(dimmed, LATTE.base)).toBeGreaterThan(1.2)
  })
})

describe("blending two colours", () => {
  it("survives being nested, which is how the lens is built", () => {
    /**
     * `mix` returns `rgb(…)` and used to parse only `#rrggbb`, so nesting fed
     * a hex parser a string beginning `rgb(`. It did not throw: `"rg"` parses
     * as NaN while the later slices yield digits, so the impact lens drew
     * `rgb(NaN, 126, 134)` on paper for as long as it existed.
     */
    const once = mix(LATTE.yellow, LATTE.text, 0.12)
    const twice = mix(once, LATTE.subtext, 0.5)
    expect(channels(twice).every(Number.isFinite)).toBe(true)
  })
})

describe("the wave is drawn where the reader is looking", () => {
  /**
   * The node fade was corrected first and changed almost nothing on screen:
   * widening to four rings pulled the camera back until a node was 1.9 CSS
   * pixels, while every impacted edge stayed one flat ochre. Edges cover a
   * hundred times the area of the dots, so the surface that fills the picture
   * has to carry the distance.
   */
  const rings = [0, 1, 2, 3, 4]
  const edgeAt = (r: number) =>
    edgeInk(mood({ impactOn: true, impacted: true, impactRing: r }), LATTE, false)

  it("keeps every ring of the wave legible on paper", () => {
    for (const r of rings) expect(contrast(edgeAt(r), LATTE.base)).toBeGreaterThan(3)
  })

  it("reads distance as drained colour, like the nodes do", () => {
    const drained = rings.map((r) => {
      const [red, green, blue] = channels(edgeAt(r).color)
      return Math.max(red!, green!, blue!) - Math.min(red!, green!, blue!)
    })
    expect(drained[0]).toBeGreaterThan(90)
    expect(drained[3]).toBeLessThan(20)
  })

  it("stays clear of the map the lens pushed back, all the way out", () => {
    const ground = contrast(edgeInk(mood({ impactOn: true }), LATTE, false), LATTE.base)
    for (const r of rings) expect(contrast(edgeAt(r), LATTE.base) / ground).toBeGreaterThan(3)
  })

  it("dims with distance in the void, where light is what recedes", () => {
    const near = edgeInk(mood({ impactOn: true, impacted: true, impactRing: 0 }), MOCHA, true)
    const far = edgeInk(mood({ impactOn: true, impacted: true, impactRing: 4 }), MOCHA, true)
    expect(near.opacity).toBeGreaterThan(far.opacity)
    expect(contrast(far, MOCHA.base)).toBeGreaterThan(3)
  })
})

/**
 * `lens.ts` states the contract in its first paragraph: only one lens can be
 * active, because each repaints every node and edge to answer *its* question.
 * This one shipped without repainting anything, so its answer was two thin
 * lines laid over a neighbourhood drawn at full strength.
 */
describe("the co-change lens repaints, like the others", () => {
  it("sends every import to the background, because none of them is the answer", () => {
    /**
     * The other lenses split the edges into answer and context. This one has no
     * answering edge at all: a pair only reaches the graph when no import
     * connects it. The answer is drawn by `CoChangeMesh`; the imports are the
     * ground it stands out from.
     */
    const lit = edgeInk(mood({ lit: true, hasActive: true }), LATTE, false)
    const under = edgeInk(mood({ lit: true, hasActive: true, coChangeOn: true }), LATTE, false)
    expect(contrast(under, LATTE.base)).toBeLessThan(contrast(lit, LATTE.base))
  })

  it("presses the file and its partners forward, and everything else back", () => {
    const answer = nodeInk(node({ coChangeOn: true, coChanged: true }), LATTE, false)
    const context = nodeInk(node({ coChangeOn: true, coChanged: false }), LATTE, false)
    expect(contrast({ ...answer, opacity: answer.opacity }, LATTE.base)).toBeGreaterThan(
      contrast({ ...context, opacity: context.opacity }, LATTE.base),
    )
  })

  it("still reads on the dark ground, where dimming is loss of light", () => {
    const answer = nodeInk(node({ coChangeOn: true, coChanged: true }), MOCHA, true)
    const context = nodeInk(node({ coChangeOn: true, coChanged: false }), MOCHA, true)
    expect(answer.opacity).toBeGreaterThan(context.opacity)
    expect(contrast({ ...answer, opacity: answer.opacity }, MOCHA.base)).toBeGreaterThan(3)
  })
})

describe("the hotspot lens draws a ranking, not a set", () => {
  // a file in the ranking and in a cycle: the mark. `cool` is the rest of the
  // ranking, drawn behind it
  const hot = (heat: number, p = LATTE, dark = false) =>
    nodeInk(node({ hotspotsOn: true, heat, knotted: true }), p, dark)
  const cool = (heat: number, p = LATTE, dark = false) =>
    nodeInk(node({ hotspotsOn: true, heat, knotted: false }), p, dark)

  it("separates the answer from the ranking it was drawn from", () => {
    /**
     * The one distinction the map is allowed to make here, and it is allowed
     * because it is a category: this file is inside an import cycle, or it is
     * not. A category is something an identity channel can hold; a rank is not,
     * which is what killed the radius, the gradient, the halo and the shapes.
     *
     * The rest of the ranking stays drawn rather than receding to the
     * background, because every row of the panel is clickable and a row you can
     * click has to be a file you can find.
     */
    expect(contrast(hot(0.5), LATTE.base)).toBeGreaterThan(contrast(cool(0.5), LATTE.base))
    expect(contrast(cool(0.5), LATTE.base)).toBeGreaterThan(
      contrast(nodeInk(node({ hotspotsOn: true }), LATTE, false), LATTE.base),
    )
  })

  it("finds a row that was clicked, whether or not it is in a cycle", () => {
    // following the list must work on all 150 rows, not on the 36
    const picked = nodeInk(
      node({ hotspotsOn: true, heat: 0.2, knotted: false, selected: true }),
      LATTE,
      false,
    )
    expect(contrast(picked, LATTE.base)).toBeGreaterThan(contrast(cool(0.2), LATTE.base))
  })

  it("marks the whole ranking alike, because rank cannot live in a picture", () => {
    /**
     * There was a gradient here — radius, then hue and glow — and the same
     * arithmetic killed each: what a node looks like on screen is its weight
     * over its distance from the camera, 2.6x of range against 3.1x of depth,
     * so the loudest mark belongs to whatever is nearest. Fifth in the ranking
     * came out a block in the foreground while first sat behind it as a dot.
     */
    expect(hot(1)).toEqual(hot(0))
    expect(hot(1, MOCHA, true)).toEqual(hot(0.5, MOCHA, true))
    // and the quieter register is uniform in itself for the same reason
    expect(cool(1)).toEqual(cool(0))
  })

  it("keeps the last file in the ranking visible, unlike a fourth impact ring", () => {
    /**
     * `wave` lands its far end on the resting grey, which is right for a
     * dependent four hops out and wrong here: the coolest hotspot is still one
     * of the files the lens is naming. Measured against a node the lens pushed
     * away entirely.
     */
    const coolest = hot(0)
    const pushed = nodeInk(node({ hotspotsOn: true, heat: undefined }), LATTE, false)
    expect(contrast(coolest, LATTE.base)).toBeGreaterThan(contrast(pushed, LATTE.base))
  })

  it("pushes away every file the ranking did not reach", () => {
    const inside = hot(0.5)
    const outside = nodeInk(node({ hotspotsOn: true, heat: undefined }), MOCHA, true)
    expect(inside.opacity).toBeGreaterThan(outside.opacity)
  })

  it("marks the row being followed without leaving the ranking's language", () => {
    // it is one of these files, not a new subject, so it keeps the heat hue
    const followed = nodeInk(node({ hotspotsOn: true, heat: 0.5, selected: true }), MOCHA, true)
    const same = hot(0.5, MOCHA, true)
    expect(followed.color).toBe(same.color)
    expect(followed.emissiveIntensity).toBeGreaterThan(same.emissiveIntensity)
  })

  it("draws the knot and backgrounds every other import", () => {
    /**
     * This sent every import to the background, because a ranking has no use
     * for one. The lens stopped being a ranking: what it reports is the files
     * that sit inside an import cycle, so those particular imports are not
     * context — they are the whole reason the finding exists, and the map was
     * showing the members of the set while hiding what binds them.
     */
    const lit = edgeInk(mood({ lit: true, hasActive: true }), LATTE, false)
    const other = edgeInk(mood({ lit: true, hasActive: true, hotspotsOn: true }), LATTE, false)
    const knot = edgeInk(mood({ hotspotsOn: true, knotEdge: true }), LATTE, false)
    expect(contrast(other, LATTE.base)).toBeLessThan(contrast(lit, LATTE.base))
    expect(contrast(knot, LATTE.base)).toBeGreaterThan(contrast(other, LATTE.base) * 2)

    /**
     * And further back than the context of any other lens, because this one
     * also shrinks every node to a fixed few pixels. Left at the ordinary
     * dimming the imports became the heaviest ink on screen — on a graph with
     * nothing knotted, a wash of grey curves and three specks, which reads as
     * broken rather than as empty.
     */
    const elsewhere = edgeInk(mood({ impactOn: true, impacted: false }), LATTE, false)
    expect(other.opacity).toBeLessThan(elsewhere.opacity / 2)

    // and on the dark ground, where an answer emits rather than inks
    const onDark = edgeInk(mood({ hotspotsOn: true, knotEdge: true }), MOCHA, true)
    expect(contrast(onDark, MOCHA.base)).toBeGreaterThan(3)
  })

  it("still reads on the dark ground, where the answer is light and not ink", () => {
    // uniform is not quiet: the one thing the map claims has to be unmistakable
    expect(hot(1, MOCHA, true).emissiveIntensity).toBeGreaterThan(0)
    expect(contrast(hot(1, MOCHA, true), MOCHA.base)).toBeGreaterThan(3)
  })
})
