import assert from "node:assert/strict";
import { test } from "node:test";
import { MOTIF, THEMES, cuesFromTrack, pickTheme, planScore, renderScore } from "../src/score.mjs";
import { SR } from "../src/synth.mjs";

const CUES = [
  { t: 2.2, kind: "bell", round: 1 },
  { t: 4.0, kind: "hit", weight: "light" },
  { t: 7.5, kind: "hit", weight: "big" },
  { t: 14.8, kind: "bell", round: 2 },
  { t: 17.4, kind: "bell", round: 3 },
  { t: 30.0, kind: "finisher" },
  { t: 36.0, kind: "ending", style: "decision" },
];

test("pickTheme: asked for, else the stage's venue, else the pairing's own draw", () => {
  assert.equal(pickTheme({ theme: "final", venue: "garage", seedKey: "a|b" }), "final");
  assert.equal(pickTheme({ theme: "nope", venue: "rooftop", seedKey: "a|b" }), "rooftop");
  assert.equal(pickTheme({ seedKey: "a|b" }), pickTheme({ seedKey: "a|b" }));
  const drawn = new Set(Array.from({ length: 60 }, (_, i) => pickTheme({ seedKey: `fight ${i}` })));
  assert.deepEqual([...drawn].sort(), ["garage", "orbit", "rooftop"]); // the final's theme is never drawn
});

test("every theme opens its lead with the shared motif", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    const steps = t.lead.a[0].reduce((n, [, len]) => n + len, 0);
    assert.equal(steps, 16, `${name}: a bar is 16 sixteenths`);
    assert.deepEqual(t.lead.a[0], MOTIF, `${name}: bar 1 of phrase A is the motif`);
  }
});

test("cuesFromTrack: bells where the round steps, hits where a bar drops, the ending last", () => {
  const track = [
    { t: 0, hp: [1, 1], round: null },
    { t: 2, hp: [1, 1], round: 1 },
    { t: 3, hp: [1, 0.96], round: 1 },
    { t: 4, hp: [0.9, 0.96], round: 1 },
    { t: 5, hp: [0.9, 0.96], round: 2 },
    { t: 6, hp: [0.9, 0.7], round: 2 },
  ];
  const cues = cuesFromTrack(track, 8);
  assert.deepEqual(cues.map((c) => c.kind), ["bell", "hit", "hit", "bell", "finisher", "ending"]);
  assert.deepEqual(cues.filter((c) => c.kind === "hit").map((c) => c.weight), ["light", "big"]);
  assert.equal(cues.at(-1).style, "decision");
  assert.equal(cuesFromTrack([{ t: 0, hp: [1, 1] }, { t: 1, hp: [1, 0] }], 2).at(-1).style, "ko");
});

test("planScore: a section per round on whole half bars, rising, cut at the finisher", () => {
  const plan = planScore({ cues: CUES, fight: 38, total: 40.5, theme: "garage", seedKey: "a|b" });
  assert.equal(plan.stop, 30);
  assert.deepEqual(plan.sections.map((s) => +s.t0.toFixed(2)), [0, 2.2, 14.8, 17.4]);
  assert.equal(plan.sections[0].level, 0);
  assert.equal(plan.sections.at(-1).level, 3);
  for (let i = 1; i < plan.sections.length; i++) {
    assert.ok(plan.sections[i].level >= plan.sections[i - 1].level, "the fight never gets quieter");
    assert.ok(Math.abs(plan.sections[i].t0 - plan.sections[i - 1].t1) < 1e-9, "sections meet");
  }
  for (const s of plan.sections) {
    assert.equal(s.beats % 2, 0, "whole half bars");
    assert.ok(Math.abs(s.beat * s.beats - (s.t1 - s.t0)) < 1e-9, "the tempo is bent to fit");
    assert.ok(Math.abs(60 / s.beat - THEMES.garage.bpm) < THEMES.garage.bpm * 0.2, "but stays near the theme's");
  }
  // After the blow: silence, then the quiet section, then the jingle on the end card's fade.
  assert.ok(plan.after.t0 - plan.stop >= 1 && plan.after.level === 0);
  assert.ok(Math.abs(plan.jingle.at - 38) <= 0.2 && plan.jingle.at >= plan.after.t1);
});

test("planScore without bells or cues still plays: one section, an ending", () => {
  const plan = planScore({ cues: [], fight: 20, total: 22.5, theme: "rooftop", seedKey: "x" });
  assert.equal(plan.sections.length, 1);
  assert.ok(plan.stop <= 20);
});

test("renderScore: the same fight gives the same samples, inside full scale, silent after the cut", () => {
  const plan = () => planScore({ cues: CUES, fight: 38, total: 40.5, theme: "orbit", seedKey: "a|b" });
  const a = renderScore(plan()).mix;
  const b = renderScore(plan()).mix;
  assert.equal(a.n, Math.ceil(40.5 * SR));
  assert.ok(a.peak() <= 1);
  assert.ok(a.rms(5, 12) > 0.02, "music under the fight");
  for (let i = 0; i < a.n; i += 997) assert.equal(a.l[i], b.l[i]);
  const other = renderScore(planScore({ cues: CUES, fight: 38, total: 40.5, theme: "garage", seedKey: "a|b" })).mix;
  let differ = 0;
  for (let i = 0; i < a.n; i += 997) if (a.l[i] !== other.l[i]) differ++;
  assert.ok(differ > 100, "another theme is another track");
});
