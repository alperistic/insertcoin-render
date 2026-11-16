// The two 9:16 candidates (PORTRAIT=a|b|both), next to today's letterbox
// in build.mjs. Today's 9x16 puts the 16:9 stage across the width, a third
// of the frame's height; both of these give the stage more of it.
//
//   A · compact live stage: a second recording at a phone viewport, where
//       the page itself lays out a 4:3 stage with its mobile HUD above and
//       the commentary below. Cropped as the page draws it.
//   B · vertical composition: from the 16:9 recording, a window of the
//       stage with our own HUD over its top, drawn from the HP and round the
//       recording sampled. The window is a square the height of the stage
//       (1080x1080 in the frame, 56 % of its height), planned over the whole
//       fight as a few fixed framings with pans between them (layout.mjs
//       trackCrop, hold). The cut opens wider, on the 4:3 the VS card needs,
//       pushes in when the card goes (openingEase), and pulls back to the
//       whole stage for the result (closingEase): the last picture, the
//       winner's banner across the stage, fits no closer window. Wide, the
//       picture carries the stage's own HUD; ours is on in between.
//
//       Until 16.11.2026 the window was that 4:3 throughout: 1080x810, 42 %
//       of the frame, with the fighters a quarter smaller than they are now
//       and the window re-centring on every lunge. Measured on a bracket
//       fight, the pair fits the square with air on 87 % of the fight's
//       frames; what does not is the VS card (hence the opening) and a few
//       frames where they stand at their marks.
//
// Each is planned first (geometry, the PNG pages stills.mjs renders), then
// encoded once the PNGs exist.

import fs from "node:fs";
import path from "node:path";
import { titleLayout } from "./frames.mjs";
import { closingEase, closingFrame, even, fitPixel, holdSpans, openingEase, runs, samplesAt, solidColor, stackLayout, trackCrop, unionRect } from "./layout.mjs";
import { BG, BORDER, ENCODE, FPS, TAIL, endcardGraph, endcardInput, ffmpeg } from "./build.mjs";
import { C, endCardHtml, layerHtml, pageHtml, textItem } from "./stills.mjs";

/** The domain line under the stage, in the pixel font. */
const DOMAIN_SIZE = 32;
/** Space between title and stage block, and between block and domain. */
const GAP_TITLE = 96;
const GAP_DOMAIN = 96;

/** Title lines (titleLayout) as text items from `top`, and their height. */
function titleItems(title, top) {
  const layout = titleLayout(title.a, title.b);
  const lineGap = Math.round(layout.size * 0.6);
  const h = layout.lines.length * layout.size + (layout.lines.length - 1) * lineGap;
  const items = layout.lines.map((line, i) => textItem({ y: top + i * (layout.size + lineGap), w: 1080, text: line, size: layout.size }));
  return { items, h };
}

function titleHeight(title) {
  return titleItems(title, 0).h;
}

const rectOf = (r) => r && [r.x, r.y, r.x + r.w, r.y + r.h];

// ── A · compact live stage ────────────────────────────────────────────────

/** Space between the mobile HUD and the stage once the buttons between them are cut out. */
const GAP_A = 20;

/**
 * @param {object} meta the phone recording's meta.json (record.mjs PHONE)
 * @param {{ a: string, b: string }} title
 * @param {string} dir where its PNGs go
 */
export function planA(meta, title, dir) {
  const { hud, box, commentary, ctrl } = meta.rects ?? {};
  if (!hud || !box) throw new Error("phone pass: mobile HUD or stage not measured (compact layout changed?)");
  const d = meta.dpr;
  // The commentary at its tallest over the fight, so a long quote's last line stays.
  const live = unionRect([rectOf(box), rectOf(commentary), rectOf(meta.grow?.commentary)]);
  const h = rectOf(hud);
  // The page puts SOUND / SHOW RESULT / REPLAY between its HUD and the stage
  // (read 22.10.2026); they mean nothing in a video, so HUD and stage are
  // cut as two pieces and stacked. If the buttons ever move out of the way,
  // HUD to commentary is one piece.
  const c = rectOf(ctrl);
  const between = c && c[1] >= h[3] - 1 && c[3] <= live[1] + 1;
  const pieces = between || h[3] < live[1] - 1 ? [h, live] : [unionRect([h, live])];
  // The whole page width, its own margins included (PHONE: 1080 device px).
  const x0 = 0;
  const x1 = meta.viewport?.width ?? Math.max(...pieces.map((p) => p[2])) + Math.min(...pieces.map((p) => p[0]));
  const cw = even((x1 - x0) * d);
  const crops = pieces.map((p) => ({ x: even(x0 * d), y: even(p[1] * d), w: cw, h: even((p[3] - p[1]) * d) }));
  // 1080 device px already (PHONE), so no scaling; anything else is scaled.
  const k = 1080 / cw;
  const flags = Math.abs(k - Math.round(k)) < 0.01 ? "neighbor" : "lanczos";
  const scaled = crops.map((q) => even(q.h * k));
  const gap = pieces.length > 1 ? GAP_A : 0;
  const blockH = scaled.reduce((a, b) => a + b, 0) + gap;
  const tH = titleHeight(title);
  const [titleY, blockY, domainY] = stackLayout([tH, blockH, DOMAIN_SIZE], [GAP_TITLE, GAP_DOMAIN]);
  const stageH = even(box.h * d * k);
  const chrome = path.join(dir, "chrome-a.png");
  const items = [...titleItems(title, titleY).items, textItem({ y: domainY, w: 1080, text: "insertcoin.lol", size: DOMAIN_SIZE })];
  return {
    crops, k, flags, gap, scaled, blockY, blockH, domainY, stageH,
    share: { stage: stageH / 1920, live: blockH / 1920 },
    chrome,
    stills: [{ file: chrome, w: 1080, h: 1920, html: layerHtml(1080, 1920, items) }],
  };
}

/** @param {{ seq: string, seconds: number }} cut prepareCut of the phone recording */
export function encodeA(plan, cut, track, out, endcardPng = null) {
  const parts = plan.crops.map((q, i) => `[r${i}]crop=${q.w}:${q.h}:${q.x}:${q.y}${plan.flags === "neighbor" && Math.abs(plan.k - 1) < 1e-9 ? "" : `,scale=1080:${plan.scaled[i]}:flags=${plan.flags}`}${i === 0 && plan.crops.length > 1 ? `,pad=1080:${plan.scaled[0] + plan.gap}:0:0:color=${BG}` : ""}[c${i}]`);
  const split = plan.crops.length > 1 ? `[0:v]format=rgb24,split=${plan.crops.length}${plan.crops.map((_, i) => `[r${i}]`).join("")};` : `[0:v]format=rgb24[r0];`;
  const stack = plan.crops.length > 1 ? `${plan.crops.map((_, i) => `[c${i}]`).join("")}vstack=inputs=${plan.crops.length}[blk];` : `[c0]null[blk];`;
  const base = `${split}${parts.join(";")};${stack}[blk]setsar=1,pad=1080:1920:0:${plan.blockY}:color=${BG}[base];[base][2:v]overlay=0:0`;
  const graph = endcardPng ? `${base},${TAIL}[st];${endcardGraph("st", 3, cut.seconds, 1080, 1920)}` : `${base},${TAIL}[v]`;
  ffmpeg([
    "-framerate", String(FPS), "-i", path.join(cut.seq, "%05d.jpg"), "-i", track, "-i", plan.chrome,
    ...(endcardPng ? endcardInput(endcardPng) : []),
    "-filter_complex", graph, "-map", "[v]", "-map", "1:a", ...ENCODE, out,
  ]);
}

// ── B · vertical composition ──────────────────────────────────────────────

/**
 * In stage px (1280 wide): the air the window keeps around the fighters, the
 * play around a pair too wide for it, and the top speed counted as a snap.
 * PAN_S: how long a pan between two framings takes.
 */
const MARGIN_STAGE = 20;
const SLACK_STAGE = 28;
const SPEED_STAGE = 620;
const PAN_S = 0.8;
/** The wide window the cut opens on, as width over the stage's height. */
const WIDE_ASPECT = 4 / 3;
/** s a word over the fight keeps counting before and after it is drawn */
const WORD_HOLD = 0.35;
/**
 * Our HUD, drawn opaque over the window's top band where the stage's own
 * (cropped) HUD is, output px from the band's top. Laid out like the live
 * HUD (.fr-hud in the app's globals.css): per side a name line with the
 * record beside the name towards the middle, the HP bar under it in the
 * fighter's brand colour, the round on a framed plate between the bars.
 * Sized for 390 px playback: names 30–34 px, bars 24 px at 1080 wide.
 */
const HUD_BASE = {
  minH: 116, side: 40, barW: 400,
  nameY: 16, nameMax: 34, nameMin: 30, recSize: 22, recGap: 20,
  barY: 62, barH: 24,
  roundY: 10, roundW: 168, roundH: 84, roundLabel: 22, roundNum: 34, roundPad: 12, roundGap: 8,
};
/**
 * The HUD at the band's height: the square window's band is taller than the
 * 116 px these were sized for (the stage's own HUD rows, at the bigger
 * scale), so the rows and the round plate grow with it. The bars keep their
 * width and the names their size: a name is fitted to its bar, not the band.
 */
function hudFor(bandH) {
  const k = Math.min(1.35, Math.max(1, bandH / HUD_BASE.minH));
  const e = (v) => Math.round((v * k) / 2) * 2;
  const H = { ...HUD_BASE };
  for (const key of ["nameY", "recSize", "barY", "barH", "roundY", "roundW", "roundH", "roundLabel", "roundNum", "roundPad", "roundGap"]) H[key] = e(HUD_BASE[key]);
  return H;
}
/** The live HUD's own inks (--fr-ink, --fr-muted, --fr-line, --fr-deep in the app). */
const HUD_C = { ink: "#e8ecf4", muted: "#8c95a6", line: "#1e2430", deep: "#05070c" };

/** A side's HP fill colour from the page (solid, or a gradient's first stop); null if none reads. */
export function hudFill(side) {
  const first = String(side?.fillImage ?? "").match(/rgba?\([^)]*\)|#[0-9a-f]{6}\b/i)?.[0];
  return solidColor(side?.fill) ?? solidColor(first) ?? null;
}

/**
 * One side's name line, like the live .fr-nameline: name on the outside
 * edge, record next to it towards the middle, both in the pixel font. A name
 * longer than the room ends in "…" at nameMin rather than shrinking further.
 */
function nameLine({ x, y, name, record, size, right, HUD }) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const nm = `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${HUD_C.ink}">${esc(name)}</span>`;
  const rec = record ? `<span style="flex:none;font-size:${HUD.recSize}px;color:${HUD_C.muted}">${esc(record)}</span>` : "";
  return `<div class="abs px" style="left:${x}px;top:${y}px;width:${HUD.barW}px;display:flex;align-items:baseline;gap:${HUD.recGap}px;` +
    `${right ? "flex-direction:row-reverse;" : ""}font-size:${size}px;line-height:1">${nm}${rec}</div>`;
}

/**
 * @param {object} meta the 16:9 recording's meta.json, with track (record.mjs track: true)
 * @param {{ picks: number[] }} cut prepareCut of it
 */
export function planB(meta, cut, title, dir, log = console.log) {
  const d = meta.dpr;
  const innerW = meta.box.w - 2 * BORDER;
  const innerH = meta.box.h - 2 * BORDER;
  const s = innerW / 1280; // CSS px per stage px
  // A word over the fight (K.O., WINS) is centred on the stage, so a window
  // on the fighters cuts it: each sample carries the word's span (w) apart
  // from the fighters, and trackCrop takes it in whenever both fit. It is
  // stamped in and out in steps (its text box flickers between drawings), so
  // the span is held WORD_HOLD s either side: one steady reason to pan,
  // not a window hopping on every step.
  const raw = meta.track ?? [];
  const held = holdSpans(raw.map((t) => t.t), raw.map((t) => t.wd ?? null), WORD_HOLD);
  const track = raw.map((t, i) => ({
    ...t,
    u: t.u && [t.u[0] - BORDER, t.u[1] - BORDER, t.u[2] - BORDER, t.u[3] - BORDER],
    w: held[i] && [held[i][0] - BORDER, held[i][2] - BORDER],
  }));
  if (!track.length) throw new Error("no fighter track in the recording (record with track: true)");
  const times = cut.picks.map((i) => meta.frames[i].t);
  const winW = innerH; // the square: the stage's whole height
  const wideW = Math.min(innerW, innerH * WIDE_ASPECT);
  const crop = trackCrop(track, {
    stageW: innerW, winW, margin: MARGIN_STAGE * s, slack: SLACK_STAGE * s, hold: PAN_S, maxSpeed: SPEED_STAGE * s, fps: FPS, times,
  });

  // The opening: wide on the VS card, in when it goes, which is where what
  // the recording sees of the fighters first changes (the card's portraits
  // stand still). Without that, where the stage's HUD first shows a round.
  const first = track.find((t) => t.t >= times[0] && t.u);
  const moved = first && track.find((t) => t.t > first.t && t.u && (Math.abs(t.u[0] - first.u[0]) > 2 || Math.abs(t.u[2] - first.u[2]) > 2));
  const tOpen = moved?.t ?? track.find((t) => t.t >= times[0] && t.round !== null && t.round !== undefined)?.t ?? null;
  const ease = openingEase(times, tOpen, { lead: 0 });
  const open = Math.max(0, ease.findIndex((e) => e > 0)); // first frame of the push-in; our HUD is on from here
  // The result: back out to the whole stage where the last picture stops fitting.
  const inAt = ease.findIndex((e) => e >= 1);
  const kClose = closingFrame(crop.fit);
  // The stage says when the fight is over (the "ending" cue): the verdict's
  // lines come up from there, so the pull-out starts no later than that.
  const tEnding = (meta.cues ?? []).find((c) => c.kind === "ending")?.t ?? Infinity;
  const tFit = kClose > inAt && inAt >= 0 ? times[kClose] : Infinity;
  const tClose = Math.min(tFit, inAt >= 0 && tEnding > times[inAt] ? tEnding : Infinity);
  const out = closingEase(times, Number.isFinite(tClose) ? tClose : null);
  const close = out.findIndex((e) => e > 0) < 0 ? times.length : out.findIndex((e) => e > 0); // our HUD is off from here
  const win = ease.map((e, k) => {
    const w = winW + (wideW - winW) * (1 - e) + (innerW - winW) * out[k];
    const c = innerW / 2 + (crop.x[k] + winW / 2 - innerW / 2) * e * (1 - out[k]);
    return { w, x: Math.min(innerW - w, Math.max(0, c - w / 2)) };
  });

  // The stage's own HUD would be cut at the corners by the window. Ours
  // goes over it: an opaque band exactly as tall as the stage's HUD rows,
  // drawn on top of the stage like the live page draws its HUD over the
  // fighters. What of a fighter reaches up under the band (hair, a jump,
  // an effect) is hidden there; those frames are counted and logged.
  const hud = meta.rects?.hud;
  const hudBottom = hud ? hud.y + hud.h - (meta.box.y + BORDER) + 2 : 0;
  const into = crop.need.filter((u) => u && u[1] < hudBottom).length;
  if (hud) log(`B: ${into} frames reach under the HUD band (top ${hudBottom.toFixed(0)} css px of ${innerH.toFixed(0)})`);
  let outside = 0;
  crop.need.forEach((u, k) => {
    if (u && (u[0] < win[k].x - 0.5 || u[2] > win[k].x + win[k].w + 0.5)) outside++;
  });

  // Device px. The stage is cut out of the page frame once, padded above and
  // below to the widest window's height, and the square window is cropped
  // out of that: wide it takes the pad in (the VS card and the result
  // letterboxed in the block), at its closest exactly the stage's rows.
  const iw = even(innerW * d);
  const ih = even(innerH * d);
  const ox = even((meta.box.x + BORDER) * d);
  const oy = even((meta.box.y + BORDER) * d);
  const padH = Math.max(ih, even(Math.max(...win.map((w) => w.w)) * d));
  const padY = even((padH - ih) / 2);
  const wins = win.map(({ w, x }) => {
    const W = Math.min(padH, Math.max(ih, even(w * d)));
    return { w: W, x: Math.min(iw - W, Math.max(0, Math.round(x * d))), y: Math.round((padH - W) / 2) };
  });
  const cw = ih;
  const ch = ih;
  const sh = 1080;
  const bandH = Math.max(HUD_BASE.minH, even((hudBottom / innerH) * sh));
  const HUD = hudFor(bandH);

  const tH = titleHeight(title);
  const [titleY, stageY, domainY] = stackLayout([tH, sh, DOMAIN_SIZE], [GAP_TITLE, GAP_DOMAIN]);
  const hudY = stageY;

  // HUD chrome: the band, names, W–L records, empty bars; fills and the round go on per frame.
  // Names are the job's (upper-case, challenger first = page side a, the
  // left one), never the page HUD's text, whose casing is the startup's own.
  // Records and colours come from the page HUD, side by side.
  const sides = meta.hud ?? [];
  const names = [title.a, title.b].map((name, i) => ({ name, record: sides[i]?.record ?? "" }));
  const nameSize = Math.min(
    // Monospaced glyphs as wide as the size (no letter-spacing: at 1080 px
    // the live 0.04em would cost a ten-letter name its last glyph).
    ...names.map((n) => fitPixel(n.name, HUD.barW - (n.record ? n.record.length * HUD.recSize + HUD.recGap : 0), HUD.nameMax, HUD.nameMin) ?? HUD.nameMin),
  );
  const fill = [0, 1].map((i) => hudFill(sides[i]) ?? C.text);
  const trackC = [0, 1].map((i) => solidColor(sides[i]?.track, C.surface) ?? C.track);
  const L = HUD.side;
  const R = 1080 - HUD.side;
  const items = [
    ...titleItems(title, titleY).items,
    textItem({ y: domainY, w: 1080, text: "insertcoin.lol", size: DOMAIN_SIZE }),
  ];
  // The HUD is its own layer: it comes on with the push-in, not over the VS card.
  const hudItems = [
    nameLine({ x: L, y: hudY + HUD.nameY, ...names[0], size: nameSize, right: false, HUD }),
    nameLine({ x: R - HUD.barW, y: hudY + HUD.nameY, ...names[1], size: nameSize, right: true, HUD }),
  ];
  const barY = hudY + HUD.barY;
  const boxes = [
    { x: 0, y: hudY, w: 1080, h: bandH, color: C.surface },
    { x: L, y: barY, w: HUD.barW, h: HUD.barH, color: trackC[0] },
    { x: R - HUD.barW, y: barY, w: HUD.barW, h: HUD.barH, color: trackC[1] },
  ];
  const chrome = path.join(dir, "chrome-b.png");
  const hudPng = path.join(dir, "hud-b.png");
  const stills = [
    { file: chrome, w: 1080, h: 1920, html: layerHtml(1080, 1920, items) },
    { file: hudPng, w: 1080, h: 1920, html: layerHtml(1080, 1920, hudItems, boxes) },
  ];

  // Per frame: HP (both bars, in px of fill) and round, from the sample on that frame.
  const at = times.map((t) => {
    const ss = samplesAt(track, t, { slack: 0, ahead: 0 });
    return ss[ss.length - 1];
  });
  const hpA = runs(at.map((x) => Math.round((x?.hp?.[0] ?? 1) * HUD.barW)));
  const hpB = runs(at.map((x) => Math.round((x?.hp?.[1] ?? 1) * HUD.barW)));
  const rounds = runs(at.map((x) => x?.round ?? null)).filter((r) => r.v !== null);
  const roundFiles = new Map();
  for (const r of rounds) {
    if (roundFiles.has(r.v)) continue;
    const file = path.join(dir, `round-${r.v}.png`);
    roundFiles.set(r.v, file);
    // The live .fr-mid plate: ROUND over the number, framed.
    const plate = `<div class="abs px" style="left:0;top:0;width:${HUD.roundW}px;height:${HUD.roundH}px;box-sizing:border-box;border:2px solid ${HUD_C.line};` +
      `background:${HUD_C.deep};text-align:center;padding-top:${HUD.roundPad}px">` +
      `<div style="font-size:${HUD.roundLabel}px;letter-spacing:0.14em;color:${HUD_C.muted};margin-left:0.14em">ROUND</div>` +
      `<div style="font-size:${HUD.roundNum}px;margin-top:${HUD.roundGap}px;color:${HUD_C.ink}">${r.v}</div></div>`;
    stills.push({ file, w: HUD.roundW, h: HUD.roundH, html: pageHtml(HUD.roundW, HUD.roundH, plate) });
  }
  // On how many frames of the close part the window moves: the pans.
  let moving = 0;
  let closeFrames = 0;
  for (let k = Math.max(1, inAt + 1); k < close; k++) {
    closeFrames++;
    if (wins[k].x !== wins[k - 1].x) moving++;
  }
  return {
    cw, ch, iw, ih, ox, oy, padH, padY, wins, open, close, sh, stageY, hudY, barY, domainY, bandH, into, outside, fill, HUD,
    wide: crop.wide, snaps: crop.snaps, wordCut: crop.wordCut, moving, frames: closeFrames, holds: crop.holds,
    chrome, hudPng, stills, hpA, hpB, rounds, roundFiles,
    share: { stage: sh / 1920, picture: (sh - bandH) / 1920 },
  };
}

export function encodeB(plan, cut, track, out, dir, endcardPng = null) {
  // The window per frame through sendcmd: a command takes effect on the
  // first frame at or after its time, so each goes half a frame early. Size
  // before place when it shrinks, place before size when it grows, so the
  // window never asks for rows the padded stage does not have.
  const cmds = [];
  plan.wins.forEach((w, k) => {
    const p = plan.wins[k - 1];
    if (k > 0 && w.w === p.w && w.x === p.x && w.y === p.y) return;
    const size = [`crop@win w ${w.w}`, `crop@win h ${w.w}`];
    const place = [`crop@win x ${w.x}`, `crop@win y ${w.y}`];
    const list = k > 0 && w.w === p.w ? place : !p || w.w <= p.w ? [...size, ...place] : [...place, ...size];
    cmds.push(`${(k === 0 ? 0 : (k - 0.5) / FPS).toFixed(6)} ${list.join(", ")};`);
  });
  const cmdFile = path.join(dir, "crop-b.cmd");
  fs.writeFileSync(cmdFile, cmds.join("\n") + "\n");

  const HUD = plan.HUD;
  const roundList = [...plan.roundFiles.keys()];
  const fills = [];
  const L = HUD.side;
  const R = 1080 - HUD.side;
  const [fa, fb] = plan.fill.map((c) => c.replace("#", "0x"));
  // Everything of the HUD is on between the push-in and the pull-out.
  const hudEnd = plan.close - 1;
  const on = (r) => `between(n,${Math.max(r.from, plan.open)},${Math.min(r.to, hudEnd)})`;
  const live = (r) => r.to >= plan.open && r.from <= hudEnd;
  for (const r of plan.hpA) if (r.v > 0 && live(r)) fills.push(`drawbox=x=${L}:y=${plan.barY}:w=${r.v}:h=${HUD.barH}:color=${fa}:t=fill:enable='${on(r)}'`);
  for (const r of plan.hpB) if (r.v > 0 && live(r)) fills.push(`drawbox=x=${R - r.v}:y=${plan.barY}:w=${r.v}:h=${HUD.barH}:color=${fb}:t=fill:enable='${on(r)}'`);
  const w0 = plan.wins[0];
  // Pixel art one and a third times its size: tripled on whole pixels first,
  // then averaged down, so an edge stays an edge instead of a lanczos ring.
  let graph =
    `[0:v]format=rgb24,crop=${plan.iw}:${plan.ih}:${plan.ox}:${plan.oy},pad=${plan.iw}:${plan.padH}:0:${plan.padY}:color=${BG},` +
    `sendcmd=f='${cmdFile.replace(/'/g, "'\\''")}',crop@win=w=${w0.w}:h=${w0.w}:x=${w0.x}:y=${w0.y},` +
    `scale=iw*3:ih*3:flags=neighbor,scale=1080:${plan.sh}:flags=area,setsar=1,pad=1080:1920:0:${plan.stageY}:color=${BG}[base];` +
    `[base][2:v]overlay=0:0[ch];[ch][3:v]overlay=0:0:enable='between(n,${plan.open},${plan.close - 1})'` +
    (fills.length ? `,${fills.join(",")}` : "") + "[h0]";
  let last = "h0";
  roundList.forEach((v, i) => {
    const when = plan.rounds.filter((r) => r.v === v && live(r)).map(on).join("+") || "0";
    graph += `;[${last}][${4 + i}:v]overlay=${(1080 - HUD.roundW) / 2}:${plan.hudY + HUD.roundY}:enable='${when}'[h${i + 1}]`;
    last = `h${i + 1}`;
  });
  const ecIdx = 4 + roundList.length;
  graph += endcardPng ? `;[${last}]${TAIL}[st];${endcardGraph("st", ecIdx, cut.seconds, 1080, 1920)}` : `;[${last}]${TAIL}[v]`;
  ffmpeg([
    "-framerate", String(FPS), "-i", path.join(cut.seq, "%05d.jpg"), "-i", track, "-i", plan.chrome, "-i", plan.hudPng,
    ...roundList.flatMap((v) => ["-i", plan.roundFiles.get(v)]),
    ...(endcardPng ? endcardInput(endcardPng) : []),
    "-filter_complex", graph, "-map", "[v]", "-map", "1:a", ...ENCODE, out,
  ]);
}

// ── End card ──────────────────────────────────────────────────────────────

/** The end card page for a 9:16 (domain where that candidate has it) or the 16:9. */
export function endcardStill(model, file, { portrait, domainY, note, line }) {
  const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
  const y = domainY ?? (portrait ? 1920 - 160 : 1080 - 96 - DOMAIN_SIZE);
  return { file, w, h, html: endCardHtml(model, { w, h, domainY: y, domainSize: DOMAIN_SIZE, note, line }) };
}
