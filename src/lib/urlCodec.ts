/**
 * URL codec — the contract the whole app depends on.
 *
 * Implements the GrooveScribe query-string format exactly, for link
 * compatibility:
 *
 *   ?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=…&K=…
 *
 * Rules implemented here:
 *  - Parameter names are case-insensitive.
 *  - Lane tab strings are read one char per grid slot; `|` and spaces are
 *    skipped; `-` is a rest. The char→hit maps are context-sensitive per lane.
 *  - `+` in a lane string is a real character (closed hi-hat), NOT a space —
 *    so we hand-roll parsing instead of using URLSearchParams (which applies
 *    the form-encoding `+`→space rule).
 *  - Validation clamps: TimeSig top 1–32 / bottom ∈ {2,4,8,16}, Tempo 20–400,
 *    Measures 1–100, Swing 0–100, Div ∈ {8,12,16,24,32,48}.
 *  - Optional params (Swing, MetronomeFreq, Title/Author/Comments, toms) are
 *    only written when non-default, keeping URLs short.
 */

import {
  ALLOWED_BOTTOMS,
  ALLOWED_DIVS,
  ALLOWED_METRONOME_FREQS,
  Cell,
  createEmptyGroove,
  DEFAULT_TEMPO,
  GrooveData,
  HIHAT_CHAR_TO_HIT,
  HIHAT_HIT_TO_CHAR,
  KICK_CHAR_TO_HIT,
  KICK_HIT_TO_CHAR,
  MAX_MEASURES,
  SNARE_CHAR_TO_HIT,
  SNARE_HIT_TO_CHAR,
  TimeSig,
  TOM_CHAR_TO_HIT,
  TOM_HIT_TO_CHAR,
  cellsPerMeasure,
  emptyLane,
  totalCells,
} from './grooveData';

/** Split a query string into a map of lowercased-name → raw (undecoded) value. */
function rawQueryParams(search: string): Map<string, string> {
  const map = new Map<string, string>();
  const q = search.startsWith('?') ? search.slice(1) : search;
  if (!q) return map;
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (!map.has(key)) map.set(key, value);
  }
  return map;
}

/** Decode a metadata value: form-style `+`→space, then percent-decoding. */
function decodeMeta(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/** Decode a lane value: percent-decoding only — `+` stays a literal char. */
function decodeLane(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseTimeSigString(raw: string | undefined): TimeSig {
  const fallback: TimeSig = { top: 4, bottom: 4 };
  if (!raw) return fallback;
  const m = /^(\d+)\/(\d+)$/.exec(decodeLane(raw).trim());
  if (!m) return fallback;
  let top = parseInt(m[1], 10);
  let bottom = parseInt(m[2], 10);
  if (!(top >= 1 && top <= 32)) top = 4;
  if (!(ALLOWED_BOTTOMS as readonly number[]).includes(bottom)) bottom = 4;
  return { top, bottom };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Expand an ASCII tab string into a lane array of `cellCount` cells.
 * Skips `|` and spaces; `-` is a rest; unknown chars are treated as rests.
 */
export function parseTabString<H>(
  tab: string,
  cellCount: number,
  charToHit: Record<string, H>,
): Cell<H>[] {
  const lane = emptyLane<H>(cellCount);
  let i = 0;
  for (const ch of tab) {
    if (ch === '|' || ch === ' ') continue;
    if (i >= cellCount) break;
    if (ch !== '-') {
      const hit = charToHit[ch];
      if (hit !== undefined) lane[i] = hit;
    }
    i++;
  }
  return lane;
}

/** Serialize a lane back to a `|…|`-delimited tab string, one bar per segment. */
export function laneToTabString<H extends string>(
  lane: Cell<H>[],
  perMeasure: number,
  hitToChar: Record<H, string>,
): string {
  const chars = lane.map((cell) => (cell === null ? '-' : hitToChar[cell] ?? '-'));
  const bars: string[] = [];
  for (let i = 0; i < chars.length; i += perMeasure) {
    bars.push(chars.slice(i, i + perMeasure).join(''));
  }
  return '|' + bars.join('|') + '|';
}

export function laneHasHits<H>(lane: Cell<H>[]): boolean {
  return lane.some((c) => c !== null);
}

export function parseUrl(search: string): GrooveData {
  const params = rawQueryParams(search);

  const timeSig = parseTimeSigString(params.get('timesig'));

  let div = parseIntOr(params.get('div'), 16);
  if (!(ALLOWED_DIVS as readonly number[]).includes(div)) div = 16;

  let tempo = parseIntOr(params.get('tempo'), DEFAULT_TEMPO);
  if (tempo < 20 || tempo > 400) tempo = DEFAULT_TEMPO;

  let measures = parseIntOr(params.get('measures'), 1);
  measures = Math.min(MAX_MEASURES, Math.max(1, measures));

  let swing = parseIntOr(params.get('swing'), 0);
  swing = Math.min(100, Math.max(0, swing));

  let metronomeFreq = parseIntOr(params.get('metronomefreq'), 0);
  if (!(ALLOWED_METRONOME_FREQS as readonly number[]).includes(metronomeFreq)) {
    metronomeFreq = 0;
  }

  const groove = createEmptyGroove({ timeSig, div, tempo, measures, swing, metronomeFreq });
  groove.title = decodeMeta(params.get('title'));
  groove.author = decodeMeta(params.get('author'));
  groove.comments = decodeMeta(params.get('comments'));

  const n = totalCells(groove);
  groove.hihat = parseTabString(decodeLane(params.get('h')), n, HIHAT_CHAR_TO_HIT);
  groove.snare = parseTabString(decodeLane(params.get('s')), n, SNARE_CHAR_TO_HIT);
  groove.kick = parseTabString(decodeLane(params.get('k')), n, KICK_CHAR_TO_HIT);
  groove.toms = [
    parseTabString(decodeLane(params.get('t1')), n, TOM_CHAR_TO_HIT),
    parseTabString(decodeLane(params.get('t2')), n, TOM_CHAR_TO_HIT),
    parseTabString(decodeLane(params.get('t3')), n, TOM_CHAR_TO_HIT),
    parseTabString(decodeLane(params.get('t4')), n, TOM_CHAR_TO_HIT),
  ];

  return groove;
}

export function toUrl(g: GrooveData): string {
  const perMeasure = cellsPerMeasure(g.timeSig, g.div);
  const parts: string[] = [];

  parts.push(`TimeSig=${g.timeSig.top}/${g.timeSig.bottom}`);
  parts.push(`Div=${g.div}`);
  if (g.title) parts.push(`Title=${encodeURIComponent(g.title)}`);
  if (g.author) parts.push(`Author=${encodeURIComponent(g.author)}`);
  if (g.comments) parts.push(`Comments=${encodeURIComponent(g.comments)}`);
  parts.push(`Tempo=${g.tempo}`);
  if (g.swing > 0) parts.push(`Swing=${g.swing}`);
  parts.push(`Measures=${g.measures}`);
  if (g.metronomeFreq !== 0) parts.push(`MetronomeFreq=${g.metronomeFreq}`);
  parts.push(`H=${laneToTabString(g.hihat, perMeasure, HIHAT_HIT_TO_CHAR)}`);
  parts.push(`S=${laneToTabString(g.snare, perMeasure, SNARE_HIT_TO_CHAR)}`);
  parts.push(`K=${laneToTabString(g.kick, perMeasure, KICK_HIT_TO_CHAR)}`);
  g.toms.forEach((lane, i) => {
    if (laneHasHits(lane)) {
      parts.push(`T${i + 1}=${laneToTabString(lane, perMeasure, TOM_HIT_TO_CHAR)}`);
    }
  });

  return '?' + parts.join('&');
}
