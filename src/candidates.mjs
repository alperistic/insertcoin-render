// The 9:16 cuts (B by default, A, both) and the end card, cut from
// recordings already made: render.mjs records, this composes. Apart so a cut can be
// redone from out/<id>/rec without recording the fight again.

import fs from "node:fs";
import path from "node:path";
import { ENDCARD_S, LEGACY_DOMAIN_Y, buildVideos, hasDrawtext, legacyChromeStill, musicTrack, prepareCut } from "./build.mjs";
import { endCardModel } from "./layout.mjs";
import { encodeA, encodeB, endcardStill, planA, planB } from "./portrait.mjs";
import { renderStills } from "./stills.mjs";

const sizeMb = (file) => (fs.statSync(file).size / 1e6).toFixed(1);

/**
 * @param {{ matchId: string, title: { a: string, b: string }, workDir: string,
 *   cfg: { portrait: string, endcard: boolean, note: boolean, legacy: boolean, candidates?: boolean },
 *   rec: object, recA: object | null }} o rec/recA: meta of rec/ and rec-a/ in workDir
 */
export async function composeCandidates({ matchId, title, workDir, cfg, rec, recA }) {
  const wantA = cfg.portrait === "a" || cfg.portrait === "both";
  const wantB = cfg.portrait === "b" || cfg.portrait === "both";
  const recDir = path.join(workDir, "rec");
  const stillDir = path.join(workDir, "stills");
  fs.mkdirSync(stillDir, { recursive: true });
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
      stills.push(endcardStill(model, ec.portrait, { portrait: true, domainY: LEGACY_DOMAIN_Y, note: cfg.note }));
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
      `B ${sizeMb(file)} MB (stage ${(b.share.stage * 100).toFixed(1)} %, ${(b.share.picture * 100).toFixed(1)} % under the HUD band, ` +
        `${b.into} frames under the band, ${b.wide} wider than the window, ${b.outside} with a fighter outside, ` +
        `${b.wordCut} with a word cut, ${b.snaps} snaps)`,
    );
  }
  console.log(`${matchId}: ${out.seconds.toFixed(1)} s, max gap ${out.maxGapMs} ms; ${files.join("; ")}`);
  fs.writeFileSync(path.join(workDir, "candidates.json"), JSON.stringify({
    endcard: model, raw: rec.endcard,
    a: a && { share: a.share, crops: a.crops, k: a.k, flags: a.flags },
    b: b && { share: b.share, bandH: b.bandH, into: b.into, wide: b.wide, outside: b.outside, wordCut: b.wordCut, snaps: b.snaps, cw: b.cw, ch: b.ch },
  }, null, 1));
  return out;
}
