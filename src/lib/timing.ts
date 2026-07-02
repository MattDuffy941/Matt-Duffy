/**
 * Pure timing math for the sequencer — kept free of Web Audio so it can be
 * unit-tested. All positions are expressed in beats (one beat = 1/bottom note)
 * and converted to seconds with the tempo at the call site.
 */

import { GrooveData, cellsPerBeat, isTripletDiv, totalCells } from './grooveData';

/**
 * Musical position of a grid cell, in beats from the start of the groove.
 *
 * Swing (straight divisions only): the off-beat cell of each consecutive
 * cell pair is delayed toward the triplet position. At 100% swing a pair
 * plays as the first and third notes of a triplet:
 *   delay = swing% × (cellDuration / 3)
 */
export function cellOffsetBeats(g: GrooveData, cellIndex: number): number {
  const cpb = cellsPerBeat(g.timeSig, g.div);
  const cellDurBeats = 1 / cpb;
  let beats = cellIndex * cellDurBeats;
  if (!isTripletDiv(g.div) && g.swing > 0 && cellIndex % 2 === 1) {
    beats += (g.swing / 100) * (cellDurBeats / 3);
  }
  return beats;
}

/** Duration of one full pass through the groove, in beats. */
export function loopBeats(g: GrooveData): number {
  return totalCells(g) / cellsPerBeat(g.timeSig, g.div);
}

export function secondsPerBeat(tempo: number): number {
  return 60 / tempo;
}

/** Absolute time of a cell within loop `loopIndex`, in seconds from groove start. */
export function cellTimeSeconds(g: GrooveData, cellIndex: number, loopIndex: number): number {
  const spb = secondsPerBeat(g.tempo);
  return (loopIndex * loopBeats(g) + cellOffsetBeats(g, cellIndex)) * spb;
}

/**
 * Metronome click positions for one measure, in beats, with accent flags.
 * freq 4 = one click per beat; 8 = two per beat; 16 = four per beat.
 * (In compound signatures this yields e.g. dotted-quarter pulses for 6/8.)
 */
export function metronomeClicksPerMeasure(
  g: GrooveData,
): { offsetBeats: number; accent: boolean }[] {
  if (g.metronomeFreq === 0) return [];
  const measureBeats = g.timeSig.top;
  const clickSpacingBeats = g.timeSig.bottom / g.metronomeFreq;
  const clicks: { offsetBeats: number; accent: boolean }[] = [];
  for (let b = 0; b < measureBeats - 1e-9; b += clickSpacingBeats) {
    clicks.push({ offsetBeats: b, accent: b === 0 });
  }
  return clicks;
}
