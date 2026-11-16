// The sound of one fight video: a score cut to THIS fight, and the hits.
//
// Until 16.11.2026 every video carried the same 32 s loop at -28 LUFS and no
// sound effects at all (the screencast records no audio), so ten fights in a
// feed sounded like one, and none of them sounded like a fight.
//
// What this builds instead, offline and deterministic (synth.mjs):
//
//   one sound    the same five chip voices in every video, and the same
//                eight-note motif: it opens the lead of every theme, its first
//                two notes (a fourth up, the coin) open every video, and all
//                of it is the jingle under every end card.
//   variety      four themes (key, tempo, changes, bass and drum feel, two
//                lead phrases each), picked by the stage the fight is on or
//                by the pairing; within a theme the pairing seeds the smaller
//                choices (fills, hats, arpeggio shape).
//   the fight    the music follows the recording: an intro under the VS card,
//                a section per round that starts on the bell and steps up,
//                a riser into the finisher, silence where the freeze is, and
//                the jingle on the end card. Each section's tempo is bent a
//                few percent so it ends on its own grid and the fill lands.
//   the hits     every cue the stage fires (lib/fight/sfx.ts in the app:
//                hit, block, whiff, swing, bell, finisher, ending) with the
//                app's own recipes (components/fight/sfxPlayer.ts), so the
//                video sounds like the site with sound on.
//
// planScore is pure (tests); renderScore turns a plan into a Mix.

import { Mix, SR, hash, kick, lfsr, midiHz, noise, note, rng } from "./synth.mjs";

const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Scale degree (0 = tonic, 7 = the octave) to MIDI; `sharp` raises listed degrees (mod 7). */
export function degMidi(tonic, d, sharp = null) {
  const k = ((d % 7) + 7) % 7;
  return tonic + 12 * Math.floor(d / 7) + MINOR[k] + (sharp?.includes(k) ? 1 : 0);
}

/**
 * The motif, in scale degrees and sixteenths: a pickup up a fourth onto the
 * tonic (the coin), up to the third, back down, and home through the flat
 * seventh. One bar. Every theme's first lead bar is exactly this.
 */
export const MOTIF = [[-3, 1], [0, 3], [2, 2], [1, 2], [0, 2], [-3, 2], [-1, 2], [0, 2]];

const R = null; // a rest

/**
 * roots: the four chords, one bar each, as scale degrees (5 and up sit below
 * the tonic in the bass). sharp: degrees raised while that chord sounds.
 * lead: two four-bar phrases, [degree, sixteenths]; bar 1 of A is the motif.
 */
export const THEMES = {
  // A minor, i-VI-III-VII: the driving one. Workbench, strip light, eighths.
  garage: {
    tonic: 57, leadOct: 1, bpm: 132, roots: [0, 5, 2, 6], sharp: [null, null, null, null],
    bass: [0, R, 0, R, 7, R, 0, R, 0, R, 0, R, 7, R, 4, R],
    drums: "four",
    lead: {
      a: [
        MOTIF,
        [[0, 4], [2, 2], [0, 2], [-2, 4], [R, 2], [0, 2]],
        [[2, 3], [4, 3], [2, 2], [4, 2], [6, 2], [4, 4]],
        [[3, 3], [1, 3], [-1, 2], [1, 4], [-1, 2], [-3, 2]],
      ],
      b: [
        [[4, 2], [4, 1], [4, 1], [7, 2], [4, 2], [2, 2], [4, 2], [2, 2], [0, 2]],
        [[5, 2], [5, 1], [5, 1], [7, 2], [5, 2], [2, 2], [5, 2], [2, 2], [0, 2]],
        [[6, 2], [6, 1], [6, 1], [9, 2], [6, 2], [4, 2], [6, 2], [4, 2], [2, 2]],
        [[8, 2], [6, 2], [8, 2], [10, 2], [8, 4], [6, 2], [4, 2]],
      ],
    },
  },
  // D minor, i-VII-VI-VII: slower, half-time, room between the notes. Night air.
  rooftop: {
    tonic: 50, leadOct: 2, bpm: 114, roots: [0, 6, 5, 6], sharp: [null, null, null, null],
    bass: [0, R, R, 0, R, R, 0, R, R, R, 7, R, 0, R, 4, R],
    drums: "half",
    lead: {
      a: [
        MOTIF,
        [[1, 6], [3, 2], [1, 2], [-1, 6]],
        [[0, 3], [2, 3], [4, 2], [2, 4], [0, 4]],
        [[1, 3], [3, 3], [1, 2], [-1, 4], [R, 2], [-3, 2]],
      ],
      b: [
        [[4, 3], [7, 3], [4, 2], [2, 4], [4, 4]],
        [[3, 3], [6, 3], [3, 2], [1, 4], [3, 4]],
        [[2, 3], [5, 3], [2, 2], [0, 4], [2, 4]],
        [[3, 2], [4, 2], [6, 2], [8, 2], [7, 8]],
      ],
    },
  },
  // E minor, i-VI-VII-v: fast, octave bass, arpeggio runs. The orbit deck.
  orbit: {
    tonic: 52, leadOct: 1, bpm: 140, roots: [0, 5, 6, 4], sharp: [null, null, null, null],
    bass: [0, R, 7, R, 0, R, 7, R, 0, R, 7, R, 0, R, 7, 7],
    drums: "break",
    lead: {
      a: [
        MOTIF,
        [[2, 2], [0, 2], [2, 2], [4, 2], [2, 4], [0, 4]],
        [[3, 2], [1, 2], [3, 2], [5, 2], [3, 4], [1, 4]],
        [[4, 4], [6, 2], [4, 2], [1, 4], [-1, 2], [-3, 2]],
      ],
      b: [
        [[0, 1], [2, 1], [4, 1], [7, 1], [4, 1], [2, 1], [4, 1], [7, 1], [9, 2], [7, 2], [4, 2], [7, 2]],
        [[0, 1], [2, 1], [5, 1], [7, 1], [5, 1], [2, 1], [5, 1], [7, 1], [9, 2], [7, 2], [5, 2], [7, 2]],
        [[1, 1], [3, 1], [6, 1], [8, 1], [6, 1], [3, 1], [6, 1], [8, 1], [10, 2], [8, 2], [6, 2], [8, 2]],
        [[-1, 1], [1, 1], [4, 1], [6, 1], [4, 1], [1, 1], [4, 1], [6, 1], [8, 4], [6, 2], [4, 2]],
      ],
    },
  },
  // F sharp minor, i-iv-VI-V with the raised seventh: the last night of a bracket.
  final: {
    tonic: 54, leadOct: 1, bpm: 150, roots: [0, 3, 5, 4], sharp: [null, null, null, [6]],
    bass: [0, R, 0, 0, 0, R, 0, 0, 0, R, 0, 0, 7, R, 4, R],
    drums: "gallop",
    lead: {
      a: [
        MOTIF,
        [[3, 3], [5, 3], [3, 2], [0, 2], [3, 2], [5, 4]],
        [[2, 3], [5, 3], [2, 2], [0, 2], [2, 2], [5, 4]],
        [[4, 4], [6, 2], [8, 2], [6, 2], [4, 2], [6, 4]],
      ],
      b: [
        [[7, 2], [7, 2], [4, 2], [7, 2], [9, 3], [7, 3], [4, 2]],
        [[7, 2], [7, 2], [5, 2], [7, 2], [10, 3], [7, 3], [5, 2]],
        [[9, 2], [9, 2], [7, 2], [9, 2], [12, 3], [9, 3], [7, 2]],
        [[8, 2], [6, 2], [8, 2], [11, 2], [13, 4], [11, 2], [8, 2]],
      ],
    },
  },
};

/** Themes a pairing is drawn from when nothing names one. `final` is asked for. */
const ROTATION = ["garage", "rooftop", "orbit"];

/** Which theme: the one asked for, the stage's own, or the pairing's draw. */
export function pickTheme({ theme, venue, seedKey }) {
  if (theme && THEMES[theme]) return theme;
  if (venue && THEMES[venue]) return venue;
  return ROTATION[hash(seedKey || "insertcoin") % ROTATION.length];
}

const DRUMS = {
  // [kick steps, snare steps] per level 1..3
  four: { kick: [[0, 8], [0, 4, 8, 12], [0, 4, 8, 12]], snare: [[4, 12], [4, 12], [4, 12, 15]] },
  half: { kick: [[0, 10], [0, 7, 10], [0, 6, 7, 10]], snare: [[8], [8], [8, 15]] },
  break: { kick: [[0, 10], [0, 6, 10], [0, 3, 6, 10]], snare: [[4, 12], [4, 12], [4, 7, 12]] },
  gallop: { kick: [[0, 8], [0, 3, 8, 11], [0, 3, 4, 8, 11, 12]], snare: [[4, 12], [4, 12], [4, 12, 14]] },
};

/**
 * The cues a recording without them still implies: a bell where the round
 * number steps, a hit where either bar drops, the ending where the cut ends.
 * Coarser than the stage's own cues (no blocks, no whiffs, no finisher), and
 * only used against an app that does not send them.
 */
export function cuesFromTrack(track, tEnd) {
  const cues = [];
  let prev = null;
  for (const s of track ?? []) {
    if (prev) {
      if (s.round && s.round !== prev.round) cues.push({ t: s.t, kind: "bell", round: s.round });
      const drop = Math.max((prev.hp?.[0] ?? 0) - (s.hp?.[0] ?? 0), (prev.hp?.[1] ?? 0) - (s.hp?.[1] ?? 0));
      // HP is a fraction of the bar. A drop of a sixth or more is the blow that ends it.
      if (drop >= 0.15) cues.push({ t: s.t, kind: "finisher" });
      else if (drop > 0.005) cues.push({ t: s.t, kind: "hit", weight: drop >= 0.06 ? "big" : "light" });
    }
    prev = s;
  }
  const dead = prev && Math.min(prev.hp?.[0] ?? 1, prev.hp?.[1] ?? 1) <= 0;
  cues.push({ t: tEnd - 0.4, kind: "ending", style: dead ? "ko" : "decision" });
  return cues;
}

/**
 * Lay the fight out in time. All times in seconds from the first video frame.
 *
 * @param {{ cues: {t:number, kind:string, weight?:string, style?:string, round?:number}[],
 *   fight: number, total: number, theme: string, seedKey: string }} input
 *   cues: already on the video's clock; fight: where the held last frame ends
 *   (and the end card starts fading in); total: the video's length.
 */
export function planScore({ cues, fight, total, theme, seedKey }) {
  const T = THEMES[theme];
  const inCut = cues.filter((c) => c.t >= -0.05 && c.t < fight).sort((a, b) => a.t - b.t);
  const bells = inCut.filter((c) => c.kind === "bell").map((c) => c.t);
  const finisher = inCut.find((c) => c.kind === "finisher") ?? null;
  const ending = inCut.findLast((c) => c.kind === "ending") ?? null;
  // Where the music stops: on the blow the fight is about, else on the ending.
  const stop = Math.min(finisher?.t ?? Infinity, ending?.t ?? Infinity, fight - 0.2);

  // Section edges: the cut's first frame, every bell that leaves room, the stop.
  const beat = 60 / T.bpm;
  const edges = [0];
  for (const b of bells) if (b - edges[edges.length - 1] > 2 * beat && stop - b > 4 * beat) edges.push(b);
  const sections = [];
  const rounds = edges.length - 1;
  for (let i = 0; i < edges.length; i++) {
    const t0 = edges[i];
    const t1 = i + 1 < edges.length ? edges[i + 1] : stop;
    // No bell in the cut at all: the one section is a round, not an intro.
    const intro = i === 0 && edges.length > 1;
    // The last round is always the top level, whatever the count.
    const round = intro ? 0 : edges.length > 1 ? i : 1;
    const level = intro ? 0 : rounds <= 1 ? 3 : round === rounds ? 3 : Math.min(2, round);
    // Bend the tempo so the section is a whole number of half bars.
    const half = 2 * beat;
    const halves = Math.max(1, Math.round((t1 - t0) / half));
    const sBeat = (t1 - t0) / (halves * 2);
    sections.push({ t0, t1, level, round, beats: halves * 2, beat: sBeat, last: i === edges.length - 1 });
  }

  // The jingle: on the end card when there is one, else where the held frame
  // leaves room for it. One motif bar and the chord it lands on.
  const jBeat = 60 / 140;
  const room = total - fight;
  const jingleAt = room > 1.6 ? fight - 0.1 : null;
  const landing = jingleAt === null ? Math.max(stop + 0.5, (ending?.t ?? stop) + 0.55) : null;
  // After the stop the picture holds on the winner for seconds. First the hit
  // rings in silence, then the theme comes back as it stood under the VS card
  // (no drums, the chords only) and walks into the jingle.
  const afterFrom = stop + 1.4;
  const afterTo = (jingleAt ?? landing ?? fight) - 0.05;
  let after = null;
  if (afterTo - afterFrom > 4 * beat) {
    const halves = Math.max(1, Math.round((afterTo - afterFrom) / (2 * beat)));
    after = { t0: afterFrom, t1: afterTo, level: 0, round: 0, beats: halves * 2, beat: (afterTo - afterFrom) / (halves * 2), last: false, after: true };
  }
  return {
    theme,
    after,
    seed: hash(`${theme}|${seedKey}`),
    total,
    fight,
    stop,
    sections,
    cues: inCut,
    finisher: finisher?.t ?? null,
    ending: ending ? { t: ending.t, style: ending.style ?? "ko" } : null,
    jingle: jingleAt !== null ? { at: jingleAt, beat: jBeat, full: true } : landing < total - 0.5 ? { at: landing, beat: jBeat, full: false } : null,
  };
}

// --------------------------------------------------------------- the voices

const LEAD_ENV = { a: 0.004, d: 0.12, s: 0.55, r: 0.06 };
const BASS_ENV = { a: 0.003, d: 0.2, s: 0.7, r: 0.03 };
const ARP_ENV = { a: 0.002, d: 0.05, s: 0.25, r: 0.03 };

function snare(gain, seed) {
  const n = noise({ dur: 0.13, gain: gain * 0.9, cutoff: 5200, type: "bp", seed, q: 1.2 });
  const body = note({ wave: "tri", hz: 190, glideTo: 120, dur: 0.07, gain: gain * 0.7, env: { a: 0.001, d: 0.03, s: 0, r: 0.02 } });
  for (let i = 0; i < body.length && i < n.length; i++) n[i] += body[i];
  return n;
}

const hat = (gain, open) => lfsr({ dur: open ? 0.16 : 0.035, gain, rate: 11000, decay: open ? 4 : 6, short: true });
const crash = (gain, seed) => noise({ dur: 1.1, gain, cutoff: 9000, sweepTo: 3500, type: "hp", seed, q: 0.7 });

/** One section of music into the buses. */
function renderSection(bus, T, plan, sec) {
  const rand = rng(plan.seed ^ Math.round(sec.t0 * 1000));
  const s16 = sec.beat / 4;
  const steps = sec.beats * 4;
  const lvl = sec.level;
  // The last beat belongs to the fill (or to the riser into the finisher).
  const fillFrom = steps - 4;
  const leadTonic = T.tonic + 12 * (T.leadOct + 1);
  const at = (step) => sec.t0 + step * s16;
  const chordOf = (bar) => bar % 4;
  const bassRoot = (d) => (d >= 5 ? d - 7 : d);

  // Bass: whole notes under the VS card, the theme's own figure in a round.
  for (let step = 0; step < steps; step++) {
    const bar = Math.floor(step / 16);
    const c = chordOf(bar);
    const root = bassRoot(T.roots[c]);
    if (lvl === 0) {
      if (step % 16 !== 0) continue;
      const len = Math.min(16, steps - step) * s16;
      bus.bass.add(note({ wave: "tri", hz: midiHz(degMidi(T.tonic - 12, root, T.sharp[c])), dur: len * 0.96, gain: 0.36, env: { ...BASS_ENV, s: 0.9 } }), at(step), 1);
      continue;
    }
    if (step >= fillFrom && !sec.last) continue;
    const off = T.bass[step % 16];
    if (off === R) continue;
    let len = 1;
    while (step + len < steps && len < 4 && T.bass[(step + len) % 16] === R) len++;
    bus.bass.add(
      note({ wave: "tri", hz: midiHz(degMidi(T.tonic - 12, root + off, T.sharp[c])), dur: len * s16 * 0.82, gain: 0.42, env: BASS_ENV }),
      at(step), 1,
    );
  }

  // Arpeggio: the chord in sixteenths on the thin pulse. Under the VS card it
  // is the whole tune and fades in; in a round it is the shimmer behind the lead.
  if (lvl === 0 || lvl >= 2) {
    const shapes = [[0, 2, 4, 7], [0, 4, 2, 7], [7, 4, 2, 0], [0, 2, 4, 2]];
    const shape = shapes[Math.floor(rand() * shapes.length)];
    for (let step = 0; step < steps; step++) {
      if (lvl > 0 && step >= fillFrom && !sec.last) break;
      if (lvl === 0 && step % 2 === 1) continue; // eighths before the bell
      const c = chordOf(Math.floor(step / 16));
      const d = T.roots[c] + shape[(lvl === 0 ? step / 2 : step) % shape.length];
      const fade = lvl === 0 ? Math.min(1, 0.25 + (step / Math.max(1, steps)) * 0.9) : 1;
      bus.arp.add(
        note({ wave: "pulse", duty: 0.125, hz: midiHz(degMidi(T.tonic + 12, d >= 9 ? d - 7 : d, T.sharp[c])), dur: s16 * (lvl === 0 ? 1.6 : 0.8), gain: 0.3 * fade, env: ARP_ENV }),
        at(step), 1, step % 2 ? 0.35 : -0.35,
      );
    }
  }

  // Lead: phrase A on odd rounds, B on even ones; the top level doubles it an
  // octave up, quietly. A note that would cross the fill is left out whole.
  if (lvl >= 1) {
    const phrase = sec.round % 2 === 1 ? T.lead.a : T.lead.b;
    const vib = { rate: 5.5, depth: 0.18, delay: 0.16 };
    let step = 0;
    for (let bar = 0; step < steps; bar++) {
      const c = chordOf(bar);
      for (const [d, len] of phrase[bar % 4]) {
        const end = step + len;
        if (d !== R && step < (sec.last ? steps : fillFrom) && step < steps) {
          const dur = (Math.min(end, steps) - step) * s16;
          const hz = midiHz(degMidi(leadTonic, d, T.sharp[c]));
          bus.lead.add(note({ wave: "pulse", duty: 0.25, hz, dur: dur * 0.92, gain: 0.42, env: LEAD_ENV, vib: len >= 3 ? vib : null }), at(step), 1, -0.08);
          if (lvl >= 3) bus.lead.add(note({ wave: "pulse", duty: 0.5, hz: hz * 2, dur: dur * 0.8, gain: 0.1, env: LEAD_ENV }), at(step), 1, 0.2);
        }
        step = end;
      }
    }
  }

  // Drums.
  if (lvl >= 1) {
    const D = DRUMS[T.drums];
    const kicks = D.kick[lvl - 1];
    const snares = D.snare[lvl - 1];
    const sixteenths = lvl >= 3 || (lvl === 2 && T.drums === "break");
    for (let step = 0; step < steps; step++) {
      if (step >= fillFrom && !sec.last) break;
      const k = step % 16;
      if (kicks.includes(k)) bus.drums.add(kick({ gain: 0.95 }), at(step), 1);
      if (snares.includes(k)) bus.drums.add(snare(k === 15 || k === 7 || k === 14 ? 0.3 : 0.55, 7 + step), at(step), 1, 0.05);
      const open = lvl >= 2 && k % 8 === 6;
      if (k % 2 === 0 || sixteenths) bus.drums.add(hat(k % 4 === 0 ? 0.2 : k % 2 === 0 ? 0.14 : 0.08, open), at(step), 1, 0.25);
    }
  } else {
    // Under the VS card: a soft kick on every bar, so the card has a pulse.
    for (let step = 0; step < steps - (sec.after ? 0 : 4); step += 8) bus.drums.add(kick({ gain: 0.5, from: 110 }), at(step), 1);
  }

  // The way out. Into a bell: a fill on the last beat, one of three, and the
  // crash that opens the next section. Into the finisher: a riser, no crash,
  // because what follows is the hit and then nothing.
  if (sec.after) return;
  if (!sec.last) {
    const v = Math.floor(rand() * 3);
    const fill = v === 0 ? [0, 1, 2, 3] : v === 1 ? [0, 2, 3] : [0, 1.5, 2, 3];
    fill.forEach((f, i) => {
      const g = 0.3 + (i / fill.length) * 0.4;
      bus.drums.add(snare(g, 91 + i), at(fillFrom + f), 1, -0.2 + i * 0.13);
      if (i === fill.length - 1) bus.drums.add(kick({ gain: 0.8 }), at(fillFrom + f), 1);
    });
    if (lvl === 0) bus.fx.add(noise({ dur: Math.min(1.2, (sec.t1 - sec.t0) * 0.6), gain: 0.2, cutoff: 1200, sweepTo: 7000, type: "bp", swell: true, seed: 5 }), sec.t1 - Math.min(1.2, (sec.t1 - sec.t0) * 0.6), 1);
    bus.drums.add(crash(0.34, 3 + sec.round), sec.t1, 1, -0.1);
    bus.drums.add(kick({ gain: 1 }), sec.t1, 1);
  } else if (plan.finisher !== null) {
    const len = Math.min(0.9, sec.t1 - sec.t0);
    bus.fx.add(noise({ dur: len, gain: 0.3, cutoff: 900, sweepTo: 8000, type: "bp", swell: true, seed: 11 }), sec.t1 - len, 1);
  }
}

/** The motif bar and the chord it lands on: what every end card sounds like. */
function renderJingle(mix, T, j) {
  const leadTonic = T.tonic + 12 * (T.leadOct + 1);
  const s16 = j.beat / 4;
  const echo = new Mix(mix.seconds);
  if (j.full) {
    let step = 0;
    for (const [d, len] of MOTIF) {
      const hz = midiHz(degMidi(leadTonic, d));
      echo.add(note({ wave: "pulse", duty: 0.25, hz, dur: len * s16 * 0.9, gain: 0.42, env: LEAD_ENV }), j.at + step * s16, 1, -0.1);
      echo.add(note({ wave: "pulse", duty: 0.125, hz: hz * 2, dur: len * s16 * 0.7, gain: 0.1, env: LEAD_ENV }), j.at + step * s16, 1, 0.25);
      if (step % 4 === 0) mix.add(note({ wave: "tri", hz: midiHz(degMidi(T.tonic - 12, step < 12 ? 0 : -1)), dur: s16 * 3.4, gain: 0.5, env: BASS_ENV }), j.at + step * s16, 0.8);
      step += len;
    }
  } else {
    // No end card: only the coin, the two notes every video opens with.
    echo.add(note({ wave: "pulse", duty: 0.25, hz: midiHz(degMidi(leadTonic, -3)), dur: s16 * 0.9, gain: 0.42, env: LEAD_ENV }), j.at - s16, 1);
  }
  // The landing: tonic, fifth and octave (no third, so it is neither sad nor
  // sweet), rolled up in thirty-seconds, with the kick under it.
  const land = j.at + (j.full ? 16 * s16 : 0);
  const room = Math.max(0.5, mix.seconds - land - 0.05);
  [0, 4, 7, 11].forEach((d, i) => {
    echo.add(note({ wave: "pulse", duty: i % 2 ? 0.125 : 0.25, hz: midiHz(degMidi(leadTonic - 12, d)), dur: Math.min(1.4, room), gain: 0.26, env: { a: 0.004, d: 0.5, s: 0.25, r: 0.25 }, vib: { rate: 5, depth: 0.12, delay: 0.3 } }), land + i * 0.028, 1, (i - 1.5) * 0.3);
  });
  mix.add(note({ wave: "tri", hz: midiHz(T.tonic - 12), dur: Math.min(1.2, room), gain: 0.6, env: { ...BASS_ENV, s: 0.8, r: 0.2 } }), land, 0.8);
  mix.add(kick({ gain: 0.9 }), land, 0.7);
  mix.add(crash(0.22, 21), land, 0.7);
  echo.echo(j.beat * 0.75, 0.3, 0.22);
  mix.addMix(echo);
}

// ---------------------------------------------------------------- the hits

const tone = (wave, hz, dur, peak, glideTo = 0) =>
  note({ wave, duty: 0.5, hz, dur, gain: peak, glideTo, env: { a: Math.min(0.008, dur / 4), d: dur / 7, s: 0, r: 0.01 } });

/**
 * One cue, with the app's recipes (sfxPlayer.ts) — same frequencies, lengths
 * and relative peaks. `v` (0.94 to 1.06) detunes each landing a little, so six
 * light hits in a row are six hits and not one sample six times.
 */
function renderCue(sfx, c, t, v, seed) {
  const add = (buf, dt = 0, g = 1) => sfx.add(buf, t + dt, g);
  switch (c.kind) {
    case "vs":
      add(tone("pulse", 220, 0.09, 0.5));
      add(tone("pulse", 440, 0.09, 0.5), 0.1);
      add(noise({ dur: 0.07, gain: 0.35, cutoff: 6000, seed }), 0.2);
      break;
    case "hit": {
      const big = c.weight !== "light";
      add(noise({ dur: big ? 0.12 : 0.06, gain: big ? 0.5 : 0.35, cutoff: (big ? 3000 : 5000) * v, seed }));
      add(tone("sine", (big ? 80 : 110) * v, big ? 0.12 : 0.08, 0.7));
      if (c.weight === "crit") add(tone("pulse", 600 * v, 0.12, 0.28, 200), 0.02);
      break;
    }
    case "block":
      add(noise({ dur: 0.05, gain: 0.22, cutoff: 900 * v, seed }));
      add(tone("sine", 150 * v, 0.06, 0.4, 110));
      break;
    case "whiff":
      add(noise({ dur: 0.16, gain: 0.2, cutoff: 700, sweepTo: 2600, type: "bp", seed }));
      break;
    case "swing":
      add(noise({ dur: 0.22, gain: 0.14, cutoff: 3000, sweepTo: 6000, type: "hp", swell: true, seed }));
      break;
    case "finisher":
      add(noise({ dur: 0.14, gain: 0.55, cutoff: 2600, seed }));
      add(tone("sine", 55, 0.9, 0.9, 32));
      add(tone("pulse", 520, 0.16, 0.26, 130), 0.02);
      add(noise({ dur: 0.7, gain: 0.22, cutoff: 900, sweepTo: 180, seed: seed + 1 }), 0.06);
      break;
    case "bell":
      add(tone("sine", 880, 0.45, 0.32));
      add(tone("sine", 1760, 0.4, 0.12));
      break;
    case "ending":
      if (c.style === "ko") {
        add(tone("sine", 60, 0.4, 0.85));
        add(noise({ dur: 0.15, gain: 0.4, cutoff: 1800, seed }));
        add(tone("pulse", 220, 0.3, 0.3), 0.25);
        add(tone("pulse", 330, 0.3, 0.22), 0.25);
      } else if (c.style === "tko") {
        add(tone("sine", 150, 0.5, 0.4, 70));
        add(tone("pulse", 165, 0.34, 0.22), 0.3);
        add(tone("pulse", 220, 0.34, 0.16), 0.3);
      } else {
        for (const dt of [0, 0.18, 0.36]) {
          add(tone("sine", 880, 0.45, 0.32), dt);
          add(tone("sine", 1760, 0.4, 0.12), dt);
        }
      }
      break;
  }
}

/** How far the music steps back for a landing, and for how long (seconds). */
const DUCK = { hit: [0.78, 0.1], big: [0.55, 0.16], crit: [0.45, 0.2], finisher: [0, 0], bell: [0.8, 0.2] };

/**
 * The whole track.
 * @returns {{ mix: Mix, music: Mix, sfx: Mix }} mix is what the video carries;
 *   the two stems are returned for the tests and the level report.
 */
export function renderScore(plan) {
  const T = THEMES[plan.theme];
  const seconds = plan.total;
  const bus = { bass: new Mix(seconds), arp: new Mix(seconds), lead: new Mix(seconds), drums: new Mix(seconds), fx: new Mix(seconds) };
  for (const sec of plan.sections) renderSection(bus, T, plan, sec);
  bus.lead.echo((60 / T.bpm) * 0.75, 0.32, 0.2);

  const music = new Mix(seconds);
  music.addMix(bus.bass);
  music.addMix(bus.arp);
  music.addMix(bus.lead);
  music.addMix(bus.drums);
  music.addMix(bus.fx);

  // The music's own gain over time: out on the stop (20 ms, a cut and not a
  // fade), back for nothing (the jingle is added after), and a step back under
  // every landing so the hit is what is heard.
  const g = new Float32Array(music.n).fill(1);
  const stopI = Math.round(plan.stop * SR);
  const cutN = Math.round(0.02 * SR);
  for (let i = Math.max(0, stopI - cutN); i < music.n; i++) g[i] = i >= stopI ? 0 : (stopI - i) / cutN;
  for (const c of plan.cues) {
    const key = c.kind === "hit" ? (c.weight === "light" ? "hit" : c.weight) : c.kind;
    const d = DUCK[key];
    if (!d || !d[1]) continue;
    const i0 = Math.round(c.t * SR);
    const len = Math.round(d[1] * SR);
    for (let i = 0; i < len && i0 + i < music.n; i++) {
      if (i0 + i < 0) continue;
      const back = d[0] + (1 - d[0]) * (i / len) ** 2;
      g[i0 + i] = Math.min(g[i0 + i], back * (g[i0 + i] > 0 ? 1 : 0));
    }
  }
  const mix = new Mix(seconds);
  // The coin: the motif's first two notes, on the first frame of every video.
  const leadTonic = T.tonic + 12 * (T.leadOct + 1);
  const coin = new Mix(seconds);
  coin.add(note({ wave: "pulse", duty: 0.25, hz: midiHz(degMidi(leadTonic, -3)), dur: 0.07, gain: 0.4, env: LEAD_ENV }), 0.02, 1);
  coin.add(note({ wave: "pulse", duty: 0.25, hz: midiHz(degMidi(leadTonic, 0)), dur: 0.42, gain: 0.4, env: { ...LEAD_ENV, d: 0.25, s: 0.2 } }), 0.1, 1);
  coin.echo(0.19, 0.3, 0.25);
  music.addMix(coin);

  const MUSIC_GAIN = 0.34;
  mix.addMix(music, g);
  mix.scale(MUSIC_GAIN);
  const tail = new Mix(seconds);
  if (plan.after) {
    const ab = { bass: new Mix(seconds), arp: new Mix(seconds), lead: new Mix(seconds), drums: new Mix(seconds), fx: new Mix(seconds) };
    renderSection(ab, T, plan, plan.after);
    // In over its first second, and out at its end, where the jingle takes over.
    const ag = new Float32Array(tail.n);
    const a0 = Math.round(plan.after.t0 * SR);
    const a1 = Math.round(plan.after.t1 * SR);
    for (let i = a0; i < a1 && i < tail.n; i++) ag[i] = Math.min(1, (i - a0) / SR, (a1 - i) / (0.04 * SR)) * 0.8;
    for (const b of [ab.bass, ab.arp, ab.drums]) tail.addMix(b, ag);
  }
  if (plan.jingle) renderJingle(tail, T, plan.jingle);
  tail.scale(MUSIC_GAIN * 1.1);
  mix.addMix(tail);

  const sfx = new Mix(seconds);
  const rand = rng(plan.seed ^ 0x51f15e);
  plan.cues.forEach((c, i) => renderCue(sfx, c, Math.max(0, c.t), 0.94 + rand() * 0.12, 100 + i * 7));
  sfx.scale(0.95);
  mix.addMix(sfx);

  // Out over the last 60 ms, so the file never ends on a step.
  const fade = Math.round(0.06 * SR);
  for (let i = 0; i < fade; i++) {
    const k = mix.n - 1 - i;
    if (k < 0) break;
    mix.l[k] *= i / fade;
    mix.r[k] *= i / fade;
  }
  mix.limit(0.8);
  return { mix, music, sfx };
}
