/**
 * How many files the detail view may hold at once.
 *
 * Measured on cal.com, walking outwards from its most connected file: 200 files
 * (about 1090 draw calls) and 500 files (about 4450) are both comfortable;
 * 1000 files — 3681 imports between them, some 9360 draw calls — is neither
 * smooth nor legible. Two separate ceilings happen to sit close together, and
 * the lower one is the eye's: even rendered perfectly, a thousand files at once
 * says nothing. The budget is set below both.
 *
 * Note that edges, not nodes, dominate the cost — they outnumber files roughly
 * three to one at this scale, and each is a tube plus an arrowhead.
 */
export const BUDGET = 400
