"""Writes assets/music.m4a: a quiet 8-bit loop (A minor, 120 bpm, 32 s).

Pulse arpeggio on top, triangle bass, a thin noise tick. Pure synthesis, no
samples, so the file is ours. build.mjs loops it under the fight and turns the
level down further, so this only has to sound right, not be loud.
"""
import subprocess, sys
import numpy as np

SR = 44100
BPM = 120
STEP = 60 / BPM / 4            # sixteenth
BARS = [("A", [57, 60, 64]), ("F", [53, 57, 60]), ("C", [48, 52, 55]), ("G", [55, 59, 62])] * 4
rng = np.random.default_rng(7)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

def pulse(f, n, duty=0.25):
    t = np.arange(n) / SR
    return np.where((t * f) % 1.0 < duty, 1.0, -1.0)

def tri(f, n):
    t = np.arange(n) / SR
    return 2 * np.abs(2 * ((t * f) % 1.0) - 1) - 1

def env(n, a=0.004, d=0.09):
    t = np.arange(n) / SR
    return np.minimum(t / a, 1.0) * np.exp(-t / d)

total = int(SR * STEP * 16 * len(BARS))
out = np.zeros(total)
for b, (_, chord) in enumerate(BARS):
    base = int(b * 16 * STEP * SR)
    n8 = int(STEP * 2 * SR)
    n16 = int(STEP * SR)
    for i in range(16):
        # arpeggio, one octave up on the last quarter
        note = chord[[0, 1, 2, 1][i % 4]] + (12 if i >= 12 else 0)
        s = base + i * n16
        out[s:s + n16] += 0.5 * pulse(hz(note), n16) * env(n16, d=0.07)
    for i in range(0, 16, 2):
        s = base + i * n16
        out[s:s + n8] += 0.9 * tri(hz(chord[0] - 12), n8) * env(n8, a=0.006, d=0.2)
    for i in range(2, 16, 4):
        s = base + i * n16
        out[s:s + n16] += 0.18 * rng.uniform(-1, 1, n16) * env(n16, a=0.001, d=0.02)

out = out / np.max(np.abs(out)) * 0.6
pcm = (out * 32767).astype("<i2").tobytes()
dest = sys.argv[1] if len(sys.argv) > 1 else "assets/music.m4a"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                "-c:a", "aac", "-b:a", "96k", "-ac", "2", dest], input=pcm, check=True)
