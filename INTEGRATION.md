# Groove Builder — Integration Brief

For whoever maintains **hub.wirralmusicfactory.com**. This describes what the
app is built with, what it needs from a host, and the ways it can be integrated.

**Short version:** it's a **static, client-side single-page app**. No backend,
no database, no server runtime. It builds to a folder of plain HTML/JS/CSS/WAV
files that any web server can serve. Integration is either an `<iframe>` or
dropping the built folder somewhere the hub serves.

---

## 1. Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.6 |
| UI framework | React 18.3 (function components + hooks) |
| Build tool | Vite 5.4 (Rollup under the hood) |
| Music notation | [abcjs](https://www.abcjs.net/) 6.4 — renders SVG, no music font needed |
| Audio | **Web Audio API** directly (no library) — a lookahead scheduler |
| PDF export | jsPDF 4.2 (+ html2canvas) |
| Video export | `MediaRecorder` + `canvas.captureStream` (native); `@ffmpeg/ffmpeg` 0.12 for optional MP4 |
| Tests | Vitest (60 tests) |

**Runtime dependencies are bundled at build time.** The served app is just
static files — the hub does not need Node, npm, React, or any of the above
installed.

---

## 2. Build output

`npm run build` produces a `dist/` folder:

```
dist/
  index.html          4 KB
  assets/             1.5 MB   (JS + CSS, content-hashed filenames)
  samples/            3.4 MB   (CC0 drum samples: acoustic 2.5 MB, TR-808 956 KB)
```

**Total ≈ 4.9 MB on disk.** Over the wire on first load it's far less:

- Main JS bundle: **1.1 MB raw → ~329 KB gzipped**
- CSS: ~2 KB gzipped
- PDF/video code is **code-split** and only downloads when those features are used
- Drum samples download **lazily**, only when a user selects a sample kit
  (the default "Classic" synth kit needs no download at all)

So a first visit that just plays a groove pulls roughly **330–390 KB gzipped**.

---

## 3. What the host must provide

**Required**
- Serve static files over **HTTPS** (Web Audio and clipboard need a secure context)
- Correct MIME types for `.js`, `.css`, `.wav` (any standard web server does this)

**Not required** — worth stating explicitly:
- ❌ No Node.js / PHP / Python runtime
- ❌ No database
- ❌ No server-side rendering or API
- ❌ No environment variables, secrets, or API keys
- ❌ No SPA rewrite / history-fallback rules (see §5 — all state is in the query
  string, so there are no client-side *paths* to rewrite)
- ❌ No cookies, no auth, no tracking, no analytics, no PII collected

The app is built with Vite `base: './'`, meaning **all asset paths are
relative**. It therefore runs unchanged from a domain root, a subfolder
(`/groove/`), or a subdomain — no rebuild or config change needed.

---

## 4. Integration options

### Option A — iframe (no hub code changes)
Host the built folder anywhere (including where it already is) and embed:

```html
<iframe src="https://mattduffy941.github.io/Matt-Duffy/"
        width="100%" height="760" style="border:0"
        title="Groove Builder"></iframe>
```

A compact, read-only player for a single lesson groove — add `&Embed=1`:

```html
<iframe src="https://mattduffy941.github.io/Matt-Duffy/?TimeSig=4/4&Div=16&Tempo=90&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|&Embed=1"
        width="100%" height="300" style="border:0;border-radius:8px"
        loading="lazy"></iframe>
```

### Option B — serve it from the hub's own domain
Copy `dist/` into whatever the hub serves statically (e.g. `public/groove/`),
then link or iframe to `/groove/`. Same-origin, so no CSP/frame concerns, and
it's branded as the hub.

### Option C — build it into the hub
If the hub is itself a React/Vite app, the source can be imported as a
component rather than iframed. Bigger job; only worth it if deep integration
(shared login, shared styling) matters. Options A/B are recommended first.

---

## 5. How state works (relevant to linking)

**A groove is fully described by the URL query string.** There is no server
state and no groove IDs. Example:

```
?TimeSig=4/4&Div=16&Tempo=90&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|
```

Consequences for the hub:
- Any lesson can link or embed an **exact** pattern by URL alone.
- Grooves are shareable/bookmarkable with no database.
- The app never uses client-side *routing* — only the query string — so the
  server needs no rewrite rules.
- Format is documented in `ios/URL_FORMAT.md` in the repo.

**Local persistence:** the "My Grooves" list uses `localStorage` under the key
`grooveBuilder.savedGrooves.v1`. It is per-browser, never sent anywhere, and
access is wrapped in try/catch so private mode / blocked storage degrades
gracefully. If the hub wants grooves saved to a user account instead, that
would need hub-side work — the app currently has no concept of a user.

---

## 6. Network behaviour

- **Same-origin only** in normal use: the app fetches its own drum samples from
  `./samples/...` relative to wherever it's hosted. Nothing else.
- **One exception:** if a user exports **MP4** video, the ffmpeg.wasm engine
  (~25 MB) is fetched from `cdn.jsdelivr.net`. WebM export needs no download.
  If the hub has a strict CSP, allow `cdn.jsdelivr.net` **or** self-host the
  ffmpeg core (or simply don't offer MP4).
- Outbound links in the footer (credits) are `target="_blank"`.

**CSP note:** if the hub sets `Content-Security-Policy` and you iframe the app
from another origin, `frame-src` must permit that origin.

---

## 7. Browser support

| Feature | Requirement |
|---|---|
| Editor + notation | Any modern browser |
| Playback | Web Audio API — universal; Safari needs a user gesture to start audio (handled) |
| PDF export | Any modern browser |
| **Video export** | `MediaRecorder` + `canvas.captureStream` — **desktop Chrome / Edge / Firefox**. Unreliable on Safari and iOS, where the control is hidden rather than shown broken. |

Touch is supported (44px targets, long-press for the full sound menu), so it
works on iPad for editing and playback.

---

## 8. Source and licence

- Repo: `https://github.com/MattDuffy941/Matt-Duffy`
- Branch: `claude/groovescribe-recreation-research-xmd6p9`
- Build: `npm install && npm run build` (Node 18+; built with Node 22)
- Drum samples are **CC0 / public domain** (VCSL and tidalcycles TR-808) — no
  attribution legally required, credited in the footer anyway.

---

## 9. Recommended path for the hub

1. Copy `dist/` to a folder the hub serves — e.g. `/groove/` — or point a
   subdomain (`groove.wirralmusicfactory.com`) at it.
2. Link the existing admin/lesson entry point at that path.
3. For individual lessons, embed specific grooves with `&Embed=1` iframes.

This needs no changes to the hub's own application code, no new
infrastructure, and no ongoing maintenance beyond serving static files.
