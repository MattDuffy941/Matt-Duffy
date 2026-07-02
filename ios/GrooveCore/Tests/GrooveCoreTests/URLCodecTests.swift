import XCTest
@testable import GrooveCore

/// Mirrors the web app's src/lib/__tests__/urlCodec.test.ts. The reference URL
/// and round-trip assertions are the interop contract with the website.
final class URLCodecTests: XCTestCase {

    let referenceURL =
        "?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|"

    // MARK: Reference URL

    func testDecodesReferenceURL() {
        let g = URLCodec.parse(referenceURL)
        XCTAssertEqual(g.timeSig, TimeSig(top: 4, bottom: 4))
        XCTAssertEqual(g.div, 16)
        XCTAssertEqual(g.tempo, 80)
        XCTAssertEqual(g.measures, 1)
        XCTAssertEqual(g.swing, 0)
        XCTAssertEqual(totalCells(g), 16)
        XCTAssertEqual(g.hihat.count, 16)
        XCTAssertTrue(g.hihat.allSatisfy { $0 == nil })
        XCTAssertTrue(g.snare.allSatisfy { $0 == nil })
        XCTAssertTrue(g.kick.allSatisfy { $0 == nil })
    }

    func testRoundTripsReferenceURL() {
        XCTAssertEqual(URLCodec.serialize(URLCodec.parse(referenceURL)), referenceURL)
    }

    // MARK: Parameter handling

    func testCaseInsensitiveParams() {
        let g = URLCodec.parse("?timesig=6/8&DIV=16&tempo=90&MEASURES=2&h=|xxxxxxxxxxxx|xxxxxxxxxxxx|")
        XCTAssertEqual(g.timeSig, TimeSig(top: 6, bottom: 8))
        XCTAssertEqual(g.tempo, 90)
        XCTAssertEqual(g.measures, 2)
        XCTAssertEqual(totalCells(g), 24) // 6/8 at Div=16 → 12 cells/measure × 2
        XCTAssertTrue(g.hihat.allSatisfy { $0 == .normal })
    }

    func testSkipsBarsAndSpaces() {
        let g = URLCodec.parse("?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=x-x- x-x- |x-x- x-x-|")
        for i in 0..<16 {
            XCTAssertEqual(g.hihat[i], i % 2 == 0 ? .normal : nil)
        }
    }

    func testPlusPreservedAsClosedHiHat() {
        let g = URLCodec.parse("?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x-+-x-+-x-+-x-+-|")
        XCTAssertEqual(g.hihat[2], .close)
        XCTAssertEqual(g.hihat[6], .close)
    }

    // MARK: Validation clamps

    func testTempoClamps() {
        XCTAssertEqual(URLCodec.parse("?Tempo=1000").tempo, 80)
        XCTAssertEqual(URLCodec.parse("?Tempo=5").tempo, 80)
        XCTAssertEqual(URLCodec.parse("?Tempo=abc").tempo, 80)
        XCTAssertEqual(URLCodec.parse("?Tempo=20").tempo, 20)
        XCTAssertEqual(URLCodec.parse("?Tempo=400").tempo, 400)
    }

    func testTimeSigFallback() {
        XCTAssertEqual(URLCodec.parse("?TimeSig=99/4").timeSig, TimeSig(top: 4, bottom: 4))
        XCTAssertEqual(URLCodec.parse("?TimeSig=4/7").timeSig, TimeSig(top: 4, bottom: 4))
        XCTAssertEqual(URLCodec.parse("?TimeSig=garbage").timeSig, TimeSig(top: 4, bottom: 4))
        XCTAssertEqual(URLCodec.parse("?TimeSig=7/8").timeSig, TimeSig(top: 7, bottom: 8))
    }

    func testMeasuresAndSwingAndDivClamps() {
        XCTAssertEqual(URLCodec.parse("?Measures=0").measures, 1)
        XCTAssertEqual(URLCodec.parse("?Measures=500").measures, 100)
        XCTAssertEqual(URLCodec.parse("?Swing=150").swing, 100)
        XCTAssertEqual(URLCodec.parse("?Swing=-5").swing, 0)
        XCTAssertEqual(URLCodec.parse("?Div=13").div, 16)
        XCTAssertEqual(URLCodec.parse("?Div=12").div, 12)
        XCTAssertEqual(URLCodec.parse("?MetronomeFreq=7").metronomeFreq, 0)
        XCTAssertEqual(URLCodec.parse("?MetronomeFreq=8").metronomeFreq, 8)
    }

    // MARK: Context-sensitive lane maps

    func testHihatVocabulary() {
        let g = URLCodec.parse("?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|xXo+rRbBcsmnN---|")
        XCTAssertEqual(Array(g.hihat.prefix(13)), [
            .normal, .accent, .open, .close, .ride, .ride, .rideBell, .rideBell,
            .crash, .stacker, .cowbell, .metronomeNormal, .metronomeAccent,
        ])
    }

    func testSameLetterDiffersPerLane() {
        let g = URLCodec.parse(
            "?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|x---------------|&K=|x---------------|")
        XCTAssertEqual(g.hihat[0], .normal)  // hi-hat: x = normal
        XCTAssertEqual(g.snare[0], .xstick)  // snare:  x = cross-stick
        XCTAssertEqual(g.kick[0], .splash)   // kick:   x = foot splash
    }

    func testKickVocabulary() {
        let g = URLCodec.parse("?TimeSig=4/4&Div=16&Tempo=80&Measures=1&K=|oxX-------------|")
        XCTAssertEqual(Array(g.kick.prefix(3)), [.normal, .splash, .kickAndSplash])
    }

    // MARK: Serialization

    func testRoundTripsRockBeat() {
        let url =
            "?TimeSig=4/4&Div=16&Tempo=120&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|"
        XCTAssertEqual(URLCodec.serialize(URLCodec.parse(url)), url)
    }

    func testOmitsAndIncludesOptionalParams() {
        var g = GrooveData()
        g.hihat = emptyLane(16); g.snare = emptyLane(16); g.kick = emptyLane(16)
        g.toms = [emptyLane(16), emptyLane(16), emptyLane(16), emptyLane(16)]
        g.stickings = emptyLane(16)
        XCTAssertFalse(URLCodec.serialize(g).contains("Swing="))
        XCTAssertFalse(URLCodec.serialize(g).contains("MetronomeFreq="))

        g.swing = 30
        g.metronomeFreq = 8
        let url = URLCodec.serialize(g)
        XCTAssertTrue(url.contains("&Swing=30&"))
        XCTAssertTrue(url.contains("&MetronomeFreq=8&"))
    }

    func testEncodesMetadata() {
        var g = GrooveData()
        g.hihat = emptyLane(16); g.snare = emptyLane(16); g.kick = emptyLane(16)
        g.toms = [emptyLane(16), emptyLane(16), emptyLane(16), emptyLane(16)]
        g.stickings = emptyLane(16)
        g.title = "My Groove #1"
        g.author = "Matt Duffy"
        let url = URLCodec.serialize(g)
        XCTAssertTrue(url.contains("Title=My%20Groove%20%231"))
        let g2 = URLCodec.parse(url)
        XCTAssertEqual(g2.title, "My Groove #1")
        XCTAssertEqual(g2.author, "Matt Duffy")
    }

    func testTomsAndStickingsRoundTrip() {
        let url =
            "?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|&T1=|----o-----------|&Stickings=|R-L-------------|"
        let g = URLCodec.parse(url)
        XCTAssertEqual(g.toms[0][4], .normal)
        XCTAssertEqual(g.stickings[0], .R)
        XCTAssertEqual(g.stickings[2], .L)
        XCTAssertEqual(URLCodec.serialize(g), url)
    }

    func testRoundTripsEveryHitType() {
        let url =
            "?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|xXo+rbcsmnN-----|&S=|oOgxfdb---------|&K=|oxX-------------|"
        XCTAssertEqual(URLCodec.serialize(URLCodec.parse(url)), url)
    }
}
