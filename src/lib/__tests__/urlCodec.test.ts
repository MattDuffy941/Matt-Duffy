import { describe, expect, it } from 'vitest';
import { parseUrl, toUrl } from '../urlCodec';
import { createEmptyGroove, totalCells } from '../grooveData';

const REFERENCE_URL =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|';

describe('parseUrl — reference URL', () => {
  it('decodes the blank-canvas reference URL', () => {
    const g = parseUrl(REFERENCE_URL);
    expect(g.timeSig).toEqual({ top: 4, bottom: 4 });
    expect(g.div).toBe(16);
    expect(g.tempo).toBe(80);
    expect(g.measures).toBe(1);
    expect(g.swing).toBe(0);
    expect(totalCells(g)).toBe(16);
    expect(g.hihat).toHaveLength(16);
    expect(g.hihat.every((c) => c === null)).toBe(true);
    expect(g.snare.every((c) => c === null)).toBe(true);
    expect(g.kick.every((c) => c === null)).toBe(true);
  });

  it('round-trips the reference URL exactly', () => {
    expect(toUrl(parseUrl(REFERENCE_URL))).toBe(REFERENCE_URL);
  });
});

describe('parseUrl — parameter handling', () => {
  it('matches parameter names case-insensitively', () => {
    const g = parseUrl('?timesig=6/8&DIV=16&tempo=90&MEASURES=2&h=|xxxxxxxxxxxx|xxxxxxxxxxxx|');
    expect(g.timeSig).toEqual({ top: 6, bottom: 8 });
    expect(g.tempo).toBe(90);
    expect(g.measures).toBe(2);
    // 6/8 at Div=16 → 12 cells per measure, 2 measures
    expect(totalCells(g)).toBe(24);
    expect(g.hihat.every((c) => c === 'normal')).toBe(true);
  });

  it('skips | and spaces in tab strings', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=x-x- x-x- |x-x- x-x-|');
    for (let i = 0; i < 16; i++) {
      expect(g.hihat[i]).toBe(i % 2 === 0 ? 'normal' : null);
    }
  });

  it('preserves + as closed hi-hat (never decodes it to a space)', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x-+-x-+-x-+-x-+-|');
    expect(g.hihat[2]).toBe('close');
    expect(g.hihat[6]).toBe('close');
  });

  it('pads short tab strings and truncates long ones', () => {
    const short = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x-x-|');
    expect(short.hihat[0]).toBe('normal');
    expect(short.hihat[2]).toBe('normal');
    expect(short.hihat.slice(4).every((c) => c === null)).toBe(true);

    const long = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&K=|oooooooooooooooooooo|');
    expect(long.kick).toHaveLength(16);
    expect(long.kick.every((c) => c === 'normal')).toBe(true);
  });

  it('treats unknown characters as rests', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&S=|?o??????????????|');
    expect(g.snare[0]).toBe(null);
    expect(g.snare[1]).toBe('normal');
  });
});

describe('parseUrl — validation clamps', () => {
  it('clamps out-of-range tempo to default', () => {
    expect(parseUrl('?Tempo=1000').tempo).toBe(80);
    expect(parseUrl('?Tempo=5').tempo).toBe(80);
    expect(parseUrl('?Tempo=abc').tempo).toBe(80);
    expect(parseUrl('?Tempo=20').tempo).toBe(20);
    expect(parseUrl('?Tempo=400').tempo).toBe(400);
  });

  it('falls back on invalid time signatures', () => {
    expect(parseUrl('?TimeSig=99/4').timeSig).toEqual({ top: 4, bottom: 4 });
    expect(parseUrl('?TimeSig=4/7').timeSig).toEqual({ top: 4, bottom: 4 });
    expect(parseUrl('?TimeSig=garbage').timeSig).toEqual({ top: 4, bottom: 4 });
    expect(parseUrl('?TimeSig=7/8').timeSig).toEqual({ top: 7, bottom: 8 });
  });

  it('clamps measures to 1–100', () => {
    expect(parseUrl('?Measures=0').measures).toBe(1);
    expect(parseUrl('?Measures=500').measures).toBe(100);
  });

  it('clamps swing to 0–100 and rejects bad divisions', () => {
    expect(parseUrl('?Swing=150').swing).toBe(100);
    expect(parseUrl('?Swing=-5').swing).toBe(0);
    expect(parseUrl('?Div=13').div).toBe(16);
    expect(parseUrl('?Div=12').div).toBe(12);
  });

  it('rejects invalid metronome frequencies', () => {
    expect(parseUrl('?MetronomeFreq=7').metronomeFreq).toBe(0);
    expect(parseUrl('?MetronomeFreq=8').metronomeFreq).toBe(8);
  });
});

describe('lane character maps (context-sensitive)', () => {
  it('decodes the full hi-hat vocabulary', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|xXo+rRbBcsmnN---|');
    expect(g.hihat.slice(0, 13)).toEqual([
      'normal',
      'accent',
      'open',
      'close',
      'ride',
      'ride',
      'rideBell',
      'rideBell',
      'crash',
      'stacker',
      'cowbell',
      'metronomeNormal',
      'metronomeAccent',
    ]);
  });

  it('decodes the full snare vocabulary', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&S=|oOgxfdbB--------|');
    expect(g.snare.slice(0, 8)).toEqual([
      'normal',
      'accent',
      'ghost',
      'xstick',
      'flam',
      'drag',
      'buzz',
      'buzz',
    ]);
  });

  it('decodes the kick vocabulary (x = foot splash, X = kick+splash)', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&K=|oxX-------------|');
    expect(g.kick.slice(0, 3)).toEqual(['normal', 'splash', 'kickAndSplash']);
  });

  it('the same letter means different things per lane', () => {
    const g = parseUrl(
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|x---------------|&K=|x---------------|',
    );
    expect(g.hihat[0]).toBe('normal'); // hi-hat: x = normal
    expect(g.snare[0]).toBe('xstick'); // snare: x = cross-stick
    expect(g.kick[0]).toBe('splash'); //  kick: x = foot splash
  });
});

describe('toUrl — serialization', () => {
  it('round-trips a basic rock beat', () => {
    const url =
      '?TimeSig=4/4&Div=16&Tempo=120&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|';
    expect(toUrl(parseUrl(url))).toBe(url);
  });

  it('round-trips multi-measure grooves with bar separators', () => {
    const url =
      '?TimeSig=4/4&Div=8&Tempo=100&Measures=2&H=|xxxxxxxx|xxxxxxxx|&S=|--o---o-|--o---o-|&K=|o---o---|o---o---|';
    expect(toUrl(parseUrl(url))).toBe(url);
  });

  it('omits Swing and MetronomeFreq when default, includes them otherwise', () => {
    const g = createEmptyGroove();
    expect(toUrl(g)).not.toContain('Swing=');
    expect(toUrl(g)).not.toContain('MetronomeFreq=');

    g.swing = 30;
    g.metronomeFreq = 8;
    const url = toUrl(g);
    expect(url).toContain('&Swing=30&');
    expect(url).toContain('&MetronomeFreq=8&');
    const g2 = parseUrl(url);
    expect(g2.swing).toBe(30);
    expect(g2.metronomeFreq).toBe(8);
  });

  it('encodes and round-trips metadata', () => {
    const g = createEmptyGroove();
    g.title = 'My Groove #1';
    g.author = 'Matt Duffy';
    const url = toUrl(g);
    expect(url).toContain('Title=My%20Groove%20%231');
    const g2 = parseUrl(url);
    expect(g2.title).toBe('My Groove #1');
    expect(g2.author).toBe('Matt Duffy');
  });

  it('serializes toms only when they contain hits', () => {
    const g = createEmptyGroove();
    expect(toUrl(g)).not.toContain('T1=');
    g.toms[0][4] = 'normal';
    const url = toUrl(g);
    expect(url).toContain('T1=|----o-----------|');
    expect(url).not.toContain('T2=');
    const g2 = parseUrl(url);
    expect(g2.toms[0][4]).toBe('normal');
  });

  it('round-trips stickings, omitting the param when empty', () => {
    const g = createEmptyGroove();
    expect(toUrl(g)).not.toContain('Stickings=');
    const url =
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|&Stickings=|R-L-R-L-B-------|';
    const g2 = parseUrl(url);
    expect(g2.stickings[0]).toBe('R');
    expect(g2.stickings[2]).toBe('L');
    expect(g2.stickings[8]).toBe('B');
    expect(toUrl(g2)).toBe(url);
  });

  it('accepts lowercase sticking characters', () => {
    const g = parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&Stickings=|rl--------------|');
    expect(g.stickings[0]).toBe('R');
    expect(g.stickings[1]).toBe('L');
  });

  it('round-trips every hit type in every lane', () => {
    const url =
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|xXo+rbcsmnN-----|&S=|oOgxfdb---------|&K=|oxX-------------|';
    expect(toUrl(parseUrl(url))).toBe(url);
  });
});
