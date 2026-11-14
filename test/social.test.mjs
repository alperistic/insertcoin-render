import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PLATFORMS, buildSocial, captionFacts, fitPlan, probe } from "../src/social.mjs";

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

test("buildSocial: every platform, thumbs and facts from a finished dir", () => {
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
    assert.match(fs.readFileSync(path.join(r.dir, "caption-facts.txt"), "utf8"), /winner: DEVIN/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSocial: a missing 16x9 skips X with a note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-"));
  try {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "9x16.mp4")]);
    const r = buildSocial(dir);
    assert.deepEqual(r.skipped, ["x: no 16x9.mp4"]);
    assert.match(fs.readFileSync(path.join(r.dir, "caption-facts.txt"), "utf8"), /end card not readable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
