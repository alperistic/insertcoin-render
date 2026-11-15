import assert from "node:assert/strict";
import test from "node:test";
import { resolveTitle } from "../src/titles.mjs";

// meta.hud and meta.endcard as the real recording of 7fb30586… read them (14.11.2026).
const rec = {
  hud: [{ name: "ATEL", record: "0–2" }, { name: "Ttrrechner", record: "0–1" }],
  endcard: { cols: [{ name: "ATEL", total: "1925", win: true }, { name: "Ttrrechner", total: "1635", win: false }] },
};

test("resolveTitle: the job's titles win", () => {
  assert.deepEqual(resolveTitle({ a: "CORDINARE", b: "ATEL" }, rec), { title: { a: "CORDINARE", b: "ATEL" }, from: "given" });
});

test("resolveTitle: no titles -> the page HUD's names, side a left, upper-case", () => {
  assert.deepEqual(resolveTitle({ a: null, b: null }, rec), { title: { a: "ATEL", b: "TTRRECHNER" }, from: "page hud" });
});

test("resolveTitle: one side given keeps it, the other from the page", () => {
  assert.deepEqual(resolveTitle({ a: null, b: "TTR" }, rec).title, { a: "ATEL", b: "TTR" });
});

test("resolveTitle: no HUD read (PORTRAIT=a) -> the end card's columns", () => {
  assert.deepEqual(resolveTitle(undefined, { endcard: rec.endcard }), { title: { a: "ATEL", b: "TTRRECHNER" }, from: "page end card" });
});

test("resolveTitle: half a pair is not a pair; nothing readable -> FIGHTER A/B with a warning", () => {
  const r = resolveTitle({}, { hud: [{ name: "ATEL" }, { name: "" }], endcard: null });
  assert.equal(r.from, "fallback");
  assert.deepEqual(r.title, { a: "FIGHTER A", b: "FIGHTER B" });
  assert.match(r.warn, /FIGHTER A/);
});
