import assert from "node:assert/strict";
import { test } from "node:test";
import { endCardModel } from "../src/layout.mjs";
import { endCardHtml } from "../src/stills.mjs";

const model = endCardModel({
  cols: [
    { name: "Cursor", total: "1975", win: true },
    { name: "Devin", total: "1935", win: false },
  ],
  tiers: ["SPLIT"],
});
const O = { w: 1080, h: 1920, domainY: 1760, domainSize: 40, note: true };

test("end card carries no extra line unless ENDCARD_LINE names one", () => {
  assert.ok(model);
  assert.ok(!endCardHtml(model, O).includes("data-endcard-line"));
  assert.ok(!endCardHtml(model, { ...O, line: "" }).includes("data-endcard-line"));
});

test("the extra line is drawn escaped, after the scorecard note", () => {
  const html = endCardHtml(model, { ...O, line: "AI judges · exhibition · not affiliated <b>" });
  assert.ok(html.includes("data-endcard-line"));
  assert.ok(html.includes("AI judges · exhibition · not affiliated &lt;b&gt;"));
  assert.ok(html.indexOf("judges' scorecards") < html.indexOf("data-endcard-line"));
});
