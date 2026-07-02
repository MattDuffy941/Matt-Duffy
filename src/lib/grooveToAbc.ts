/**
 * grooveToAbc — translate the grid into ABC notation for rendering with abcjs.
 *
 * Approach (standard drum-notation conventions):
 *  - One percussion staff, two voices: Hands (stems up) and Feet (stems down).
 *  - Instruments get fixed staff positions; cymbals/hi-hat/cross-stick get
 *    X (or triangle) noteheads via `%%percmap`.
 *  - Durations come from look-ahead within each beam group: a hit "lasts"
 *    until the next event in its voice or the end of the group, so a hi-hat
 *    pattern of 8ths on a 16th grid renders as real 8th notes, not
 *    8th+rest pairs.
 *  - Simultaneous hits become chords `[gc]`; decorations and grace notes are
 *    hoisted outside the chord bracket (they misrender inside).
 *  - Triplet divisions emit tuplet groups `(3` (or `(3:2:n` when merged
 *    durations leave fewer than three elements).
 */

import {
  Cell,
  GrooveData,
  HihatHit,
  KickHit,
  SnareHit,
  cellsPerBeat,
  cellsPerMeasure,
  isTripletDiv,
} from './grooveData';

/** Staff positions (written pitches) per instrument. */
const PITCH = {
  hihat: 'g', // above the top line
  crash: 'a',
  ride: 'f', // top line
  rideBell: 'b',
  stacker: "c'",
  cowbell: "d'",
  metronome: "e'",
  snare: 'c', // third space
  xstick: 'B', // middle line, x head
  // Tom ladder: hi = top space, mid = ON the second line down (half above,
  // half below the D line), floor (T4) = second space from the bottom.
  // T3 has no grid row but stays URL-compatible; it renders on the G line.
  toms: ['e', 'd', 'G', 'A'],
  kick: 'F', // first space
  splash: 'D', // below the staff, x head (hi-hat with foot)
} as const;

const PERCMAP_LINES = [
  `%%percmap ${PITCH.kick} acoustic-bass-drum`,
  `%%percmap ${PITCH.splash} pedal-hi-hat x`,
  `%%percmap ${PITCH.snare} acoustic-snare`,
  `%%percmap ${PITCH.xstick} side-stick x`,
  `%%percmap ${PITCH.hihat} closed-hi-hat x`,
  `%%percmap ${PITCH.crash} crash-cymbal-1 x`,
  `%%percmap ${PITCH.ride} ride-cymbal-1 x`,
  `%%percmap ${PITCH.rideBell} ride-bell triangle`,
  `%%percmap ${PITCH.stacker} splash-cymbal x`,
  `%%percmap ${PITCH.cowbell} cowbell triangle`,
  `%%percmap ${PITCH.metronome} claves x`,
  `%%percmap ${PITCH.toms[0]} high-tom`,
  `%%percmap ${PITCH.toms[1]} hi-mid-tom`,
  `%%percmap ${PITCH.toms[2]} low-tom`,
  `%%percmap ${PITCH.toms[3]} low-floor-tom`,
];

/** A single cell's content in one voice, before durations are assigned. */
interface CellNote {
  graces: string;
  decos: string[];
  pitches: string[];
}

function hihatCellNote(hit: HihatHit): CellNote {
  const base: CellNote = { graces: '', decos: [], pitches: [PITCH.hihat] };
  switch (hit) {
    case 'normal':
      return base;
    case 'accent':
      return { ...base, decos: ['!accent!'] };
    case 'open':
      return { ...base, decos: ['!open!'] };
    case 'close':
      return { ...base, decos: ['!plus!'] };
    case 'ride':
      return { graces: '', decos: [], pitches: [PITCH.ride] };
    case 'rideBell':
      return { graces: '', decos: [], pitches: [PITCH.rideBell] };
    case 'crash':
      return { graces: '', decos: [], pitches: [PITCH.crash] };
    case 'stacker':
      return { graces: '', decos: [], pitches: [PITCH.stacker] };
    case 'cowbell':
      return { graces: '', decos: [], pitches: [PITCH.cowbell] };
    case 'metronomeNormal':
      return { graces: '', decos: [], pitches: [PITCH.metronome] };
    case 'metronomeAccent':
      return { graces: '', decos: ['!accent!'], pitches: [PITCH.metronome] };
  }
}

function snareCellNote(hit: SnareHit): CellNote {
  const c = PITCH.snare;
  switch (hit) {
    case 'normal':
      return { graces: '', decos: [], pitches: [c] };
    case 'accent':
      return { graces: '', decos: ['!accent!'], pitches: [c] };
    case 'ghost':
      // Rendered as a plain (quiet) note: abcjs has no ghost-paren decoration.
      return { graces: '', decos: [], pitches: [c] };
    case 'xstick':
      return { graces: '', decos: [], pitches: [PITCH.xstick] };
    case 'flam':
      return { graces: `{/${c}}`, decos: ['!accent!'], pitches: [c] };
    case 'drag':
      return { graces: `{/${c}${c}}`, decos: [], pitches: [c] };
    case 'buzz':
      return { graces: '', decos: ['!///!'], pitches: [c] };
  }
}

function kickCellNote(hit: KickHit): CellNote {
  switch (hit) {
    case 'normal':
      return { graces: '', decos: [], pitches: [PITCH.kick] };
    case 'splash':
      return { graces: '', decos: [], pitches: [PITCH.splash] };
    case 'kickAndSplash':
      return { graces: '', decos: [], pitches: [PITCH.kick, PITCH.splash] };
  }
}

function mergeCellNotes(notes: CellNote[]): CellNote | null {
  if (notes.length === 0) return null;
  return {
    graces: notes.map((n) => n.graces).join(''),
    decos: [...new Set(notes.flatMap((n) => n.decos))],
    pitches: notes.flatMap((n) => n.pitches),
  };
}

/** Hands-voice content for a cell: hi-hat + snare + toms. */
function handsCell(g: GrooveData, i: number): CellNote | null {
  const notes: CellNote[] = [];
  const hh = g.hihat[i];
  if (hh) notes.push(hihatCellNote(hh));
  const sn = g.snare[i];
  if (sn) notes.push(snareCellNote(sn));
  g.toms.forEach((lane, t) => {
    const hit: Cell<'normal'> = lane[i] ?? null;
    if (hit) notes.push({ graces: '', decos: [], pitches: [PITCH.toms[t]] });
  });
  return mergeCellNotes(notes);
}

/** Feet-voice content for a cell: kick / foot splash. */
function feetCell(g: GrooveData, i: number): CellNote | null {
  const k = g.kick[i];
  return k ? kickCellNote(k) : null;
}

function formatNote(note: CellNote, dur: number): string {
  const durStr = dur > 1 ? String(dur) : '';
  const pitchPart =
    note.pitches.length > 1 ? `[${note.pitches.join('')}]` : note.pitches[0];
  return note.graces + note.decos.join('') + pitchPart + durStr;
}

/**
 * Emit one beam group with look-ahead durations. Returns ABC with no spaces
 * inside (so abcjs beams the group together).
 */
function emitGroup(cells: (CellNote | null)[], triplet: boolean): string {
  interface Element {
    text: string;
    span: number;
    isNote: boolean;
  }
  const elements: Element[] = [];
  let i = 0;
  while (i < cells.length) {
    let j = i + 1;
    while (j < cells.length && cells[j] === null) j++;
    const span = j - i;
    const cell = cells[i];
    if (cell !== null) {
      elements.push({ text: formatNote(cell, span), span, isNote: true });
    } else {
      elements.push({ text: 'z' + (span > 1 ? span : ''), span, isNote: false });
    }
    i = j;
  }

  if (!triplet) {
    return elements.map((e) => e.text).join('');
  }

  // Triplet group of 3 cells: written unit is half a group (3 written units
  // sound as 2), so a group collapsed to a single element is written with
  // duration 2 and needs no tuplet marker.
  if (elements.length === 1) {
    const e = elements[0];
    const cell = cells[0];
    return e.isNote && cell !== null ? formatNote(cell, 2) : 'z2';
  }
  const prefix = elements.length === 3 ? '(3' : `(3:2:${elements.length}`;
  return prefix + elements.map((e) => e.text).join('');
}

function emitVoiceMeasure(
  g: GrooveData,
  cellForVoice: (g: GrooveData, i: number) => CellNote | null,
  measureIndex: number,
): string {
  const perMeasure = cellsPerMeasure(g.timeSig, g.div);
  const triplet = isTripletDiv(g.div);
  const groupSize = triplet ? 3 : cellsPerBeat(g.timeSig, g.div);
  const start = measureIndex * perMeasure;
  const groups: string[] = [];
  for (let gStart = 0; gStart < perMeasure; gStart += groupSize) {
    const cells: (CellNote | null)[] = [];
    for (let k = 0; k < groupSize && gStart + k < perMeasure; k++) {
      cells.push(cellForVoice(g, start + gStart + k));
    }
    groups.push(emitGroup(cells, triplet));
  }
  return groups.join(' ');
}

const MEASURES_PER_LINE = 2;

export function grooveToAbc(g: GrooveData): string {
  const triplet = isTripletDiv(g.div);
  // Straight: one cell = 1/div note. Triplet: written unit = 3/(2·div).
  const unitDenom = triplet ? Math.round((2 * g.div) / 3) : g.div;

  const lines: string[] = [
    'X:1',
    ...(g.title ? [`T:${g.title}`] : []),
    ...(g.author ? [`C:${g.author}`] : []),
    `M:${g.timeSig.top}/${g.timeSig.bottom}`,
    `L:1/${unitDenom}`,
    '%%score (1 2)',
    ...PERCMAP_LINES,
    'K:C clef=perc',
    'V:1 stem=up',
    'V:2 stem=down',
  ];

  for (let m0 = 0; m0 < g.measures; m0 += MEASURES_PER_LINE) {
    const mEnd = Math.min(g.measures, m0 + MEASURES_PER_LINE);
    const hands: string[] = [];
    const feet: string[] = [];
    for (let m = m0; m < mEnd; m++) {
      hands.push(emitVoiceMeasure(g, handsCell, m));
      feet.push(emitVoiceMeasure(g, feetCell, m));
    }
    const isLast = mEnd === g.measures;
    const barEnd = isLast ? ' |]' : ' |';
    lines.push('[V:1] ' + hands.join(' | ') + barEnd);
    lines.push('[V:2] ' + feet.join(' | ') + barEnd);
  }

  return lines.join('\n');
}
