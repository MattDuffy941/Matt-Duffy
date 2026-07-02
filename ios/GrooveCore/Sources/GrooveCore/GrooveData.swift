import Foundation

// MARK: - Types
//
// Native Swift port of the web app's src/lib/grooveData.ts. Field names,
// validation clamps, and character maps are kept identical so grooves
// round-trip byte-for-byte with the website (see URLCodec).

public struct TimeSig: Equatable, Hashable, Codable, Sendable {
    public var top: Int
    public var bottom: Int
    public init(top: Int = 4, bottom: Int = 4) {
        self.top = top
        self.bottom = bottom
    }
}

public enum HihatHit: String, CaseIterable, Codable, Sendable {
    case normal, accent, open, close, ride, rideBell, crash, stacker, cowbell,
         metronomeNormal, metronomeAccent
}

public enum SnareHit: String, CaseIterable, Codable, Sendable {
    case normal, accent, ghost, xstick, flam, drag, buzz
}

public enum KickHit: String, CaseIterable, Codable, Sendable {
    case normal, splash, kickAndSplash
}

public enum TomHit: String, CaseIterable, Codable, Sendable {
    case normal
}

public enum Sticking: String, CaseIterable, Codable, Sendable {
    case R, L, B
}

public struct GrooveData: Equatable, Sendable {
    public var timeSig = TimeSig(top: 4, bottom: 4)
    /// Grid resolution: cells per whole note (16 = 16ths, 12 = 8th triplets…).
    public var div = 16
    public var tempo = GrooveConstants.defaultTempo
    public var measures = 1
    public var swing = 0
    public var metronomeFreq = 0
    public var title = ""
    public var author = ""
    public var comments = ""
    public var hihat: [HihatHit?] = []
    public var snare: [SnareHit?] = []
    public var kick: [KickHit?] = []
    /// Four tom lanes (T1…T4), each the same length as the other lanes.
    public var toms: [[TomHit?]] = [[], [], [], []]
    public var stickings: [Sticking?] = []

    public init() {}
}

// MARK: - Constants

public enum GrooveConstants {
    public static let allowedDivs = [8, 12, 16, 24, 32, 48]
    public static let allowedBottoms = [2, 4, 8, 16]
    public static let allowedMetronomeFreqs = [0, 4, 8, 16]
    public static let defaultTempo = 80
    public static let maxMeasures = 100
}

// MARK: - Grid math

/// Triplet grids are the divisions divisible by 12 (12, 24, 48).
public func isTripletDiv(_ div: Int) -> Bool { div % 12 == 0 }

/// Cells in one measure: div is per-whole-note, scaled by the time signature.
public func cellsPerMeasure(_ timeSig: TimeSig, _ div: Int) -> Int {
    Int((Double(div * timeSig.top) / Double(timeSig.bottom)).rounded())
}

/// Cells per beat (one beat = 1/bottom note).
public func cellsPerBeat(_ timeSig: TimeSig, _ div: Int) -> Int {
    Int((Double(div) / Double(timeSig.bottom)).rounded())
}

public func totalCells(_ g: GrooveData) -> Int {
    cellsPerMeasure(g.timeSig, g.div) * g.measures
}

public func emptyLane<T>(_ length: Int) -> [T?] {
    Array<T?>(repeating: nil, count: max(0, length))
}

public func laneHasHits<T>(_ lane: [T?]) -> Bool {
    lane.contains { $0 != nil }
}

/// Remap a lane onto a new grid size, preserving musical position as closely
/// as possible (exact for integer up/down-scaling; first-wins on collisions).
public func remapLane<T>(_ lane: [T?], _ newLength: Int) -> [T?] {
    var out: [T?] = emptyLane(newLength)
    if lane.isEmpty || newLength == 0 { return out }
    for i in 0..<lane.count {
        guard let hit = lane[i] else { continue }
        let j = (i * newLength) / lane.count
        if out[j] == nil { out[j] = hit }
    }
    return out
}

// MARK: - Character maps (the URL contract — context-sensitive per lane)

public enum TabMaps {
    public static let hihatCharToHit: [Character: HihatHit] = [
        "x": .normal, "X": .accent, "o": .open, "+": .close,
        "r": .ride, "R": .ride, "b": .rideBell, "B": .rideBell,
        "c": .crash, "s": .stacker, "m": .cowbell,
        "n": .metronomeNormal, "N": .metronomeAccent,
    ]
    public static let hihatHitToChar: [HihatHit: Character] = [
        .normal: "x", .accent: "X", .open: "o", .close: "+",
        .ride: "r", .rideBell: "b", .crash: "c", .stacker: "s",
        .cowbell: "m", .metronomeNormal: "n", .metronomeAccent: "N",
    ]

    public static let snareCharToHit: [Character: SnareHit] = [
        "o": .normal, "O": .accent, "g": .ghost, "x": .xstick,
        "f": .flam, "d": .drag, "b": .buzz, "B": .buzz,
    ]
    public static let snareHitToChar: [SnareHit: Character] = [
        .normal: "o", .accent: "O", .ghost: "g", .xstick: "x",
        .flam: "f", .drag: "d", .buzz: "b",
    ]

    public static let kickCharToHit: [Character: KickHit] = [
        "o": .normal, "x": .splash, "X": .kickAndSplash,
    ]
    public static let kickHitToChar: [KickHit: Character] = [
        .normal: "o", .splash: "x", .kickAndSplash: "X",
    ]

    public static let tomCharToHit: [Character: TomHit] = [
        "o": .normal, "x": .normal,
    ]
    public static let tomHitToChar: [TomHit: Character] = [
        .normal: "o",
    ]

    public static let stickingCharToHit: [Character: Sticking] = [
        "R": .R, "r": .R, "L": .L, "l": .L, "B": .B, "b": .B,
    ]
    public static let stickingHitToChar: [Sticking: Character] = [
        .R: "R", .L: "L", .B: "B",
    ]
}
