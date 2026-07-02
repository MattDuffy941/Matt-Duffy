# Groove Builder

**Groove Builder** is a clean-room recreation of the base functionality of
[GrooveScribe](https://github.com/montulli/GrooveScribe) — a browser-based drum
groove editor, sheet-music renderer, and practice tool. Click cells in the
rhythm grid to place drum hits, see them rendered as real drum notation, play
them back with a metronome, and share the groove as a URL.

**The URL is the document.** The entire groove state lives in the query string,
using the same format as the original GrooveScribe, so links are compatible:

```
?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|
```

## Running

```sh
npm install
npm run dev      # dev server
npm test         # unit tests (URL codec, timing math, ABC generation)
npm run build    # static production build in dist/
```

100% client-side — deploy `dist/` to any static host.

## Architecture

```
URL query string
      │  parse (urlCodec.ts)
      ▼
GrooveData (grooveData.ts): timeSig, div, tempo, measures, swing, lanes[]
      ├──────────► grooveToAbc.ts ──► abcjs ──► SVG sheet music
      └──────────► audio/player.ts ──► Web Audio ──► synthesized drum kit
      ▲
      │  serialize — every edit rewrites the URL (share/permalink for free)
```

- **`src/lib/grooveData.ts`** — the typed model and the context-sensitive
  tab-character maps (`x` means hi-hat in `H`, cross-stick in `S`, foot splash
  in `K`; `-` is always a rest).
- **`src/lib/urlCodec.ts`** — parse/serialize the query string. Hand-rolled
  (not `URLSearchParams`) because `+` is a real character (closed hi-hat), not
  a space. Case-insensitive params, `|`/space skipping, validation clamps.
- **`src/lib/grooveToAbc.ts`** — grid → ABC notation: one percussion staff,
  Hands voice (stems up) + Feet voice (stems down), X noteheads via
  `%%percmap`, look-ahead durations so 8th patterns on a 16th grid render as
  real 8th notes, chords with hoisted decorations, tuplet groups for triplet
  divisions. Rendered with [abcjs](https://www.abcjs.net).
- **`src/lib/audio/`** — sample-accurate playback using the
  ["Two Clocks"](https://web.dev/articles/audio-scheduling) lookahead
  scheduler against `AudioContext.currentTime`. Drum sounds are procedurally
  synthesized into `AudioBuffer`s at startup (no sample assets). Swing delays
  off-beat cells toward the triplet position; the metronome is an independent
  click stream locked to the same clock.

## URL format

| Param | Meaning |
|---|---|
| `TimeSig` | `top/bottom` (top 1–32, bottom 2/4/8/16) |
| `Div` | grid resolution per whole note: 8, 16, 32 straight; 12, 24, 48 triplets |
| `Tempo` | BPM 20–400 |
| `Measures` | 1–100 |
| `Swing` | 0–100 % (straight divisions; written only when > 0) |
| `MetronomeFreq` | 0 / 4 / 8 / 16 (written only when ≠ 0) |
| `H` `S` `K` | ASCII tab, one char per grid cell |
| `T1`–`T4` | tom lanes (written only when used) |

Lane characters — hi-hat: `x` normal, `X` accent, `o` open, `+` foot-close,
`r` ride, `b` ride bell, `c` crash, `s` stacker, `m` cowbell; snare: `o`
normal, `O` accent, `g` ghost, `x` cross-stick, `f` flam, `d` drag, `b` buzz;
kick: `o` kick, `x` hi-hat foot splash, `X` both.

## Practice features

- **Presets** — rock, funk, disco, shuffle, jazz ride, 6/8 and more starters.
- **Toms** — four tom rows (toggle "Show toms"); they share the URL format
  (`T1`–`T4`) and render on the staff.
- **Count-in** — one measure of clicks before the groove starts.
- **Auto speed-up** — raise the tempo by +1/+2/+5/+10 BPM every loop (capped
  at 400) for practice ramps; the live BPM shows next to the tempo control.

## Saving & lesson-app integration

- **Save / My Grooves** — the Save button stores the groove (as its canonical
  URL) in the browser's local storage on that device; the My Grooves panel
  lists, reopens and deletes them. No account, works offline.
- **Link integration** — every groove *is* a URL, so pasting the link into any
  lessons platform (notes, homework, messages) hands the student the full
  groove.
- **Embed integration** — the **Embed code** button copies an `<iframe>`
  snippet. Any lesson page that accepts HTML embeds then shows a compact
  player: title, tempo, play/stop, the engraved notation, and an
  "Open in Groove Builder" link. The embed view is the same app loaded with
  `&Embed=1` appended to a groove URL.

## Known limitations (vs. full GrooveScribe)

- Ghost notes play quietly but render as plain noteheads (no parentheses).
- No MIDI export (PDF download is built in).

See `groovescribe-clone-prompt.md` for the full build spec this implements.
