import assert from "node:assert/strict";
import test from "node:test";
import { resolveTitle } from "../src/titles.mjs";

// meta.hud and meta.endcard as the real recording of 11111111… read them (14.11.2026).
const rec = {
  hud: [{ name: "ACME", record: "0–2" }, { name: "Initechlab", record: "0–1" }],
  endcard: { cols: [{ name: "ACME", total: "1925", win: true }, { name: "Initechlab", total: "1635", win: false }] },
};

test("resolveTitle: the job's titles win", () => {
  assert.deepEqual(resolveTitle({ a: "NORTHWIND", b: "ACME" }, rec), { title: { a: "NORTHWIND", b: "ACME" }, from: "given" });
});

test("resolveTitle: no titles -> the page HUD's names, side a left, upper-case", () => {
  assert.deepEqual(resolveTitle({ a: null, b: null }, rec), { title: { a: "ACME", b: "INITECHLAB" }, from: "page hud" });
});

test("resolveTitle: one side given keeps it, the other from the page", () => {
  assert.deepEqual(resolveTitle({ a: null, b: "TTR" }, rec).title, { a: "ACME", b: "TTR" });
});

test("resolveTitle: no HUD read (PORTRAIT=a) -> the end card's columns", () => {
  assert.deepEqual(resolveTitle(undefined, { endcard: rec.endcard }), { title: { a: "ACME", b: "INITECHLAB" }, from: "page end card" });
});

test("resolveTitle: half a pair is not a pair; nothing readable -> FIGHTER A/B with a warning", () => {
  const r = resolveTitle({}, { hud: [{ name: "ACME" }, { name: "" }], endcard: null });
  assert.equal(r.from, "fallback");
  assert.deepEqual(r.title, { a: "FIGHTER A", b: "FIGHTER B" });
  assert.match(r.warn, /FIGHTER A/);
});
