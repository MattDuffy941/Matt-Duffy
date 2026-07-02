# Groove Builder — iOS / iPadOS App Build Spec

> Hand this to Claude Code inside your Xcode project. It builds a native
> SwiftUI app that wraps the existing Groove Builder web app, running fully
> offline, with native audio, a native PDF share sheet, and proper iPad/iPhone
> behaviour. Work through it phase by phase; each phase has an acceptance check.

---

## 0. What we're building & why this approach

Groove Builder is a 100% client-side web app (React + TypeScript, no backend,
all state in the URL). The fastest, lowest-risk way to ship it on the App Store
is **not** a rewrite — it's a thin **native SwiftUI shell** that loads the
already-built web app inside a `WKWebView`, served from files bundled in the
app so it works with no internet.

We add three native pieces so it behaves like a real app, not a bookmark:

1. **Offline serving** via a custom URL scheme handler (gives the web app a
   real origin so the History API / shareable-URL state keeps working).
2. **Native audio session** so playback sounds through the silent/mute switch
   and behaves correctly with other audio.
3. **Native PDF share sheet** — iOS web views can't "download" a file the way
   desktop browsers do, so PDF export is bridged to a native share sheet
   (Save to Files, AirDrop, Print, Mail…).

**Read this honestly before you start (App Store Guideline 4.2):** Apple
sometimes rejects apps that are "just a website in a wrapper." The three native
features above, full offline operation, and the app being a genuine creation
tool are the standard mitigations and usually clear review. If it's rejected,
the fix is to add more native feel (haptics on taps, a native launch
experience) — noted in Phase 7.

---

## 1. Prerequisites (you, once)

- A **Mac** with **Xcode 16+**.
- An **Apple Developer Program** membership ($99/year) — required to run on a
  physical iPad and to submit to the App Store. (You can build to the simulator
  without it.)
- The built web app. In the Groove Builder repo run `npm run build`; this
  produces a `dist/` folder. You'll copy its contents into the Xcode project in
  Phase 3.

Decisions already made for you (so Claude Code shouldn't ask):

| Setting | Value |
|---|---|
| App name | Groove Builder |
| Bundle identifier | `com.wirralmusicfactory.groovebuilder` |
| Deployment target | iOS 16.0 |
| Devices | Universal (iPhone + iPad) |
| Interface | SwiftUI (App lifecycle) |
| Orientations | Portrait + Landscape (both, esp. iPad) |
| Internet required | No — fully offline |
| Data collected | None |

---

## 2. Master prompt (paste this into Claude Code first)

> You are working in a new Xcode project for a SwiftUI iOS/iPadOS app called
> "Groove Builder", bundle id `com.wirralmusicfactory.groovebuilder`,
> deployment target iOS 16, universal (iPhone + iPad). The app is a thin native
> shell around a bundled web app loaded in a WKWebView. Implement the app in the
> phases described in this spec: (3) bundle the web files and serve them offline
> via a custom `app://` URL scheme handler; (4) configure the WKWebView and a
> playback AVAudioSession; (5) bridge PDF export to a native share sheet via a
> WKScriptMessageHandler named `exportPdf`; (6) set Info.plist, icons, launch
> screen, orientations, and safe-area handling. Use the exact Swift shown in the
> spec as a starting point and adapt to the project. After each phase, stop and
> report the acceptance check result.

---

## 3. Phase 1 — Project + bundled web files

1. Create the Xcode project: **App**, SwiftUI, Swift, name **Groove Builder**,
   bundle id `com.wirralmusicfactory.groovebuilder`, deployment target iOS 16,
   uncheck Core Data / Tests if you like.
2. From the web repo, build (`npm run build`) and copy **the contents of
   `dist/`** into a folder named `web/` inside the Xcode project.
   - Add it to Xcode as a **folder reference** (blue folder), *not* a group, so
     every asset (including `assets/*`) is copied into the app bundle verbatim.
   - Vite is configured with `base: './'`, so all asset paths are relative and
     resolve correctly under the custom scheme.
   - Re-run this copy on every web release. A helper script:
     ```sh
     rsync -a --delete /path/to/groove-builder/dist/ ./web/
     ```

**Acceptance check:** `web/index.html` and `web/assets/…` appear in "Copy Bundle
Resources" for the app target.

---

## 4. Phase 2 — Offline scheme handler

Create `BundleSchemeHandler.swift`. It serves files from the bundled `web/`
folder under an `app://local/…` origin.

```swift
import WebKit
import UniformTypeIdentifiers

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { task.didFailWithError(URLError(.badURL)); return }

        // Map the path (ignoring query string) to a file in the bundle's web/ dir.
        var path = comps.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let relative = String(path.drop(while: { $0 == "/" }))

        guard let base = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let fileURL = base.appendingPathComponent(relative)

        guard let data = try? Data(contentsOf: fileURL) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404,
                                       httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(resp); task.didReceive(Data()); task.didFinish(); return
        }

        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": Self.mime(for: fileURL.pathExtension),
                           "Cache-Control": "no-cache",
                           "Access-Control-Allow-Origin": "*"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "json": return "application/json"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ico": return "image/x-icon"
        default:
            return UTType(filenameExtension: ext)?.preferredMIMEType
                ?? "application/octet-stream"
        }
    }
}
```

**Acceptance check:** after Phase 3 wiring, the app loads the grid + notation
with Wi-Fi **off**.

---

## 5. Phase 3 — WebView, audio session, PDF bridge

`WebView.swift` — a `UIViewRepresentable` wrapping `WKWebView`:

```swift
import SwiftUI
import WebKit
import AVFoundation

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "app")
        config.userContentController.add(context.coordinator, name: "exportPdf")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.bounces = false
        webView.isOpaque = true
        context.coordinator.webView = webView

        webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        // JS calls window.webkit.messageHandlers.exportPdf.postMessage({filename, base64})
        func userContentController(_ uc: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == "exportPdf",
                  let body = message.body as? [String: Any],
                  let b64 = body["base64"] as? String,
                  let data = Data(base64Encoded: b64) else { return }
            let name = (body["filename"] as? String) ?? "groove.pdf"

            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try? data.write(to: tmp)

            let av = UIActivityViewController(activityItems: [tmp],
                                              applicationActivities: nil)
            // iPad requires a source rect or it crashes.
            if let pop = av.popoverPresentationController, let v = webView {
                pop.sourceView = v
                pop.sourceRect = CGRect(x: v.bounds.midX, y: v.bounds.midY,
                                        width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            Self.topViewController()?.present(av, animated: true)
        }

        static func topViewController() -> UIViewController? {
            let window = UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
            var top = window?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            return top
        }
    }
}
```

`ContentView.swift`:

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView().ignoresSafeArea()   // web CSS handles safe-area insets
    }
}
```

`GrooveBuilderApp.swift` — configure the audio session so sound plays through
the mute switch:

```swift
import SwiftUI
import AVFoundation

@main
struct GrooveBuilderApp: App {
    init() {
        try? AVAudioSession.sharedInstance()
            .setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
    }
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

**Acceptance check:** Play works with the **hardware mute switch on**; tapping
**Export PDF** opens the iOS share sheet with a `.pdf` you can Save to Files.

---

## 6. Phase 4 — Info.plist, icons, launch, orientation

- **App Icon:** add a 1024×1024 PNG to the asset catalog's AppIcon (Xcode 16
  can generate the rest from the single size). Design suggestion: the grid +
  a drum-notation X on the app's dark panel colour (`#1e2128`).
- **Launch Screen:** a simple storyboard/launch screen with the dark background
  colour so startup isn't a white flash.
- **Orientation:** enable Portrait, Landscape Left, Landscape Right for both
  iPhone and iPad (iPad users will want landscape for wide grids).
- **Status bar:** light content on the dark background.
- **Info.plist:** no privacy-permission keys are needed (no camera, mic,
  location, tracking). Because everything is bundled and same-origin, no App
  Transport Security exceptions are required either.
- **Display name:** `Groove Builder`.

**Acceptance check:** launches to the dark screen (no white flash), rotates
freely on iPad, icon shows on the home screen.

---

## 7. Phase 5 — Build, device test, submit

1. **Signing & Capabilities:** select your Team, enable Automatically Manage
   Signing. No special capabilities required.
2. Run on a **physical iPad** and iPhone. Verify: offline load, tap-to-cycle,
   long-press sound menu, playback + metronome + count-in + speed-up, notation
   updates, PDF share, and that the shareable-URL state persists across an app
   relaunch (the History API works under the `app://` origin).
3. **TestFlight:** Archive → Distribute → App Store Connect → TestFlight for
   yourself and a few students before public release.
4. **App Store Connect listing:** screenshots (iPhone 6.7" + iPad 12.9"
   required), description, keywords (drums, groove, notation, metronome,
   practice), category **Music** (or Education). App Privacy questionnaire:
   **"Data Not Collected."**
5. **If rejected under 4.2** (wrapper concern), add native feel and resubmit:
   - Haptic feedback on cell taps (`UIImpactFeedbackGenerator`) via a second
     script message handler (`window.webkit.messageHandlers.haptic.postMessage()`).
   - A native launch/onboarding screen.
   - Emphasise in review notes that it's an offline creation tool with native
     audio and PDF export, not a web bookmark.

**Acceptance check:** app runs on your own iPad via TestFlight end-to-end.

---

## 8. Web-app changes needed (in the Groove Builder repo, not Xcode)

Two small changes make the web app cooperate with the native shell. **I (Claude
in the web repo) can apply these for you — just ask.** They're harmless in the
browser (feature-detected, no-ops when there's no native bridge).

1. **PDF export → native bridge** in `src/lib/exportPdf.ts`: when the native
   handler exists, post the PDF instead of triggering a browser download.
   ```ts
   const bridge = (window as any).webkit?.messageHandlers?.exportPdf;
   if (bridge) {
     const dataUri = pdf.output('datauristring');      // data:application/pdf;base64,…
     bridge.postMessage({ filename: safeFilename(title), base64: dataUri.split(',')[1] });
   } else {
     pdf.save(safeFilename(title));                     // unchanged web behaviour
   }
   ```
2. **Safe-area + no-zoom viewport** in `index.html`:
   ```html
   <meta name="viewport"
         content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
   ```
   and pad the app for the notch/home-indicator in `app.css`:
   ```css
   .app { padding-left: max(16px, env(safe-area-inset-left));
          padding-right: max(16px, env(safe-area-inset-right));
          padding-bottom: env(safe-area-inset-bottom); }
   ```

After applying these, rebuild (`npm run build`) and re-copy `dist/` → `web/`
(Phase 3).

---

## 9. Effort & cost summary

| Item | Effort / cost |
|---|---|
| Xcode project + Swift shell (Phases 1–4) | ~½–1 day with Claude Code |
| Icons, launch, listing assets | ~half a day |
| Apple Developer Program | $99 / year |
| App Review turnaround | ~1–3 days per submission |
| Ongoing updates | re-run `npm run build` → copy `dist/` → re-archive |

No rewrite, no second codebase to maintain — the web app stays the single source
of truth, and the iOS app is a wrapper you re-bundle on release.

---

## 10. File checklist (what Claude Code should end up creating)

- `GrooveBuilderApp.swift` — app entry + audio session
- `ContentView.swift` — hosts the web view
- `WebView.swift` — WKWebView + PDF bridge coordinator
- `BundleSchemeHandler.swift` — offline file serving
- `web/` — folder reference containing the built web app (`dist/` contents)
- `Assets.xcassets/AppIcon` — 1024² icon
- Launch screen + Info.plist configured per Phase 4
