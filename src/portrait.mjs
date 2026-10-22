// The two 9:16 candidates (PORTRAIT=a|b|both), next to today's letterbox
// in build.mjs. Today's 9x16 puts the 16:9 stage across the width, a third
// of the frame's height; both of these give the stage more of it.
//
//   A · compact live stage: a second recording at a phone viewport, where
//       the page itself lays out a 4:3 stage with its mobile HUD above and
//       the commentary below. Cropped as the page draws it.
//   B · vertical composition: from the 16:9 recording, a 4:3 window of the
//       stage that follows the fighters (layout.mjs trackCrop), with our own
//       HUD above it, drawn from the HP and round the recording sampled.
//
// Each is planned first (geometry, the PNG pages stills.mjs renders), then
// encoded once the PNGs exist.

import fs from "node:fs";
import path from "node:path";
import { titleLayout } from "./frames.mjs";
import { even, fitPixel, holdSpans, runs, samplesAt, stackLayout, trackCrop, unionRect } from "./layout.mjs";
import { BG, BORDER, ENCODE, FPS, TAIL, endcardGraph, endcardInput, ffmpeg } from "./build.mjs";
import { C, endCardHtml, layerHtml, textItem } from "./stills.mjs";

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

/** Fighters + margin the window keeps inside, and its top pan speed, in stage px (1280 wide). */
const MARGIN_STAGE = 40;
const SPEED_STAGE = 700;
/** s a word over the fight keeps counting before and after it is drawn */
const WORD_HOLD = 0.35;
/**
 * Our HUD, drawn opaque over the window's top band where the stage's own
 * (cropped) HUD is, output px from the band's top. Sized for 390 px
 * playback: names 32 px, bars 20 px at 1080 wide.
 */
const HUD = { minH: 116, side: 40, nameY: 14, nameSize: 32, roomName: 380, roundY: 18, roundW: 240, roundH: 26, barY: 58, barH: 20, barW: 440, recY: 88, recSize: 20 };

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
  const winW = innerH * (4 / 3);
  const crop = trackCrop(track, { stageW: innerW, winW, margin: MARGIN_STAGE * s, maxSpeed: SPEED_STAGE * s, fps: FPS, times });

  // The stage's own HUD would be cut at the corners by a 4:3 window. Ours
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
    if (u && (u[0] < crop.x[k] - 0.5 || u[2] > crop.x[k] + winW + 0.5)) outside++;
  });

  const cw = even(winW * d);
  const ch = even(innerH * d);
  const ox = even((meta.box.x + BORDER) * d);
  const oy = even((meta.box.y + BORDER) * d);
  const xs = crop.x.map((x) => Math.min(ox + Math.round(x * d), ox + even(innerW * d) - cw));
  const sh = even((ch * 1080) / cw);
  const bandH = Math.max(HUD.minH, even((hudBottom / innerH) * sh));

  const tH = titleHeight(title);
  const [titleY, stageY, domainY] = stackLayout([tH, sh, DOMAIN_SIZE], [GAP_TITLE, GAP_DOMAIN]);
  const hudY = stageY;

  // HUD chrome: the band, names, W–L records, empty bars; fills and the round go on per frame.
  const names = meta.hud ?? [{ name: title.a, record: "" }, { name: title.b, record: "" }];
  const nameSize = Math.min(...names.map((n) => fitPixel(n.name, HUD.roomName, HUD.nameSize, 20) ?? 20));
  const L = HUD.side;
  const R = 1080 - HUD.side;
  const items = [
    ...titleItems(title, titleY).items,
    textItem({ x: L, y: hudY + HUD.nameY, w: HUD.roomName, text: names[0].name, size: nameSize, color: C.text, align: "left" }),
    textItem({ x: R - HUD.roomName, y: hudY + HUD.nameY, w: HUD.roomName, text: names[1].name, size: nameSize, color: C.text, align: "right" }),
    textItem({ x: L, y: hudY + HUD.recY, w: HUD.barW, text: names[0].record, size: HUD.recSize, color: C.muted, align: "left" }),
    textItem({ x: R - HUD.barW, y: hudY + HUD.recY, w: HUD.barW, text: names[1].record, size: HUD.recSize, color: C.muted, align: "right" }),
    textItem({ y: domainY, w: 1080, text: "insertcoin.lol", size: DOMAIN_SIZE }),
  ];
  const barY = hudY + HUD.barY;
  const boxes = [
    { x: 0, y: hudY, w: 1080, h: bandH, color: C.surface },
    { x: L, y: barY, w: HUD.barW, h: HUD.barH, color: C.track },
    { x: R - HUD.barW, y: barY, w: HUD.barW, h: HUD.barH, color: C.track },
  ];
  const chrome = path.join(dir, "chrome-b.png");
  const stills = [{ file: chrome, w: 1080, h: 1920, html: layerHtml(1080, 1920, items, boxes) }];

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
    stills.push({ file, w: HUD.roundW, h: HUD.roundH, html: layerHtml(HUD.roundW, HUD.roundH, [textItem({ y: 2, w: HUD.roundW, text: `ROUND · ${r.v}`, size: 22, color: C.muted })]) });
  }
  return {
    cw, ch, oy, xs, sh, stageY, hudY, barY, domainY, bandH, into, outside,
    wide: crop.wide, snaps: crop.snaps, wordCut: crop.wordCut, chrome, stills, hpA, hpB, rounds, roundFiles,
    share: { stage: sh / 1920, picture: (sh - bandH) / 1920 },
  };
}

export function encodeB(plan, cut, track, out, dir, endcardPng = null) {
  // The window's x per frame through sendcmd: a command takes effect on the
  // first frame at or after its time, so each goes half a frame early.
  const cmds = [];
  plan.xs.forEach((x, k) => {
    if (k === 0 || x !== plan.xs[k - 1]) cmds.push(`${(k === 0 ? 0 : (k - 0.5) / FPS).toFixed(6)} crop@win x ${x};`);
  });
  const cmdFile = path.join(dir, "crop-b.cmd");
  fs.writeFileSync(cmdFile, cmds.join("\n") + "\n");

  const roundList = [...plan.roundFiles.keys()];
  const fills = [];
  const L = HUD.side;
  const R = 1080 - HUD.side;
  for (const r of plan.hpA) if (r.v > 0) fills.push(`drawbox=x=${L}:y=${plan.barY}:w=${r.v}:h=${HUD.barH}:color=${C.text.replace("#", "0x")}:t=fill:enable='between(n,${r.from},${r.to})'`);
  for (const r of plan.hpB) if (r.v > 0) fills.push(`drawbox=x=${R - r.v}:y=${plan.barY}:w=${r.v}:h=${HUD.barH}:color=${C.text.replace("#", "0x")}:t=fill:enable='between(n,${r.from},${r.to})'`);
  let graph =
    `[0:v]format=rgb24,sendcmd=f='${cmdFile.replace(/'/g, "'\\''")}',crop@win=w=${plan.cw}:h=${plan.ch}:x=${plan.xs[0]}:y=${plan.oy},` +
    `scale=1080:${plan.sh}:flags=lanczos,setsar=1,pad=1080:1920:0:${plan.stageY}:color=${BG}[base];[base][2:v]overlay=0:0` +
    (fills.length ? `,${fills.join(",")}` : "") + "[h0]";
  let last = "h0";
  roundList.forEach((v, i) => {
    const on = plan.rounds.filter((r) => r.v === v).map((r) => `between(n,${r.from},${r.to})`).join("+");
    graph += `;[${last}][${3 + i}:v]overlay=${(1080 - HUD.roundW) / 2}:${plan.hudY + HUD.roundY}:enable='${on}'[h${i + 1}]`;
    last = `h${i + 1}`;
  });
  const ecIdx = 3 + roundList.length;
  graph += endcardPng ? `;[${last}]${TAIL}[st];${endcardGraph("st", ecIdx, cut.seconds, 1080, 1920)}` : `;[${last}]${TAIL}[v]`;
  ffmpeg([
    "-framerate", String(FPS), "-i", path.join(cut.seq, "%05d.jpg"), "-i", track, "-i", plan.chrome,
    ...roundList.flatMap((v) => ["-i", plan.roundFiles.get(v)]),
    ...(endcardPng ? endcardInput(endcardPng) : []),
    "-filter_complex", graph, "-map", "[v]", "-map", "1:a", ...ENCODE, out,
  ]);
}

// ── End card ──────────────────────────────────────────────────────────────

/** The end card page for a 9:16 (domain where that candidate has it) or the 16:9. */
export function endcardStill(model, file, { portrait, domainY, note }) {
  const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
  const y = domainY ?? (portrait ? 1920 - 160 : 1080 - 96 - DOMAIN_SIZE);
  return { file, w, h, html: endCardHtml(model, { w, h, domainY: y, domainSize: DOMAIN_SIZE, note }) };
}
