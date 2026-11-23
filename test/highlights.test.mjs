import assert from "node:assert/strict";
import { test } from "node:test";
import { planHighlights } from "../src/highlights.mjs";

const T = 1000;
const cue = (kind, t, more = {}) => ({ kind, t: T + t, ...more });
const hit = (t, weight = "light") => cue("hit", t, { weight });

test("big hits, a combo, the finisher, WINS and the end card, in playing order", () => {
  const meta = {
    tVs: T,
    cues: [hit(6.3), hit(6.5), hit(10.1, "big"), hit(17.2, "big"), hit(21.6), hit(21.8), hit(22.0), cue("finisher", 28.7), cue("ending", 29.6)],
  };
  const plan = planHighlights(meta, 37.3);
  assert.deepEqual(plan.map((s) => s.what), ["big hit", "big hit", "3-hit combo", "finisher and K.O.", "WINS", "end card"]);
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i].from >= plan[i - 1].to, "segments never overlap");
  const total = plan.reduce((n, s) => n + s.to - s.from, 0);
  assert.ok(total > 9 && total < 13, `about 11 s, got ${total}`);
  assert.ok(plan.at(-1).to <= 37.3);
});

test("a fight with one big hit is filled up with shorter runs", () => {
  const meta = { tVs: T, cues: [hit(5.3), hit(5.5), hit(7.4), hit(23.9, "big"), cue("finisher", 33), cue("ending", 34.8)] };
  const plan = planHighlights(meta, 42);
  assert.equal(plan.filter((s) => /hit/.test(s.what)).length, 3);
});

test("hits inside the finisher's wind-up are not cut twice", () => {
  const meta = { tVs: T, cues: [hit(10, "big"), hit(27, "big"), cue("finisher", 28.7), cue("ending", 29.6)] };
  const plan = planHighlights(meta, 37.3);
  assert.equal(plan.filter((s) => s.what === "big hit").length, 1);
});

test("WINS is left out when the end card follows the K.O. directly", () => {
  const meta = { tVs: T, cues: [hit(10, "big"), cue("finisher", 30), cue("ending", 31)] };
  const plan = planHighlights(meta, 35);
  assert.ok(!plan.some((s) => s.what === "WINS"));
});

test("a recording without an ending cue is refused", () => {
  assert.throws(() => planHighlights({ tVs: T, cues: [hit(3)] }, 30), /no ending cue/);
});
