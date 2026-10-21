// Records one fight off the public match page with the CDP screencast.
//
// Why the screencast and not Playwright's recordVideo: recordVideo writes a
// soft ~25 fps VP8 that smears the pixel art. The screencast hands over a
// JPEG per changed frame with the browser's own timestamp, at device scale 2
// (only with --force-device-scale-factor in headless), and src/build.mjs
// turns that into a steady 30 fps. Same method as the first fight video,
// recorded by hand on 05.10.2026.
//
// The page plays in slow motion (src/slowclock.js, SLOW = a quarter of the
// speed): the runner paints a 2x stage at only ~18-27 frames a second, which
// lost every drawing that stands for one or two frames. The timestamps that
// come back are squeezed into page time (frames.mjs pageTime), so everything
// downstream sees a fight at normal speed.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { pageTime } from "./frames.mjs";

const SLOWCLOCK = fs.readFileSync(new URL("./slowclock.js", import.meta.url), "utf8");
/** How fast the page plays while it is recorded. 0.25 paints ~70 page frames a second on a runner. */
export const SLOW = Number(process.env.SLOW || 0.25);

const DPR = 2;
const VIEWPORT = { width: 1280, height: 720 };
/** Longest a fight may run (page time) before the recording gives up. Real ones are ~25-50 s. */
const MAX_FIGHT_MS = 90_000;

export class NoStageError extends Error {}

/**
 * @param {string} pageUrl the public match page
 * @param {string} outDir frames land in outDir/f, metadata in outDir/meta.json
 * @returns {Promise<{ frames: {name: string, t: number}[], box: {x:number,y:number,w:number,h:number},
 *   dpr: number, tVs: number, tEnd: number }>}
 */
export async function recordFight(pageUrl, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "f"), { recursive: true });

  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${DPR}`] });
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
    await ctx.addInitScript({ content: `window.__SLOW_K__ = ${SLOW};\n${SLOWCLOCK}` });
    const page = await ctx.newPage();
    // ?stage=on: the stage runs even if this context had seen the fight
    // (lib/fight/stageOff.ts). A fresh context has not, so it is belt and braces.
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });
    const arena = await page.waitForSelector("canvas.fr-arena", { timeout: 20_000 }).catch(() => null);
    if (!arena) throw new NoStageError("no fight stage on the page");
    await page.waitForTimeout(2500);

    // REPLAY scrolls .fr-root to the top of the window (bringStageIntoView in
    // the app's FightReplay.tsx), smoothly and on the real clock, so the slow
    // clock does not stretch it: ~200 ms of the page moving 94 px while the
    // stage already shows the replay, and those frames opened every video.
    // Putting the root there first, at once, leaves that scroll nothing to do.
    await page.evaluate(() => {
      document.querySelector(".fr-root")?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    await page.waitForTimeout(800);

    // The two instants the cut is made from, stamped by the page itself on
    // the browser's clock (the same clock the screencast timestamps use):
    // the VS card standing complete, and the stage handing over to the end card.
    //
    // The cut opens on the finished VS card, not on its slide-in: frame 0 is
    // the preview image on iOS and X (Alper, 21.10.2026). .fr-vs stays at
    // opacity 1 from the last fight into the replay, so its opacity says
    // nothing (it stamped the instant of the click). REPLAY instead puts the
    // halves off the stage and the VS word at opacity 0, slides the halves
    // back in, then zooms the word in. The card is complete on the first
    // frame after that with neither the halves nor the word animating, the
    // word fully there and the stage standing still; the stage box is
    // measured in that same frame.
    await page.evaluate(() => {
      const w = window;
      w.__rec = { vs: 0, end: 0, box: null };
      const root = document.querySelector(".fr-root");
      const stage = document.querySelector(".fr-box");
      const half = document.querySelector(".fr-vs-l");
      const word = document.querySelector('[data-fr="vs-word"]');
      const moving = (el) => el.getAnimations().some((a) => a.playState === "running");
      let away = false; // REPLAY has put the left half off the stage
      let lastY = null;
      // The real clock (slowclock.js): the screencast stamps frames with it.
      const tick = () => {
        const now = w.__realNow();
        if (!w.__rec.vs && half && word && stage) {
          const r = stage.getBoundingClientRect();
          const still = lastY !== null && Math.abs(r.y - lastY) < 0.5;
          lastY = r.y;
          if (!away) {
            away = half.getBoundingClientRect().x < r.x - 8;
          } else if (still && !moving(half) && !moving(word) && Number(getComputedStyle(word).opacity) > 0.99) {
            w.__rec.vs = now;
            w.__rec.box = { x: r.x, y: r.y, w: r.width, h: r.height };
          }
        }
        if (!w.__rec.end && root?.dataset.phase === "end") w.__rec.end = now;
        if (!w.__rec.end) requestAnimationFrame(tick);
      };
      w.__rec.start = () => requestAnimationFrame(tick);
    });

    const cdp = await ctx.newCDPSession(page);
    const frames = [];
    let n = 0;
    cdp.on("Page.screencastFrame", (e) => {
      const name = `f/${String(n++).padStart(5, "0")}.jpg`;
      fs.writeFileSync(path.join(outDir, name), Buffer.from(e.data, "base64"));
      frames.push({ name, t: e.metadata.timestamp });
      cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 95,
      everyNthFrame: 1,
      maxWidth: VIEWPORT.width * DPR,
      maxHeight: VIEWPORT.height * DPR,
    });
    await page.waitForTimeout(500);

    const tClick = Date.now(); // Node's clock, the real one
    await page.evaluate(() => window.__rec.start());
    await page.getByRole("button", { name: /REPLAY/ }).first().click();

    // Only for a probe that misses the VS card (its markup changed): the box
    // once the page has settled after the click.
    await page.waitForTimeout(700);
    const settled = await page.evaluate(() => {
      const r = document.querySelector(".fr-box").getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    await page.waitForFunction(() => window.__rec.end > 0, null, { timeout: MAX_FIGHT_MS / SLOW, polling: 100 });
    await page.waitForTimeout(300);
    await cdp.send("Page.stopScreencast");
    const marks = await page.evaluate(() => ({ vs: window.__rec.vs, end: window.__rec.end, box: window.__rec.box }));
    if (!marks.vs) console.warn("VS card not seen; cutting at a fixed delay after the click");
    const box = marks.box ?? settled;

    // Seconds, like the screencast, squeezed into page time around the
    // first frame. A missed VS card starts the cut at a fixed delay after the
    // click, which is where it was on 05.10.
    const t0 = frames[0]?.t ?? 0;
    const page_ = (t) => pageTime(t, t0, SLOW);
    const meta = {
      dpr: DPR,
      slow: SLOW,
      box,
      frames: frames.map((f) => ({ name: f.name, t: page_(f.t) })),
      tVs: page_((marks.vs || tClick + 190 / SLOW) / 1000),
      tEnd: page_(marks.end / 1000),
    };
    fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta));
    return meta;
  } finally {
    await browser.close();
  }
}
