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
 */

import { GrooveData, HihatHit, KickHit, SnareHit, totalCells } from '../grooveData';
import { cellOffsetBeats, loopBeats, metronomeClicksPerMeasure, secondsPerBeat } from '../timing';
import { DrumKit, SoundName, buildDrumKit } from './drumSynth';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

const VELOCITY = { accent: 1.0, normal: 0.7, ghost: 0.25 } as const;

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
      // grace + main; the grace is scheduled slightly early by the caller
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

  private startTime = 0; // ctx time of groove start
  private nextCell = 0;
  private loopIndex = 0;
  private nextClick = 0;
  private clickLoopIndex = 0;

  playing = false;

  /** Fires (from a timer, close to audibly on-time) as each cell plays. */
  onStep: ((cell: number) => void) | null = null;

  /** Must be called from a user gesture (autoplay policy). */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.kit = buildDrumKit(this.ctx);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      // a gentle limiter keeps simultaneous hits from clipping
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
  preview(sounds: { hihat?: HihatHit; snare?: SnareHit; kick?: KickHit }): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    if (sounds.hihat) for (const s of hihatSounds(sounds.hihat)) this.playSound(s.name, now, s.gain);
    if (sounds.snare) for (const s of snareSounds(sounds.snare)) this.playSound(s.name, now, s.gain);
    if (sounds.kick) for (const s of kickSounds(sounds.kick)) this.playSound(s.name, now, s.gain);
  }

  start(groove: GrooveData): void {
    this.stop();
    const ctx = this.ensureContext();
    this.groove = groove;
    this.startTime = ctx.currentTime + 0.08;
    this.nextCell = 0;
    this.loopIndex = 0;
    this.nextClick = 0;
    this.clickLoopIndex = 0;
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
    this.groove = groove;
    if (!sameGrid) this.start(groove);
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

  private scheduleLoop = (): void => {
    const ctx = this.ctx;
    const g = this.groove;
    if (!ctx || !g || !this.playing) return;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;
    const spb = secondsPerBeat(g.tempo);
    const n = totalCells(g);
    const loopDurBeats = loopBeats(g);

    // groove cells
    let cellTime =
      this.startTime + (this.loopIndex * loopDurBeats + cellOffsetBeats(g, this.nextCell)) * spb;
    while (cellTime < horizon) {
      this.scheduleCellSounds(g, this.nextCell, cellTime);
      this.scheduleStepCallback(this.nextCell, cellTime, ctx);
      this.nextCell++;
      if (this.nextCell >= n) {
        this.nextCell = 0;
        this.loopIndex++;
      }
      cellTime =
        this.startTime + (this.loopIndex * loopDurBeats + cellOffsetBeats(g, this.nextCell)) * spb;
    }

    // metronome clicks (independent stream so it works at any density)
    const clicks = metronomeClicksPerMeasure(g);
    if (clicks.length > 0) {
      const measureBeats = g.timeSig.top;
      const clicksPerLoop = clicks.length * g.measures;
      let clickTime = this.clickTime(clicks, measureBeats, spb);
      while (clickTime < horizon) {
        const c = clicks[this.nextClick % clicks.length];
        this.playSound(c.accent ? 'metronomeAccent' : 'metronome', clickTime, 0.9);
        this.nextClick++;
        if (this.nextClick >= clicksPerLoop) {
          this.nextClick = 0;
          this.clickLoopIndex++;
        }
        clickTime = this.clickTime(clicks, measureBeats, spb);
      }
    }
  };

  private clickTime(
    clicks: { offsetBeats: number }[],
    measureBeats: number,
    spb: number,
  ): number {
    const g = this.groove!;
    const measure = Math.floor(this.nextClick / clicks.length);
    const within = clicks[this.nextClick % clicks.length].offsetBeats;
    const loopDurBeats = loopBeats(g);
    return (
      this.startTime +
      (this.clickLoopIndex * loopDurBeats + measure * measureBeats + within) * spb
    );
  }

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
