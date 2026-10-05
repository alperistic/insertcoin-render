// Cuts the recorded frames into the two MP4s: 16:9 (1920x1080) and 9:16
// (1080x1920 with the names above the stage and the domain below), both with
// the demo music under them.
//
// Sizes matter here: the files live in Supabase's free 1 GB bucket. The first
// hand-made video used CRF 16 (16 MB for 25 s at 1080p); pixel art with flat
// fields compresses far better than that number suggests, so these use CRF 24
// with the animation tune, a few MB per format.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSequence, maxGap, titleLayout } from "./frames.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const FONT = path.join(ASSETS, "PressStart2P-Regular.ttf");
const MUSIC = path.join(ASSETS, "music.m4a");

const FPS = 30;
/** How long the last frame of the fight (the winner's banner) stays up. */
const HOLD_S = 1.0;
/** The stage's border, in CSS px, left out of the crop. */
const BORDER = 2;
/** palette.background and palette.chrome (lib/theme.ts in the app). */
const BG = "0x000000";
const CHROME = "white";

const ENCODE = [
  "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-tune", "animation",
  "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-color_range", "tv",
  "-c:a", "aac", "-b:a", "160k",
  "-movflags", "+faststart", "-shortest",
];

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

/**
 * @param {string} recDir what src/record.mjs wrote
 * @param {{ a: string, b: string }} title upper-case names, challenger first
 * @param {string} outDir
 * @returns {{ landscape: string, portrait: string, seconds: number, maxGapMs: number }}
 */
export function buildVideos(recDir, title, outDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(recDir, "meta.json"), "utf8"));
  fs.mkdirSync(outDir, { recursive: true });

  // The cut: from the VS card to the last frame before the end card replaces
  // the stage, that frame held for HOLD_S.
  const start = meta.tVs;
  const last = meta.tEnd - 0.5 / FPS;
  const picks = frameSequence(meta.frames, { start, last, hold: HOLD_S, fps: FPS });
  if (picks.length < FPS * 5) throw new Error(`only ${picks.length} frames in the cut`);

  const seq = path.join(recDir, "seq");
  fs.rmSync(seq, { recursive: true, force: true });
  fs.mkdirSync(seq);
  picks.forEach((i, k) => {
    fs.symlinkSync(path.resolve(recDir, meta.frames[i].name), path.join(seq, `${String(k).padStart(5, "0")}.jpg`));
  });
  const seconds = picks.length / FPS;

  // Music: cut to length, 1.5 s fade, loudness to about -14 LUFS.
  const track = path.join(recDir, "track.m4a");
  ffmpeg([
    "-stream_loop", "-1", "-i", MUSIC,
    "-t", seconds.toFixed(3),
    "-af", `afade=t=out:st=${Math.max(0, seconds - 1.5).toFixed(3)}:d=1.5,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000`,
    "-c:a", "aac", "-b:a", "192k", track,
  ]);

  const d = meta.dpr;
  const crop = `crop=${even((meta.box.w - 2 * BORDER) * d)}:${even((meta.box.h - 2 * BORDER) * d)}:${even((meta.box.x + BORDER) * d)}:${even((meta.box.y + BORDER) * d)}`;
  const inputs = ["-framerate", String(FPS), "-i", path.join(seq, "%05d.jpg"), "-i", track];
  const tail = "scale=out_range=tv,format=yuv420p";

  const landscape = path.join(outDir, "16x9.mp4");
  ffmpeg([
    ...inputs,
    "-filter_complex", `[0:v]format=rgb24,${crop},scale=1920:1080:flags=neighbor,setsar=1,${tail}[v]`,
    "-map", "[v]", "-map", "1:a", ...ENCODE, landscape,
  ]);

  // 9:16: the stage across the full width in the middle, the names above it
  // and insertcoin.lol below, in the site's pixel font.
  const H = 608;
  const Y = Math.round((1920 - H) / 2);
  const layout = titleLayout(title.a, title.b);
  const lineGap = Math.round(layout.size * 0.6);
  const blockH = layout.lines.length * layout.size + (layout.lines.length - 1) * lineGap;
  const titleTop = Y - 140 - blockH + layout.size;
  const draws = layout.lines.map((line, i) => {
    const file = path.join(recDir, `title-${i}.txt`);
    fs.writeFileSync(file, line);
    return `drawtext=fontfile=${FONT}:textfile=${file}:fontsize=${layout.size}:fontcolor=${CHROME}:x=(w-text_w)/2:y=${titleTop + i * (layout.size + lineGap)}`;
  });
  const domainFile = path.join(recDir, "domain.txt");
  fs.writeFileSync(domainFile, "insertcoin.lol");
  draws.push(`drawtext=fontfile=${FONT}:textfile=${domainFile}:fontsize=32:fontcolor=${CHROME}:x=(w-text_w)/2:y=${Y + H + 108}`);

  const portrait = path.join(outDir, "9x16.mp4");
  ffmpeg([
    ...inputs,
    "-filter_complex",
    `[0:v]format=rgb24,${crop},scale=1080:${H}:flags=area,setsar=1,pad=1080:1920:0:${Y}:color=${BG},${draws.join(",")},${tail}[v]`,
    "-map", "[v]", "-map", "1:a", ...ENCODE, portrait,
  ]);

  return { landscape, portrait, seconds, maxGapMs: Math.round(maxGap(meta.frames, start, last) * 1000) };
}
