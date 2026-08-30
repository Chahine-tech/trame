# What the map is allowed to say

A note about visual encoding in this viewer, written because it was rediscovered
the hard way five times in one evening and will be rediscovered again by whoever
adds the next lens.

## The rule

Tamara Munzner sorts visual channels into two families
([Marks and Channels](https://www.oreilly.com/library/view/visualization-analysis-and/9781466508910/K14708_C005.xhtml)):

- **magnitude channels**, which carry _how much_: position on a common scale,
  length, area, luminance, saturation, volume.
- **identity channels**, which carry _which one_: colour hue, shape, motion,
  tilt, **position on an unaligned scale**, and **depth**.

A force-directed layout is a position on an unaligned scale. The camera adds
depth. Both are identity channels.

> **The map can say _which_ and _where_. It can never say _how much_.**
> Magnitude lives in the panel, which is made of text and of bars — and a bar is
> length on a common scale, the second most effective magnitude channel there is.

This is not a stylistic preference and it is not about trying harder. In a
perspective scene, what a node measures on screen is its size divided by its
distance from the camera, so any magnitude put into a size is multiplied by an
accident of where the file happens to sit. Munzner's argument against 3D for
abstract data is exactly this: foreshortening defeats size comparison, and
unlike a chair or a person, abstract data gives the reader no remembered size to
correct against.

## What this cost, once, in detail

The hotspot lens ranks 150 files. Four ways of drawing that rank on the map were
built and measured, and all four were deleted:

| attempt                   | channel used  | Munzner's family       | how it died                                                                                                                                                  |
| ------------------------- | ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2.4 + rank × 3.4` radius | area / volume | magnitude, the weakest | 2.4x of encoding against 3.1x of depth: the last file in the list came out bigger than the first                                                             |
| peach→red gradient        | hue           | **identity**           | a rank in a channel that only holds categories; 1.27x of contrast across the whole ranking at 2px a node                                                     |
| halo on some marks        | identity      | **identity**           | gated on `isLit`, so it marked adjacency to a stale selection and read as a second tier                                                                      |
| the type geometries       | shape         | **identity**           | a component's cube carries 1.7x to 2.4x a module's ink; with depth cancelled it became the only variation left and inherited the meaning depth had just lost |

Three of the four put an ordered quantity into a channel that cannot hold one.
The fourth used the weakest magnitude channel there is and lost it to
perspective. None of this needed to be measured; it needed to be read.

## What the lenses do instead

- The map draws a **uniform mark**: one colour, one size in pixels, one shape,
  for every member of the answer. It says _this file is in the set_, which is an
  identity claim, which is what the map is good at. See `mark.ts`.
- Depth is **cancelled** for that mark rather than merely ignored — a ranked node
  scales with its distance from the camera so it holds a fixed size in pixels —
  because a channel that carries nothing must also be prevented from appearing
  to carry something. See `mark.ts` and `NodeMesh.tsx`.
- The **panel** carries the order, as rows and as bars.
- The **reading** carries the conclusion, as a computed sentence. See
  `store/reading.ts` for the rules it follows.

## Where a distinction on the map is legitimate

Two tiers are allowed when the two tiers are a **fact about the file**, not a
position in a ranking: in the set or out of it, in a cycle or not, added or
removed. Those are categories, and categories are what identity channels are
for. Rank is not a category, and no amount of care will make it one.

## Why trame is in 3D at all

Munzner's position is "no unjustified 3D", not "no 3D". Trame's depth is a
presence and identity decision — a codebase you can stand inside — and it is
paid for honestly only as long as nothing analytic is asked of the third
dimension. The moment a lens needs a magnitude, that magnitude goes in the
panel. That is the whole bargain, and it is the reason this file exists.
