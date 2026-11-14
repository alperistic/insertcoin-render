import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PLATFORMS, buildSocial, captionFacts, fitPlan, koMoment, probe } from "../src/social.mjs";

// CI runs npm test before it installs ffmpeg: the encode tests wait for it.
let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}
const needsFfmpeg = { skip: !hasFfmpeg && "no ffmpeg on PATH" };

test("fitPlan: a clip that fits stays whole", () => {
  assert.deepEqual(fitPlan({ seconds: 42, bytes: 20e6 }, PLATFORMS.shorts), { start: 0, seconds: 42, videoKbps: null });
});

test("fitPlan: too long keeps the end (K.O. and end card)", () => {
  const p = fitPlan({ seconds: 75.5, bytes: 30e6 }, PLATFORMS.shorts);
  assert.equal(p.seconds, 60);
  assert.equal(p.start, 15.5);
  assert.equal(p.videoKbps, null);
});

test("fitPlan: too big re-encodes under the cap", () => {
  const p = fitPlan({ seconds: 50, bytes: 400e6 }, PLATFORMS.reels);
  assert.ok(p.videoKbps > 0);
  // video + 128k audio at that rate stays under 90 % of the cap
  assert.ok(((p.videoKbps + 128) * 1000 * p.seconds) / 8 <= PLATFORMS.reels.maxMb * 1e6 * 0.9);
});

const model = {
  cols: [{ name: "CURSOR", total: "71", win: false }, { name: "DEVIN", total: "84", win: true }],
  winner: { name: "DEVIN", total: "84", win: true },
  loser: { name: "CURSOR", total: "71", win: false },
  tier: "TKO",
  cards: null,
  decided: { rubric: "CLARITY", winner: "9", loser: "6" },
};

test("captionFacts: facts only, in column order", () => {
  const t = captionFacts(model, { url: "https://insertcoin.lol/match/x", seconds: 48.25 });
  assert.match(t, /^fighters: CURSOR vs DEVIN$/m);
  assert.match(t, /^winner: DEVIN$/m);
  assert.match(t, /^score: DEVIN 84 - 71 CURSOR$/m);
  assert.match(t, /^tier: TKO$/m);
  assert.match(t, /^decided by: CLARITY \(9 vs 6\)$/m);
  assert.match(t, /^clip length: 48\.3 s$/m);
  assert.match(t, /^link: https:\/\/insertcoin\.lol\/match\/x$/m);
});

test("captionFacts: no end card says so instead of guessing", () => {
  assert.match(captionFacts(null), /end card not readable/);
});

test("buildSocial: every platform, thumbs and facts from a finished dir", needsFfmpeg, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-"));
  try {
    const clip = (w, h, file) =>
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=30:duration=3`,
        "-f", "lavfi", "-i", "sine=duration=3",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, file),
      ]);
    clip(1920, 1080, "16x9.mp4");
    clip(1080, 1920, "9x16.mp4");
    fs.writeFileSync(path.join(dir, "candidates.json"), JSON.stringify({ endcard: model }));
    fs.mkdirSync(path.join(dir, "rec"));
    fs.writeFileSync(path.join(dir, "rec", "meta.json"), JSON.stringify({
      tVs: 100, tEnd: 102.5, track: [{ t: 100, hp: [1, 1], wd: null }, { t: 101, hp: [0.4, 0], wd: [1, 2, 3, 4] }],
    }));
    const r = buildSocial(dir, { url: "https://insertcoin.lol/match/x" });
    assert.deepEqual(r.skipped, []);
    for (const name of Object.keys(PLATFORMS)) {
      const info = probe(path.join(r.dir, `${name}.mp4`));
      assert.equal(info.w, PLATFORMS[name].w);
      assert.equal(info.h, PLATFORMS[name].h);
      assert.ok(Math.abs(info.seconds - 3) < 0.2);
    }
    assert.ok(fs.statSync(path.join(r.dir, "thumb-9x16.jpg")).size > 1000);
    assert.ok(fs.statSync(path.join(r.dir, "thumb-16x9.jpg")).size > 1000);
    assert.ok(fs.statSync(path.join(r.dir, "thumb-ko-9x16.jpg")).size > 1000);
    assert.ok(fs.statSync(path.join(r.dir, "thumb-ko-16x9.jpg")).size > 1000);
    assert.match(fs.readFileSync(path.join(r.dir, "caption-facts.txt"), "utf8"), /winner: DEVIN/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSocial: a missing 16x9 skips X with a note", needsFfmpeg, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-"));
  try {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "9x16.mp4")]);
    const r = buildSocial(dir);
    assert.deepEqual(r.skipped, ["x: no 16x9.mp4", "thumb-ko: no K.O. moment in rec/meta.json"]);
    assert.match(fs.readFileSync(path.join(r.dir, "caption-facts.txt"), "utf8"), /end card not readable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Shaped like the real recording of 7fb30586… (14.11.2026): the FIGHT word at
// 3.3 s, a fighter at 0 HP with the K.O. word at 30.79 s, WINS at 34.11 s.
const real = {
  tVs: 1000, tEnd: 1035.37,
  track: [
    { t: 1000.0, hp: [1, 1], wd: null },
    { t: 1003.3, hp: [1, 1], wd: [0, 68, 1095, 128] },
    { t: 1003.81, hp: [1, 1], wd: null },
    { t: 1030.5, hp: [0.84, 0.05], wd: null },
    { t: 1030.79, hp: [0.84, 0], wd: [-142, 227, 862, 404] },
    { t: 1032.65, hp: [0.84, 0], wd: null },
    { t: 1034.11, hp: [0.84, 0], wd: [-717, 1, 719, 404] },
  ],
};

test("koMoment: the first frame a fighter is at 0 HP, half a second on", () => {
  assert.ok(Math.abs(koMoment(real) - 31.29) < 1e-6);
});

test("koMoment: a decision on points falls back to the last stage word (WINS)", () => {
  const points = { ...real, track: real.track.map((s) => ({ ...s, hp: [0.84, 0.3] })) };
  assert.ok(Math.abs(koMoment(points) - 34.61) < 1e-6);
});

test("koMoment: never past the end of the fight, null without a track", () => {
  assert.ok(koMoment(real, 10) < 35.37);
  assert.equal(koMoment({ tVs: 0, tEnd: 1 }), null);
  assert.equal(koMoment(null), null);
});
