// Social kit: from a finished out/<id>/ (16x9.mp4, 9x16.mp4, candidates.json),
// one file per platform within its limits, a still for the thumbnail and a
// text file with the fight's facts as raw material for a caption. Local only:
// nothing is posted or uploaded.
//
//   node render.mjs --match <id> --social      render, then the kit
//   node src/social.mjs out/<id> [--url <u>]   the kit from a finished render

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What each platform takes. Limits are the documented upload caps as of
 * November 2026, rounded down; maxS is where we cut, not the platform's hard
 * ceiling for every account (X: 140 s without Premium; Reels/Shorts: 90 s and
 * 60 s keep a clip in the short-form feed).
 */
export const PLATFORMS = {
  x: { source: "16x9.mp4", w: 1920, h: 1080, maxS: 140, maxMb: 512 },
  tiktok: { source: "9x16.mp4", w: 1080, h: 1920, maxS: 600, maxMb: 287 },
  reels: { source: "9x16.mp4", w: 1080, h: 1920, maxS: 90, maxMb: 250 },
  shorts: { source: "9x16.mp4", w: 1080, h: 1920, maxS: 60, maxMb: 256 },
};

/**
 * How to fit a clip into a platform: too long keeps the end (the K.O. and the
 * score end card are the payoff), too big re-encodes at a bitrate that lands
 * under the cap with 10 % room.
 * @returns {{ start: number, seconds: number, videoKbps: number | null }}
 */
export function fitPlan({ seconds, bytes }, { maxS, maxMb }) {
  const keep = Math.min(seconds, maxS);
  const start = Math.max(0, +(seconds - keep).toFixed(3));
  const projected = bytes * (keep / seconds);
  const cap = maxMb * 1e6 * 0.9;
  const videoKbps = projected > cap ? Math.floor((cap * 8) / keep / 1000) - 128 : null;
  return { start, seconds: +keep.toFixed(3), videoKbps };
}

/** The fight's facts, plain lines, no post: the caption is written by a person. */
export function captionFacts(model, { url, seconds } = {}) {
  const lines = [];
  if (model) {
    const [l, r] = model.cols;
    lines.push(`fighters: ${l.name} vs ${r.name}`);
    lines.push(`winner: ${model.winner.name}`);
    lines.push(`score: ${model.winner.name} ${model.winner.total} - ${model.loser.total} ${model.loser.name}`);
    if (model.tier) lines.push(`tier: ${model.tier}`);
    if (model.decided) lines.push(`decided by: ${model.decided.rubric} (${model.decided.winner} vs ${model.decided.loser})`);
    if (model.cards) lines.push(`cards: ${model.cards}`);
  } else {
    lines.push("end card not readable: no winner/score facts");
  }
  if (seconds) lines.push(`clip length: ${seconds.toFixed(1)} s`);
  if (url) lines.push(`link: ${url}`);
  return lines.join("\n") + "\n";
}

export function probe(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,size:stream=width,height,codec_type", "-of", "json", file],
    { encoding: "utf8", timeout: 30_000 },
  );
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === "video");
  return { seconds: Number(j.format.duration), bytes: Number(j.format.size), w: v?.width, h: v?.height };
}

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit", timeout: 10 * 60_000 });

/**
 * Writes <dir>/social/: <platform>.mp4, thumb-9x16.jpg, thumb-16x9.jpg,
 * caption-facts.txt. A platform whose source is missing is skipped with a note.
 * @returns {{ dir: string, files: string[], skipped: string[] }}
 */
export function buildSocial(dir, { url } = {}) {
  const outDir = path.join(dir, "social");
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  const skipped = [];
  for (const [name, spec] of Object.entries(PLATFORMS)) {
    const src = path.join(dir, spec.source);
    if (!fs.existsSync(src)) {
      skipped.push(`${name}: no ${spec.source}`);
      continue;
    }
    const info = probe(src);
    if (info.w !== spec.w || info.h !== spec.h) {
      skipped.push(`${name}: ${spec.source} is ${info.w}x${info.h}, wants ${spec.w}x${spec.h}`);
      continue;
    }
    const plan = fitPlan(info, spec);
    const file = path.join(outDir, `${name}.mp4`);
    if (plan.start === 0 && plan.videoKbps == null) {
      fs.copyFileSync(src, file); // already fits: the same bytes, no second encode
    } else {
      const enc = plan.videoKbps
        ? ["-c:v", "libx264", "-b:v", `${plan.videoKbps}k`, "-maxrate", `${plan.videoKbps}k`, "-bufsize", `${plan.videoKbps * 2}k`]
        : ["-c:v", "libx264", "-crf", "18", "-preset", "medium"];
      ff(["-ss", String(plan.start), "-i", src, "-t", String(plan.seconds), ...enc, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", file]);
    }
    files.push(file);
  }
  // Thumbnails: one second before the end, on the score end card when there is one.
  for (const src of ["9x16.mp4", "16x9.mp4"]) {
    const p = path.join(dir, src);
    if (!fs.existsSync(p)) continue;
    const at = Math.max(0, probe(p).seconds - 1);
    const file = path.join(outDir, `thumb-${src.replace(".mp4", "")}.jpg`);
    ff(["-ss", at.toFixed(3), "-i", p, "-frames:v", "1", "-q:v", "2", file]);
    files.push(file);
  }
  let model = null;
  const cj = path.join(dir, "candidates.json");
  if (fs.existsSync(cj)) model = JSON.parse(fs.readFileSync(cj, "utf8")).endcard ?? null;
  const main = ["9x16.mp4", "16x9.mp4"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  const facts = path.join(outDir, "caption-facts.txt");
  fs.writeFileSync(facts, captionFacts(model, { url, seconds: main ? probe(main).seconds : undefined }));
  files.push(facts);
  for (const s of skipped) console.warn(`social: skipped ${s}`);
  return { dir: outDir, files, skipped };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error("usage: node src/social.mjs out/<id> [--url <match url>]");
    process.exit(2);
  }
  const i = process.argv.indexOf("--url");
  const r = buildSocial(path.resolve(dir), { url: i > 0 ? process.argv[i + 1] : undefined });
  console.log(`social kit: ${r.files.length} files in ${r.dir}`);
}
