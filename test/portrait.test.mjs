import assert from "node:assert/strict";
import { test } from "node:test";
import { planPage, tallUrl, windowCommands } from "../src/portrait.mjs";

// A 1432 x 800 stage padded to 1432 square: wide 4:3 at the start, a push-in,
// a held square, a move, then the pull-out to the whole stage.
const plan = {
  iw: 1432,
  padH: 1432,
  wins: [
    { w: 1066, x: 183, y: 183 },
    { w: 1066, x: 183, y: 183 },
    { w: 900, x: 266, y: 266 },
    { w: 800, x: 316, y: 316 },
    { w: 800, x: 316, y: 316 },
    { w: 800, x: 400, y: 316 },
    { w: 1432, x: 0, y: 0 },
  ],
};

test("windowCommands: the zoom is the scale, the crop only moves and never leaves the scaled stage", () => {
  const { first, lines } = windowCommands(plan, 1080, 60);
  assert.deepEqual(first, { zw: 1450, zh: 1450, x: 185, y: 185 });
  // Frames 1 and 4 repeat the one before: no line for them.
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^0\.000000 scale@zoom w 1450, scale@zoom h 1450, crop@win x 185, crop@win y 185;$/);
  // Half a frame early.
  assert.match(lines[1], /^0\.025000 scale@zoom w 1718, scale@zoom h 1718, /);
  // A move at the same size: the crop alone.
  assert.match(lines[3], /^0\.075000 crop@win x 540, crop@win y 427;$/);
  // The whole stage: scaled to the side, crop at the origin.
  assert.match(lines[4], /scale@zoom w 1080, scale@zoom h 1080, crop@win x 0, crop@win y 0;$/);
  for (const l of lines) {
    for (const [, k, v] of l.matchAll(/crop@win (x|y) (\d+)/g)) assert.ok(Number(v) >= 0, `${k} ${v}`);
  }
  // Never a size on the crop: ffmpeg 6.1 hangs on that.
  assert.ok(lines.every((l) => !/crop@win [wh] /.test(l)));
});

test("tallUrl: asks for the 9:16 frame and keeps the rest of the URL", () => {
  assert.equal(tallUrl("http://localhost:3000/preview/exhibition/a-vs-b?stage=on"), "http://localhost:3000/preview/exhibition/a-vs-b?stage=on&layout=916");
  assert.equal(tallUrl("http://localhost:3000/preview/exhibition/a-vs-b?stage=on&venue=pitch&layout=x"), "http://localhost:3000/preview/exhibition/a-vs-b?stage=on&venue=pitch&layout=916");
});

// What record.mjs TALL measures on insertcoin's 9:16 frame: 432x768 CSS px at
// the viewport's origin, the stage 84 px down, the name plate in the desk's front.
const tall = {
  dpr: 2.5,
  box: { x: 0, y: 84, w: 432, h: 324 },
  rects: { frame: { x: 0, y: 0, w: 432, h: 768 }, mark: { x: 85, y: 676, w: 262, h: 42 } },
};

test("planPage: the frame is the video, uncropped and unscaled", () => {
  const plan = planPage(tall);
  assert.deepEqual(plan.crop, { x: 0, y: 0, w: 1080, h: 1920 });
  assert.equal(plan.k, 1);
  assert.equal(plan.flags, "neighbor");
  // The stage is the same 4:3 window A shows; what changed is everything around it.
  assert.equal(plan.share.stage.toFixed(3), "0.422");
  // The end card's domain line on the centre of the name plate: (676 + 21) * 2.5 - 16.
  assert.equal(plan.domainY, 1727);
});

test("planPage: a frame in a wider window is cut out where it stands and scaled to 1080 wide", () => {
  const plan = planPage({ ...tall, dpr: 2, rects: { frame: { x: 104, y: 16, w: 432, h: 768 }, mark: null } });
  assert.deepEqual(plan.crop, { x: 208, y: 32, w: 864, h: 1536 });
  assert.equal(plan.k, 1.25);
  assert.equal(plan.flags, "lanczos");
  assert.equal(plan.domainY, 1760);
});

test("planPage: a page without the frame is refused, never filmed as it is", () => {
  assert.throws(() => planPage({ dpr: 2.5, box: tall.box, rects: { frame: null, mark: null } }), /no 9:16 frame/);
  assert.throws(() => planPage({ dpr: 2.5, box: tall.box }), /no 9:16 frame/);
  assert.throws(() => planPage({ ...tall, rects: { frame: { x: 0, y: 0, w: 432, h: 608 } } }), /not 9:16/);
});
