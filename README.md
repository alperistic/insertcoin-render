# insertcoin-render

Renders [insertcoin.lol](https://insertcoin.lol) fight replays to MP4, for the download and share buttons on each match page.

This repo is public so the GitHub Actions minutes are free. It holds no app code and no keys. The job opens the public match page in Chromium, records the replay with the CDP screencast, and cuts two files with ffmpeg:

The page plays in slow motion while it is recorded (`src/slowclock.js`, a quarter of the speed by default, env `SLOW`): a runner has no GPU and paints the stage at only ~18–27 frames a second, which lost every drawing that stands for one or two frames. The timestamps are squeezed back afterwards, so both files run at normal speed, at 60 fps:

- `16x9.mp4`, 1920×1080, the stage as the page draws it
- `9x16.mp4`, 1080×1920, a square window of the stage at its full height (candidate B below), with the names above it, our own HUD over its top band and insertcoin.lol below

Both end on a 2.5 s score end card. Each fight gets its own soundtrack, written for its cut (see Sound).

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

This writes `out/<match-id>/16x9.mp4` and `9x16.mp4` (B, both with the end card) without uploading anything. `TITLE_A`/`TITLE_B` are optional: a side left unset takes the name off the recorded page (its HUD's `fname-a`/`fname-b`, challenger left, else the end card's columns; `src/titles.mjs`), upper-case. When neither reads, the cut says FIGHTER A / FIGHTER B and the log warns. All text on the new formats is drawn as PNGs in Chromium (`src/stills.mjs`), with Press Start 2P loaded from `assets/`, so it needs no `drawtext` and no network for fonts. On the runner, the workflow's `npx playwright install --with-deps chromium` (the same Chromium that records) draws them; apt's ffmpeg has `drawtext`, which only the old letterbox uses.

### Any page (`--page`)

```sh
APP_URL=http://localhost:3000 TITLE_A=CURSOR TITLE_B=DEVIN \
  ENDCARD_LINE="AI judges · exhibition · not affiliated" \
  node render.mjs --page "http://localhost:3000/preview/exhibition/<slug>?stage=on" --out out/<slug>
```

Records any page that mounts the fight stage like the match page does (same selectors, same cut), local only, nothing uploaded. Built for brand exhibitions: the insertcoin repo's `npm run exhibition -- <urlA> <urlB>` calls it against its dev-only route. Default out is `out/page/`.

### Social kit (`--social`)

```sh
TITLE_A=CORDINARE TITLE_B=ATEL node render.mjs --match <match-id> --social
node src/social.mjs out/<match-id> --url https://insertcoin.lol/match/<match-id>   # from a finished render, no recording
```

Adds `out/<id>/social/`, local only, nothing posted:

| file | from | limits (`src/social.mjs`, `PLATFORMS`) |
|---|---|---|
| `x.mp4` | `16x9.mp4` | 140 s, 512 MB |
| `tiktok.mp4` | `9x16.mp4` | 600 s, 287 MB |
| `reels.mp4` | `9x16.mp4` | 90 s, 250 MB |
| `shorts.mp4` | `9x16.mp4` | 60 s, 256 MB |
| `thumb-9x16.jpg`, `thumb-16x9.jpg` | one second before the end | the score end card when there is one |
| `thumb-ko-9x16.jpg`, `thumb-ko-16x9.jpg` | `rec/meta.json` | half a second after a fighter's HP first reads 0 (the K.O. word has landed); on points, the WINS shout; none without B's track |
| `caption-facts.txt` | `candidates.json` | fighters, winner, score, tier, what decided it, length, link |

A clip that fits is copied byte for byte. One that is too long keeps its end (the K.O. and the end card) and is re-encoded; one that would be too big is re-encoded at a bitrate under the cap. The caption file holds facts only, no post: the words are written by a person.

### Several fights (`--batch`)

```sh
ENDCARD_LINE="AI judges · exhibition · not affiliated" node render.mjs --batch week1.txt --social
```

`week1.txt`, one fight per line, titles optional (without them, the names come off the page, see above; `TITLE_A`/`TITLE_B` from the env are ignored in a batch):

```
# bracket week 1
7fb30586-bf0a-401b-9cfb-90ce8749ee11 | CORDINARE | ATEL
http://localhost:3000/preview/exhibition/cursor-devin?stage=on | CURSOR | DEVIN
```

Each goes to `out/<id or the URL's last path segment>/`. A fight that fails is tried once more (not when the page has no stage), the rest go on, and the run ends with one line per fight and exit code 1 if any failed. The file is checked before anything records: a bad line or a fight listed twice stops the run with its line number. About 4 minutes per fight (slow motion), so a week of 7 takes about half an hour.

## Formats and switches

Since 22.10.2026 the default is B plus the end card. The old cut and candidate A stay switchable:

| env | values | |
|---|---|---|
| `PORTRAIT` | `b` (default), `legacy`, `a`, `both` | which 9:16 goes into `9x16.mp4`: `legacy` is the old letterbox (the 16:9 stage across the width, a third of the height); `a` needs a second recording pass; `both` writes `9x16-a.mp4` and `9x16-b.mp4` and is for `--match` only |
| `ENDCARD` | `0` | no end card on either file |
| `ENDCARD_NOTE` | `0` | leaves out the end card's line "The fight is drawn from the judges' scorecards." |
| `ENDCARD_LINE` | any text | one more muted line on the end card, under everything else (a brand exhibition's disclosure); unset: none |

`PORTRAIT=legacy ENDCARD=0` cuts both files exactly as before 22.10.

- **B · vertical composition** (default, `src/portrait.mjs`): from the 16:9 recording, a square window as tall as the stage (1080×1080 in the frame; until 16.11.2026 a 4:3 window, 1080×810, with the fighters a quarter smaller). The window does not follow the fighters: it is planned over the whole fight as a few fixed framings with pans between them (`trackCrop` with `hold`, `src/layout.mjs`), from their drawn bounds, weapons and effects included, sampled on every page frame. The cut opens wider, on the 4:3 the VS card needs, pushes in when the card goes, and pulls back to the whole stage for the result, whose banner fits no closer window. Stage words (K.O., WINS, ROUND, FIGHT) are framed only when they fit together with both fighters; a fighter is never cut for a word. Between push-in and pull-out its own HUD is drawn opaque over the window's top band, covering the stage's cropped HUD, laid out like the live one: the job's names (challenger left), the page's W–L records, HP bars in each fighter's brand colour as read off the page, the round on a framed plate; wide, the picture shows the stage's own HUD. The log counts the framings, the frames the window moves on, and the frames where a fighter reaches under the band. `src/candidates.mjs` composes the cut from the recording, so a cut can be redone without recording again.
- **A · compact live stage**: a second recording at a phone viewport (432×608 CSS px at device scale 2.5, so 1080 px wide), where the page lays out a 4:3 stage with its mobile HUD above and the commentary below. The buttons between HUD and stage are cut out. Takes a second slow-motion pass, about as long as the first.
- **End card**: the winner, both sealed totals, the tier and what decided it (both values under their columns, the winner's green), read off the page's own end card and shown as the page writes them; 2.5 s after a 0.3 s fade from the last frame. If the page's card does not read, the files go without one.

To compare everything for one fight:

```sh
TITLE_A=ATEL TITLE_B=TTRRECHNER node render.mjs --match <match-id> --candidates
```

This writes `16x9.mp4`, `9x16-a.mp4` and `9x16-b.mp4` with the end card, the letterbox `9x16.mp4` without one (it stays the old cut, for comparison), plus `candidates.json` with the measured layout. Without `drawtext` locally (Homebrew's ffmpeg), the letterbox's text is drawn the same PNG way.

## Sound

There is no music file. `src/score.mjs` writes a track for each cut and `src/synth.mjs` renders it offline (two pulse voices, a triangle bass, noise drums; no dependencies, seeded, so the same fight gets the same track).

- **One sound, four pieces.** `garage`, `rooftop`, `orbit` and `final` differ in key, tempo, bass and drums, and share one eight-note motif: every lead opens with it, its first two notes are the coin on the first frame, and all of it is the jingle under the end card. A fight gets the piece of the venue the page reports (`data-venue` on the stage), else one of the first three by its fighters' names. `THEME=final` (or any name) asks for one.
- **Written to the fight.** The stage sends its sound cues while it is recorded (`fr:cue` events: bells, hits by weight, blocks, whiffs, the finisher, the ending). The intro plays under the VS card, each round is a section that starts on its bell and is fuller than the one before, the tempo of a section is bent so it ends on a bar, a fill and a crash mark each round break, a riser leads into the finisher, and the music stops on it. After a held silence a quiet section carries the result into the jingle. An app that sends no cues still gets bells and hits, read off the round number and the HP bars.
- **Tone.** The arpeggio, the lead and the drums run through gentle low-passes (`TONE` in `src/score.mjs`) so the pulse voices do not fizz; the hits are not filtered.
- **Effects.** The stage's own cues are rendered with the app's recipes (`components/fight/sfxPlayer.ts` in the insertcoin repo) and the music ducks under each hit.
- **Loudness.** One static gain per track to −16 LUFS, held under −2 dB true peak on the WAV (the one AAC encode adds up to ~0.8 dB; the videos copy that track, they do not encode it again). The log line `sound: <piece>, n sections, n cues, LUFS` says what was written.

## Assets

- `assets/PressStart2P-Regular.ttf`: Press Start 2P, SIL Open Font License, see `assets/OFL-PressStart2P.txt`
