import assert from "node:assert/strict";
import { test } from "node:test";
import { windowCommands } from "../src/portrait.mjs";

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
