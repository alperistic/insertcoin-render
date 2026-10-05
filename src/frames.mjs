// Pure timing: which captured frame stands in for each frame of the output.
//
// The CDP screencast sends a frame only when the picture changes, each with
// the browser's own timestamp, so the captured stream has no fixed rate. The
// output does (30 fps): output frame k shows the last captured frame at or
// before T0 + k / fps. Before the first captured frame there is nothing to
// show, so a window that starts earlier starts on the first frame.

/**
 * @param {{ t: number }[]} frames captured frames, timestamps in seconds, ascending
 * @param {{ start: number, last: number, hold: number, fps: number }} w
 *   start: first instant to show; last: last captured instant to use (the
 *   frame showing then is held); hold: seconds to keep showing it after `last`
 * @returns {number[]} index into `frames` for every output frame
 */
export function frameSequence(frames, { start, last, hold, fps }) {
  if (!frames.length) return [];
  if (!(last > start)) throw new Error(`empty window: start ${start}, last ${last}`);
  const usable = frames.filter((f) => f.t <= last);
  const count = Math.round((last - start + hold) * fps);
  const picks = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const T = Math.min(start + k / fps, last);
    while (j + 1 < usable.length && usable[j + 1].t <= T) j++;
    picks.push(frames.indexOf(usable[j]));
  }
  return picks;
}

/** Largest gap between consecutive captured frames inside the window, in seconds. */
export function maxGap(frames, start, last) {
  const ts = frames.map((f) => f.t).filter((t) => t >= start && t <= last);
  let gap = 0;
  for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i] - ts[i - 1]);
  return gap;
}

/**
 * Title lines for the 9:16 frame: one line "A vs B" when it fits at a
 * readable size, otherwise one name per line with "vs" between. Sizes are for
 * Press Start 2P, whose glyphs are as wide as the font size.
 */
export function titleLayout(a, b, { width = 1080, margin = 60, max = 48, min = 28 } = {}) {
  const room = width - 2 * margin;
  const one = `${a} vs ${b}`;
  const fit = (text) => Math.floor(room / Math.max(1, text.length));
  const oneSize = Math.min(max, fit(one));
  if (oneSize >= min) return { size: oneSize, lines: [one] };
  const longest = Math.max(a.length, b.length, 2);
  const size = Math.max(16, Math.min(max, Math.floor(room / longest)));
  return { size, lines: [a, "vs", b] };
}
