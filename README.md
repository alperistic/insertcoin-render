# insertcoin-render

Renders [insertcoin.lol](https://insertcoin.lol) fight replays to MP4, for the download and share buttons on each match page.

This repo is public so the GitHub Actions minutes are free. It holds no app code and no keys. The job opens the public match page in Chromium, records the replay with the CDP screencast, and cuts two files with ffmpeg:

The page plays in slow motion while it is recorded (`src/slowclock.js`, a quarter of the speed by default, env `SLOW`): a runner has no GPU and paints the stage at only ~18–27 frames a second, which lost every drawing that stands for one or two frames. The timestamps are squeezed back afterwards, so both files run at normal speed, at 60 fps:

- `16x9.mp4`, 1920×1080, the stage as the page draws it
- `9x16.mp4`, 1080×1920, a full-height 4:3 window of the stage that follows both fighters (candidate B below), with the names above it, our own HUD over its top band and insertcoin.lol below

Both end on a 2.5 s score end card. The demo music plays under both.

## How a fight gets rendered

1. Every 15 minutes (or on demand) the workflow asks the app whether any fight is waiting (`POST /api/fight-video/pending`). If none is, the run ends there.
2. `render.mjs` claims the next fight (`POST /api/fight-video/claim`). The answer carries the match id, the fighter names, and one signed upload URL per file.
3. It records the fight (in slow motion, see above) from `https://insertcoin.lol/match/<id>?stage=on`, builds both MP4s (16:9 and B, both with the end card), and uploads them to the signed URLs.
4. It reports back (`POST /api/fight-video/done`). The app checks that both files are in the bucket before the match page offers them.

A rejudged fight gets rendered again, and the old files are deleted. The app side lives in `lib/fightVideo.ts` in the insertcoin repo.

## Setup

One repository secret, `VIDEO_RENDER_SECRET`: the same value as the Vercel environment variable of that name (at least 16 characters, for example `openssl rand -hex 32`).

GitHub turns off scheduled workflows in a public repo after 60 days without a commit. If renders stop, re-enable the workflow under Actions.

## Local test

```sh
npm ci
npx playwright install chromium
TITLE_A=CORDINARE TITLE_B=ATEL node render.mjs --match <match-id>
```

This writes `out/<match-id>/16x9.mp4` and `9x16.mp4` (B, both with the end card) without uploading anything. All text on the new formats is drawn as PNGs in Chromium (`src/stills.mjs`), with Press Start 2P loaded from `assets/`, so it needs no `drawtext` and no network for fonts. On the runner, the workflow's `npx playwright install --with-deps chromium` (the same Chromium that records) draws them; apt's ffmpeg has `drawtext`, which only the old letterbox uses.

## Formats and switches

Since 22.10.2026 the default is B plus the end card. The old cut and candidate A stay switchable:

| env | values | |
|---|---|---|
| `PORTRAIT` | `b` (default), `legacy`, `a`, `both` | which 9:16 goes into `9x16.mp4`: `legacy` is the old letterbox (the 16:9 stage across the width, a third of the height); `a` needs a second recording pass; `both` writes `9x16-a.mp4` and `9x16-b.mp4` and is for `--match` only |
| `ENDCARD` | `0` | no end card on either file |
| `ENDCARD_NOTE` | `0` | leaves out the end card's line "The fight is drawn from the judges' scorecards." |

`PORTRAIT=legacy ENDCARD=0` cuts both files exactly as before 22.10.

- **B · vertical composition** (default, `src/portrait.mjs`): from the 16:9 recording, a full-height 4:3 window of the stage that follows both fighters (their drawn bounds, weapons and effects included, sampled on every page frame). Stage words (K.O., WINS, ROUND, FIGHT) are framed only when they fit together with both fighters; a fighter is never cut for a word. Its own HUD is drawn opaque over the window's top band, covering the stage's cropped HUD, laid out like the live one: the job's names (challenger left), the page's W–L records, HP bars in each fighter's brand colour as read off the page, the round on a framed plate. The log counts the frames where a fighter reaches under the band. `src/candidates.mjs` composes the cut from the recording, so a cut can be redone without recording again.
- **A · compact live stage**: a second recording at a phone viewport (432×608 CSS px at device scale 2.5, so 1080 px wide), where the page lays out a 4:3 stage with its mobile HUD above and the commentary below. The buttons between HUD and stage are cut out. Takes a second slow-motion pass, about as long as the first.
- **End card**: the winner, both sealed totals, the tier and what decided it (both values under their columns, the winner's green), read off the page's own end card and shown as the page writes them; 2.5 s after a 0.3 s fade from the last frame. If the page's card does not read, the files go without one.

To compare everything for one fight:

```sh
TITLE_A=ATEL TITLE_B=TTRRECHNER node render.mjs --match <match-id> --candidates
```

This writes `16x9.mp4`, the letterbox `9x16.mp4`, `9x16-a.mp4` and `9x16-b.mp4`, all with the end card, plus `candidates.json` with the measured layout. Without `drawtext` locally (Homebrew's ffmpeg), the letterbox's text is drawn the same PNG way.

## Assets

- `assets/PressStart2P-Regular.ttf`: Press Start 2P, SIL Open Font License, see `assets/OFL-PressStart2P.txt`
- `assets/music.m4a`: the insertcoin demo track, generated by `video/scripts/music.py` in the insertcoin repo
