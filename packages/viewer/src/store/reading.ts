import type { GraphData, Hotspot } from "../types"
import type { WhatIfReport } from "./whatif"

/**
 * What a lens found, in sentences.
 *
 * Every lens in this viewer stopped at colour and a count: "150 files", "955
 * dependents". Those are facts, and a fact is not an understanding — a reader
 * looking at a hundred and fifty red marks has been handed the data and left to
 * draw the conclusion. The thing that actually taught anybody something tonight
 * was `doctor`, which says "remove the import of X from Y — verified to free
 * 104 of them", and it does it in prose.
 *
 * So a reading is computed, never written in advance. Nothing here is a legend
 * or a definition; every clause carries a number that came out of this graph,
 * and a claim that cannot be checked is not made. That constraint is the whole
 * design: it is what stops these turning into marketing.
 *
 * Four rules, taken from people who have written diagnostics for a living — the
 * C# compiler team's criteria and the rustc guide:
 *
 *  - **Precise, not editorial.** "23 of its 65 files are in the ranking" is a
 *    fact; "rewritten constantly" is an opinion wearing one.
 *  - **Each sentence stands alone.** It may be read without the one before it.
 *  - **The domain's words, not ours.** "Pressure" is a metaphor we invented and
 *    nobody else holds; files, folders, changes and dependants are not.
 *  - **Diagnostic, never prescriptive.** Describe what is, not what to do. The
 *    argument against prescribing is the strong one: a fix that is right nine
 *    times in ten tells the tenth reader how to write something that compiles
 *    and is wrong. `doctor` is allowed to prescribe — "remove this import,
 *    verified to free 104 of them" — because it removed it and recounted. A
 *    reading has simulated nothing, so it says nothing about what to do.
 */

/** How the folder tree is cut for "where", deep enough to name, shallow enough to hold. */
const folderOf = (id: string): string => {
  const parts = id.split("/")
  return parts.length > 2 ? parts.slice(0, 2).join("/") : (parts[0] ?? id)
}

const pct = (part: number, whole: number): number => Math.round((part / whole) * 100)

/** A folder, what it holds, and how much of it is in the ranking. */
export interface Densest {
  name: string
  /** every file of the folder, so the ratio the sentence states can be seen */
  ids: string[]
  hot: string[]
}

/**
 * The folder the reading names, as a set the map can go to.
 *
 * Shared rather than recomputed, so the sentence and the camera cannot drift:
 * the panel says "lib/zod — 23 of its 65 files" and the view is standing on
 * those sixty-five. By share and not by count, for the reason the sentence
 * gives — a sixth of a large folder is not the finding a third of a small one
 * is.
 *
 * Framing this instead of the whole ranking is the difference between a legible
 * answer and a dust cloud: measured on dub, all 150 hotspots framed come to
 * 1.8px a node, and lib/zod's 23 to 5.7px.
 */
export function densestFolder(data: GraphData): Densest | null {
  const ranked = data.hotspots ?? []
  if (ranked.length === 0) return null
  const inRanking = new Set(ranked.map((h) => h.id))
  const held = new Map<string, string[]>()
  for (const node of data.nodes) {
    const key = folderOf(node.id)
    held.set(key, [...(held.get(key) ?? []), node.id])
  }
  let best: Densest | null = null
  let bestShare = 0
  for (const [name, ids] of held) {
    if (ids.length < 12) continue
    const hot = ids.filter((id) => inRanking.has(id))
    if (hot.length === 0) continue
    const share = hot.length / ids.length
    if (share > bestShare) {
      bestShare = share
      best = { name, ids, hot }
    }
  }
  return best
}

/**
 * The knot: the files in the ranking that no one can change on their own, and
 * the imports that tie them.
 *
 * A ranking of churn is not a finding. A cut at the ninetieth percentile of two
 * distributions returns about a tenth of the files by construction, so "150 of
 * 3562" is a property of the cut and says nothing about the repository — which
 * is why the lens felt like a leaderboard however it was drawn.
 *
 * It is also the thing that has already been tried at scale and failed. Google
 * deployed churn-based prediction across its codebase and measured no change in
 * developer behaviour; the system was withdrawn. The authors' diagnosis was not
 * that the predictions were wrong, it was that they were not actionable, and
 * they set three requirements: the output must name an action, the reason a file
 * was flagged must be visible so the reader can rule out a false positive, and
 * it should bias towards what is a problem now.
 *
 * Churn and fan-in are what every history tool has. What trame has and they do
 * not is the import graph, so the question worth asking is the one only this
 * data can answer: which of the pressured files are structurally trapped. A file
 * inside an import cycle cannot be changed on its own, and that is an action —
 * break the cycle — with a reason that can be shown, which is the cycle itself.
 *
 * Measured on dub: 36 of the 150, the first six of the ranking among them, and
 * 21 of the 36 in one folder.
 */
export interface Knot {
  /** the ranked files that sit inside an import cycle */
  files: Set<string>
  /**
   * Every import running between two members of one of those cycles.
   *
   * This is what the map draws, and it is drawn rather than inferred. The
   * parser's cycles are Tarjan components — sets of nodes, not walks — so
   * joining the array up in order would invent edges the codebase does not
   * have. The induced subgraph invents nothing: every line is an import
   * somebody wrote, and together they are the answer to "why can none of these
   * be changed on its own".
   *
   * Measured on dub: 325 imports run inside a component and 273 of them inside
   * one holding a hotspot, out of 13 014 in the graph. Two per cent, and 198 of
   * the 273 belong to the one component that holds 61 files and 25 of the
   * ranking.
   */
  edges: Set<string>
  /**
   * The full membership of each component the ranking reaches, including the
   * files in them that are not under pressure.
   *
   * The lens settles each of these on its own, so it needs the whole component
   * and not just the ranked part: a cluster laid out from a quarter of its
   * members is a different cluster.
   */
  components: string[][]
}

export function knotOf(data: GraphData): Knot {
  const empty: Knot = { files: new Set(), edges: new Set(), components: [] }
  const ranked = data.hotspots
  const cycles = data.analysis?.cycles
  if (!ranked?.length || !cycles?.length) return empty

  const component = new Map<string, number>()
  cycles.forEach((cycle, i) => {
    for (const id of cycle) component.set(id, i)
  })
  const files = new Set(ranked.filter((h) => component.has(h.id)).map((h) => h.id))
  if (files.size === 0) return empty

  // only the components the ranking actually reaches: a cycle among files
  // nobody is rewriting is a fact about the codebase and not this lens's finding
  const live = new Set([...files].map((id) => component.get(id)!))
  const edges = new Set<string>()
  for (const e of data.edges) {
    const at = component.get(e.source)
    if (at !== undefined && at === component.get(e.target) && live.has(at)) edges.add(e.id)
  }
  return { files, edges, components: cycles.filter((_, i) => live.has(i)) }
}

/**
 * Pressure, read off the ranking.
 *
 * The knot leads, because it is the only part of this that is a finding rather
 * than a percentile — see `knottedHotspots`. Everything after it describes the
 * ranking it was drawn from, and every claim is dropped when the graph does not
 * support it: on a repository with no cycles the lens falls back to what it said
 * before, which is a shape, and says so honestly.
 */
export function hotspotReading(data: GraphData): string[] {
  const ranked: Hotspot[] = data.hotspots ?? []
  if (ranked.length === 0) return []

  const held = new Map<string, { hot: number; total: number }>()
  for (const node of data.nodes) {
    const key = folderOf(node.id)
    const e = held.get(key) ?? { hot: 0, total: 0 }
    e.total += 1
    held.set(key, e)
  }
  for (const h of ranked) {
    const e = held.get(folderOf(h.id))
    if (e) e.hot += 1
  }

  const out: string[] = []

  /**
   * The knot, and how far up the ranking it reaches.
   *
   * The second clause is the one that turns a count into a finding. Six files
   * that all sit in a cycle is unremarkable among 3562; six files that are *the
   * top six of the ranking* is a statement about how this codebase is built. It
   * is the longest run from the top, so it cannot be gerrymandered: one clean
   * file at rank two ends it at one.
   */
  const knotted = knotOf(data).files
  let namedAPlace = false
  if (knotted.size > 0) {
    let run = 0
    while (run < ranked.length && knotted.has(ranked[run]!.id)) run += 1
    const reach =
      run >= 3
        ? ` The first ${run} of the ranking are all in one.`
        : run === 0
          ? ""
          : ` The file at the top of the ranking is in one.`
    out.push(
      `${knotted.size} of the ${ranked.length} sit inside an import cycle: they change constantly, and none of them can be changed on its own.${reach}`,
    )
    /**
     * Where the knot is, when it is somewhere.
     *
     * Reported only when one folder holds more than half of it: a knot spread
     * evenly over eleven folders is a fact about the repository and not a place
     * anyone can go and stand in. A knot held entirely by one folder is the
     * strongest version of this sentence, not the weakest, so it gets its own
     * wording rather than "10 of those 10".
     */
    const where = new Map<string, number>()
    for (const id of knotted) where.set(folderOf(id), (where.get(folderOf(id)) ?? 0) + 1)
    const worst = [...where.entries()].sort((a, b) => b[1] - a[1])[0]
    if (worst && worst[1] * 2 > knotted.size) {
      out.push(
        worst[1] === knotted.size
          ? `Every one of them is in ${worst[0]}.`
          : `${worst[1]} of those ${knotted.size} are in ${worst[0]}.`,
      )
      namedAPlace = true
    }

    /**
     * Whether the knot is a problem now or a problem that was.
     *
     * The third of the three things Google's study said a prediction has to do,
     * and the one this lens still failed after the cycle answered the other two:
     * a year of history weighed every commit the same, so a file rewritten
     * eleven months ago and quiet since sat beside one being rewritten this
     * week. The parser now reports both counts.
     *
     * Said in whichever direction is the finding. All of them still moving is a
     * live knot; some of them gone quiet says which part of it has settled, and
     * a knot nobody has touched in a quarter is a knot that is not costing
     * anything today, which is worth knowing before anyone unpicks it.
     */
    const dated = ranked.filter((h) => knotted.has(h.id) && h.recent !== undefined)
    if (dated.length === knotted.size && knotted.size > 0) {
      const moving = dated.filter((h) => (h.recent ?? 0) > 0).length
      if (moving === 0) {
        out.push(`None of them has been touched in the last quarter.`)
      } else if (moving === knotted.size) {
        out.push(`All ${knotted.size} were changed again in the last quarter.`)
      } else {
        out.push(`${moving} of them were changed again in the last quarter.`)
      }
    }
  }

  /**
   * A negative finding, and a real one: it says the rules and the pressure are
   * in different parts of the codebase, so the violation list is not where to
   * look for what is expensive. Stated only when there are rules to break —
   * "none of them breaks a rule" is not a finding about a graph with no rules.
   */
  if ((data.violations?.length ?? 0) > 0) {
    const accused = new Set(
      (data.violations ?? []).map((v) => v.subject).filter((s): s is string => Boolean(s)),
    )
    if (!ranked.some((h) => accused.has(h.id))) {
      out.push(
        `None of the ${ranked.length} breaks a rule: the ${data.violations!.length} violations are somewhere else entirely.`,
      )
    }
  }

  /**
   * The shape of the ranking: where it piles up, and which folder holds the
   * largest share of it.
   *
   * These two led the panel before the knot existed and they are still true,
   * but they describe a percentile rather than report a finding, and the knot
   * has usually already named the same folder. So they stand down when it has —
   * a panel that says "21 of the 36 are in lib/zod" and then "lib/zod is the
   * densest" has spent two sentences on one fact. On a repository with no
   * cycles nothing stands them down, and the lens says what it used to.
   */
  const byCount = namedAPlace
    ? []
    : [...held.entries()].filter(([, v]) => v.hot > 0).sort((a, b) => b[1].hot - a[1].hot)

  /**
   * How few places hold half of it — a count the graph decides, not a threshold.
   *
   * Fixing the head at three and testing its share got this wrong twice in a
   * row: six folders holding five hotspots each put 50% in the top three, which
   * is exactly what perfectly even looks like, and a ratio against the even
   * share then rejected a genuinely heaped case at 89%. Asking instead how many
   * folders it takes to reach half is self-adjusting, and it is a sentence
   * rather than a statistic — the claim only survives when those folders are a
   * small minority of the ones carrying any pressure at all.
   */
  let carried = 0
  let few = 0
  for (const [, v] of byCount) {
    carried += v.hot
    few += 1
    if (carried * 2 >= ranked.length) break
  }
  if (byCount.length > 4 && few / byCount.length <= 0.34) {
    out.push(
      `${ranked.length} files are in the ranking, and half of them sit in ${few} of the ${byCount.length} folders that hold any.`,
    )
  }

  // the same folder the map goes to, from the same function, so the sentence
  // and the camera cannot come to disagree
  const densest = namedAPlace ? null : densestFolder(data)
  if (densest) {
    out.push(
      `${densest.name} is the densest: ${densest.hot.length} of its ${densest.ids.length} files are in the ranking, ${pct(densest.hot.length, densest.ids.length)}% of the folder.`,
    )
  }

  /**
   * The singular file, and only when it really is one. `lib/types.ts` tops dub's
   * ranking with 776 dependants, but `lib/prisma/index.ts` carries 858 and was
   * touched once all year — so "the most depended-on file in the repository"
   * would have been false. The check is what keeps the sentence honest.
   */
  const first = ranked[0]
  if (first) {
    const degrees = new Map<string, number>()
    for (const e of data.edges) {
      degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1)
      degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1)
    }
    /**
     * Strictly heaviest, ties included as failures. "Nothing else is heavier"
     * over a tie is true and misleading at once, and a lens that misleads once
     * is never read again.
     */
    const mine = degrees.get(first.id) ?? 0
    const alone = [...degrees.entries()].every(([id, d]) => id === first.id || d < mine)
    const mostChanged = ranked.every((h) => h.churn <= first.churn)
    if (mostChanged && alone) {
      out.push(
        `${first.id} changed ${first.churn} times and ${first.degree} files rest on it — no file in this graph carries more.`,
      )
    } else if (mostChanged) {
      out.push(
        `${first.id} tops the ranking: ${first.churn} changes, ${first.degree} files resting on it.`,
      )
    }
  }
  return out
}

/**
 * A simulated deletion, read off its own report.
 *
 * This lens is the one that already spoke in something close to a sentence, so
 * the work here is to say what the numbers mean rather than to find them. It is
 * also the only reading allowed near a recommendation, and it still does not
 * make one: "nothing imports it" is a fact, "you can delete it" is a guess about
 * dynamic imports, test harnesses and build scripts that this graph cannot see.
 */
export function whatIfReading(r: WhatIfReport, total: number): string[] {
  const out: string[] = []
  if (r.broken.length === 0 && r.orphaned.length === 0) {
    out.push(
      `Nothing in this graph imports ${r.label}: removing it would leave every other file compiling.`,
    )
  } else {
    const parts = [
      r.broken.length > 0 &&
        `${r.broken.length} file${r.broken.length === 1 ? "" : "s"} import it directly`,
      r.orphaned.length > 0 &&
        `${r.orphaned.length} more would be left with nothing importing them`,
    ].filter(Boolean)
    out.push(
      `Removing ${r.label} reaches ${pct(r.broken.length + r.orphaned.length, total)}% of the repository: ${parts.join(", and ")}.`,
    )
  }
  if (r.cyclesResolved > 0) {
    // the finding nobody looks for: a file that is expensive to remove and is
    // also what keeps a knot tied
    out.push(
      `It also closes ${r.cyclesResolved} cycle${r.cyclesResolved === 1 ? "" : "s"} — this file is part of what keeps them tied.`,
    )
  }
  const fewer = r.violationsBefore - r.violationsAfter
  if (fewer > 0)
    out.push(`Rule violations would fall from ${r.violationsBefore} to ${r.violationsAfter}.`)
  return out
}

/**
 * How far a change travels, and where it lands.
 *
 * The count alone — "955 dependents" — is the number this lens has always
 * shown, and it means nothing without the size of the thing it is a share of.
 * The second sentence is the one worth having: a wave that stops after one hop
 * is a different proposition from one that keeps going, and the depths are
 * already computed.
 */
export function impactReading(
  depth: Map<string, number>,
  label: string,
  data: GraphData,
): string[] {
  const reached = depth.size - 1
  if (reached <= 0) return []
  const out = [
    `${reached} file${reached === 1 ? "" : "s"} would feel a change to ${label} — ${pct(reached, data.nodes.length)}% of the repository.`,
  ]
  const direct = [...depth.values()].filter((d) => d === 1).length
  const far = Math.max(...depth.values())
  if (far > 1) {
    out.push(
      `${direct} import it directly; the rest arrive through ${far - 1} more hop${far === 2 ? "" : "s"}.`,
    )
  }
  return out
}

/**
 * Coupling the imports do not explain.
 *
 * The pair counts are the whole claim and they were never shown: the lens drew
 * lines and left the reader to assume they were strong. "38 of the 47 commits
 * that touched either one" is the sentence that makes the line worth drawing.
 */
export function coChangeReading(of: string, label: string, data: GraphData): string[] {
  const pairs = (data.coChange ?? []).filter((c) => c.a === of || c.b === of)
  if (pairs.length === 0) return []
  const strongest = [...pairs].sort((a, b) => b.jaccard - a.jaccard || b.together - a.together)[0]!
  const other = strongest.a === of ? strongest.b : strongest.a
  const name = data.nodes.find((n) => n.id === other)?.label ?? other
  const out = [
    `${label} keeps changing with ${pairs.length} file${pairs.length === 1 ? "" : "s"} that no import connects it to.`,
  ]
  // jaccard is together / (touched either), so the denominator is recoverable
  const either = Math.round(strongest.together / strongest.jaccard)
  out.push(
    `The strongest is ${name}: they moved together in ${strongest.together} of the ${either} commits that touched either one.`,
  )
  return out
}

/**
 * The route between two files, and what it has to pass through.
 *
 * A path is the one answer here that is naturally spatial, so the sentence does
 * not describe the shape — it names the file in the middle, which is the part
 * you cannot see by looking.
 */
export function pathReading(
  nodes: string[],
  data: GraphData,
  degree: Map<string, number>,
): string[] {
  if (nodes.length < 2) return []
  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id
  const hops = nodes.length - 1
  const out = [
    `${label(nodes[0]!)} reaches ${label(nodes[nodes.length - 1]!)} in ${hops} hop${hops === 1 ? "" : "s"}.`,
  ]
  const middle = nodes.slice(1, -1)
  if (middle.length > 0) {
    const busiest = middle.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0]!
    const d = degree.get(busiest) ?? 0
    // a chokepoint is the interesting half of a route: everything crossing here
    // is what makes the two ends harder to separate than they look
    out.push(`It passes through ${label(busiest)}, which ${d} files are joined to.`)
  }
  return out
}
