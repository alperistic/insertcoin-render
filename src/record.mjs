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
 * The phone pass of candidate A (PORTRAIT=a): the page's compact layout
 * (width <= 767 px) with its own HUD above the stage and the commentary
 * below. 432 CSS px at device scale 2.5 is 1080 device px, the width of
 * the 9:16, so the crop takes the whole width, the page's own 24 px margins
 * included, and needs no scaling. 608 high holds HUD, buttons, stage and
 * commentary after the root is scrolled to the top (they end at ~550).
 * The commentary grows with a long quote (min 88 px, 112 seen), so its
 * tallest is measured over the whole fight (grow), not in the VS frame.
 */
export const PHONE = {
  viewport: { width: 432, height: 608 },
  dpr: 2.5,
  measure: { hud: ".fr-mobile-hud", box: ".fr-box", commentary: ".fr-commentary", ctrl: ".fr-ctrl" },
  grow: { commentary: ".fr-commentary" },
};

/**
 * @param {string} pageUrl the public match page
 * @param {string} outDir frames land in outDir/f, metadata in outDir/meta.json
 * @param {{ viewport?: {width:number,height:number}, dpr?: number, measure?: Record<string,string>,
 *   grow?: Record<string,string>, track?: boolean, readEnd?: boolean }} [opts]
 *   viewport/dpr: the page size (defaults: the 16:9 recording); measure:
 *   more rects to take in the VS frame, next to the box (meta.rects);
 *   grow: rects whose union from the VS card to the end counts (meta.grow);
 *   track: sample the fighters' bounds, HP and round on every page frame
 *   (meta.track, candidate B); readEnd: read the end card's text once the
 *   stage has ended (meta.endcard, ENDCARD=1)
 * @returns {Promise<{ frames: {name: string, t: number}[], box: {x:number,y:number,w:number,h:number},
 *   dpr: number, tVs: number, tEnd: number }>}
 */
export async function recordFight(pageUrl, outDir, opts = {}) {
  const viewport = opts.viewport ?? VIEWPORT;
  const dpr = opts.dpr ?? DPR;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "f"), { recursive: true });

  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${dpr}`] });
  try {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr });
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

    // At a phone viewport the stage is in view on load and starts the fight
    // by itself, and REPLAY only shows once it is over. SHOW RESULT skips
    // there, so REPLAY can start it from the VS card like on the desktop.
    // (The desktop's REPLAY is there from the start; this never runs for it.)
    const replay = page.getByRole("button", { name: /REPLAY/ }).first();
    if (!(await replay.isVisible())) {
      await page.getByRole("button", { name: /SHOW RESULT/ }).first().click();
      await replay.waitFor({ state: "visible", timeout: 30_000 });
      await page.evaluate(() => {
        document.querySelector(".fr-root")?.scrollIntoView({ block: "start", behavior: "instant" });
      });
      await page.waitForTimeout(800);
    }

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
    await page.evaluate(({ measure, grow, track }) => {
      const w = window;
      w.__rec = { vs: 0, end: 0, box: null, rects: null, grow: grow ? {} : null, track: track ? [] : null };
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
            if (measure) {
              w.__rec.rects = {};
              for (const [name, sel] of Object.entries(measure)) {
                const el = document.querySelector(sel);
                const m = el?.getBoundingClientRect();
                w.__rec.rects[name] = m && m.width > 0 ? { x: m.x, y: m.y, w: m.width, h: m.height } : null;
              }
            }
          }
        }
        if (w.__rec.track && stage) w.__rec.track.push(sample(now, stage.getBoundingClientRect()));
        if (grow && w.__rec.vs) {
          for (const [name, sel] of Object.entries(grow)) {
            const m = document.querySelector(sel)?.getBoundingClientRect();
            if (!m || !m.width) continue;
            const g = w.__rec.grow[name];
            w.__rec.grow[name] = g
              ? { x: Math.min(g.x, m.x), y: Math.min(g.y, m.y), r: Math.max(g.r, m.right), b: Math.max(g.b, m.bottom) }
              : { x: m.x, y: m.y, r: m.right, b: m.bottom };
          }
        }
        // Only an end after the replay has left the last one (SHOW RESULT above).
        if (root?.dataset.phase !== "end") w.__rec.running = true;
        if (!w.__rec.end && w.__rec.running && root?.dataset.phase === "end") w.__rec.end = now;
        if (!w.__rec.end) requestAnimationFrame(tick);
      };

      // Candidate B's camera follows what this samples: where both fighters
      // stand on this frame, box-local CSS px. A pose is an <svg> whose
      // data-ink names the drawn part of its viewBox (the rest is empty
      // canvas, up to half the box), so that part is what counts; weapons are
      // drawn into the pose. A fighter facing left is the same svg mirrored
      // (scale: -1 1 on .fr-body), so its ink is mirrored too. Afterimages (.fr-ghosts) count like
      // fighters. Effects (.fr-fx) count too, by what their svg draws
      // (getBBox: a slash frame's box is far bigger than the slash), unless
      // they fill the stage (the hit spark, the super flash), which follow
      // nobody.
      const fx = document.querySelector('[data-fr="fx"]');
      const ghosts = document.querySelector('[data-fr="ghosts"]');
      const actors = ["a", "b"].map((s) => document.querySelector(`[data-fr="actor-${s}"]`));
      const hpEl = ["a", "b"].map((s) => document.querySelector(`[data-fr="hpf-${s}"]`));
      const roundEl = document.querySelector('[data-fr="round-box"]');
      // The drawn part in the svg's own units, mapped to the window through
      // its screen CTM, which carries every CSS transform above it (facing,
      // tilt, the camera's zoom) — checked against getBoundingClientRect.
      const inkOf = (svg) => {
        const r = svg.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        let ink = (svg.dataset.ink || "").split(",").map(Number);
        if (ink.length !== 4 || ink.some((v) => !Number.isFinite(v))) {
          let bb = null;
          try {
            bb = svg.getBBox();
          } catch {}
          if (!bb || bb.width <= 0 || bb.height <= 0) return null;
          ink = [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height];
        }
        const m = svg.getScreenCTM();
        if (!m) return [r.left, r.top, r.right, r.bottom];
        const xs = [];
        const ys = [];
        for (const [x, y] of [[ink[0], ink[1]], [ink[2], ink[1]], [ink[0], ink[3]], [ink[2], ink[3]]]) {
          const q = new DOMPoint(x, y).matrixTransform(m);
          xs.push(q.x);
          ys.push(q.y);
        }
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      };
      // Effects: an svg counts by what it draws, an element holding svgs by
      // those, any other element by its box; never anything inside an svg.
      const effects = (el, sr, add) => {
        for (const e of el.children) {
          let q = null;
          if (e.tagName.toLowerCase() === "svg") q = inkOf(e);
          else if (e.querySelector("svg")) {
            effects(e, sr, add);
            continue;
          } else {
            const b = e.getBoundingClientRect();
            if (b.width > 0 && b.height > 0) q = [b.left, b.top, b.right, b.bottom];
            if (e.children.length) effects(e, sr, add);
          }
          if (q && q[2] - q[0] < sr.width * 0.6 && q[3] - q[1] < sr.height * 0.6) add(q);
        }
      };
      const sample = (now, sr) => {
        let u = null;
        const add = (q) => {
          if (q) u = u ? [Math.min(u[0], q[0]), Math.min(u[1], q[1]), Math.max(u[2], q[2]), Math.max(u[3], q[3])] : q;
        };
        for (const a of actors) a?.querySelectorAll(".fr-pose.on svg").forEach((svg) => add(inkOf(svg)));
        ghosts?.querySelectorAll("svg").forEach((svg) => add(inkOf(svg)));
        if (fx) effects(fx, sr, add);
        const hp = hpEl.map((e) => {
          const m = /scaleX\(([-\d.e]+)\)/.exec(e?.style.transform || "");
          return m ? Math.max(0, Math.min(1, Number(m[1]))) : 1;
        });
        const rd = /(\d+)/.exec(roundEl?.textContent || "");
        const r1 = (v) => Math.round(v * 10) / 10;
        return {
          t: now,
          u: u && [r1(u[0] - sr.x), r1(u[1] - sr.y), r1(u[2] - sr.x), r1(u[3] - sr.y)],
          hp: hp.map((v) => Math.round(v * 1000) / 1000),
          round: rd ? Number(rd[1]) : null,
        };
      };
      w.__rec.start = () => requestAnimationFrame(tick);
    }, { measure: opts.measure ?? null, grow: opts.grow ?? null, track: !!opts.track });

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
      maxWidth: Math.round(viewport.width * dpr),
      maxHeight: Math.round(viewport.height * dpr),
    });
    await page.waitForTimeout(500);

    const tClick = Date.now(); // Node's clock, the real one
    await page.evaluate(() => window.__rec.start());
    await replay.click();

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
    const extra =
      opts.measure || opts.grow || opts.track
        ? await page.evaluate(() => ({ rects: window.__rec.rects, grow: window.__rec.grow, track: window.__rec.track }))
        : {};
    const hud = opts.track ? await readHud(page) : null;
    const endcard = opts.readEnd ? await readEndCard(page) : null;
    if (!marks.vs) console.warn("VS card not seen; cutting at a fixed delay after the click");
    const box = marks.box ?? settled;

    // Seconds, like the screencast, squeezed into page time around the
    // first frame. A missed VS card starts the cut at a fixed delay after the
    // click, which is where it was on 05.10.
    const t0 = frames[0]?.t ?? 0;
    const page_ = (t) => pageTime(t, t0, SLOW);
    const meta = {
      dpr,
      slow: SLOW,
      box,
      frames: frames.map((f) => ({ name: f.name, t: page_(f.t) })),
      tVs: page_((marks.vs || tClick + 190 / SLOW) / 1000),
      tEnd: page_(marks.end / 1000),
    };
    if (opts.viewport) meta.viewport = viewport;
    if (opts.measure) meta.rects = extra.rects ?? null;
    if (opts.grow) {
      meta.grow = Object.fromEntries(Object.entries(extra.grow ?? {}).map(([k, g]) => [k, { x: g.x, y: g.y, w: g.r - g.x, h: g.b - g.y }]));
    }
    if (opts.track) {
      meta.track = (extra.track ?? []).map((s) => ({ ...s, t: page_(s.t / 1000) }));
      meta.hud = hud;
    }
    if (opts.readEnd) meta.endcard = endcard;
    fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta));
    return meta;
  } finally {
    await browser.close();
  }
}

/** The in-stage HUD's names and records (W–L), as the page writes them. */
async function readHud(page) {
  return page.evaluate(() =>
    ["a", "b"].map((s) => ({
      name: document.querySelector(`[data-fr="fname-${s}"]`)?.textContent?.trim() ?? "",
      record: document.querySelector(`[data-fr="hud-${s}"] .fr-frec`)?.textContent?.trim() ?? "",
    })),
  );
}

/**
 * The end card's text once it has mounted (only at phase end) and stopped
 * changing: totals may count up, so it is read until three reads in a row
 * agree. Null, with a warning, when the card or its fields are not there:
 * the video then goes without one, the render never fails over it.
 */
async function readEndCard(page) {
  const ok = await page
    .waitForSelector(".fr-endcard[data-open] .fr-ec-sc", { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    console.warn("end card not found on the page; no end card in the video");
    return null;
  }
  const read = () =>
    page.evaluate(() => {
      const ec = document.querySelector(".fr-endcard");
      const txt = (el) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null;
      return {
        cols: [...ec.querySelectorAll(".fr-ec-top > .fr-ec-f")].map((f) => ({
          name: txt(f.querySelector(".fr-ec-nm")),
          total: txt(f.querySelector(".fr-ec-sc")),
          win: f.classList.contains("fr-win"),
        })),
        tiers: [...ec.querySelectorAll(".fr-tierbadge")].map(txt),
        cards: txt(ec.querySelector(".fr-ec-cards")),
        decided: txt(ec.querySelector('[data-fr="ec-decided"]')),
        decidedWin: txt(ec.querySelector(".fr-ec-row.fr-ec-decided b.fr-w")),
      };
    });
  let last = "";
  let same = 0;
  for (let i = 0; i < 40 && same < 2; i++) {
    await page.waitForTimeout(500);
    const now = JSON.stringify(await read());
    same = now === last ? same + 1 : 0;
    last = now;
  }
  return JSON.parse(last);
}
