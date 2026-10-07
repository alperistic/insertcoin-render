// Records one fight off the public match page with the CDP screencast.
//
// Why the screencast and not Playwright's recordVideo: recordVideo writes a
// soft ~25 fps VP8 that smears the pixel art. The screencast hands over a
// JPEG per changed frame with the browser's own timestamp, at device scale 2
// (only with --force-device-scale-factor in headless), and src/build.mjs
// turns that into a steady 30 fps. Same method as the first fight video,
// recorded by hand on 05.10.2026.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DPR = 2;
const VIEWPORT = { width: 1280, height: 720 };
/** Longest a fight may run before the recording gives up. Real ones are ~25 s. */
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
    const page = await ctx.newPage();
    // ?stage=on: the stage runs even if this context had seen the fight
    // (lib/fight/stageOff.ts). A fresh context has not, so it is belt and braces.
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });
    const arena = await page.waitForSelector("canvas.fr-arena", { timeout: 20_000 }).catch(() => null);
    if (!arena) throw new NoStageError("no fight stage on the page");
    await page.waitForTimeout(2500);

    // REPLAY scrolls the stage into view; doing it first keeps the stage
    // still in the frame while the recording runs.
    await page.evaluate(() => {
      document.querySelector(".fr-box")?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(800);

    // The two instants the cut is made from, stamped by the page itself on
    // the browser's clock (the same clock the screencast timestamps use):
    // the VS card becoming visible, and the stage handing over to the end card.
    await page.evaluate(() => {
      const w = window;
      w.__rec = { vs: 0, end: 0 };
      const root = document.querySelector(".fr-root");
      const vs = document.querySelector(".fr-vs");
      const tick = () => {
        const now = performance.timeOrigin + performance.now();
        if (!w.__rec.vs && vs && Number(getComputedStyle(vs).opacity) > 0.5 && getComputedStyle(vs).visibility !== "hidden") {
          w.__rec.vs = now;
        }
        if (w.__rec.armed && !w.__rec.end && root?.dataset.phase === "end") w.__rec.end = now;
        if (!w.__rec.end) requestAnimationFrame(tick);
      };
      w.__rec.start = () => {
        w.__rec.vs = 0;
        w.__rec.armed = true;
        requestAnimationFrame(tick);
      };
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

    const tClick = Date.now();
    await page.evaluate(() => window.__rec.start());
    await page.getByRole("button", { name: /REPLAY/ }).first().click();

    // Measured after the click: starting the replay moves the page (the stage
    // sat ~94 px higher than before the click), and a box taken earlier cut
    // the HUD off the top of every frame.
    await page.waitForTimeout(700);
    const box = await page.evaluate(() => {
      const r = document.querySelector(".fr-box").getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    await page.waitForFunction(() => window.__rec.end > 0, null, { timeout: MAX_FIGHT_MS, polling: 100 });
    await page.waitForTimeout(300);
    await cdp.send("Page.stopScreencast");
    const marks = await page.evaluate(() => ({ vs: window.__rec.vs, end: window.__rec.end }));

    const meta = {
      dpr: DPR,
      box,
      frames,
      // Seconds, like the screencast. A VS card the probe never saw starts
      // the cut just after the click, which is where it was on 05.10.
      tVs: (marks.vs || tClick + 190) / 1000,
      tEnd: marks.end / 1000,
    };
    fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta));
    return meta;
  } finally {
    await browser.close();
  }
}
