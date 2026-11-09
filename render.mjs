// Renders insertcoin.lol fights to MP4.
//
//   node render.mjs                 claim fights from the app, render, upload, report
//   node render.mjs --match <id>    render one fight to ./out/<id>/ and stop (local test)
//   node render.mjs --match <id> --candidates
//                                   the same plus the letterbox 9:16 and candidate A
//                                   next to B, all with the end card (local only)
//   node render.mjs --page <url> [--out <dir>]
//                                   record any page that mounts the fight stage the
//                                   way the match page does (local only, e.g. the
//                                   insertcoin dev route /preview/exhibition/<slug>);
//                                   default out: ./out/page/
//
// Default (live since 22.10.2026): 16x9.mp4 with the score end card, and
// 9x16.mp4 = candidate B (a 4:3 window that follows the fighters, our HUD
// over it) with the end card. One recording pass; B and the end card are
// PNG stills drawn by Chromium (src/stills.mjs), so no drawtext needed.
//
//   PORTRAIT=b|legacy|a|both  which 9:16 (src/portrait.mjs); legacy is the old
//                             letterbox, a needs a second (phone) pass, both is local only
//   ENDCARD=0                 no end card on either file
//   ENDCARD_NOTE=0            leave the end card's line about the scorecards out
//   ENDCARD_LINE=<text>       one more line on the end card under everything else
//                             (a brand exhibition's disclosure; unset: none)
//   PORTRAIT=legacy ENDCARD=0 the pre-22.10. files, cut exactly as before
//
// The app side lives in the insertcoin repo (lib/fightVideo.ts). This job
// only ever sees the public match page, one signed upload URL per file, and
// VIDEO_RENDER_SECRET for the two app routes. Nothing here can read or write
// anything else.

import fs from "node:fs";
import path from "node:path";
import { buildVideos } from "./src/build.mjs";
import { composeCandidates } from "./src/candidates.mjs";
import { NoStageError, PHONE, recordFight } from "./src/record.mjs";

const APP = (process.env.APP_URL || "https://insertcoin.lol").replace(/\/+$/, "");
const SECRET = process.env.VIDEO_RENDER_SECRET || "";
/** Fights per run. A fight takes ~4 minutes in slow motion (src/slowclock.js); the rest wait for the next run. */
const MAX_JOBS = Number(process.env.MAX_JOBS || 5);

async function api(route, body) {
  const res = await fetch(`${APP}/api/fight-video/${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function upload(signedUrl, file) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "x-upsert": "true" },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`upload: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

function sizeMb(file) {
  return (fs.statSync(file).size / 1e6).toFixed(1);
}

/**
 * What to cut. Unset env: 16x9 and B's 9x16, both with the end card.
 * @returns {{ portrait: "legacy"|"a"|"b"|"both", endcard: boolean, note: boolean, line?: string, legacy: boolean }}
 */
function options({ candidates = false } = {}) {
  const line = process.env.ENDCARD_LINE?.trim() || undefined;
  if (candidates) return { portrait: "both", endcard: true, note: process.env.ENDCARD_NOTE !== "0", line, legacy: true };
  const portrait = (process.env.PORTRAIT || "b").toLowerCase();
  if (!["legacy", "a", "b", "both"].includes(portrait)) throw new Error(`PORTRAIT=${portrait}: b, legacy, a or both`);
  return { portrait, endcard: process.env.ENDCARD !== "0", note: process.env.ENDCARD_NOTE !== "0", line, legacy: portrait === "legacy" };
}

async function renderOne(matchId, title, workDir, cfg = options(), url = `${APP}/match/${matchId}?stage=on`) {
  if (cfg.portrait === "legacy" && !cfg.endcard) {
    // The pre-22.10. path (PORTRAIT=legacy ENDCARD=0), untouched.
    const recDir = path.join(workDir, "rec");
    const rec = await recordFight(url, recDir);
    const out = buildVideos(recDir, title, workDir);
    console.log(
      `${matchId}: ${out.seconds.toFixed(1)} s, ${rec.frames.length} frames captured, max gap ${out.maxGapMs} ms, ` +
        `16x9 ${sizeMb(out.landscape)} MB, 9x16 ${sizeMb(out.portrait)} MB`,
    );
    return out;
  }
  return renderCandidates(matchId, title, workDir, cfg, url);
}

/** The default path: B and/or A and/or the end card, composed from the recording(s). */
async function renderCandidates(matchId, title, workDir, cfg, url) {
  const wantA = cfg.portrait === "a" || cfg.portrait === "both";
  const wantB = cfg.portrait === "b" || cfg.portrait === "both";
  const recDir = path.join(workDir, "rec");

  let t = Date.now();
  const rec = await recordFight(url, recDir, { track: wantB, readEnd: cfg.endcard, measure: wantB ? { hud: ".fr-hud" } : undefined });
  console.log(`${matchId}: 16:9 pass ${((Date.now() - t) / 1000).toFixed(0)} s, ${rec.frames.length} frames`);
  let recA = null;
  if (wantA) {
    t = Date.now();
    recA = await recordFight(url, path.join(workDir, "rec-a"), PHONE);
    console.log(`${matchId}: phone pass (A) ${((Date.now() - t) / 1000).toFixed(0)} s, ${recA.frames.length} frames`);
  }

  return composeCandidates({ matchId, title, workDir, cfg, rec, recA });
}

async function local(matchId, candidates) {
  const workDir = path.resolve("out", matchId);
  const title = { a: process.env.TITLE_A || "FIGHTER A", b: process.env.TITLE_B || "FIGHTER B" };
  await renderOne(matchId, title, workDir, candidates ? { ...options({ candidates: true }), candidates: true } : options());
  console.log(`written to ${workDir}`);
}

/** --page: the same cut from any URL; the id in logs and file names is "page". */
async function localPage(url, out) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`--page ${url}: http(s) only`);
  const workDir = path.resolve(out || path.join("out", "page"));
  const title = { a: process.env.TITLE_A || "FIGHTER A", b: process.env.TITLE_B || "FIGHTER B" };
  await renderOne("page", title, workDir, options(), parsed.href);
  console.log(`written to ${workDir}`);
}

async function claimLoop() {
  if (SECRET.length < 16) throw new Error("VIDEO_RENDER_SECRET is not set");
  const cfg = options();
  if (cfg.portrait === "both") throw new Error("PORTRAIT=both is for local comparison only (--match)");
  for (let i = 0; i < MAX_JOBS; i++) {
    const { job } = await api("claim");
    if (!job) {
      console.log(i === 0 ? "nothing to render" : "queue empty");
      return;
    }
    const workDir = path.resolve("out", job.matchId);
    try {
      const out = await renderOne(job.matchId, job.title, workDir, cfg);
      if (!out.portrait) throw new Error("no 9x16.mp4 was cut");
      await upload(job.uploads.landscape, out.landscape);
      await upload(job.uploads.portrait, out.portrait);
      await api("done", { matchId: job.matchId, claim: job.claim, ok: true });
      console.log(`${job.matchId}: done`);
    } catch (err) {
      const permanent = err instanceof NoStageError;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${job.matchId}: ${permanent ? "skipped" : "failed"}: ${message}`);
      await api("done", { matchId: job.matchId, claim: job.claim, ok: false, error: message, permanent }).catch(
        (e) => console.error(`report failed: ${e.message}`),
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  // A flag without its value must never fall through to the claim loop, which
  // talks to production and uploads (an exhibition passes --page, never that).
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
};
const run = arg("--page")
  ? localPage(arg("--page"), arg("--out"))
  : arg("--match")
    ? local(arg("--match"), process.argv.includes("--candidates"))
    : claimLoop();
run.catch((err) => {
  console.error(err);
  process.exit(1);
});
