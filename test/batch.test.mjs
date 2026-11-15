import assert from "node:assert/strict";
import test from "node:test";
import { batchSummary, parseBatch } from "../src/batch.mjs";

test("parseBatch: ids, URLs, titles, comments and blank lines", () => {
  const jobs = parseBatch(`# bracket week 1

7fb30586-bf0a-401b-9cfb-90ce8749ee11 | CORDINARE | ATEL
http://localhost:3000/preview/exhibition/cursor-devin?stage=on | CURSOR | DEVIN
87c5d467-459b-49c7-b4b5-6ea725ada047
`);
  assert.deepEqual(jobs, [
    { line: 3, matchId: "7fb30586-bf0a-401b-9cfb-90ce8749ee11", slug: "7fb30586-bf0a-401b-9cfb-90ce8749ee11", title: { a: "CORDINARE", b: "ATEL" } },
    { line: 4, url: "http://localhost:3000/preview/exhibition/cursor-devin?stage=on", slug: "cursor-devin", title: { a: "CURSOR", b: "DEVIN" } },
    { line: 5, matchId: "87c5d467-459b-49c7-b4b5-6ea725ada047", slug: "87c5d467-459b-49c7-b4b5-6ea725ada047" },
  ]);
});

test("parseBatch: says which line is wrong", () => {
  assert.throws(() => parseBatch("abc | ONLY_ONE"), /line 1/);
  assert.throws(() => parseBatch("ok\nnot an id!"), /line 2: "not an id!"/);
  assert.throws(() => parseBatch("a | X | Y | Z"), /line 1/);
  assert.throws(() => parseBatch("ftp://x/y"), /neither a match id nor/);
});

test("parseBatch: the same fight twice would overwrite its own out dir", () => {
  assert.throws(() => parseBatch("abc\nabc"), /abc twice/);
});

test("parseBatch: an empty file is an error, not a silent no-op", () => {
  assert.throws(() => parseBatch("# only a comment\n\n"), /no fights/);
});

test("batchSummary: counts and names the failures", () => {
  const s = batchSummary([
    { slug: "a", ok: true, seconds: 241.2 },
    { slug: "b", ok: false, error: "no fight stage on the page" },
    { slug: "c", ok: false, error: "page.goto: net::ERR_CONNECTION_REFUSED\nCall log:\n  - navigating" },
  ]);
  assert.match(s, /FAILED c {2}page\.goto: net::ERR_CONNECTION_REFUSED$/m);
  assert.doesNotMatch(s, /Call log/);
  assert.match(s, /^batch: 1\/3 rendered$/m);
  assert.match(s, /ok {5}a {2}241 s render/);
  assert.match(s, /FAILED b {2}no fight stage on the page/);
});
