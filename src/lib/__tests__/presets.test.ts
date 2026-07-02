import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets';
import { parseUrl, toUrl } from '../urlCodec';
import { totalCells } from '../grooveData';

describe('presets', () => {
  it('every preset query is canonical (round-trips unchanged)', () => {
    for (const p of PRESETS) {
      expect(toUrl(parseUrl(p.query)), p.name).toBe(p.query);
    }
  });

  it('every preset parses to a groove with correctly sized lanes', () => {
    for (const p of PRESETS) {
      const g = parseUrl(p.query);
      const n = totalCells(g);
      expect(g.hihat, p.name).toHaveLength(n);
      expect(g.snare, p.name).toHaveLength(n);
      expect(g.kick, p.name).toHaveLength(n);
      expect(g.tempo, p.name).toBeGreaterThanOrEqual(20);
    }
  });

  it('non-blank presets actually contain hits', () => {
    for (const p of PRESETS) {
      if (p.name.startsWith('Blank')) continue;
      const g = parseUrl(p.query);
      const hits = [...g.hihat, ...g.snare, ...g.kick].filter(Boolean).length;
      expect(hits, p.name).toBeGreaterThan(0);
    }
  });
});
