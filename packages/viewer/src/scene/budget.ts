/**
 * How many files the scene may hold at once before the frame rate suffers.
 *
 * Measured on cal.com, walking outwards from its most connected file: 200 files
 * (about 1090 draw calls) and 500 files (about 4450) are both comfortable;
 * 1000 files — 3681 imports between them, some 9360 draw calls — is not.
 *
 * Note that edges, not nodes, dominate the cost: they outnumber files roughly
 * three to one at this scale, and each is a tube plus an arrowhead.
 */
export const BUDGET = 400

/**
 * How many files a neighbourhood may hold before it stops being read.
 *
 * A separate ceiling from the one above, and much lower, because the eye gives
 * out long before the renderer does. Names are the measure: only a file lit by
 * the current selection carries one, and only as many as clear each other on
 * screen survive — about twenty-five, whatever is drawn behind them. So a view
 * of three hundred files shows twenty-five names over two hundred and seventy
 * five anonymous dots, and the dots are decoration.
 *
 * Measured across the load-bearing files of two large repositories, which are
 * the worst case since they are the best connected:
 *
 *     budget   median   under 10 files
 *        400      170             0 %
 *        150       46–69          2 %
 *         80       16–17         14 %
 *
 * 80 was the first guess and it was wrong: it would have opened one file in
 * seven onto fewer than ten nodes, which is emptier than the crowd it was meant
 * to fix. At 150 a neighbourhood is dense enough that a good share of it can be
 * named, and the collapse into near-nothing all but disappears.
 */
export const READABLE = 150
