// Renders insertcoin.lol fights to MP4.
//
//   node render.mjs                 claim fights from the app, render, upload, report
//   node render.mjs --match <id>    render one fight to ./out/<id>/ and stop (local test)
//
// The app side lives in the insertcoin repo (lib/fightVideo.ts). This job
// only ever sees the public match page, one signed upload URL per file, and
// VIDEO_RENDER_SECRET for the two app routes. Nothing here can read or write
// anything else.

import fs from "node:fs";
import path from "node:path";
import { buildVideos } from "./src/build.mjs";
import { NoStageError, recordFight } from "./src/record.mjs";

const APP = (process.env.APP_URL || "https://insertcoin.lol").replace(/\/+$/, "");
const SECRET = process.env.VIDEO_RENDER_SECRET || "";
/** Fights per run. A run is ~1 minute per fight; the rest wait for the next run. */
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

async function renderOne(matchId, title, workDir) {
  const recDir = path.join(workDir, "rec");
  const rec = await recordFight(`${APP}/match/${matchId}?stage=on`, recDir);
  const out = buildVideos(recDir, title, workDir);
  console.log(
    `${matchId}: ${out.seconds.toFixed(1)} s, ${rec.frames.length} frames captured, max gap ${out.maxGapMs} ms, ` +
      `16x9 ${sizeMb(out.landscape)} MB, 9x16 ${sizeMb(out.portrait)} MB`,
  );
  return out;
}

async function local(matchId) {
  const workDir = path.resolve("out", matchId);
  const title = { a: process.env.TITLE_A || "FIGHTER A", b: process.env.TITLE_B || "FIGHTER B" };
  await renderOne(matchId, title, workDir);
  console.log(`written to ${workDir}`);
}

async function claimLoop() {
  if (SECRET.length < 16) throw new Error("VIDEO_RENDER_SECRET is not set");
  for (let i = 0; i < MAX_JOBS; i++) {
    const { job } = await api("claim");
    if (!job) {
      console.log(i === 0 ? "nothing to render" : "queue empty");
      return;
    }
    const workDir = path.resolve("out", job.matchId);
    try {
      const out = await renderOne(job.matchId, job.title, workDir);
      await upload(job.uploads.landscape, out.landscape);
      await upload(job.uploads.portrait, out.portrait);
      await api("done", { matchId: job.matchId, stamp: job.stamp, ok: true });
      console.log(`${job.matchId}: done`);
    } catch (err) {
      const permanent = err instanceof NoStageError;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${job.matchId}: ${permanent ? "skipped" : "failed"}: ${message}`);
      await api("done", { matchId: job.matchId, stamp: job.stamp, ok: false, error: message, permanent }).catch(
        (e) => console.error(`report failed: ${e.message}`),
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

const at = process.argv.indexOf("--match");
const run = at > 0 ? local(process.argv[at + 1]) : claimLoop();
run.catch((err) => {
  console.error(err);
  process.exit(1);
});
