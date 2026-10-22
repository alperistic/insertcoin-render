// Renders insertcoin.lol fights to MP4.
//
//   node render.mjs                 claim fights from the app, render, upload, report
//   node render.mjs --match <id>    render one fight to ./out/<id>/ and stop (local test)
//   node render.mjs --match <id> --candidates
//                                   the same plus both 9:16 candidates and the end card,
//                                   next to today's files, to compare (local only)
//
// Opt-in, off by default (today's two files, cut exactly as before):
//   PORTRAIT=legacy|a|b|both  which 9:16 (src/portrait.mjs); both is local only
//   ENDCARD=1                 append the score end card to both formats
//   ENDCARD_NOTE=0            leave the end card's line about the scorecards out
//
// The app side lives in the insertcoin repo (lib/fightVideo.ts). This job
// only ever sees the public match page, one signed upload URL per file, and
// VIDEO_RENDER_SECRET for the two app routes. Nothing here can read or write
// anything else.

import fs from "node:fs";
import path from "node:path";
import { ENDCARD_S, buildVideos, hasDrawtext, legacyChromeStill, musicTrack, prepareCut } from "./src/build.mjs";
import { endCardModel } from "./src/layout.mjs";
import { encodeA, encodeB, endcardStill, planA, planB } from "./src/portrait.mjs";
import { NoStageError, PHONE, recordFight } from "./src/record.mjs";
import { renderStills } from "./src/stills.mjs";

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
 * What to cut. Unset env: today's 16x9 + letterbox 9x16, nothing else.
 * @returns {{ portrait: "legacy"|"a"|"b"|"both", endcard: boolean, note: boolean, legacy: boolean }}
 */
function options({ candidates = false } = {}) {
  if (candidates) return { portrait: "both", endcard: true, note: process.env.ENDCARD_NOTE !== "0", legacy: true };
  const portrait = (process.env.PORTRAIT || "legacy").toLowerCase();
  if (!["legacy", "a", "b", "both"].includes(portrait)) throw new Error(`PORTRAIT=${portrait}: legacy, a, b or both`);
  return { portrait, endcard: process.env.ENDCARD === "1", note: process.env.ENDCARD_NOTE !== "0", legacy: portrait === "legacy" };
}

async function renderOne(matchId, title, workDir, cfg = options()) {
  if (cfg.portrait === "legacy" && !cfg.endcard) {
    // Today's path, untouched.
    const recDir = path.join(workDir, "rec");
    const rec = await recordFight(`${APP}/match/${matchId}?stage=on`, recDir);
    const out = buildVideos(recDir, title, workDir);
    console.log(
      `${matchId}: ${out.seconds.toFixed(1)} s, ${rec.frames.length} frames captured, max gap ${out.maxGapMs} ms, ` +
        `16x9 ${sizeMb(out.landscape)} MB, 9x16 ${sizeMb(out.portrait)} MB`,
    );
    return out;
  }
  return renderCandidates(matchId, title, workDir, cfg);
}

/** The opt-in path: candidates A/B and/or the end card. */
async function renderCandidates(matchId, title, workDir, cfg) {
  const url = `${APP}/match/${matchId}?stage=on`;
  const wantA = cfg.portrait === "a" || cfg.portrait === "both";
  const wantB = cfg.portrait === "b" || cfg.portrait === "both";
  const recDir = path.join(workDir, "rec");
  const stillDir = path.join(workDir, "stills");
  fs.mkdirSync(stillDir, { recursive: true });

  let t = Date.now();
  const rec = await recordFight(url, recDir, { track: wantB, readEnd: cfg.endcard, measure: wantB ? { hud: ".fr-hud" } : undefined });
  console.log(`${matchId}: 16:9 pass ${((Date.now() - t) / 1000).toFixed(0)} s, ${rec.frames.length} frames`);
  let recA = null;
  if (wantA) {
    t = Date.now();
    recA = await recordFight(url, path.join(workDir, "rec-a"), PHONE);
    console.log(`${matchId}: phone pass (A) ${((Date.now() - t) / 1000).toFixed(0)} s, ${recA.frames.length} frames`);
  }

  const model = cfg.endcard ? endCardModel(rec.endcard) : null;
  if (cfg.endcard && !model) console.warn(`${matchId}: end card not readable (${JSON.stringify(rec.endcard)}); none appended`);
  if (model) console.log(`${matchId}: end card ${JSON.stringify(model)}`);

  // Plan everything that needs a PNG, render them in one browser, then cut.
  const stills = [];
  const multi = cfg.portrait === "both";
  let a = null;
  let b = null;
  let cutA = null;
  let cutB = null;
  if (wantA) {
    cutA = prepareCut(path.join(workDir, "rec-a"));
    a = planA(recA, title, stillDir);
    stills.push(...a.stills);
  }
  if (wantB) {
    cutB = prepareCut(recDir);
    b = planB(rec, cutB, title, stillDir);
    stills.push(...b.stills);
  }
  const ec = {};
  if (model) {
    ec.landscape = path.join(stillDir, "endcard-16x9.png");
    stills.push(endcardStill(model, ec.landscape, { portrait: false, note: cfg.note }));
    if (a) {
      ec.a = path.join(stillDir, "endcard-9x16-a.png");
      stills.push(endcardStill(model, ec.a, { portrait: true, domainY: a.domainY, note: cfg.note }));
    }
    if (b) {
      ec.b = path.join(stillDir, "endcard-9x16-b.png");
      stills.push(endcardStill(model, ec.b, { portrait: true, domainY: b.domainY, note: cfg.note }));
    }
    if (cfg.legacy && !cfg.candidates) {
      ec.portrait = path.join(stillDir, "endcard-9x16.png");
      stills.push(endcardStill(model, ec.portrait, { portrait: true, domainY: 656 + 608 + 108, note: cfg.note }));
    }
  }
  const legacyChrome = cfg.legacy && !hasDrawtext() ? path.join(stillDir, "chrome-legacy.png") : null;
  if (legacyChrome) stills.push(legacyChromeStill(title, legacyChrome));
  await renderStills(stills);

  const out = buildVideos(recDir, title, workDir, {
    endcard: model ? { landscape: ec.landscape, portrait: ec.portrait } : null,
    portrait: cfg.legacy,
    legacyChrome,
  });
  const files = [`16x9 ${sizeMb(out.landscape)} MB`];
  if (out.portrait) files.push(`9x16 (legacy) ${sizeMb(out.portrait)} MB`);
  if (a) {
    const file = path.join(workDir, multi ? "9x16-a.mp4" : "9x16.mp4");
    const secs = cutA.seconds + (ec.a ? ENDCARD_S : 0);
    encodeA(a, cutA, musicTrack(path.join(workDir, "rec-a"), secs, "track-out.m4a"), file, ec.a ?? null);
    if (!multi) out.portrait = file;
    files.push(`A ${sizeMb(file)} MB (stage ${(a.share.stage * 100).toFixed(1)} %, live block ${(a.share.live * 100).toFixed(1)} %)`);
  }
  if (b) {
    const file = path.join(workDir, multi ? "9x16-b.mp4" : "9x16.mp4");
    const secs = cutB.seconds + (ec.b ? ENDCARD_S : 0);
    encodeB(b, cutB, musicTrack(recDir, secs, "track-b.m4a"), file, recDir, ec.b ?? null);
    if (!multi) out.portrait = file;
    files.push(
      `B ${sizeMb(file)} MB (stage ${(b.share.stage * 100).toFixed(1)} %, ${b.cutTop ? `HUD band cut at ${b.cutTop} css px` : "full height"}, ` +
        `${b.wide} frames wider than the window, ${b.outside} with content outside, ${b.snaps} snaps)`,
    );
  }
  console.log(`${matchId}: ${out.seconds.toFixed(1)} s, max gap ${out.maxGapMs} ms; ${files.join("; ")}`);
  fs.writeFileSync(path.join(workDir, "candidates.json"), JSON.stringify({
    endcard: model, raw: rec.endcard,
    a: a && { share: a.share, crops: a.crops, k: a.k, flags: a.flags },
    b: b && { share: b.share, cutTop: b.cutTop, into: b.into, wide: b.wide, outside: b.outside, snaps: b.snaps, cw: b.cw, ch: b.ch },
  }, null, 1));
  return out;
}

async function local(matchId, candidates) {
  const workDir = path.resolve("out", matchId);
  const title = { a: process.env.TITLE_A || "FIGHTER A", b: process.env.TITLE_B || "FIGHTER B" };
  await renderOne(matchId, title, workDir, candidates ? { ...options({ candidates: true }), candidates: true } : options());
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

const at = process.argv.indexOf("--match");
const run = at > 0 ? local(process.argv[at + 1], process.argv.includes("--candidates")) : claimLoop();
run.catch((err) => {
  console.error(err);
  process.exit(1);
});
