import { describe, expect, it } from 'vitest';
import { createEmptyGroove } from '../grooveData';
import {
  cellOffsetBeats,
  cellTimeSeconds,
  loopBeats,
  metronomeClicksPerMeasure,
} from '../timing';

describe('cellOffsetBeats — straight time', () => {
  it('spaces 16th cells a quarter-beat apart in 4/4', () => {
    const g = createEmptyGroove(); // 4/4, Div=16
    expect(cellOffsetBeats(g, 0)).toBe(0);
    expect(cellOffsetBeats(g, 1)).toBeCloseTo(0.25);
    expect(cellOffsetBeats(g, 4)).toBeCloseTo(1);
    expect(cellOffsetBeats(g, 15)).toBeCloseTo(3.75);
  });

  it('spaces 8th cells a half-beat apart', () => {
    const g = createEmptyGroove({ div: 8 });
    expect(cellOffsetBeats(g, 1)).toBeCloseTo(0.5);
    expect(cellOffsetBeats(g, 7)).toBeCloseTo(3.5);
  });
});

describe('cellOffsetBeats — swing', () => {
  it('delays off-beat cells by swing% of a third of a cell', () => {
    const g = createEmptyGroove({ div: 16, swing: 100 });
    const cellDur = 0.25; // beats
    // even cells unaffected
    expect(cellOffsetBeats(g, 0)).toBe(0);
    expect(cellOffsetBeats(g, 2)).toBeCloseTo(0.5);
    // odd cells pushed to the triplet position at 100%
    expect(cellOffsetBeats(g, 1)).toBeCloseTo(cellDur + cellDur / 3);
    expect(cellOffsetBeats(g, 3)).toBeCloseTo(3 * cellDur + cellDur / 3);
  });

  it('scales linearly with swing percentage', () => {
    const g50 = createEmptyGroove({ div: 16, swing: 50 });
    expect(cellOffsetBeats(g50, 1)).toBeCloseTo(0.25 + 0.5 * (0.25 / 3));
  });

  it('never swings triplet divisions', () => {
    const g = createEmptyGroove({ div: 12, swing: 100 });
    expect(cellOffsetBeats(g, 1)).toBeCloseTo(1 / 3);
  });
});

describe('triplet spacing', () => {
  it('spaces Div=12 cells a third of a beat apart', () => {
    const g = createEmptyGroove({ div: 12 });
    expect(cellOffsetBeats(g, 0)).toBe(0);
    expect(cellOffsetBeats(g, 1)).toBeCloseTo(1 / 3);
    expect(cellOffsetBeats(g, 2)).toBeCloseTo(2 / 3);
    expect(cellOffsetBeats(g, 3)).toBeCloseTo(1);
  });
});

describe('loop and absolute times', () => {
  it('computes loop length in beats', () => {
    expect(loopBeats(createEmptyGroove())).toBe(4);
    expect(loopBeats(createEmptyGroove({ measures: 2 }))).toBe(8);
    expect(loopBeats(createEmptyGroove({ timeSig: { top: 6, bottom: 8 } }))).toBe(6);
  });

  it('converts to seconds with tempo (80 BPM → 0.75 s/beat)', () => {
    const g = createEmptyGroove(); // tempo 80
    expect(cellTimeSeconds(g, 4, 0)).toBeCloseTo(0.75);
    // second loop of a 4-beat groove starts at 3s
    expect(cellTimeSeconds(g, 0, 1)).toBeCloseTo(3);
  });
});

describe('metronome clicks', () => {
  it('is silent at freq 0', () => {
    expect(metronomeClicksPerMeasure(createEmptyGroove())).toEqual([]);
  });

  it('clicks every beat at freq 4 in 4/4, accenting beat 1', () => {
    const clicks = metronomeClicksPerMeasure(createEmptyGroove({ metronomeFreq: 4 }));
    expect(clicks.map((c) => c.offsetBeats)).toEqual([0, 1, 2, 3]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it('clicks every half-beat at freq 8', () => {
    const clicks = metronomeClicksPerMeasure(createEmptyGroove({ metronomeFreq: 8 }));
    expect(clicks).toHaveLength(8);
    expect(clicks[1].offsetBeats).toBeCloseTo(0.5);
  });

  it('produces a dotted-quarter pulse in 6/8 at freq 4', () => {
    const clicks = metronomeClicksPerMeasure(
      createEmptyGroove({ timeSig: { top: 6, bottom: 8 }, metronomeFreq: 4 }),
    );
    expect(clicks.map((c) => c.offsetBeats)).toEqual([0, 2, 4]);
  });
});
