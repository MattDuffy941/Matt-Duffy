# Groove Builder — Fully Native SwiftUI iOS / iPadOS App Build Spec

> Hand this to Claude Code inside your Xcode project. This builds a **100%
> native SwiftUI app** — no web view, no bundled HTML. The grid, the drum
> notation, the audio engine, PDF export, and the saved-groove library are all
> reimplemented in Swift. The one hard rule that keeps it interoperable with the
> web version: **the URL format is identical**, so links made on the website
> open in the app and vice-versa.
>
> Work through the phases in order; each has an acceptance check. This is a real
> rewrite — budget **2–4 weeks**, not a day. In return you get a genuinely
> native app with no App Store "wrapper" risk, the best possible feel
> (haptics, Apple Pencil, smooth 120 Hz drawing), and full offline operation.

---

## 0. Architecture

```
GrooveCore  (pure Swift, no UI — mirrors the web app's src/lib)
 ├─ GrooveData.swift      structs/enums for the document + tab-char maps
 ├─ URLCodec.swift        parse/serialize the query string (LINK-COMPATIBLE)
 ├─ Timing.swift          cell → beats/seconds, swing, metronome positions
 ├─ Engraver.swift        groove → laid-out notation primitives (shared by
 │                        the on-screen Canvas AND the PDF renderer)
 ├─ AudioEngine.swift     AVAudioEngine + lookahead scheduler + drum synth
 └─ Library.swift         save/load "My Grooves" (Codable + files)

GrooveBuilder  (SwiftUI app)
 ├─ GrooveBuilderApp.swift   @main, audio session, deep-link handling
 ├─ EditorView.swift         top-level screen (controls + grid + notation)
 ├─ ControlsView.swift       tempo, time sig, div, measures, swing, click…
 ├─ GridEditorView.swift     the tappable lane/cell grid + long-press menu
 ├─ NotationView.swift       Canvas that draws Engraver output
 ├─ MyGroovesView.swift      saved library list
 └─ Share/ExportPDF.swift    UIActivity share + PDFKit export
```

Pattern: **MVVM**. `GrooveCore` types are value types (`struct`/`enum`), the
document lives in an `@Observable` view-model, and the URL is still the
canonical serialization (so save = store the query string; share = the URL).

The golden rule: **`GrooveCore` is a faithful port of the web app's `src/lib`**.
Keep the same field names, the same validation clamps, and the exact same
character maps so a groove round-trips byte-for-byte with the website.

---

## 1. Prerequisites

- Mac with **Xcode 16+**.
- **Apple Developer Program** ($99/yr) for device install + App Store.
- The web app's `src/lib` as the reference implementation to port from:
  `grooveData.ts`, `urlCodec.ts`, `timing.ts`, `grooveToAbc.ts` (layout logic),
  `audio/player.ts`, `audio/drumSynth.ts`, `library.ts`.

Fixed decisions (don't re-ask):

| Setting | Value |
|---|---|
| App name | Groove Builder |
| Bundle id | `com.wirralmusicfactory.groovebuilder` |
| Deployment target | iOS 17.0 (for `@Observable` + modern Canvas) |
| Devices | Universal (iPhone + iPad) |
| Interface | SwiftUI, no storyboards |
| Data collected | None |
| URL format | **Identical to the web app** (see Phase 2) |

---

## 2. Master prompt (paste into Claude Code first)

> You are building a fully native SwiftUI iOS/iPadOS app called "Groove
> Builder", bundle id `com.wirralmusicfactory.groovebuilder`, deployment target
> iOS 17, universal. It is a drum-groove editor: a tappable grid, real engraved
> drum notation, sample-accurate playback with a metronome, PDF export, and a
> saved-groove library. Do NOT use a WebView — every view is SwiftUI and all
> logic is Swift. Implement it as a `GrooveCore` module (pure Swift: data model,
> URL codec, timing, notation engraver, audio engine, library) plus a SwiftUI
> app layer, following the phases in this spec. Critically, the URL query-string
> format must be byte-for-byte identical to the existing web app so links are
> cross-compatible — port `GrooveData`, the character maps, and the codec
> exactly. After each phase, stop and report the acceptance check.

---

## 3. Phase 1 — GrooveCore data model

Port `src/lib/grooveData.ts` to `GrooveData.swift`.

```swift
struct TimeSig: Equatable { var top: Int; var bottom: Int }

enum HihatHit: String { case normal, accent, open, close, ride, rideBell,
    crash, stacker, cowbell, metronomeNormal, metronomeAccent }
enum SnareHit: String { case normal, accent, ghost, xstick, flam, drag, buzz }
enum KickHit:  String { case normal, splash, kickAndSplash }
enum Sticking: String { case R, L, B }

struct GrooveData: Equatable {
    var timeSig = TimeSig(top: 4, bottom: 4)
    var div = 16                 // cells per whole note (16, 12, 8, 24, 32, 48)
    var tempo = 80               // BPM 20…400
    var measures = 1             // 1…100
    var swing = 0                // 0…100 %
    var metronomeFreq = 0        // 0/4/8/16
    var title = "", author = "", comments = ""
    var hihat: [HihatHit?] = []
    var snare: [SnareHit?] = []
    var kick:  [KickHit?]  = []
    var toms:  [[TomHit?]] = [[],[],[],[]]   // T1…T4
    var stickings: [Sticking?] = []
}
```

Port helpers verbatim: `cellsPerMeasure`, `cellsPerBeat`, `totalCells`,
`isTripletDiv` (`div % 12 == 0`), `remapLane`, and — critically — the
**context-sensitive character maps** (hi-hat/snare/kick/tom/sticking → char and
back). These are the interop contract.

**Acceptance check:** a Swift unit test mirroring `urlCodec.test.ts` builds the
same lane arrays from the same characters.

---

## 4. Phase 2 — URL codec (link compatibility)

Port `src/lib/urlCodec.ts` to `URLCodec.swift`. This is the interop keystone —
match it exactly:

- Hand-roll the query split (do **not** use `URLComponents.queryItems`, because
  `+` is a literal character (closed hi-hat), not a space).
- Case-insensitive parameter names.
- Skip `|` and spaces in lane strings; `-` is a rest.
- Same validation clamps (TimeSig top 1–32 / bottom ∈ {2,4,8,16}, Tempo 20–400,
  Measures 1–100, Swing 0–100, Div ∈ {8,12,16,24,32,48}).
- Emit optional params (Swing, MetronomeFreq, Title/Author/Comments, T1–T4,
  Stickings) only when non-default, in the same order.

```swift
enum URLCodec {
    static func parse(_ query: String) -> GrooveData { /* … */ }
    static func serialize(_ g: GrooveData) -> String  { /* "?TimeSig=…" */ }
}
```

**Acceptance check:** `serialize(parse(x)) == x` for the reference URL
`?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|`
and for a groove exported from the website (paste a real share link into a test).

---

## 5. Phase 3 — Grid editor (SwiftUI)

`GridEditorView.swift`: lanes top-to-bottom (Sticking, Hi-hat, Hi tom, Mid tom,
Snare, Floor tom, Kick — toms/sticking rows toggle on). Each cell is a
`Button`; columns come from `TimeSig × Div × Measures`, with beat/measure
divider styling.

- **Tap** cycles the common sounds for that lane (same cycles as the web app:
  hi-hat → normal/accent/open, snare → normal/accent/ghost, kick → normal/
  splash/both, toms → on/off, sticking → R/L/B).
- **Long-press** opens the full sound menu — use a SwiftUI `.contextMenu` (this
  is the native, no-code-of-your-own long-press) listing every sound for the
  lane, each writing the explicit tab char.
- Tapping a hit fires a short audio preview and a light `.sensoryFeedback`
  haptic (a native touch the web app can't do).
- Cell targets ≥ 44 pt; horizontal scroll for wide grids.

**Acceptance check:** building a basic rock beat by tapping updates the model;
long-press → "Ride" writes a ride; the whole grid scrolls on iPhone.

---

## 6. Phase 4 — Notation engraver (the big one)

There is no abcjs on iOS, so port the **layout logic** of `grooveToAbc.ts`
directly into a drawing routine. Split it in two:

1. `Engraver.swift` (in GrooveCore) turns a `GrooveData` into an array of
   positioned primitives — **no UIKit**, just geometry:
   ```swift
   enum Glyph { case noteheadBlack, noteheadX, restQuarter, rest8th, rest16th,
                     percClef, timeSigDigit(Int), augmentationDot }
   struct Placed { var glyph: Glyph; var x: CGFloat; var staffStep: Int }
   struct Stem  { var x: CGFloat; var topStep: Int; var bottomStep: Int }
   struct Beam  { var x1, x2: CGFloat; var step: Int; var thickness: CGFloat }
   struct TextMark { var s: String; var x: CGFloat; var aboveStaff: Bool } // stickings, tempo
   struct EngravedLine { var placed: [Placed]; var stems: [Stem]; var beams: [Beam]; var text: [TextMark]; var barlines: [CGFloat] }
   func engrave(_ g: GrooveData, width: CGFloat) -> [EngravedLine]
   ```
   Reuse the web app's pitch→staff-position table and rules:
   - Percussion 5-line staff, percussion clef at the left.
   - **X noteheads** for hi-hat, ride, crash, stacker, cross-stick, foot splash,
     metronome; **normal heads** for snare, kick, toms.
   - Staff positions: Hi-hat above top line; Hi tom = top space; Mid tom = on
     the 2nd line from the top; Snare = 3rd space; Floor tom = 2nd space from
     bottom; Kick = 1st space.
   - **Hands stems up, feet (kick/foot) stems down.**
   - Look-ahead durations (a hit lasts until the next event), beam groups per
     beat, `(3` tuplets for triplet divisions, rests on empty beats.
   - Sticking letters on one baseline above the staff; tempo text top-left; two
     measures per line; a lone measure centred and enlarged.

2. `NotationView.swift` draws `EngravedLine`s in a SwiftUI `Canvas`. Use the
   **Bravura** SMuFL music font (free from Steinberg — bundle `Bravura.otf`) for
   glyphs (`noteheadBlack` U+E0A4, `noteheadXBlack` U+E0A9,
   `unpitchedPercussionClef1` U+E069, time-sig digits U+E080–E089, rests
   U+E4E5–E4E7 — verify against Bravura's `glyphnames.json`). Draw staff lines,
   stems, beams, and barlines as filled rects/paths. This gives real engraving
   quality identical in spirit to the web output.

   *(Lighter alternative if you want zero font dependency: draw noteheads as
   filled ellipses and X-heads as crossed strokes. Serviceable, less polished.)*

**Acceptance check:** a rock beat renders with X-head hi-hats (stems up), snare
on 2 & 4, kick stems down, correct beaming; a paradiddle shows R L R R … level
above the notes; a single bar is centred and large.

---

## 7. Phase 5 — Audio engine (AVAudioEngine)

Port `audio/drumSynth.ts` + `audio/player.ts` to `AudioEngine.swift`.

- **Sounds:** port the procedural DSP into `AVAudioPCMBuffer`s at startup (fill
  Float channel data with the same kick/snare/hat/cymbal/tom synthesis). No
  audio assets to license, and it matches the web timbre. *(Or bundle WAVs if
  you prefer recorded samples.)*
- **Graph:** `AVAudioEngine` → main mixer → output; a small pool of
  `AVAudioPlayerNode`s for polyphony, plus a limiter (`AVAudioUnitEffect` /
  `AVAudioUnitDynamicsProcessor`) on the master.
- **Scheduling — the native two-clocks pattern:** a timer (~25 ms) schedules
  every hit landing within the next ~120 ms at a precise `AVAudioTime`
  (`sampleTime` anchored to the engine's `lastRenderTime`), via
  `playerNode.scheduleBuffer(buffer, at: time)`. This is the sample-accurate
  equivalent of the web `AudioContext.currentTime` scheduler. Port the same
  `secondsPerBeat`, subdivision, and swing math from `timing.ts`.
- **Features to carry over:** tempo, swing, count-in, auto speed-up per loop,
  metronome click track, accent/ghost velocities, looping, and the playing-cell
  highlight (publish the current cell to the view-model).
- **Session:** `AVAudioSession` `.playback` category so it sounds through the
  mute switch; resume the engine on a user gesture.

**Acceptance check:** the rock beat plays in time; changing tempo/swing while
playing takes effect; count-in and metronome work; the grid highlight tracks the
beat; audio survives backgrounding/interruptions (phone call) gracefully.

---

## 8. Phase 6 — Library, sharing, deep links

- **My Grooves:** port `library.ts` — save the current groove's query string
  (upsert by name), list newest-first, delete/rename. Store as `Codable` JSON in
  Application Support (or SwiftData if you prefer). `MyGroovesView.swift` is a
  `List` with swipe-to-delete.
- **Share:** a share button → `UIActivityViewController` sharing the groove URL
  (so the recipient can open it on web or in the app).
- **Deep links / lesson-app integration:** register a **Universal Link** (or a
  custom scheme `groovebuilder://`) so tapping a groove URL opens the app to that
  groove. Implement `onOpenURL` → `URLCodec.parse` → load. This is the native
  equivalent of the web app's link/embed integration: a lessons platform links
  to a groove and it opens straight into the app.

**Acceptance check:** save → force-quit → relaunch → the groove is still in My
Grooves and opens intact; a shared link opens the app to the right groove.

---

## 9. Phase 7 — PDF export (PDFKit)

Reuse the **same `Engraver`** to draw into a PDF context:

```swift
let data = UIGraphicsPDFRenderer(bounds: a4).pdfData { ctx in
    ctx.beginPage()
    NotationRenderer.draw(engrave(groove, width: contentWidth),
                          in: ctx.cgContext)   // shared draw routine
}
```

Because the engraver is UI-independent, on-screen notation and the PDF are
pixel-identical. Present the resulting file via the share sheet (Save to Files,
Print, AirDrop, Mail). Filename from the groove title. Single-bar grooves centred
and enlarged; multi-page for long sheets.

**Acceptance check:** export produces a clean vector PDF (title, tempo, notation)
with no browser-style headers/footers, saved to Files.

---

## 10. Phase 8 — Polish & App Store

- App icon (1024²), launch screen (dark `#1e2128`), light status bar.
- Portrait + landscape; iPad multitasking/size-class friendly layout.
- Haptics on taps; optional Apple Pencil support on the grid (a native perk).
- **App Store Connect:** category Music (or Education), screenshots (iPhone 6.7"
  + iPad 12.9"), App Privacy = **Data Not Collected**. Because it's genuinely
  native, **Guideline 4.2 "wrapper" risk does not apply.**

**Acceptance check:** TestFlight build runs end-to-end on your iPad; submitted
for review.

---

## 11. Effort, trade-offs, and interop

| | This spec (native) |
|---|---|
| Effort | ~2–4 weeks |
| Codebases to maintain | Two (web + Swift) — keep `GrooveCore` in sync with `src/lib` |
| Feel | Fully native (haptics, Pencil, 120 Hz) |
| App Store 4.2 risk | None |
| Offline | Yes |
| Cross-open with web links | Yes — identical URL format is the contract |

**Keep them in sync:** the web app's `src/lib` is the reference. When you change
a rule there (a new sound, a mapping tweak), mirror it in `GrooveCore` and update
both test suites. The shared URL format is what guarantees a groove made on the
website opens correctly in the app and vice-versa.

*(For context: a WebView-wrapper version would be ~1 day but isn't truly native.
This spec is the full-native path you asked for.)*

---

## 12. File checklist

**GrooveCore:** `GrooveData.swift`, `URLCodec.swift`, `Timing.swift`,
`Engraver.swift`, `NotationRenderer.swift` (shared Canvas+PDF draw),
`AudioEngine.swift`, `Library.swift`, + unit tests mirroring the web suite.

**App:** `GrooveBuilderApp.swift`, `EditorView.swift`, `ControlsView.swift`,
`GridEditorView.swift`, `NotationView.swift`, `MyGroovesView.swift`,
`ExportPDF.swift`, `Assets.xcassets` (AppIcon, `Bravura.otf`), launch screen,
Info.plist (Universal Links / URL scheme).
