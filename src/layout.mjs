// Pure layout and parsing for the 9:16 candidates and the end card
// (PORTRAIT=a|b, ENDCARD=1). Nothing here touches the disk, the browser or
// ffmpeg, so all of it runs under node:test.
//
// Units: the camera window of candidate B works in box-local CSS px of the
// recorded page (what record.mjs samples into meta.track), the layouts in
// output px of the 1080x1920 frame.

export const even = (v) => Math.max(2, Math.round(v / 2) * 2);

/**
 * Union of rects given as [x0, y0, x1, y1]; nulls are skipped. Null when
 * nothing is left.
 */
export function unionRect(rects) {
  let u = null;
  for (const r of rects) {
    if (!r) continue;
    u = u ? [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])] : [...r];
  }
  return u;
}

/**
 * The track samples that stand for one output frame: every sample within
 * `slack` seconds before `t` up to `ahead` after it, or the last one before
 * `t` when that window holds none. Why a window and not one sample: a
 * screencast frame shows the DOM of some animation frame at or shortly
 * before its timestamp, never exactly which one, so the window takes all of
 * them that could be on it.
 */
export function samplesAt(track, t, { slack = 0.012, ahead = 0.004 } = {}) {
  const hit = track.filter((s) => s.t >= t - slack && s.t <= t + ahead);
  if (hit.length) return hit;
  let last = null;
  for (const s of track) if (s.t <= t) last = s;
  return last ? [last] : track.length ? [track[0]] : [];
}

/**
 * Where candidate B's camera window stands (left edge x) on every output frame.
 *
 * The window (winW wide, inside a stage stageW wide) centres on the fighters
 * but must keep the union of both of them, weapons and effects included,
 * plus `margin` on each side inside, whenever that fits. Smooth: a critically
 * damped follow toward the centre with a top speed, so it never jitters. It
 * snaps only when the content would otherwise leave the window; to make that
 * rare, the corridor each frame is narrowed by what is coming (a move ending
 * at the right edge in 0.3 s starts the pan early enough to get there at top
 * speed). A union wider than the window is centred and counted in `wide`.
 * A sample's `w` = [x0, x1] (a word over the fight) is taken in too, but
 * only where it fits together with the fighters; frames where it does not
 * are counted in `wordCut`.
 *
 * @param {{ t: number, u: number[] | null, w?: number[] | null }[]} track samples, u = [x0, y0, x1, y1]
 * @param {{ stageW: number, winW: number, margin: number, maxSpeed: number, fps: number,
 *   times: number[], omega?: number, lookahead?: number }} o
 *   times: the instant each output frame shows (the time of the captured
 *   frame picked for it); maxSpeed in units per second
 * @returns {{ x: number[], wide: number, snaps: number, wordCut: number, need: (number[] | null)[] }}
 */
export function trackCrop(track, { stageW, winW, margin, maxSpeed, fps, times, omega = 6, lookahead = 0.6 }) {
  const maxX = Math.max(0, stageW - winW);
  const clampX = (v) => Math.min(maxX, Math.max(0, v));
  const dt = 1 / fps;
  const step = maxSpeed * dt;

  // What each frame needs to see, clipped to the stage (a body thrown past
  // the stage's edge is not on the 16:9 either).
  const need = times.map((t) => {
    const u = unionRect(samplesAt(track, t).map((s) => s.u));
    if (!u) return null;
    const x0 = Math.max(0, u[0]);
    const x1 = Math.min(stageW, u[2]);
    return x1 > x0 ? [x0, u[1], x1, u[3]] : null;
  });

  // Words over the fight (samples' w = [x0, x1]: K.O., WINS, ROUND, FIGHT)
  // are framed only when they fit together with both fighters. Fighters
  // and their weapons come first: a fighter is never cut for a word, the
  // word is cut instead (counted in wordCut).
  const words = times.map((t) => {
    const ws = samplesAt(track, t).map((s) => (s.w ? [s.w[0], 0, s.w[1], 0] : null));
    const u = unionRect(ws);
    return u && [Math.max(0, u[0]), Math.min(stageW, u[2])];
  });

  // The hard corridor: [lo, hi] for the left edge; a frame with nothing to
  // see is free. Too wide to fit: centred, lo = hi.
  let wide = 0;
  const lo = [];
  const hi = [];
  const centre = [];
  let wordCut = 0;
  const fits = (x0, x1) => clampX(x1 + margin - winW) <= clampX(x0 - margin);
  need.forEach((n, k) => {
    let u = n;
    const w = words[k];
    if (w && !u) u = [w[0], 0, w[1], 0];
    else if (w && fits(Math.min(u[0], w[0]), Math.max(u[2], w[1]))) u = [Math.min(u[0], w[0]), u[1], Math.max(u[2], w[1]), u[3]];
    else if (w) wordCut++;
    if (!u) {
      lo.push(0);
      hi.push(maxX);
      centre.push(null);
      return;
    }
    const c = (u[0] + u[2]) / 2;
    centre.push(clampX(c - winW / 2));
    const a = clampX(u[2] + margin - winW);
    const b = clampX(u[0] - margin);
    if (a <= b) {
      lo.push(a);
      hi.push(b);
    } else {
      wide++;
      const x = clampX(c - winW / 2);
      lo.push(x);
      hi.push(x);
    }
  });

  // The soft corridor: what the frames ahead will need, reachable at top speed.
  const n = need.length;
  const look = Math.round(lookahead * fps);
  const slo = lo.slice();
  const shi = hi.slice();
  for (let k = 0; k < n; k++) {
    for (let j = k + 1; j < Math.min(n, k + look + 1); j++) {
      const reach = step * (j - k);
      slo[k] = Math.max(slo[k], lo[j] - reach);
      shi[k] = Math.min(shi[k], hi[j] + reach);
    }
    if (slo[k] > shi[k]) {
      slo[k] = lo[k];
      shi[k] = hi[k];
    }
  }

  // Follow: the target is the fighters' centre (the last one seen on frames
  // with nothing), kept inside the soft corridor.
  const x = [];
  let target = centre.find((c) => c !== null) ?? maxX / 2;
  let pos = Math.min(shi[0], Math.max(slo[0], target));
  let vel = 0;
  let snaps = 0;
  for (let k = 0; k < n; k++) {
    if (centre[k] !== null) target = centre[k];
    const goal = Math.min(shi[k], Math.max(slo[k], target));
    if (k > 0) {
      vel += (-2 * omega * vel - omega * omega * (pos - goal)) * dt;
      vel = Math.max(-maxSpeed, Math.min(maxSpeed, vel));
      pos += vel * dt;
    }
    // The soft corridor moves at most top speed a frame, so being pushed by
    // it is a pan, not a snap; the spring alone can lag behind it.
    pos = Math.min(shi[k], Math.max(slo[k], pos));
    const kept = Math.min(hi[k], Math.max(lo[k], pos));
    if (k > 0 && Math.abs(kept - x[k - 1]) > step + 1e-9) snaps++;
    if (kept !== pos) vel = 0;
    pos = kept;
    x.push(pos);
  }
  return { x, wide, snaps, wordCut, need };
}

/**
 * Holds rects (x0, y0, x1, y1, or null) over time: entry i becomes the union
 * of every rect within `hold` seconds of times[i]. Times ascending. Why: a
 * word over the fight is drawn in steps, on and off; held, it is one steady
 * span the camera can pan toward ahead of time.
 */
export function holdSpans(times, rects, hold) {
  const out = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[lo] < times[i] - hold) lo++;
    while (hi < times.length && times[hi] <= times[i] + hold) hi++;
    out.push(unionRect(rects.slice(lo, hi)));
  }
  return out;
}

/**
 * Runs of equal values over output frames, for drawbox/overlay `enable`
 * ranges: [{ from, to, v }] with inclusive frame indexes.
 */
export function runs(values) {
  const out = [];
  values.forEach((v, k) => {
    const last = out[out.length - 1];
    if (last && last.v === v) last.to = k;
    else out.push({ from: k, to: k, v });
  });
  return out;
}

/**
 * Vertical stack centred in the frame: blocks of the given heights with the
 * given gaps between them. Returns the top y of every block, all even.
 */
export function stackLayout(heights, gaps, { H = 1920 } = {}) {
  const total = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  let y = Math.round((H - total) / 4) * 2;
  return heights.map((h, i) => {
    const top = y;
    y += h + (gaps[i] ?? 0);
    return top;
  });
}

/** Share of the frame's height the stage takes, 0..1. */
export const stageShare = (stageH, H = 1920) => stageH / H;

/**
 * Parses the end card's decided line, e.g. "DECIDED ON PROOF · 6.7 VS 3.0".
 * The values stay strings exactly as the page wrote them (the video shows the
 * sealed numbers, never recomputed ones). Null if the line does not read.
 */
export function parseDecided(text) {
  const m = /^\s*DECIDED ON\s+(.+?)\s*·\s*(\S+)\s+VS\s+(\S+)\s*$/i.exec(String(text ?? "").replace(/\s+/g, " "));
  if (!m) return null;
  return { rubric: m[1], first: m[2], second: m[3] };
}

/**
 * The end card's content from what record.mjs read off the page (raw), or
 * null when something it needs is missing. Columns keep the page's order
 * (left = fighter A); `decided.winner` / `.loser` are the decided line's two
 * values, winner first as the page writes it — confirmed against the
 * decided rubric row when the page had one.
 *
 * @param {{ cols: { name: string, total: string, win: boolean }[], tiers: string[], cards: string | null,
 *   decided: string | null, decidedWin: string | null }} raw
 */
export function endCardModel(raw) {
  if (!raw || !Array.isArray(raw.cols) || raw.cols.length !== 2) return null;
  const cols = raw.cols.map((c) => ({ name: String(c.name ?? "").trim(), total: String(c.total ?? "").trim(), win: !!c.win }));
  if (cols.some((c) => !c.name || !c.total)) return null;
  const winner = cols.find((c) => c.win);
  const loser = cols.find((c) => !c.win);
  if (!winner || !loser) return null;
  const d = parseDecided(raw.decided);
  let decided = null;
  if (d) {
    // The page writes the winner's value first; the rubric row's green
    // value says for sure when it is there.
    const swap = raw.decidedWin != null && raw.decidedWin === d.second && d.first !== d.second;
    decided = { rubric: d.rubric, winner: swap ? d.second : d.first, loser: swap ? d.first : d.second };
  }
  const tiers = (raw.tiers ?? []).map((t) => String(t).trim()).filter(Boolean);
  return { cols, winner, loser, tier: tiers.length ? tiers.join(" · ") : null, cards: raw.cards?.trim() || null, decided };
}

/**
 * Font size for one line of Press Start 2P (glyphs as wide as the size) that
 * fits `room` px, between min and max; null below min.
 */
export function fitPixel(text, room, max, min) {
  const size = Math.min(max, Math.floor(room / Math.max(1, String(text).length)));
  return size >= min ? size : null;
}

/**
 * The end card's tier as the stage says it: KO and TKO are written as the
 * stage's words (K.O., T.K.O.), every other tier verbatim. Display only:
 * the model keeps the page's strings.
 */
export function tierLabel(tier) {
  if (!tier) return tier;
  const word = { KO: "K.O.", TKO: "T.K.O." };
  return tier
    .split(" · ")
    .map((t) => word[t.trim().toUpperCase()] ?? t)
    .join(" · ");
}

/**
 * The decided rubric's two values in the end card's column order (left
 * column first, like the totals above them), each marked with whether it is
 * the winner's. Values verbatim from the model; null without a decided line.
 *
 * @param {ReturnType<typeof endCardModel>} m
 * @returns {{ value: string, win: boolean }[] | null}
 */
export function decidedInColumns(m) {
  if (!m?.decided) return null;
  return m.cols.map((c) => ({ value: c.win ? m.decided.winner : m.decided.loser, win: c.win }));
}

/**
 * A CSS colour as the page computed it ("rgb(181, 110, 74)",
 * "rgba(255, 255, 255, 0.07)", "#b56e4a") to an opaque #rrggbb, a
 * translucent one laid over `over` (#rrggbb) the way the page lays it over
 * what is behind. Null when it does not read or is fully transparent.
 */
export function solidColor(css, over = "#000000") {
  const s = String(css ?? "").trim().toLowerCase();
  let rgba = null;
  const hex = /^#([0-9a-f]{6})$/.exec(s);
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (hex) rgba = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  else if (fn) {
    const a = fn[4] == null ? 1 : fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    rgba = [Number(fn[1]), Number(fn[2]), Number(fn[3]), a];
  }
  if (!rgba || rgba.slice(0, 3).some((v) => !Number.isFinite(v)) || !(rgba[3] > 0)) return null;
  const base = /^#([0-9a-f]{6})$/.exec(over) ? [0, 2, 4].map((i) => parseInt(over.slice(1 + i, 3 + i), 16)) : [0, 0, 0];
  const a = Math.min(1, rgba[3]);
  return "#" + [0, 1, 2].map((i) => Math.round(rgba[i] * a + base[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
}
