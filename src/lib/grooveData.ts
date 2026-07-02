/**
 * Core data model for a drum groove.
 *
 * The URL is the document: everything in GrooveData round-trips through the
 * query string (see urlCodec.ts). Lanes are flat arrays of cells covering all
 * measures; a cell is `null` (rest) or a lane-specific hit type.
 */

export interface TimeSig {
  top: number;
  bottom: number;
}

export type HihatHit =
  | 'normal'
  | 'accent'
  | 'open'
  | 'close'
  | 'ride'
  | 'rideBell'
  | 'crash'
  | 'stacker'
  | 'cowbell'
  | 'metronomeNormal'
  | 'metronomeAccent';

export type SnareHit =
  | 'normal'
  | 'accent'
  | 'ghost'
  | 'xstick'
  | 'flam'
  | 'drag'
  | 'buzz';

export type KickHit = 'normal' | 'splash' | 'kickAndSplash';

export type TomHit = 'normal';

export type Cell<H> = H | null;

export interface GrooveData {
  timeSig: TimeSig;
  /** Grid resolution: cells per whole note. 16 = 16ths, 12 = 8th triplets… */
  div: number;
  tempo: number;
  measures: number;
  /** Swing percentage 0–100 (straight divisions only). */
  swing: number;
  /** Metronome click density: 0 = off, 4 = quarters, 8 = eighths, 16 = sixteenths. */
  metronomeFreq: number;
  title: string;
  author: string;
  comments: string;
  hihat: Cell<HihatHit>[];
  snare: Cell<SnareHit>[];
  kick: Cell<KickHit>[];
  /** Four tom lanes (T1–T4), each same length as the other lanes. */
  toms: [Cell<TomHit>[], Cell<TomHit>[], Cell<TomHit>[], Cell<TomHit>[]];
}

export const ALLOWED_DIVS = [8, 12, 16, 24, 32, 48] as const;
export const ALLOWED_BOTTOMS = [2, 4, 8, 16] as const;
export const ALLOWED_METRONOME_FREQS = [0, 4, 8, 16] as const;

export const DEFAULT_TEMPO = 80;
export const MAX_MEASURES = 100;

/** Triplet grids are the divisions divisible by 12 (12, 24, 48). */
export function isTripletDiv(div: number): boolean {
  return div % 12 === 0;
}

/** Cells in one measure: div is per-whole-note, so scale by the time signature. */
export function cellsPerMeasure(timeSig: TimeSig, div: number): number {
  return Math.round((div * timeSig.top) / timeSig.bottom);
}

/** Cells per beat (one beat = 1/bottom note). */
export function cellsPerBeat(timeSig: TimeSig, div: number): number {
  return Math.round(div / timeSig.bottom);
}

export function totalCells(g: Pick<GrooveData, 'timeSig' | 'div' | 'measures'>): number {
  return cellsPerMeasure(g.timeSig, g.div) * g.measures;
}

export function emptyLane<H>(length: number): Cell<H>[] {
  return new Array<Cell<H>>(length).fill(null);
}

export function createEmptyGroove(overrides: Partial<GrooveData> = {}): GrooveData {
  const base: GrooveData = {
    timeSig: { top: 4, bottom: 4 },
    div: 16,
    tempo: DEFAULT_TEMPO,
    measures: 1,
    swing: 0,
    metronomeFreq: 0,
    title: '',
    author: '',
    comments: '',
    hihat: [],
    snare: [],
    kick: [],
    toms: [[], [], [], []],
  };
  const merged = { ...base, ...overrides };
  const n = totalCells(merged);
  merged.hihat = overrides.hihat ?? emptyLane(n);
  merged.snare = overrides.snare ?? emptyLane(n);
  merged.kick = overrides.kick ?? emptyLane(n);
  merged.toms = overrides.toms ?? [emptyLane(n), emptyLane(n), emptyLane(n), emptyLane(n)];
  return merged;
}

/**
 * Remap a lane onto a new grid size, preserving musical position as closely
 * as possible (exact for integer up/down-scaling; first-wins on collisions).
 */
export function remapLane<H>(lane: Cell<H>[], newLength: number): Cell<H>[] {
  const out = emptyLane<H>(newLength);
  if (lane.length === 0 || newLength === 0) return out;
  for (let i = 0; i < lane.length; i++) {
    const hit = lane[i];
    if (hit === null) continue;
    const j = Math.floor((i * newLength) / lane.length);
    if (out[j] === null) out[j] = hit;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tab-character maps (the URL contract — context-sensitive per lane) */
/* ------------------------------------------------------------------ */

export const HIHAT_CHAR_TO_HIT: Record<string, HihatHit> = {
  x: 'normal',
  X: 'accent',
  o: 'open',
  '+': 'close',
  r: 'ride',
  R: 'ride',
  b: 'rideBell',
  B: 'rideBell',
  c: 'crash',
  s: 'stacker',
  m: 'cowbell',
  n: 'metronomeNormal',
  N: 'metronomeAccent',
};

export const HIHAT_HIT_TO_CHAR: Record<HihatHit, string> = {
  normal: 'x',
  accent: 'X',
  open: 'o',
  close: '+',
  ride: 'r',
  rideBell: 'b',
  crash: 'c',
  stacker: 's',
  cowbell: 'm',
  metronomeNormal: 'n',
  metronomeAccent: 'N',
};

export const SNARE_CHAR_TO_HIT: Record<string, SnareHit> = {
  o: 'normal',
  O: 'accent',
  g: 'ghost',
  x: 'xstick',
  f: 'flam',
  d: 'drag',
  b: 'buzz',
  B: 'buzz',
};

export const SNARE_HIT_TO_CHAR: Record<SnareHit, string> = {
  normal: 'o',
  accent: 'O',
  ghost: 'g',
  xstick: 'x',
  flam: 'f',
  drag: 'd',
  buzz: 'b',
};

export const KICK_CHAR_TO_HIT: Record<string, KickHit> = {
  o: 'normal',
  x: 'splash',
  X: 'kickAndSplash',
};

export const KICK_HIT_TO_CHAR: Record<KickHit, string> = {
  normal: 'o',
  splash: 'x',
  kickAndSplash: 'X',
};

export const TOM_CHAR_TO_HIT: Record<string, TomHit> = {
  o: 'normal',
  x: 'normal',
};

export const TOM_HIT_TO_CHAR: Record<TomHit, string> = {
  normal: 'o',
};
