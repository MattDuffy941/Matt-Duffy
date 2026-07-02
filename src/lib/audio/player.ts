/**
 * GroovePlayer — sample-accurate playback via the "Two Clocks" pattern.
 *
 * A sloppy setTimeout loop (~25 ms) wakes up and schedules every hit landing
 * within the next ~120 ms against AudioContext.currentTime, which is
 * drift-free and runs on the audio thread. The JS timer only has to stay
 * ahead of the window; the audio clock makes the hits tight.
 *
 * The player reads the (mutable) groove reference at schedule time, so cell
 * edits, tempo and swing changes take effect immediately without restarting.
 *
 * Practice features:
 *  - Count-in: one measure of clicks before the groove starts.
 *  - Auto speed-up: tempo rises by N BPM each loop (capped at 400). Loop
 *    start times are accumulated incrementally per loop, so the ramp never
 *    drifts; within a loop the tempo is constant.
 */

import { GrooveData, HihatHit, KickHit, SnareHit, totalCells } from '../grooveData';
import { cellOffsetBeats, loopBeats, metronomeClicksPerMeasure, secondsPerBeat } from '../timing';
import { DrumKit, SoundName, buildDrumKit } from './drumSynth';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;
const MAX_TEMPO = 400;

const VELOCITY = { accent: 1.0, normal: 0.7, ghost: 0.25 } as const;

export interface PlayOptions {
  countIn?: boolean;
  /** BPM added each time the loop wraps (0 = constant tempo). */
  rampBpmPerLoop?: number;
}

interface ScheduledSound {
  name: SoundName;
  gain: number;
}

function hihatSounds(hit: HihatHit): ScheduledSound[] {
  switch (hit) {
    case 'normal':
      return [{ name: 'hihatClosed', gain: VELOCITY.normal }];
    case 'accent':
      return [{ name: 'hihatClosed', gain: VELOCITY.accent }];
    case 'open':
      return [{ name: 'hihatOpen', gain: VELOCITY.normal }];
    case 'close':
      return [{ name: 'hihatFoot', gain: VELOCITY.normal }];
    case 'ride':
      return [{ name: 'ride', gain: VELOCITY.normal }];
    case 'rideBell':
      return [{ name: 'rideBell', gain: VELOCITY.normal }];
    case 'crash':
      return [{ name: 'crash', gain: VELOCITY.normal }];
    case 'stacker':
      return [{ name: 'stacker', gain: VELOCITY.normal }];
    case 'cowbell':
      return [{ name: 'cowbell', gain: VELOCITY.normal }];
    case 'metronomeNormal':
      return [{ name: 'metronome', gain: VELOCITY.normal }];
    case 'metronomeAccent':
      return [{ name: 'metronomeAccent', gain: VELOCITY.accent }];
  }
}

function snareSounds(hit: SnareHit): ScheduledSound[] {
  switch (hit) {
    case 'normal':
      return [{ name: 'snare', gain: VELOCITY.normal }];
    case 'accent':
      return [{ name: 'snare', gain: VELOCITY.accent }];
    case 'ghost':
      return [{ name: 'snareGhost', gain: VELOCITY.ghost }];
    case 'xstick':
      return [{ name: 'xstick', gain: VELOCITY.normal }];
    case 'flam':
      return [{ name: 'snare', gain: VELOCITY.accent }];
    case 'drag':
      return [{ name: 'snare', gain: VELOCITY.normal }];
    case 'buzz':
      return [{ name: 'snare', gain: VELOCITY.normal }];
  }
}

function kickSounds(hit: KickHit): ScheduledSound[] {
  switch (hit) {
    case 'normal':
      return [{ name: 'kick', gain: VELOCITY.accent }];
    case 'splash':
      return [{ name: 'hihatFoot', gain: VELOCITY.normal }];
    case 'kickAndSplash':
      return [
        { name: 'kick', gain: VELOCITY.accent },
        { name: 'hihatFoot', gain: VELOCITY.normal },
      ];
  }
}

const FLAM_GRACE_OFFSET_S = 0.028;
const DRAG_GRACE_OFFSET_S = 0.045;

export class GroovePlayer {
  private ctx: AudioContext | null = null;
  private kit: DrumKit | null = null;
  private master: GainNode | null = null;

  private groove: GrooveData | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private highlightTimers = new Set<ReturnType<typeof setTimeout>>();

  private ramp = 0;
  private grooveTempo = 120; // tempo of the loop the groove walker is in
  private clickTempo = 120; // tempo of the loop the metronome walker is in

  private loopStartTime = 0; // ctx time the current groove loop began
  private nextCell = 0;
  private clickLoopStartTime = 0;
  private nextClick = 0;

  playing = false;

  /** Fires (from a timer, close to audibly on-time) as each cell plays. */
  onStep: ((cell: number) => void) | null = null;
  /** Fires when auto speed-up raises the tempo at a loop boundary. */
  onTempoChange: ((bpm: number) => void) | null = null;

  /** Must be called from a user gesture (autoplay policy). */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.kit = buildDrumKit(this.ctx);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private playSound(name: SoundName, when: number, gain: number): void {
    if (!this.ctx || !this.kit || !this.master) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.kit[name];
    const g = this.ctx.createGain();
    g.gain.value = gain;
    source.connect(g);
    g.connect(this.master);
    source.start(Math.max(when, this.ctx.currentTime));
  }

  /** Audition a single cell immediately (grid click feedback). */
  preview(sounds: { hihat?: HihatHit; snare?: SnareHit; kick?: KickHit; tom?: 1 | 2 | 3 | 4 }): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    if (sounds.hihat) for (const s of hihatSounds(sounds.hihat)) this.playSound(s.name, now, s.gain);
    if (sounds.snare) for (const s of snareSounds(sounds.snare)) this.playSound(s.name, now, s.gain);
    if (sounds.kick) for (const s of kickSounds(sounds.kick)) this.playSound(s.name, now, s.gain);
    if (sounds.tom) this.playSound(`tom${sounds.tom}` as SoundName, now, VELOCITY.normal);
  }

  start(groove: GrooveData, opts: PlayOptions = {}): void {
    this.stop();
    const ctx = this.ensureContext();
    this.groove = groove;
    this.ramp = opts.rampBpmPerLoop ?? 0;
    this.grooveTempo = groove.tempo;
    this.clickTempo = groove.tempo;

    const startTime = ctx.currentTime + 0.08;
    let grooveStart = startTime;
    if (opts.countIn) {
      const spb = secondsPerBeat(this.grooveTempo);
      const beats = groove.timeSig.top;
      for (let b = 0; b < beats; b++) {
        this.playSound(b === 0 ? 'metronomeAccent' : 'metronome', startTime + b * spb, 0.9);
      }
      grooveStart = startTime + beats * spb;
    }

    this.loopStartTime = grooveStart;
    this.clickLoopStartTime = grooveStart;
    this.nextCell = 0;
    this.nextClick = 0;
    this.playing = true;
    this.timerId = setInterval(this.scheduleLoop, LOOKAHEAD_MS);
    this.scheduleLoop();
  }

  /** Swap in an edited groove while playing (same grid size keeps position). */
  updateGroove(groove: GrooveData): void {
    if (!this.playing || !this.groove) {
      this.groove = groove;
      return;
    }
    const sameGrid = totalCells(groove) === totalCells(this.groove);
    const tempoChanged = groove.tempo !== this.groove.tempo;
    this.groove = groove;
    if (!sameGrid) {
      this.start(groove, { rampBpmPerLoop: this.ramp });
      return;
    }
    if (tempoChanged) {
      // manual tempo edit resets the ramp baseline
      this.grooveTempo = groove.tempo;
      this.clickTempo = groove.tempo;
    }
  }

  stop(): void {
    this.playing = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    for (const t of this.highlightTimers) clearTimeout(t);
    this.highlightTimers.clear();
  }

  private scheduleCellSounds(g: GrooveData, cell: number, when: number): void {
    const hh = g.hihat[cell];
    if (hh) for (const s of hihatSounds(hh)) this.playSound(s.name, when, s.gain);

    const sn = g.snare[cell];
    if (sn) {
      for (const s of snareSounds(sn)) this.playSound(s.name, when, s.gain);
      if (sn === 'flam') {
        this.playSound('snareGhost', when - FLAM_GRACE_OFFSET_S, VELOCITY.ghost);
      } else if (sn === 'drag') {
        this.playSound('snareGhost', when - DRAG_GRACE_OFFSET_S, VELOCITY.ghost);
        this.playSound('snareGhost', when - DRAG_GRACE_OFFSET_S / 2, VELOCITY.ghost);
      } else if (sn === 'buzz') {
        for (let b = 1; b <= 3; b++) {
          this.playSound('snareGhost', when + b * 0.016, VELOCITY.ghost);
        }
      }
    }

    const k = g.kick[cell];
    if (k) for (const s of kickSounds(k)) this.playSound(s.name, when, s.gain);

    g.toms.forEach((lane, t) => {
      if (lane[cell]) {
        this.playSound(`tom${t + 1}` as SoundName, when, VELOCITY.normal);
      }
    });
  }

  private nextRampedTempo(tempo: number): number {
    return Math.min(MAX_TEMPO, tempo + this.ramp);
  }

  private scheduleLoop = (): void => {
    const ctx = this.ctx;
    const g = this.groove;
    if (!ctx || !g || !this.playing) return;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;
    const n = totalCells(g);
    const loopDurBeats = loopBeats(g);

    // groove cells
    let spb = secondsPerBeat(this.grooveTempo);
    let cellTime = this.loopStartTime + cellOffsetBeats(g, this.nextCell) * spb;
    while (cellTime < horizon) {
      this.scheduleCellSounds(g, this.nextCell, cellTime);
      this.scheduleStepCallback(this.nextCell, cellTime, ctx);
      this.nextCell++;
      if (this.nextCell >= n) {
        this.nextCell = 0;
        this.loopStartTime += loopDurBeats * spb; // completed loop at its own tempo
        if (this.ramp > 0 && this.grooveTempo < MAX_TEMPO) {
          this.grooveTempo = this.nextRampedTempo(this.grooveTempo);
          spb = secondsPerBeat(this.grooveTempo);
          this.onTempoChange?.(this.grooveTempo);
        }
      }
      cellTime = this.loopStartTime + cellOffsetBeats(g, this.nextCell) * spb;
    }

    // metronome clicks (independent stream so it works at any density)
    const clicks = metronomeClicksPerMeasure(g);
    if (clicks.length > 0) {
      const measureBeats = g.timeSig.top;
      const clicksPerLoop = clicks.length * g.measures;
      let clickSpb = secondsPerBeat(this.clickTempo);
      const clickTimeOf = (): number => {
        const measure = Math.floor(this.nextClick / clicks.length);
        const within = clicks[this.nextClick % clicks.length].offsetBeats;
        return this.clickLoopStartTime + (measure * measureBeats + within) * clickSpb;
      };
      let clickTime = clickTimeOf();
      while (clickTime < horizon) {
        const c = clicks[this.nextClick % clicks.length];
        this.playSound(c.accent ? 'metronomeAccent' : 'metronome', clickTime, 0.9);
        this.nextClick++;
        if (this.nextClick >= clicksPerLoop) {
          this.nextClick = 0;
          this.clickLoopStartTime += loopDurBeats * clickSpb;
          if (this.ramp > 0 && this.clickTempo < MAX_TEMPO) {
            this.clickTempo = this.nextRampedTempo(this.clickTempo);
            clickSpb = secondsPerBeat(this.clickTempo);
          }
        }
        clickTime = clickTimeOf();
      }
    }
  };

  private scheduleStepCallback(cell: number, when: number, ctx: AudioContext): void {
    if (!this.onStep) return;
    const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
    const t = setTimeout(() => {
      this.highlightTimers.delete(t);
      if (this.playing) this.onStep?.(cell);
    }, delayMs);
    this.highlightTimers.add(t);
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
