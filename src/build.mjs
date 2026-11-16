// Cuts the recorded frames into the two MP4s: 16:9 (1920x1080) and 9:16
// (1080x1920 with the names above the stage and the domain below), both with
// the fight's own sound under them (musicTrack, src/score.mjs).
//
// Sizes matter here: the files live in Supabase's free 1 GB bucket. The first
// hand-made video used CRF 16 (16 MB for 25 s at 1080p); pixel art with flat
// fields compresses far better than that number suggests, so these use CRF 24
// with the animation tune, a few MB per format.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSequence, maxGap, titleLayout } from "./frames.mjs";
import { textItem, layerHtml } from "./stills.mjs";
import { cuesFromTrack, pickTheme, planScore, renderScore } from "./score.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const FONT = path.join(ASSETS, "PressStart2P-Regular.ttf");

/**
 * 60, not 30: a move's quick drawings stand one frame (17 ms) each, and a
 * 30 fps video showed every second one.
 */
export const FPS = 60;

// Legacy 9:16 layout: stage height, and the domain line 108 px below the stage.
// One place, shared with the end card still (candidates.mjs).
export const LEGACY_H = 608;
export const LEGACY_Y = Math.round((1920 - LEGACY_H) / 2);
export const LEGACY_DOMAIN_Y = LEGACY_Y + LEGACY_H + 108;
/** How long the last frame of the fight (the winner's banner) stays up. */
const HOLD_S = 1.0;
/** The stage's border, in CSS px, left out of the crop. */
export const BORDER = 2;
/** palette.background and palette.chrome (lib/theme.ts in the app). */
export const BG = "0x000000";
const CHROME = "white";
/**
 * The end card (ENDCARD=1): it fades in over the held last frame in
 * XFADE_S and then stands for ENDCARD_S, so the video gets ENDCARD_S longer.
 */
export const ENDCARD_S = 2.5;
export const XFADE_S = 0.3;

export const ENCODE = [
  "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-tune", "animation",
  "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-color_range", "tv",
  // The track is AAC already (musicTrack): copied, not encoded a second
  // time, which pushed its true peak over the ceiling it was set to.
  "-c:a", "copy",
  "-movflags", "+faststart", "-shortest",
];

const even = (v) => Math.max(2, Math.round(v / 2) * 2);
export const TAIL = "scale=out_range=tv,format=yuv420p";

export function ffmpeg(args) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

/** Whether this ffmpeg has drawtext (the runner's does, Homebrew's does not). */
export function hasDrawtext() {
  try {
    return / drawtext /.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }));
  } catch {
    return false;
  }
}

/**
 * The input that shows the end card: a still, looped for its fade and its
 * stand. Pass it after the frames and the music.
 */
export const endcardInput = (png) => ["-loop", "1", "-framerate", String(FPS), "-t", (XFADE_S + ENDCARD_S).toFixed(3), "-i", png];

/**
 * Filter graph tail that fades the end card (input `idx`, already W x H)
 * in over the last XFADE_S of the stage stream `[label]`, out as `[v]`.
 */
export function endcardGraph(label, idx, seconds, W, H) {
  return `[${idx}:v]format=rgb24,scale=${W}:${H},setsar=1,${TAIL},settb=1/${FPS}[ec];` +
    `[${label}]settb=1/${FPS}[sx];[sx][ec]xfade=transition=fade:duration=${XFADE_S}:offset=${(seconds - XFADE_S).toFixed(3)}[v]`;
}

/**
 * The cut every format shares: frame picks from the VS card to the end,
 * symlinked as a numbered sequence for ffmpeg's image2.
 */
export function prepareCut(recDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(recDir, "meta.json"), "utf8"));
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
  return { meta, picks, seq, seconds, start, last };
}

/** Where the mix sits: loud enough for a feed, with the hits on top of the music. */
// peak: on the WAV, before AAC, whose encode adds up to ~0.8 dB of true peak.
const LOUDNESS = { lufs: -16, peak: -2.0 };

/**
 * The fight's sound (score.mjs): a score cut to this recording and every cue
 * the stage fired, as one AAC track of `seconds`.
 *
 * It reads the recording's own meta.json: the cues the page sent (meta.cues,
 * on the recorder's clock like the frames), or what the HP bars and the round
 * imply when the app is one that does not send them. The theme is the one
 * asked for (opts.theme, THEME=), else the stage's own (meta.venue), else the
 * pairing's draw; the pairing also seeds the smaller choices.
 *
 * @param {string} recDir
 * @param {number} seconds the video's length, end card included
 * @param {string} [name]
 * @param {{ theme?: string, seedKey?: string, log?: (m: string) => void }} [opts]
 */
export function musicTrack(recDir, seconds, name = "track.m4a", opts = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(recDir, "meta.json"), "utf8"));
  const start = meta.tVs;
  // Where the held last frame ends: the cut's own length (prepareCut).
  const fight = Math.min(seconds, meta.tEnd - 0.5 / FPS - start + HOLD_S);
  const sent = Array.isArray(meta.cues) && meta.cues.length > 0;
  const cues = (sent ? meta.cues : cuesFromTrack(meta.track, meta.tEnd)).map((c) => ({ ...c, t: c.t - start }));
  const seedKey = opts.seedKey ?? (meta.hud ?? []).map((h) => h?.name ?? "").join("|");
  const theme = pickTheme({ theme: opts.theme ?? process.env.THEME, venue: meta.venue, seedKey });
  const plan = planScore({ cues, fight, total: seconds, theme, seedKey });
  const { mix } = renderScore(plan);
  const wav = path.join(recDir, name.replace(/\.[^.]+$/, ".wav"));
  mix.writeWav(wav);

  // One static gain to the target loudness, held under the true-peak ceiling:
  // measured, not loudnorm's own riding, which pumps under every hit.
  const probe = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(probe.stderr ?? "");
  const read = m ? JSON.parse(m[0]) : null;
  const inI = Number(read?.input_i);
  const inTp = Number(read?.input_tp);
  const gain = Number.isFinite(inI) && Number.isFinite(inTp) ? Math.min(LOUDNESS.lufs - inI, LOUDNESS.peak - inTp) : 0;
  const track = path.join(recDir, name);
  ffmpeg(["-i", wav, "-af", `volume=${gain.toFixed(2)}dB,aresample=48000`, "-c:a", "aac", "-b:a", "160k", track]);
  (opts.log ?? console.log)(
    `sound: ${theme}, ${plan.sections.length} sections, ${plan.cues.length} cues (${sent ? "from the stage" : "from HP and rounds"}), ` +
      `${Number.isFinite(inI) ? (inI + gain).toFixed(1) : "?"} LUFS`,
  );
  return track;
}

/**
 * @param {string} recDir what src/record.mjs wrote
 * @param {{ a: string, b: string }} title upper-case names, challenger first
 * @param {string} outDir
 * @param {{ endcard?: { landscape?: string, portrait?: string } | null, portrait?: boolean,
 *   legacyChrome?: string | null }} [opts]
 *   endcard: end card PNGs to append (ENDCARD=1); portrait false: no 9x16.mp4;
 *   legacyChrome: the 9x16's names and domain as a PNG (stills.mjs,
 *   legacyChromeStill) instead of drawtext, for an ffmpeg without it.
 *   Without opts both files are cut exactly as they always were.
 * @returns {{ landscape: string, portrait: string | null, seconds: number, maxGapMs: number }}
 */
export function buildVideos(recDir, title, outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const { meta, seq, seconds, start, last } = prepareCut(recDir);
  const track = musicTrack(recDir, seconds);
  const ec = opts.endcard ?? null;
  const trackEc = ec ? musicTrack(recDir, seconds + ENDCARD_S, "track-ec.m4a") : null;

  const d = meta.dpr;
  const crop = `crop=${even((meta.box.w - 2 * BORDER) * d)}:${even((meta.box.h - 2 * BORDER) * d)}:${even((meta.box.x + BORDER) * d)}:${even((meta.box.y + BORDER) * d)}`;
  const inputs = ["-framerate", String(FPS), "-i", path.join(seq, "%05d.jpg"), "-i", track];
  const tail = "scale=out_range=tv,format=yuv420p";

  const landscape = path.join(outDir, "16x9.mp4");
  if (ec?.landscape) {
    ffmpeg([
      "-framerate", String(FPS), "-i", path.join(seq, "%05d.jpg"), "-i", trackEc, ...endcardInput(ec.landscape),
      "-filter_complex",
      `[0:v]format=rgb24,${crop},scale=1920:1080:flags=neighbor,setsar=1,${tail}[st];${endcardGraph("st", 2, seconds, 1920, 1080)}`,
      "-map", "[v]", "-map", "1:a", ...ENCODE, landscape,
    ]);
  } else {
    ffmpeg([
      ...inputs,
      "-filter_complex", `[0:v]format=rgb24,${crop},scale=1920:1080:flags=neighbor,setsar=1,${tail}[v]`,
      "-map", "[v]", "-map", "1:a", ...ENCODE, landscape,
    ]);
  }
  const result = { landscape, portrait: null, seconds: ec?.landscape ? seconds + ENDCARD_S : seconds, maxGapMs: Math.round(maxGap(meta.frames, start, last) * 1000) };
  if (opts.portrait === false) return result;

  // 9:16: the stage across the full width in the middle, the names above it
  // and insertcoin.lol below, in the site's pixel font.
  const H = LEGACY_H;
  const Y = LEGACY_Y;
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
  draws.push(`drawtext=fontfile=${FONT}:textfile=${domainFile}:fontsize=32:fontcolor=${CHROME}:x=(w-text_w)/2:y=${LEGACY_DOMAIN_Y}`);

  const portrait = path.join(outDir, "9x16.mp4");
  const base = `[0:v]format=rgb24,${crop},scale=1080:${H}:flags=area,setsar=1,pad=1080:1920:0:${Y}:color=${BG}`;
  if (!opts.legacyChrome && !ec?.portrait) {
    ffmpeg([
      ...inputs,
      "-filter_complex",
      `${base},${draws.join(",")},${tail}[v]`,
      "-map", "[v]", "-map", "1:a", ...ENCODE, portrait,
    ]);
  } else {
    // The same frame with the text as a PNG layer (no drawtext here) and/or
    // the end card after it.
    const chrome = opts.legacyChrome ? ["-i", opts.legacyChrome] : [];
    const text = opts.legacyChrome ? `[p0];[p0][2:v]overlay=0:0` : `,${draws.join(",")}`;
    const ecIdx = opts.legacyChrome ? 3 : 2;
    const graph = ec?.portrait ? `${base}${text},${tail}[st];${endcardGraph("st", ecIdx, seconds, 1080, 1920)}` : `${base}${text},${tail}[v]`;
    ffmpeg([
      "-framerate", String(FPS), "-i", path.join(seq, "%05d.jpg"), "-i", ec?.portrait ? trackEc : track,
      ...chrome, ...(ec?.portrait ? endcardInput(ec.portrait) : []),
      "-filter_complex", graph,
      "-map", "[v]", "-map", "1:a", ...ENCODE, portrait,
    ]);
  }
  return { ...result, portrait };
}

/**
 * The 9x16's names and domain where drawtext puts them (y is the top of the
 * text, Press Start 2P's line box equals its size), as a stills.mjs page.
 */
export function legacyChromeStill(title, file) {
  const H = LEGACY_H;
  const Y = LEGACY_Y;
  const layout = titleLayout(title.a, title.b);
  const lineGap = Math.round(layout.size * 0.6);
  const blockH = layout.lines.length * layout.size + (layout.lines.length - 1) * lineGap;
  const titleTop = Y - 140 - blockH + layout.size;
  const items = layout.lines.map((line, i) => textItem({ y: titleTop + i * (layout.size + lineGap), w: 1080, text: line, size: layout.size }));
  items.push(textItem({ y: LEGACY_DOMAIN_Y, w: 1080, text: "insertcoin.lol", size: 32 }));
  return { file, w: 1080, h: 1920, html: layerHtml(1080, 1920, items) };
}
