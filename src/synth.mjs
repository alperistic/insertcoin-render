// A small chip synth, offline: voices are rendered sample by sample into one
// stereo Float32 mix and written out as a 16-bit WAV. No dependencies, and no
// randomness that is not seeded, so the same fight gets the same track.
//
// The palette is the one the old consoles had, on purpose (one sound for every
// video, see score.mjs): two pulse voices, a triangle, a noise channel, and a
// sine for the kick and the sub of a hit.

import fs from "node:fs";

export const SR = 48000;

/** Mulberry32: tiny, seeded, good enough for noise and for picking a variant. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, for seeds. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** The band-limited step: takes the click out of a pulse's edges. */
function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export class Mix {
  /** @param {number} seconds */
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.seconds = seconds;
  }

  /** Add a mono buffer at `at` seconds; pan -1 (left) to 1 (right). */
  add(buf, at, gain = 1, pan = 0) {
    const i0 = Math.round(at * SR);
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let i = 0; i < buf.length; i++) {
      const k = i0 + i;
      if (k < 0) continue;
      if (k >= this.n) break;
      this.l[k] += buf[i] * gl;
      this.r[k] += buf[i] * gr;
    }
  }

  /** Add another mix of the same length, through a per-sample gain curve. */
  addMix(other, gainAt) {
    const n = Math.min(this.n, other.n);
    for (let i = 0; i < n; i++) {
      const g = gainAt ? gainAt[i] : 1;
      this.l[i] += other.l[i] * g;
      this.r[i] += other.r[i] * g;
    }
  }

  /** A feedback echo on what is in the mix so far, ping-ponging a little. */
  echo(delayS, feedback, wet) {
    const d = Math.round(delayS * SR);
    const el = new Float32Array(this.n);
    const er = new Float32Array(this.n);
    for (let i = d; i < this.n; i++) {
      el[i] = (this.r[i - d] + er[i - d] * feedback) * 1;
      er[i] = (this.l[i - d] + el[i - d] * feedback) * 1;
    }
    for (let i = 0; i < this.n; i++) {
      this.l[i] += el[i] * wet;
      this.r[i] += er[i] * wet;
    }
  }

  /**
   * Two one-pole low-passes in a row (12 dB an octave above `hz`): takes the
   * fizz off the pulse voices' upper harmonics, the way a TV speaker did.
   */
  lowpass(hz) {
    const a = 1 - Math.exp((-2 * Math.PI * hz) / SR);
    for (const ch of [this.l, this.r]) {
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < this.n; i++) {
        y1 += a * (ch[i] - y1);
        y2 += a * (y1 - y2);
        ch[i] = y2;
      }
    }
  }

  peak() {
    let p = 0;
    for (let i = 0; i < this.n; i++) p = Math.max(p, Math.abs(this.l[i]), Math.abs(this.r[i]));
    return p;
  }

  rms(from = 0, to = this.seconds) {
    const a = Math.max(0, Math.round(from * SR));
    const b = Math.min(this.n, Math.round(to * SR));
    let s = 0;
    for (let i = a; i < b; i++) s += this.l[i] * this.l[i] + this.r[i] * this.r[i];
    return Math.sqrt(s / Math.max(1, 2 * (b - a)));
  }

  /** A soft knee over `knee`, so a stack of hits rounds off instead of clipping. */
  limit(knee = 0.8) {
    const f = (x) => {
      const a = Math.abs(x);
      if (a <= knee) return x;
      const over = (a - knee) / (1 - knee);
      return Math.sign(x) * (knee + (1 - knee) * Math.tanh(over));
    };
    for (let i = 0; i < this.n; i++) {
      this.l[i] = f(this.l[i]);
      this.r[i] = f(this.r[i]);
    }
  }

  scale(g) {
    for (let i = 0; i < this.n; i++) {
      this.l[i] *= g;
      this.r[i] *= g;
    }
  }

  writeWav(file) {
    const data = Buffer.alloc(this.n * 4);
    for (let i = 0; i < this.n; i++) {
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.l[i])) * 32767), i * 4);
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.r[i])) * 32767), i * 4 + 2);
    }
    const head = Buffer.alloc(44);
    head.write("RIFF", 0);
    head.writeUInt32LE(36 + data.length, 4);
    head.write("WAVEfmt ", 8);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(2, 22);
    head.writeUInt32LE(SR, 24);
    head.writeUInt32LE(SR * 4, 28);
    head.writeUInt16LE(4, 32);
    head.writeUInt16LE(16, 34);
    head.write("data", 36);
    head.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([head, data]));
  }
}

/**
 * Attack, decay to a sustain level, release. Linear attack, exponential rest:
 * that is what makes a pulse note read as plucked rather than switched.
 */
function envAt(t, dur, { a = 0.004, d = 0.08, s = 0.6, r = 0.04 }) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < dur) return s + (1 - s) * Math.exp(-(t - a) / d);
  const held = s + (1 - s) * Math.exp(-(dur - a) / d);
  return held * Math.exp(-(t - dur) / (r / 4));
}

/**
 * One pitched note.
 * wave: "pulse" (duty 0.125 / 0.25 / 0.5), "tri" (the 4-bit stepped triangle),
 * "sine". glideTo bends the pitch over the note; vib is { rate, depth (semis),
 * delay }; arp is a list of semitone offsets cycled every `arpS` seconds.
 */
export function note({
  wave = "pulse",
  duty = 0.5,
  hz,
  dur,
  gain = 0.5,
  env = {},
  glideTo = 0,
  vib = null,
  arp = null,
  arpS = 0.03,
}) {
  const rel = env.r ?? 0.04;
  const n = Math.ceil((dur + rel) * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = glideTo ? hz * (glideTo / hz) ** Math.min(1, t / dur) : hz;
    if (arp) f *= 2 ** (arp[Math.floor(t / arpS) % arp.length] / 12);
    if (vib && t > (vib.delay ?? 0)) f *= 2 ** ((Math.sin((t - (vib.delay ?? 0)) * vib.rate * 2 * Math.PI) * vib.depth) / 12);
    const dt = f / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    let v;
    if (wave === "pulse") {
      v = ph < duty ? 1 : -1;
      v += polyBlep(ph, dt);
      let p2 = ph - duty;
      if (p2 < 0) p2 += 1;
      v -= polyBlep(p2, dt);
      v -= 2 * duty - 1; // no DC, whatever the duty
    } else if (wave === "tri") {
      const tri = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
      v = Math.round(tri * 7.5) / 7.5;
    } else {
      v = Math.sin(ph * 2 * Math.PI);
    }
    out[i] = v * gain * envAt(t, dur, env);
  }
  return out;
}

/**
 * Filtered noise. type: "lp" | "hp" | "bp"; the cutoff may sweep. `swell`
 * rises to its peak instead of falling from it (a wind-up, a riser).
 */
export function noise({ dur, gain = 0.5, cutoff = 4000, sweepTo = 0, type = "lp", swell = false, seed = 1, q = 0.9 }) {
  const n = Math.ceil((dur + 0.02) * SR);
  const out = new Float32Array(n);
  const rand = rng(seed);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fc = sweepTo ? cutoff * (sweepTo / cutoff) ** Math.min(1, t / dur) : cutoff;
    // A state-variable filter: one loop gives low, band and high.
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6.5)) / SR);
    const x = rand() * 2 - 1;
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    const y = type === "hp" ? high : type === "bp" ? band : low;
    const e = swell
      ? t < dur * 0.85
        ? (t / (dur * 0.85)) ** 2
        : Math.max(0, 1 - (t - dur * 0.85) / (dur * 0.15))
      : Math.exp((-t / dur) * 5);
    out[i] = y * gain * e;
  }
  return out;
}

/** Shift-register noise at a clock rate: the consoles' hi-hat and snare grit. */
export function lfsr({ dur, gain = 0.4, rate = 8000, decay = 5, short = false }) {
  const n = Math.ceil(dur * SR);
  const out = new Float32Array(n);
  let reg = 1;
  let acc = 0;
  let v = 1;
  for (let i = 0; i < n; i++) {
    acc += rate / SR;
    while (acc >= 1) {
      acc -= 1;
      const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
      reg = (reg >> 1) | (bit << 14);
      v = reg & 1 ? 1 : -1;
    }
    out[i] = v * gain * Math.exp((-i / n) * decay);
  }
  return out;
}

/** A kick: a sine that falls from `from` to `to` Hz with a click on top. */
export function kick({ dur = 0.16, gain = 0.9, from = 150, to = 45 }) {
  const n = Math.ceil(dur * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = to + (from - to) * Math.exp(-t * 38);
    ph += f / SR;
    out[i] = Math.sin(ph * 2 * Math.PI) * gain * Math.exp(-t * 16) * Math.min(1, t / 0.002);
  }
  return out;
}
