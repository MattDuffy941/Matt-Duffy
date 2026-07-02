# Build Prompt: GrooveScribe Clone (Drum Groove Notation Tool)

> Hand this prompt to a coding agent. It is self-contained: it specifies the goal,
> the exact data format, the architecture, the tech stack, and milestone-by-milestone
> acceptance criteria. Build it clean-room (your own code) — do **not** copy the
> original GrooveScribe source, which is GPL v2.

---

## Role & Goal

You are building a **base clone of GrooveScribe** — a browser-based drum groove
notation and practice tool (the original lives at `mikeslessons.com/groove`). The app
lets a user click cells in a rhythm grid to place drum hits, renders those hits as real
**drum sheet music**, **plays them back** through the browser with a metronome, and
encodes the entire groove in a **shareable URL** (no backend — the URL *is* the document).

Reference blank-canvas URL the clone must be able to load and reproduce:

```
?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|
```

This decodes to an empty 4/4 bar at 80 BPM, 16th-note grid, with hi-hat/snare/kick lanes
all resting. Loading it must yield an empty editable bar; editing it must produce a URL in
the same format.

---

## Tech Stack

- **TypeScript + Vite** (fast dev server, static build — the app is 100% client-side).
- **React** for the grid editor UI (Svelte is acceptable if preferred).
- **Notation:** `abcjs` (npm, well-documented, has `%%percmap` + X noteheads) — or
  `abc2svg` if you want the closest match to the original. Generate ABC notation text
  from the grid and render it to SVG.
- **Audio:** `Tone.js` (gives you `Transport` BPM/swing/subdivision + `Players`/`Sampler`
  for free) — or raw Web Audio API + a lookahead scheduler if you want a dependency-light core.
- **URL state:** `URLSearchParams` + History API (`history.replaceState`).
- No backend. Deployable as static files (GitHub Pages / Netlify / Vercel).

---

## Architecture (single pipeline, run twice)

```
URL query string
      │  parse
      ▼
GrooveData (typed model): timeSig, div, tempo, measures, swing, lanes[]
      │   each lane = array of cell states (off, or a hit type)
      ├──────────► grooveToABC() ──► abcjs ──► SVG sheet music
      │
      └──────────► scheduler ──► Tone.js / Web Audio ──► drum samples
      ▲
      │  serialize  (every edit rewrites the URL; this also gives undo/redo for free)
```

The **URL is the document model.** Sharing, permalinks, and undo/redo all round-trip
through the query string.

---

## The URL Encoding Format (implement this EXACTLY for link compatibility)

Parameter names are **case-insensitive** (`Tempo`/`tempo`, `H`/`h` all valid).

**Non-note parameters:**

| Param | Meaning | Validation / default |
|---|---|---|
| `TimeSig` | `top/bottom`, e.g. `4/4`, `6/8` | top 1–32 (else 4); bottom ∈ {2,4,8,16} (else 4) |
| `Div` | Grid resolution = cells per beat-grid. `16`=16ths, `8`=8ths, `12`=8th-triplets, `24`/`32`/`48` | default 16 |
| `Tempo` | BPM | 20–400 (else default) |
| `Measures` | Number of bars | ≥1, clamped to a max (use 100) |
| `Swing` | Swing %, 0–100 | default 0; write to URL only when > 0 |
| `MetronomeFreq` | Click density: 0=off, 4=quarters, 8=eighths, 16=sixteenths | default 0; write only when ≠ 0 |
| `Stickings` | R/L/count row | omit from URL when default |
| `Title` / `Author` / `Comments` | Metadata | URI-encoded; write only when non-empty |

**Note-lane parameters** — one ASCII drum-tab string per voice, conventionally wrapped in
`|…|`. Read **left-to-right, one character per grid slot**. Skip `|` (barlines) and spaces.
`-` is always a rest/off.

- `H` = hi-hat / cymbals
- `S` = snare
- `K` = kick
- `T1`–`T4` = toms (optional; serialize only when in use)
- `Stickings` = R/L/count row (optional)

**Character → sound map (CONTEXT-SENSITIVE — same letter differs per lane):**

**Hi-hat (`H`):**
`x` normal · `X` accent · `o` open · `+` closed/foot-choke · `r`/`R` ride ·
`b`/`B` ride bell · `c` crash · `s` stacker · `m` cowbell · `n`/`N` metronome · `-` off

**Snare (`S`):**
`o` normal · `O` accent · `g` ghost · `x` cross-stick · `f` flam · `d` drag ·
`b`/`B` buzz · `-` off

**Kick (`K`):**
`o` normal · `x` hi-hat foot-splash · `X` kick + foot-splash together · `-` off
(there is no separate "foot" param — foot is folded into the kick lane)

Notes:
- There is **no** `Subdivision` param — that concept is `Div`.
- Ignore the legacy `HH=`/`B=` aliases (they were effectively dead in the original).

---

## Notation Rendering (grid → ABC → SVG)

Generate **ABC notation** and render with abcjs/abc2svg. Key techniques:

- **Three voices, one percussion staff:** `%%staves (Stickings Hands Feet)` with
  `clef=perc`. `Hands` voice `stem=up`; `Feet` voice `stem=down` (standard drum convention).
- **X-shaped noteheads** (hi-hat, crash, cross-stick) via percussion map / custom glyph
  (`%%map drum ^g heads=Xhead print=g` in abc2svg, or `%%percmap` in abcjs). Snare and
  kick keep normal oval heads.
- **Articulations as ABC decorations:** accent `!accent!`, open hi-hat `!open!`,
  foot-close `!plus!`, ghost = parentheses around note, flam = grace note `{/c}c`,
  drag = `{/cc}c`, buzz = tremolo `!///!`.
- **Simultaneous hits** → ABC chord `[^gc]`. Note: decorations must be hoisted *outside*
  the `[]` bracket (`!accent![^gc]`), because they misrender inside a chord.

**grid → ABC algorithm:** normalize every lane to a common fixed grid (32nd notes, or 48
for triplets). For each hit, **look ahead** counting empty cells to the next event to get
the note's duration. Insert spaces at beam-group boundaries, `|` every measure, newline
every N measures. Give each rendered note a stable DOM id (e.g. `note-<measure>-<index>`)
so playback can highlight it.

---

## Audio Engine (sample-accurate playback)

Do **not** replicate the original's MIDI.js indirection. Use direct sample playback:

- Load a drum sample set (kick, snare, closed/open hi-hat, foot, ride, ride bell, crash,
  toms 1–4, cowbell, metronome click). Decode once into buffers (`Tone.Players`, or
  `AudioBuffer`s via `fetch → decodeAudioData`).
- **Scheduling — the "Two Clocks" pattern (Chris Wilson):** never `setTimeout`-per-note.
  Use a lookahead loop (~25 ms timer) that queues every note landing within the next
  ~100 ms, timed against the drift-free clock:
  - `secondsPerBeat = 60 / BPM`
  - `secondsPer16th = secondsPerBeat / 4` (8th `/2`, triplet-8th `secondsPerBeat/3`)
  - **swing:** push off-beat subdivisions later by `swingAmount * secondsPer16th`.
  - With Tone.js this is `Transport.bpm`, `Transport.swing`, and a `Tone.Sequence` — most of
    it is done for you.
- **Velocity:** accent = louder, ghost = quieter, normal = mid (per-voice gain).
- **Metronome:** a separate click track locked to the same transport, density from `MetronomeFreq`.
- **Autoplay unlock:** resume the AudioContext on the first user gesture.
- **Looping:** restart the sequence at the end of the last measure.

---

## Playback Highlight

Sync the SVG to the transport: as each note plays, add a `highlighted` CSS class to its
DOM id and clear the previous one, so a cursor visibly moves through the notation.

---

## Build Milestones & Acceptance Criteria

Build in this order. Each milestone must pass its check before moving on.

**M1 — Data model + URL codec (foundation, ship with tests).**
- `GrooveData` type; `parseUrl(search): GrooveData` and `toUrl(data): string`.
- ✅ Check: parsing the reference URL yields an empty 4/4 / 80 BPM / 16-cell bar; and a
  round-trip (`toUrl(parseUrl(x))`) is stable. Unit tests cover each lane's char map,
  case-insensitivity, `|`/space skipping, and validation clamps.

**M2 — Grid editor UI.**
- Rows = instruments (H/S/K minimum), columns = subdivisions from `TimeSig × Div`.
- Click a cell to cycle hit type (e.g. off → normal → accent → ghost → off).
- Controls: tempo, time signature, division, measures, swing.
- ✅ Check: every edit updates `GrooveData` and rewrites the URL via `replaceState`;
  reloading the page restores the exact groove.

**M3 — Notation rendering.**
- `grooveToABC(data)` + abcjs/abc2svg render on every change.
- ✅ Check: a basic rock beat (hi-hat 8ths, snare on 2 & 4, kick on 1 & 3) renders as
  correct, readable drum notation with X-head hi-hats, hands-up/feet-down stems.

**M4 — Audio engine.**
- Sample playback + lookahead scheduler (or Tone.js), play/stop, loop, tempo, swing, metronome.
- ✅ Check: the same rock beat plays back in time; changing tempo/swing changes playback;
  metronome toggles; audio unlocks on user gesture.

**M5 — Playback highlight + polish.**
- Moving highlight synced to transport; then presets, count-in, undo/redo, optional
  MIDI/PNG export, optional embed mode.
- ✅ Check: a visible cursor tracks the playing note; presets load; undo/redo works.

**Minimum viable base clone = M1 + M2 + M3 + M4** (toms, stickings, export, and embed
can come later).

---

## Constraints & Reminders

- **Clean-room only.** Reproduce the URL *format* for link compatibility, but write all
  code yourself with modern libraries. Do not copy GPL-v2 GrooveScribe source.
- 100% client-side; deployable as static files.
- Write tests for the URL codec first — it is the contract the whole app depends on.
- Keep the code idiomatic TypeScript; prefer small, testable modules
  (`grooveData.ts`, `urlCodec.ts`, `grooveToAbc.ts`, `audioEngine.ts`, `GridEditor.tsx`).

---

## Reference Sources

- Original (GPLv2): https://github.com/montulli/GrooveScribe · About: https://montulli.github.io/GrooveScribe/gscribe_about.html
- Notation: https://www.abcjs.net · https://github.com/moinejf/abc2svg · https://vexflow.com
- Audio: https://tonejs.github.io/ · Chris Wilson "A Tale of Two Clocks": https://web.dev/articles/audio-scheduling
