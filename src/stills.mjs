// Every piece of text and chrome the new formats put on the video (titles,
// the domain, candidate B's HUD, the end card) is a PNG drawn here by
// Chromium from a small HTML page and laid over the video with ffmpeg's
// overlay. Why not drawtext: Homebrew's ffmpeg comes without it, so the
// candidates could not even be tried locally; a PNG also gets the same
// browser text rendering as the site.
//
// Press Start 2P (the site's pixel font) is for numbers and headers only;
// the one line of plain text uses the system sans. No glow, no gradients,
// no shadows: flat colours from lib/theme.ts in the app.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fitPixel, tierLabel } from "./layout.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(HERE, "..", "assets", "PressStart2P-Regular.ttf");

/** palette in lib/theme.ts (app). Amber is the champion's only, so never here. */
export const C = {
  bg: "#000000",
  chrome: "#ffffff",
  text: "#e9e9ee",
  muted: "#a7a7b2",
  faint: "#8a8a95",
  win: "#3ecf6e",
  track: "#1e2430",
  surface: "#0a0a0d",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(w, h, body, bg = "transparent") {
  const font = fs.readFileSync(FONT).toString("base64");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "px"; src: url(data:font/ttf;base64,${font}) format("truetype"); }
html, body { margin: 0; padding: 0; width: ${w}px; height: ${h}px; background: ${bg}; overflow: hidden; }
body { position: relative; color: ${C.text}; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
.px { font-family: "px", monospace; line-height: 1; white-space: pre; }
.sans { font-family: system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
.abs { position: absolute; }
</style></head><body>${body}</body></html>`;
}

/**
 * One text item, absolutely placed: y is the top of the line box
 * (line-height 1); align left/center/right within [x, x + w].
 */
export function textItem({ x = 0, y, w, text, size, color = C.chrome, font = "px", align = "center", html = null }) {
  return `<div class="abs ${font === "px" ? "px" : "sans"}" style="left:${x}px;top:${y}px;width:${w}px;text-align:${align};font-size:${size}px;color:${color}">${html ?? esc(text)}</div>`;
}

/** A transparent layer w x h with text items and flat boxes on it. */
export function layerHtml(w, h, items = [], boxes = []) {
  const bx = boxes.map((b) => `<div class="abs" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${b.color}"></div>`);
  return page(w, h, bx.join("") + items.join(""));
}

/**
 * The end card: who won, both sealed totals, the tier, what decided it.
 * Every value is the page's own string (layout.mjs endCardModel). Names are
 * upper-cased like the stage's own banner and the title above the video.
 *
 * @param {ReturnType<import("./layout.mjs").endCardModel>} m
 * @param {{ w: number, h: number, domainY: number, domainSize: number, note: boolean }} o
 */
export function endCardHtml(m, { w, h, domainY, domainSize, note }) {
  const portrait = h > w;
  const room = Math.min(w - 120, 1500);
  const up = (s) => s.toUpperCase();
  const head = `${up(m.winner.name)} WINS`;
  const headSize = fitPixel(head, room, portrait ? 64 : 72, 32);
  const headHtml = headSize
    ? `<div class="px" style="font-size:${headSize}px;color:${C.chrome}">${esc(up(m.winner.name))} <span style="color:${C.win}">WINS</span></div>`
    : `<div class="px" style="font-size:${fitPixel(m.winner.name, room, 64, 12) ?? 12}px;color:${C.chrome}">${esc(up(m.winner.name))}</div>
       <div class="px" style="font-size:64px;color:${C.win};margin-top:24px">WINS</div>`;
  const tier = m.tier ? `<div class="px" style="font-size:${portrait ? 28 : 28}px;color:${C.muted};margin-top:36px">${esc(tierLabel(m.tier))}</div>` : "";

  const colW = portrait ? 440 : 520;
  const scoreSize = Math.min(portrait ? 96 : 104, fitPixel(m.cols.reduce((a, c) => (c.total.length > a.length ? c.total : a), ""), colW - 40, 120, 24) ?? 24);
  const col = (c) => `<div style="width:${colW}px;display:flex;flex-direction:column;align-items:center">
      <div class="px" style="font-size:${scoreSize}px;color:${c.win ? C.win : C.text}">${esc(c.total)}</div>
      <div class="px" style="font-size:${fitPixel(c.name, colW - 40, 24, 10) ?? 10}px;color:${C.muted};margin-top:28px">${esc(up(c.name))}</div>
    </div>`;
  const scores = `<div style="display:flex;align-items:flex-start;justify-content:center;margin-top:${portrait ? 150 : 84}px">
      ${col(m.cols[0])}
      <div class="px" style="font-size:${Math.round(scoreSize * 0.5)}px;color:${C.faint};margin-top:${Math.round(scoreSize * 0.25)}px">·</div>
      ${col(m.cols[1])}
    </div>`;
  const cards = m.cards ? `<div class="px" style="font-size:20px;color:${C.muted};margin-top:44px">${esc(m.cards)}</div>` : "";
  const decided = m.decided
    ? `<div class="px" style="font-size:24px;color:${C.muted};margin-top:${portrait ? 150 : 84}px">DECIDED ON ${esc(m.decided.rubric)}</div>
       <div class="px" style="font-size:48px;margin-top:32px"><span style="color:${C.win}">${esc(m.decided.winner)}</span><span style="color:${C.faint}"> VS </span><span style="color:${C.text}">${esc(m.decided.loser)}</span></div>`
    : "";
  const noteHtml = note
    ? `<div class="sans" style="font-size:${portrait ? 30 : 26}px;color:${C.muted};margin-top:${portrait ? 120 : 64}px;letter-spacing:0.01em">The fight is drawn from the judges' scorecards.</div>`
    : "";
  const body = `<div class="abs" style="left:0;top:0;width:${w}px;height:${domainY}px;display:flex;flex-direction:column;align-items:center;justify-content:center">
      ${headHtml}${tier}${scores}${cards}${decided}${noteHtml}
    </div>
    ${textItem({ x: 0, y: domainY, w, text: "insertcoin.lol", size: domainSize, color: C.chrome })}`;
  return page(w, h, body, C.bg);
}

/**
 * Renders [{ file, w, h, html }] to PNGs (transparent where the page is)
 * in one browser.
 */
export async function renderStills(list) {
  if (!list.length) return;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    for (const s of list) {
      await pg.setViewportSize({ width: s.w, height: s.h });
      await pg.setContent(s.html, { waitUntil: "load" });
      await pg.evaluate(() => document.fonts.ready);
      fs.mkdirSync(path.dirname(s.file), { recursive: true });
      await pg.screenshot({ path: s.file, omitBackground: true, clip: { x: 0, y: 0, width: s.w, height: s.h } });
    }
  } finally {
    await browser.close();
  }
}
