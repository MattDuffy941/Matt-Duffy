/**
 * Sample-based drum kits — real one-shot recordings loaded over the network
 * and decoded into AudioBuffers, layered on top of the procedural synth so any
 * voice a kit doesn't provide still sounds (via the synth fallback).
 *
 * The bundled "TR-808" kit is Creative Commons Zero (public domain) — see
 * public/samples/tr808/CREDITS.txt. No attribution required.
 */

import { DrumKit, SoundName } from './drumSynth';

export interface KitDef {
  id: string;
  label: string;
  base: string;
  /** Voices with their own sample file. */
  files: Partial<Record<SoundName, string>>;
  /** Voices that reuse another voice's buffer (e.g. ghost snare = snare). */
  aliases: Partial<Record<SoundName, SoundName>>;
}

const BASE = import.meta.env.BASE_URL;

export const SAMPLE_KITS: Record<string, KitDef> = {
  acoustic: {
    id: 'acoustic',
    label: 'Acoustic (CC0)',
    base: `${BASE}samples/acoustic/`,
    files: {
      kick: 'kick.wav',
      snare: 'snare.wav',
      hihatClosed: 'hihatClosed.wav',
      hihatOpen: 'hihatOpen.wav',
      hihatFoot: 'hihatFoot.wav',
      crash: 'crash.wav',
      tom1: 'tom1.wav',
      tom2: 'tom2.wav',
    },
    aliases: {
      snareGhost: 'snare',
      stacker: 'crash',
      // VCSL provides two toms — the lower one covers low & floor toms
      tom3: 'tom2',
      tom4: 'tom2',
      // ride, rideBell, cowbell, cross-stick and the metronome click fall back
      // to the synth (VCSL has no dedicated ride/cross-stick).
    },
  },
  tr808: {
    id: 'tr808',
    label: 'TR-808 (CC0)',
    base: `${BASE}samples/tr808/`,
    files: {
      kick: 'kick.wav',
      snare: 'snare.wav',
      xstick: 'xstick.wav',
      hihatClosed: 'hihatClosed.wav',
      hihatOpen: 'hihatOpen.wav',
      cowbell: 'cowbell.wav',
      tom1: 'tom1.wav',
      tom2: 'tom2.wav',
      tom3: 'tom3.wav',
      tom4: 'tom4.wav',
      ride: 'cymbal.wav',
      metronome: 'click.wav',
    },
    aliases: {
      snareGhost: 'snare',
      hihatFoot: 'hihatClosed',
      // the 808 has a single cymbal — share it across ride/bell/crash/stacker
      rideBell: 'ride',
      crash: 'ride',
      stacker: 'ride',
      metronomeAccent: 'metronome',
    },
  },
};

/** Kit choices for the UI, synth first (the zero-latency default). */
export const KIT_OPTIONS: { id: string; label: string }[] = [
  { id: 'synth', label: 'Classic (synth)' },
  ...Object.values(SAMPLE_KITS).map((k) => ({ id: k.id, label: k.label })),
];

/**
 * Build a DrumKit for `def` by loading its samples, starting from the synth
 * kit so any un-sampled voice keeps a sound. Failed loads keep the fallback.
 */
export async function loadSampleKit(
  ctx: BaseAudioContext,
  def: KitDef,
  fallback: DrumKit,
): Promise<DrumKit> {
  const kit: DrumKit = { ...fallback };

  const entries = Object.entries(def.files) as [SoundName, string][];
  await Promise.all(
    entries.map(async ([voice, file]) => {
      try {
        const res = await fetch(def.base + file);
        if (!res.ok) return;
        const bytes = await res.arrayBuffer();
        kit[voice] = await ctx.decodeAudioData(bytes);
      } catch {
        /* keep the synth fallback for this voice */
      }
    }),
  );

  for (const [voice, src] of Object.entries(def.aliases) as [SoundName, SoundName][]) {
    if (kit[src]) kit[voice] = kit[src];
  }

  return kit;
}
