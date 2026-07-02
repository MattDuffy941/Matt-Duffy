import { describe, expect, it } from 'vitest';
import { grooveToAbc } from '../grooveToAbc';
import { parseUrl } from '../urlCodec';

const ROCK_BEAT =
  '?TimeSig=4/4&Div=16&Tempo=120&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----o-------o---|&K=|o-------o-------|';

describe('grooveToAbc — header', () => {
  it('emits time signature, unit length, percmap and two stem-directed voices', () => {
    const abc = grooveToAbc(parseUrl(ROCK_BEAT));
    expect(abc).toContain('M:4/4');
    expect(abc).toContain('L:1/16');
    expect(abc).toContain('K:C clef=perc');
    expect(abc).toContain('V:1 stem=up');
    expect(abc).toContain('V:2 stem=down');
    expect(abc).toContain('%%percmap g closed-hi-hat x');
    expect(abc).toContain('%%percmap F acoustic-bass-drum');
  });

  it('uses L:1/8 written units for 8th-note triplets (Div=12)', () => {
    const abc = grooveToAbc(parseUrl('?TimeSig=4/4&Div=12&Tempo=80&Measures=1'));
    expect(abc).toContain('L:1/8');
  });
});

describe('grooveToAbc — body', () => {
  it('merges durations by look-ahead: 8th hi-hats on a 16th grid become g2', () => {
    const abc = grooveToAbc(parseUrl(ROCK_BEAT));
    const hands = abc.split('\n').find((l) => l.startsWith('[V:1]'))!;
    // hi-hat only beats render as two beamed 8ths: g2g2
    expect(hands).toContain('g2g2');
    // beat 2 and 4: hi-hat + snare chord
    expect(hands).toContain('[gc]2');
  });

  it('renders kick in the feet voice with beat rests elsewhere', () => {
    const abc = grooveToAbc(parseUrl(ROCK_BEAT));
    const feet = abc.split('\n').find((l) => l.startsWith('[V:2]'))!;
    expect(feet).toContain('F4');
    expect(feet).toContain('z4');
  });

  it('renders an empty groove as rests', () => {
    const abc = grooveToAbc(
      parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|'),
    );
    const hands = abc.split('\n').find((l) => l.startsWith('[V:1]'))!;
    expect(hands).toContain('z4 z4 z4 z4');
  });

  it('hoists decorations outside chord brackets', () => {
    const abc = grooveToAbc(
      parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|X---------------|&S=|O---------------|'),
    );
    expect(abc).toContain('!accent![gc]');
    expect(abc).not.toMatch(/\[[^\]]*!accent![^\]]*\]/);
  });

  it('emits (3 tuplet groups for triplet divisions', () => {
    const abc = grooveToAbc(
      parseUrl('?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|xxxxxxxxxxxx|'),
    );
    const hands = abc.split('\n').find((l) => l.startsWith('[V:1]'))!;
    expect(hands).toContain('(3ggg');
  });

  it('uses extended tuplet syntax when triplet durations merge', () => {
    // one hit on the first cell of a triplet group, next on the third
    const abc = grooveToAbc(
      parseUrl('?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|x-x---------|'),
    );
    const hands = abc.split('\n').find((l) => l.startsWith('[V:1]'))!;
    expect(hands).toContain('(3:2:2g2g');
  });

  it('voices hi/mid/floor toms at e/d/A with the mid tom on the D line', () => {
    const abc = grooveToAbc(
      parseUrl(
        '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&T1=|o---------------|&T2=|----o-----------|&T4=|--------o-------|',
      ),
    );
    const hands = abc.split('\n').find((l) => l.startsWith('[V:1]'))!;
    // hi = top space, mid = ON the D line, floor = second space from bottom
    expect(hands).toContain('e4');
    expect(hands).toContain('d4');
    expect(hands).toContain('A4');
    expect(abc).toContain('%%percmap d hi-mid-tom');
    expect(abc).toContain('%%percmap A low-floor-tom');
  });

  it('renders flams as grace notes and cross-stick on its own position', () => {
    const abc = grooveToAbc(
      parseUrl('?TimeSig=4/4&Div=16&Tempo=80&Measures=1&S=|f---x-----------|'),
    );
    expect(abc).toContain('{/c}!accent!c');
    expect(abc).toContain('B'); // cross-stick pitch
  });

  it('separates measures with barlines and ends with |]', () => {
    const abc = grooveToAbc(
      parseUrl('?TimeSig=4/4&Div=8&Tempo=80&Measures=2&K=|o-------|o-------|'),
    );
    const feet = abc.split('\n').find((l) => l.startsWith('[V:2]'))!;
    expect(feet).toContain(' | ');
    expect(feet.trimEnd().endsWith('|]')).toBe(true);
  });
});
