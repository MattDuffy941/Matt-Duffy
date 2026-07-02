import Foundation

/// URL codec — the interop keystone. A native port of src/lib/urlCodec.ts,
/// kept byte-for-byte compatible so a groove made on the website opens in the
/// app and vice-versa.
///
/// Rules mirrored exactly:
///  - Parameter names are case-insensitive; first occurrence wins.
///  - Lane tab strings are read one char per grid slot; `|` and spaces are
///    skipped; `-` is a rest. The char→hit maps are context-sensitive per lane.
///  - `+` is a literal character (closed hi-hat), NOT a space — so we hand-roll
///    the query split rather than using URLComponents.queryItems.
///  - Validation clamps: TimeSig top 1–32 / bottom ∈ {2,4,8,16}, Tempo 20–400,
///    Measures 1–100, Swing 0–100, Div ∈ {8,12,16,24,32,48}.
///  - Optional params (Swing, MetronomeFreq, Title/Author/Comments, T1–T4,
///    Stickings) are written only when non-default.
public enum URLCodec {

    // MARK: Parse

    public static func parse(_ search: String) -> GrooveData {
        let params = rawQueryParams(search)

        var g = GrooveData()
        g.timeSig = parseTimeSig(params["timesig"])

        var div = parseIntPrefix(params["div"]) ?? 16
        if !GrooveConstants.allowedDivs.contains(div) { div = 16 }
        g.div = div

        var tempo = parseIntPrefix(params["tempo"]) ?? GrooveConstants.defaultTempo
        if tempo < 20 || tempo > 400 { tempo = GrooveConstants.defaultTempo }
        g.tempo = tempo

        var measures = parseIntPrefix(params["measures"]) ?? 1
        measures = min(GrooveConstants.maxMeasures, max(1, measures))
        g.measures = measures

        var swing = parseIntPrefix(params["swing"]) ?? 0
        swing = min(100, max(0, swing))
        g.swing = swing

        var metro = parseIntPrefix(params["metronomefreq"]) ?? 0
        if !GrooveConstants.allowedMetronomeFreqs.contains(metro) { metro = 0 }
        g.metronomeFreq = metro

        g.title = decodeMeta(params["title"])
        g.author = decodeMeta(params["author"])
        g.comments = decodeMeta(params["comments"])

        let n = totalCells(g)
        g.hihat = parseTab(decodeLane(params["h"]), n, TabMaps.hihatCharToHit)
        g.snare = parseTab(decodeLane(params["s"]), n, TabMaps.snareCharToHit)
        g.kick = parseTab(decodeLane(params["k"]), n, TabMaps.kickCharToHit)
        g.toms = [
            parseTab(decodeLane(params["t1"]), n, TabMaps.tomCharToHit),
            parseTab(decodeLane(params["t2"]), n, TabMaps.tomCharToHit),
            parseTab(decodeLane(params["t3"]), n, TabMaps.tomCharToHit),
            parseTab(decodeLane(params["t4"]), n, TabMaps.tomCharToHit),
        ]
        g.stickings = parseTab(decodeLane(params["stickings"]), n, TabMaps.stickingCharToHit)

        return g
    }

    // MARK: Serialize

    public static func serialize(_ g: GrooveData) -> String {
        let perMeasure = cellsPerMeasure(g.timeSig, g.div)
        var parts: [String] = []

        parts.append("TimeSig=\(g.timeSig.top)/\(g.timeSig.bottom)")
        parts.append("Div=\(g.div)")
        if !g.title.isEmpty { parts.append("Title=\(encodeURIComponent(g.title))") }
        if !g.author.isEmpty { parts.append("Author=\(encodeURIComponent(g.author))") }
        if !g.comments.isEmpty { parts.append("Comments=\(encodeURIComponent(g.comments))") }
        parts.append("Tempo=\(g.tempo)")
        if g.swing > 0 { parts.append("Swing=\(g.swing)") }
        parts.append("Measures=\(g.measures)")
        if g.metronomeFreq != 0 { parts.append("MetronomeFreq=\(g.metronomeFreq)") }
        parts.append("H=\(laneToTab(g.hihat, perMeasure, TabMaps.hihatHitToChar))")
        parts.append("S=\(laneToTab(g.snare, perMeasure, TabMaps.snareHitToChar))")
        parts.append("K=\(laneToTab(g.kick, perMeasure, TabMaps.kickHitToChar))")
        for (i, lane) in g.toms.enumerated() where laneHasHits(lane) {
            parts.append("T\(i + 1)=\(laneToTab(lane, perMeasure, TabMaps.tomHitToChar))")
        }
        if laneHasHits(g.stickings) {
            parts.append("Stickings=\(laneToTab(g.stickings, perMeasure, TabMaps.stickingHitToChar))")
        }

        return "?" + parts.joined(separator: "&")
    }

    // MARK: Tab strings

    /// Expand an ASCII tab string into a lane of `cellCount` cells. Skips `|`
    /// and spaces; `-` is a rest; unknown chars are treated as rests.
    public static func parseTab<T>(
        _ tab: String, _ cellCount: Int, _ map: [Character: T]
    ) -> [T?] {
        var lane: [T?] = emptyLane(cellCount)
        var i = 0
        for ch in tab {
            if ch == "|" || ch == " " { continue }
            if i >= cellCount { break }
            if ch != "-", let hit = map[ch] { lane[i] = hit }
            i += 1
        }
        return lane
    }

    /// Serialize a lane back to a `|…|`-delimited tab string, one bar per segment.
    public static func laneToTab<T: Hashable>(
        _ lane: [T?], _ perMeasure: Int, _ map: [T: Character]
    ) -> String {
        let chars: [Character] = lane.map { cell in
            guard let cell = cell else { return "-" }
            return map[cell] ?? "-"
        }
        var bars: [String] = []
        var i = 0
        let step = max(1, perMeasure)
        while i < chars.count {
            let end = min(i + step, chars.count)
            bars.append(String(chars[i..<end]))
            i += step
        }
        return "|" + bars.joined(separator: "|") + "|"
    }

    // MARK: Query helpers

    /// Split a query string into a map of lowercased-name → raw value. `+` is
    /// preserved; first occurrence of a key wins.
    static func rawQueryParams(_ search: String) -> [String: String] {
        var map: [String: String] = [:]
        var q = Substring(search)
        if q.hasPrefix("?") { q = q.dropFirst() }
        if q.isEmpty { return map }
        for pair in q.split(separator: "&", omittingEmptySubsequences: true) {
            let key: String
            let value: String
            if let eq = pair.firstIndex(of: "=") {
                key = String(pair[..<eq]).lowercased()
                value = String(pair[pair.index(after: eq)...])
            } else {
                key = String(pair).lowercased()
                value = ""
            }
            if map[key] == nil { map[key] = value }
        }
        return map
    }

    /// Decode a metadata value: form-style `+`→space, then percent-decoding.
    static func decodeMeta(_ raw: String?) -> String {
        guard let raw = raw, !raw.isEmpty else { return "" }
        let spaced = raw.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
    }

    /// Decode a lane value: percent-decoding only — `+` stays a literal char.
    static func decodeLane(_ raw: String?) -> String {
        guard let raw = raw, !raw.isEmpty else { return "" }
        return raw.removingPercentEncoding ?? raw
    }

    static func parseTimeSig(_ raw: String?) -> TimeSig {
        let fallback = TimeSig(top: 4, bottom: 4)
        guard let raw = raw else { return fallback }
        let s = decodeLane(raw).trimmingCharacters(in: .whitespaces)
        let parts = s.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let top0 = Int(parts[0]), let bottom0 = Int(parts[1])
        else { return fallback }
        var top = top0, bottom = bottom0
        if !(top >= 1 && top <= 32) { top = 4 }
        if !GrooveConstants.allowedBottoms.contains(bottom) { bottom = 4 }
        return TimeSig(top: top, bottom: bottom)
    }

    /// Mimic JavaScript's parseInt(str, 10): leading optional sign + digits,
    /// ignoring a trailing non-numeric suffix; nil when no leading integer.
    static func parseIntPrefix(_ raw: String?) -> Int? {
        guard let raw = raw else { return nil }
        let chars = Array(raw.trimmingCharacters(in: .whitespaces))
        var i = 0
        var sign = 1
        if i < chars.count, chars[i] == "+" || chars[i] == "-" {
            if chars[i] == "-" { sign = -1 }
            i += 1
        }
        var digits = ""
        while i < chars.count, chars[i].isNumber, chars[i].isASCII {
            digits.append(chars[i]); i += 1
        }
        guard let value = Int(digits) else { return nil }
        return sign * value
    }

    /// Match JavaScript's encodeURIComponent (unreserved set A–Z a–z 0–9 - _ . ! ~ * ' ( )).
    static func encodeURIComponent(_ s: String) -> String {
        let unreserved = CharacterSet(
            charactersIn:
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
        )
        return s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s
    }
}
