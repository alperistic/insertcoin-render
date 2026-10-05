import assert from "node:assert/strict";
import { test } from "node:test";
import { frameSequence, maxGap, titleLayout } from "../src/frames.mjs";

const at = (...ts) => ts.map((t) => ({ t }));

test("each output frame shows the last captured frame at or before its instant", () => {
  const frames = at(0, 0.05, 0.1, 0.2);
  assert.deepEqual(frameSequence(frames, { start: 0, last: 0.2, hold: 0, fps: 20 }), [0, 1, 2, 2]);
});

test("the last usable frame is held for `hold` seconds, frames after `last` never show", () => {
  const frames = at(0, 0.1, 0.2, 0.3);
  const seq = frameSequence(frames, { start: 0, last: 0.2, hold: 0.2, fps: 10 });
  assert.deepEqual(seq, [0, 1, 2, 2]);
});

test("a window starting before the first frame starts on the first frame", () => {
  const frames = at(1, 1.5);
  assert.deepEqual(frameSequence(frames, { start: 0.5, last: 1.5, hold: 0, fps: 2 }), [0, 0]);
});

test("an empty window is an error, not an empty video", () => {
  assert.throws(() => frameSequence(at(0, 1), { start: 2, last: 1, hold: 0, fps: 30 }));
});

test("maxGap measures only inside the window", () => {
  assert.equal(maxGap(at(0, 5, 5.05, 5.1, 9), 5, 5.1).toFixed(2), "0.05");
});

test("a short title stays on one line at the largest size", () => {
  assert.deepEqual(titleLayout("CORDINARE", "ATEL"), { size: 48, lines: ["CORDINARE vs ATEL"] });
});

test("a long title breaks into name, vs, name", () => {
  const t = titleLayout("ATEL MARKETING SOLUTIONS", "CORDINARE ENTERPRISE CLOUD");
  assert.deepEqual(t.lines, ["ATEL MARKETING SOLUTIONS", "vs", "CORDINARE ENTERPRISE CLOUD"]);
  assert.ok(t.size * 26 <= 960);
});
