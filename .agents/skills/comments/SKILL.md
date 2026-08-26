---
name: comments
description: Decide what a code comment is allowed to say, and audit existing ones. Three cases earn a comment (a measurement, an abandoned approach, an external constraint); everything else is cut. Use when writing a non-trivial comment, when reviewing a diff full of them, or when a codebase reads as machine-written. Ships a measurement pass so the verdict is a number, not an impression.
---

# Comments

Written after an audit of this repository found **22 371 words** of comments in
the source: a ninety-page book inside the code, most of it machine-written by
the same assistant now reading this. The cull removed 3 124 words and 297 em
dashes without touching a line of code. This skill is what was learned.

## The rule

A comment earns its place if it does one of three things, and nothing else:

1. **It carries a measurement** that cannot be recovered by reading the code.
2. **It names an approach that was tried and abandoned**, with the reason, so
   nobody tries it again.
3. **It explains a constraint from outside** the file: a library's behaviour, a
   framework convention, a platform quirk.

Everything else is cut. Tone, analogy, moral, and the story told for its own
sake.

The strongest single test: **does the block contain a number?** In the audit,
68% of blocks five lines or longer had none, and that is where nearly all the
slop lived.

```
                 with a measurement   pure prose
before                      62            134
```

## The four shapes of slop

Each of these is real, from this repository, written by an assistant.

**The aphorism.** Opening a block with a slogan.

> *"The hero proves the graph is alive. It does not teach."*
> *"Scroll is a clock, not a hijack."* *"Paper does not emit."*

Sounds earned. Teaches nothing. Delete the sentence and the block loses no
information.

**The rhetorical reversal.** `not X, it was Y`, `worse than`, `rather than`.

> *"The marker was not discreet, it was absent."*
> *"A false orphan is worse than a missed one."*

A writing tic, repeated 69 times in one codebase. Say the fact once.

**The extended metaphor.** A paragraph of analogy standing in for a mechanism.

> A greedy non-overlap algorithm explained through a road map: *"the capital is
> named, the village beside it waits until you are closer"*.

The fact that mattered — 114 folders, `i18n/ 1 file` printed through
`trpc/ 398 files` — was one line under the metaphor.

**The manifesto.** Product reasoning in a source file.

> *"That is the whole argument of the page: you are not reading about the tool,
> you are watching it work."*

True, and it belongs in the README. This is the shape that made the landing
package 2.5× denser in comments than the parser.

## Tells you can grep for

The em dash is the loudest. Ordinary prose runs 1–2 per thousand words; the
audit found **13**, seven to ten times over. It carries the permanent
parenthetical incise that gives machine writing its grain.

```
tiret cadratin  300     one every 75 words
rather than      69     one every 324 words
which is …       26
```

Killing the em dash usually costs nothing, because it is punctuation rather
than content. Replace it with `:` when what follows explains, `,` when it
qualifies, or a full stop when it is a second thought.

## What is never touched

**Product copy.** UI labels, CLI help text, error messages, marketing prose,
anything rendered to a person. An em dash there is normal typography. In the
audit ~20 survived in `packages/parser`, all inside template literals, and they
were left alone deliberately.

Before editing a line containing a tell, check whether it is inside a string.

## Auditing a codebase

Do not trust an impression. Measure first, three ways:

```bash
# 1. comment-to-code ratio per package, and the worst files by ratio
# 2. tic counts: em dashes, "rather than", "which is"
# 3. blocks of 5+ lines split by whether they contain a digit
```

Write these as throwaway scripts in a scratch directory. What matters is the
shape of the answer:

- **Ratio per package** finds where the problem is. The audit found 0.24 /
  0.29 / 0.61 across three packages, and the 0.61 was the one the user had
  already suspected without counting.
- **Percent pure prose** finds what to cut inside a file.
- **Tic counts** give a before/after that is not a matter of taste.

Then work biggest-file-first: comment mass is concentrated, and two files
usually hold a quarter of it.

## Expected results

Uneven, and the unevenness is the point:

```
              words            em dashes
landing    3213 → 1736 (−46%)   47 → 1
viewer    13341 → 12284 (−8%)  185 → 0
parser     5817 → 5227 (−10%)   68 → 2
```

A package whose comments explain *code* loses a tenth. A package whose comments
explain *product decisions* loses half. If every package loses the same
fraction, the cut was mechanical and probably wrong.

## Two failure modes while cutting

**Cutting a measurement.** The tables and numbers are the whole value: 400/150/80
with medians, `3451 → 588 → 216`, 25 800 draw calls, `2.06:1` against a 3:1
floor. None can be recovered without redoing the experiment. When in doubt,
keep the number and cut the sentence around it.

**Breaking a sentence with a scripted replace.** A bulk substitution left
`… stayed on screen. on paper that gap was 1.9x`. Re-read every block you touch.

The same pass also found conversational French quoted from a chat transcript
inside a test comment. Comments absorb whatever was in the room when they were
written; that is exactly what makes them read as machine-made.

## After the cut

Run typecheck and the full test suite. Nothing should move: a comment pass that
changes behaviour changed code by accident.
