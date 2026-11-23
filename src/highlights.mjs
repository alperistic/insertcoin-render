// The short cut: a finished 9x16.mp4 down to its hits, the finisher, the
// result and the end card, about 11 s instead of 40. A feed viewer is gone
// after ~4.5 s (Shorts, 23.11.2026: 0.7 h watched over 561 views), so the
// short cut opens inside the fight and spends at most 3.2 s after the K.O.
//
//   node src/highlights.mjs out/<slug>            # → out/<slug>/9x16-short.mp4
//   node src/highlights.mjs out/<slug> --plan     # print the segments, cut nothing
//
// It reads the cues the stage sent while it was recorded (rec-page/meta.json,
// else rec/meta.json) and cuts on them, so it needs no second recording.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Seconds around a cue. Measured on v0 vs Claude Code (23.11.2026). */
const CUT = {
  /** a cue lands this much later in the video than (cue.t - tVs) says */
  lag: 0.1,
  big: { before: 0.7, after: 0.7 },
  combo: { before: 0.3, after: 0.5, gap: 0.3, min: 1.2 },
  /** the wind-up before the finisher, and the K.O. word after the ending cue */
  finisher: { before: 2.6, after: 0.8 },
  /** the WINS banner, counted back from the end card: its start after the
   *  ending cue depends on the tier (K.O. +1.8 s, K.O. PERFECT +3.1 s) */
  wins: { beforeCard: 1.4, length: 1.2 },
  /** the end card: its fade and two seconds of it, out of the 2.5 s it holds */
  endcard: { fromEnd: 2.7, length: 2.0 },
  /** hits this close to the finisher belong to it */
  keepClear: 3.0,
  fade: 0.035,
};

/**
 * @param {{ tVs: number, cues: { kind: string, t: number, weight?: string }[] }} meta
 * @param {number} seconds the video's length
 * @returns {{ from: number, to: number, what: string }[]} in playing order
 */
export function planHighlights(meta, seconds) {
  const at = (c) => c.t - meta.tVs + CUT.lag;
  const cues = [...(meta.cues ?? [])].sort((a, b) => a.t - b.t);
  const ending = cues.find((c) => c.kind === "ending");
  if (!ending) throw new Error("no ending cue in meta.json: this recording cannot be cut short");
  const tEnd = at(ending);
  const finisher = cues.findLast((c) => c.kind === "finisher" && c.t <= ending.t);
  const tFin = finisher ? at(finisher) : tEnd - 0.4;
  const limit = tFin - CUT.keepClear;

  const hits = cues.filter((c) => c.kind === "hit" && at(c) < limit);
  /** @type {{ from: number, to: number, what: string, rank: number }[]} */
  const picks = [];
  for (const h of hits.filter((c) => c.weight === "big")) {
    picks.push({ from: at(h) - CUT.big.before, to: at(h) + CUT.big.after, what: "big hit", rank: 2 });
  }
  let run = [];
  const flush = () => {
    // A fight with few big hits still needs three moments: shorter runs fill in.
    if (run.length && !run.some((c) => c.weight === "big")) {
      const from = at(run[0]) - CUT.combo.before - (run.length < 3 ? 0.3 : 0);
      const to = Math.max(at(run.at(-1)) + CUT.combo.after, from + CUT.combo.min);
      picks.push({ from, to, what: run.length > 1 ? `${run.length}-hit combo` : "hit", rank: run.length >= 3 ? 1 : run.length / 10 });
    }
    run = [];
  };
  for (const h of hits) {
    if (run.length && h.t - run.at(-1).t > CUT.combo.gap) flush();
    run.push(h);
  }
  flush();

  // Three moments at most, the big hits first, none overlapping another.
  const chosen = [];
  for (const p of picks.sort((a, b) => b.rank - a.rank || a.from - b.from)) {
    if (chosen.length === 3) break;
    if (chosen.some((c) => p.from < c.to + 0.2 && c.from < p.to + 0.2)) continue;
    chosen.push(p);
  }
  chosen.sort((a, b) => a.from - b.from);

  const plan = chosen.map(({ from, to, what }) => ({ from: Math.max(0, from), to, what }));
  plan.push({ from: tFin - CUT.finisher.before, to: tEnd + CUT.finisher.after, what: "finisher and K.O." });
  const cardFrom = seconds - CUT.endcard.fromEnd;
  const winsFrom = cardFrom - CUT.wins.beforeCard;
  if (winsFrom >= tEnd + CUT.finisher.after) plan.push({ from: winsFrom, to: winsFrom + CUT.wins.length, what: "WINS" });
  plan.push({ from: cardFrom, to: cardFrom + CUT.endcard.length, what: "end card" });
  return plan.map((s) => ({ ...s, from: +s.from.toFixed(3), to: +s.to.toFixed(3) }));
}

export function cutHighlights(file, plan, out, { overlay = null } = {}) {
  const f = CUT.fade;
  const parts = plan.map(
    (s, i) =>
      `[0:v]trim=${s.from}:${s.to},setpts=PTS-STARTPTS[v${i}];` +
      `[0:a]atrim=${s.from}:${s.to},asetpts=PTS-STARTPTS,afade=t=in:d=${f},afade=t=out:st=${(s.to - s.from - f).toFixed(3)}:d=${f}[a${i}];`,
  );
  const joined = plan.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${plan.length}:v=1:a=1[vc][ao]`;
  const first = plan[0].to - plan[0].from;
  const last = overlay ? `;[vc][1:v]overlay=0:${overlay.y}:enable='between(t,0.1,${first.toFixed(2)})'[vo]` : "";
  const args = ["-v", "error", "-y", "-i", file, ...(overlay ? ["-i", overlay.png] : []),
    "-filter_complex", parts.join("") + joined + last, "-map", overlay ? "[vo]" : "[vc]", "-map", "[ao]",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "60",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
  const res = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`ffmpeg: ${res.stderr}`);
  return out;
}

function seconds(file) {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(res.stdout);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node src/highlights.mjs <render dir> [--plan] [--file=9x16.mp4] [--hook=png:y]");
  const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const metaFile = ["rec-page", "rec"].map((d) => path.join(dir, d, "meta.json")).find((p) => fs.existsSync(p));
  if (!metaFile) throw new Error(`no rec-page/meta.json or rec/meta.json in ${dir}`);
  const file = path.resolve(dir, opt("file") ?? "9x16.mp4");
  const plan = planHighlights(JSON.parse(fs.readFileSync(metaFile, "utf8")), seconds(file));
  const total = plan.reduce((n, s) => n + s.to - s.from, 0);
  for (const s of plan) console.log(`${s.from.toFixed(2).padStart(6)} – ${s.to.toFixed(2).padStart(6)}  ${s.what}`);
  console.log(`${total.toFixed(1)} s from ${path.relative(process.cwd(), metaFile)}`);
  if (!process.argv.includes("--plan")) {
    const hook = opt("hook")?.split(":");
    const out = path.join(dir, "9x16-short.mp4");
    cutHighlights(file, plan, out, { overlay: hook ? { png: hook[0], y: Number(hook[1] ?? 1380) } : null });
    console.log(out);
  }
}
