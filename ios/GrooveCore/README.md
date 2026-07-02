# GrooveCore (Swift)

A native Swift port of the Groove Builder web app's core, and the starting point
for the fully-native iOS/iPadOS app (see `../../groove-builder-ios-spec.md`).

**Implemented so far — Phases 1 & 2 of the spec:**

- `GrooveData.swift` — the document model (`GrooveData`, the hit enums,
  `TimeSig`), grid math (`cellsPerMeasure`, `totalCells`, `isTripletDiv`,
  `remapLane`), and the context-sensitive tab-character maps.
- `URLCodec.swift` — `URLCodec.parse` / `URLCodec.serialize`, byte-for-byte
  compatible with the website's query-string format so groove links open across
  web and app.
- `Tests/…/URLCodecTests.swift` — XCTest suite mirroring the web `urlCodec`
  tests, including the exact round-trip of the reference URL.

**Still to build (Phases 3–8):** `Timing.swift`, `Engraver.swift` +
`NotationRenderer.swift`, `AudioEngine.swift`, `Library.swift`, and the SwiftUI
app layer.

## Use it

```sh
cd ios/GrooveCore
swift test          # runs the XCTest suite on macOS
```

Or add the package to your Xcode app project: **File ▸ Add Package Dependencies ▸
Add Local…** and point at `ios/GrooveCore`, then `import GrooveCore`.

```swift
import GrooveCore

let groove = URLCodec.parse(
    "?TimeSig=4/4&Div=16&Tempo=120&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|")
let link = URLCodec.serialize(groove)   // == the same query string
```

**Keep it in sync:** the web app's `src/lib/grooveData.ts` and `urlCodec.ts` are
the reference. If a rule changes there, mirror it here and update both test
suites — the shared URL format is the contract that lets a groove made on the
website open in the app.
