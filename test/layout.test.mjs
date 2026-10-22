import assert from "node:assert/strict";
import { test } from "node:test";
import { endCardModel, even, fitPixel, parseDecided, runs, stackLayout, stageShare, trackCrop, unionRect } from "../src/layout.mjs";

const FPS = 60;
const W = { stageW: 716, winW: 533, margin: 22, maxSpeed: 340, fps: FPS };
const frames = (n) => Array.from({ length: n }, (_, k) => k / FPS);
/** A track with one sample per output frame, union from `at(t)` = [x0, x1]. */
const trackOf = (n, at) => frames(n).map((t) => {
  const [x0, x1] = at(t);
  return { t, u: [x0, 150, x1, 600] };
});
const contains = (x, u, m, winW) => u[0] - m >= x - 1e-6 && u[2] + m <= x + winW + 1e-6;

test("static fighters keep the window standing still", () => {
  const track = trackOf(300, () => [200, 480]);
  const { x, snaps, wide } = trackCrop(track, { ...W, times: frames(300) });
  assert.equal(new Set(x.map((v) => v.toFixed(6))).size, 1);
  assert.equal(snaps, 0);
  assert.equal(wide, 0);
  assert.ok(contains(x[0], [200, 0, 480], W.margin, W.winW));
});

test("the window stays on the stage and keeps the fighters plus margin inside", () => {
  // Fighters pace from the left edge to the right edge and back.
  const track = trackOf(600, (t) => {
    const c = 180 + 360 * (0.5 - 0.5 * Math.cos(t * 1.2));
    return [c - 130, c + 130];
  });
  const { x, need, wide } = trackCrop(track, { ...W, times: frames(600) });
  assert.equal(wide, 0);
  x.forEach((v, k) => {
    assert.ok(v >= 0 && v <= W.stageW - W.winW, `frame ${k} off the stage: ${v}`);
    assert.ok(contains(v, need[k], W.margin, W.winW), `frame ${k} cuts the fighters`);
  });
});

test("a smooth track never moves the window faster than maxSpeed", () => {
  const track = trackOf(600, (t) => {
    const c = 250 + 200 * Math.sin(t * 0.9);
    return [c - 100, c + 100];
  });
  const { x, snaps } = trackCrop(track, { ...W, times: frames(600) });
  assert.equal(snaps, 0);
  for (let k = 1; k < x.length; k++) assert.ok(Math.abs(x[k] - x[k - 1]) <= W.maxSpeed / FPS + 1e-9);
});

test("a sudden knockback is caught early: the pan starts before the body gets there", () => {
  // The right fighter flies 150 px right within 0.1 s at t = 2 s.
  const track = trackOf(300, (t) => [150, t < 2 ? 420 : t < 2.1 ? 420 + 1500 * (t - 2) : 570]);
  const { x, need, snaps } = trackCrop(track, { ...W, times: frames(300) });
  x.forEach((v, k) => assert.ok(contains(v, need[k], W.margin, W.winW), `frame ${k} cuts the fighters`));
  assert.equal(snaps, 0);
  assert.ok(x[119] > x[0], "the window has started moving before the hit lands");
});

test("a union wider than the window is centred and counted", () => {
  const track = trackOf(10, () => [50, 650]);
  const { x, wide } = trackCrop(track, { ...W, times: frames(10) });
  assert.equal(wide, 10);
  assert.ok(Math.abs(x[0] + W.winW / 2 - 350) < 1e-6);
});

test("frames without a sample keep the last position", () => {
  const track = [{ t: 0, u: [300, 0, 500, 0] }, { t: 0.5, u: null }];
  const { x } = trackCrop(track, { ...W, times: frames(60) });
  assert.equal(x[59].toFixed(3), x[0].toFixed(3));
});

test("unionRect skips nulls", () => {
  assert.deepEqual(unionRect([null, [1, 2, 3, 4], [0, 3, 2, 9]]), [0, 2, 3, 9]);
  assert.equal(unionRect([null]), null);
});

test("runs groups equal neighbours with inclusive frame ranges", () => {
  assert.deepEqual(runs([1, 1, 2, 2, 2, 1]), [{ from: 0, to: 1, v: 1 }, { from: 2, to: 4, v: 2 }, { from: 5, to: 5, v: 1 }]);
});

test("the decided line parses into its rubric and both values, verbatim", () => {
  assert.deepEqual(parseDecided("DECIDED ON PROOF · 6.7 VS 3.0"), { rubric: "PROOF", first: "6.7", second: "3.0" });
  assert.deepEqual(parseDecided("  DECIDED ON VOICE  ·  8.3 VS 6.3 "), { rubric: "VOICE", first: "8.3", second: "6.3" });
  assert.deepEqual(parseDecided("DECIDED ON PROOF · 10 VS 9.25"), { rubric: "PROOF", first: "10", second: "9.25" });
  assert.equal(parseDecided("DRAW"), null);
  assert.equal(parseDecided(null), null);
});

test("the end card model keeps the page's strings and finds the winner", () => {
  const m = endCardModel({
    cols: [{ name: "Cordinare", total: "2305", win: false }, { name: "insertcoin", total: "2320", win: true }],
    tiers: ["SPLIT DECISION"],
    cards: "2–1 ON THE CARDS",
    decided: "DECIDED ON VOICE · 8.3 VS 6.3",
    decidedWin: "8.3",
  });
  assert.equal(m.winner.name, "insertcoin");
  assert.equal(m.winner.total, "2320");
  assert.equal(m.loser.total, "2305");
  assert.equal(m.cols[0].name, "Cordinare");
  assert.equal(m.tier, "SPLIT DECISION");
  assert.equal(m.cards, "2–1 ON THE CARDS");
  assert.deepEqual(m.decided, { rubric: "VOICE", winner: "8.3", loser: "6.3" });
});

test("two tier badges join with a middle dot; a decided line written loser-first is put right", () => {
  const m = endCardModel({
    cols: [{ name: "A", total: "1", win: true }, { name: "B", total: "0", win: false }],
    tiers: ["KO", "PERFECT"],
    cards: null,
    decided: "DECIDED ON PROOF · 3.0 VS 8.0",
    decidedWin: "8.0",
  });
  assert.equal(m.tier, "KO · PERFECT");
  assert.deepEqual(m.decided, { rubric: "PROOF", winner: "8.0", loser: "3.0" });
});

test("the end card model is null when the page did not give what it needs", () => {
  assert.equal(endCardModel(null), null);
  assert.equal(endCardModel({ cols: [{ name: "A", total: "1", win: true }] }), null);
  assert.equal(endCardModel({ cols: [{ name: "A", total: "", win: true }, { name: "B", total: "2", win: false }] }), null);
  assert.equal(endCardModel({ cols: [{ name: "A", total: "1", win: false }, { name: "B", total: "2", win: false }] }), null);
});

test("a stack is centred vertically on even rows", () => {
  const ys = stackLayout([48, 1300, 32], [96, 96]);
  assert.ok(ys.every((y) => y % 2 === 0));
  const bottom = ys[2] + 32;
  assert.ok(Math.abs(ys[0] - (1920 - bottom)) <= 2);
  assert.equal(ys[1], ys[0] + 48 + 96);
});

test("stage share and even sizes", () => {
  assert.equal(stageShare(608).toFixed(3), "0.317");
  assert.equal(even(809.6), 810);
  assert.equal(even(1), 2);
});

test("fitPixel fits one line of the pixel font or gives up below min", () => {
  assert.equal(fitPixel("ATEL WINS", 960, 72, 32), 72);
  assert.equal(fitPixel("TTRRECHNER WINS", 960, 72, 32), 64);
  assert.equal(fitPixel("A VERY LONG STARTUP NAME THAT GOES ON WINS", 960, 72, 32), null);
});
