/**
 * Procedurally synthesized drum samples.
 *
 * Each sound is rendered once into an AudioBuffer at startup — no external
 * sample assets, no licensing concerns, instant load. The synthesis is simple
 * subtractive/FM-ish DSP written directly into Float32Arrays.
 */

export type SoundName =
  | 'kick'
  | 'snare'
  | 'snareGhost'
  | 'xstick'
  | 'hihatClosed'
  | 'hihatOpen'
  | 'hihatFoot'
  | 'ride'
  | 'rideBell'
  | 'crash'
  | 'stacker'
  | 'cowbell'
  | 'tom1'
  | 'tom2'
  | 'tom3'
  | 'tom4'
  | 'metronome'
  | 'metronomeAccent';

type Renderer = (sr: number) => Float32Array<ArrayBuffer>;

function samples(sr: number, seconds: number): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(Math.ceil(sr * seconds) * 4));
}

/** Deterministic pseudo-random noise (no Math.random dependency). */
function makeNoise(): () => number {
  let state = 0x2545f491;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state / 0x7fffffff) * 0.9;
  };
}

const TWO_PI = Math.PI * 2;

/** Kick: exponential pitch sweep 150→48 Hz with a fast amp decay and a click. */
const kick: Renderer = (sr) => {
  const out = samples(sr, 0.22);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const freq = 48 + 102 * Math.exp(-t * 28);
    phase += (TWO_PI * freq) / sr;
    const amp = Math.exp(-t * 18);
    const click = t < 0.003 ? (1 - t / 0.003) * 0.4 : 0;
    out[i] = Math.tanh(Math.sin(phase) * 1.6) * amp + click;
  }
  return out;
};

/** Snare: 190 Hz body + high-passed noise burst. */
function snareRenderer(gain: number): Renderer {
  return (sr) => {
    const out = samples(sr, 0.22);
    const noise = makeNoise();
    let prev = 0;
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase += (TWO_PI * 190) / sr;
      const body = Math.sin(phase) * Math.exp(-t * 30) * 0.5;
      const n = noise();
      const hp = n - prev; // crude one-zero high-pass
      prev = n;
      const rattle = hp * Math.exp(-t * 20) * 1.4;
      out[i] = (body + rattle) * gain;
    }
    return out;
  };
}

/** Cross-stick: short bright tick. */
const xstick: Renderer = (sr) => {
  const out = samples(sr, 0.07);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    phase += (TWO_PI * 1650) / sr;
    out[i] = Math.sin(phase) * Math.exp(-t * 90) * 0.8;
  }
  return out;
};

/** Metallic noise burst used for hats/cymbals. */
function metalRenderer(decay: number, level: number, seconds: number): Renderer {
  return (sr) => {
    const out = samples(sr, seconds);
    const noise = makeNoise();
    let prev = 0;
    // a few inharmonic square-ish partials give a metallic sheen
    const partials = [3113, 4211, 5533, 6673, 8231];
    const phases = partials.map(() => 0);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const n = noise();
      const hp = n - prev;
      prev = n;
      let metal = 0;
      for (let p = 0; p < partials.length; p++) {
        phases[p] += (TWO_PI * partials[p]) / sr;
        metal += Math.sign(Math.sin(phases[p]));
      }
      metal /= partials.length;
      out[i] = (hp * 1.1 + metal * 0.25) * Math.exp(-t * decay) * level;
    }
    return out;
  };
}

/** Ride: long metallic wash + a sine ping. */
const ride: Renderer = (sr) => {
  const wash = metalRenderer(6, 0.25, 0.9)(sr);
  let phase = 0;
  for (let i = 0; i < wash.length; i++) {
    const t = i / sr;
    phase += (TWO_PI * 5200) / sr;
    wash[i] += Math.sin(phase) * Math.exp(-t * 9) * 0.12;
  }
  return wash;
};

/** Ride bell: two bright partials, medium decay. */
const rideBell: Renderer = (sr) => {
  const out = samples(sr, 0.45);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    p1 += (TWO_PI * 987) / sr;
    p2 += (TWO_PI * 1974) / sr;
    out[i] = (Math.sin(p1) * 0.5 + Math.sin(p2) * 0.3) * Math.exp(-t * 8);
  }
  return out;
};

/** Cowbell: two detuned square waves. */
const cowbell: Renderer = (sr) => {
  const out = samples(sr, 0.3);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    p1 += (TWO_PI * 560) / sr;
    p2 += (TWO_PI * 845) / sr;
    const sq = Math.sign(Math.sin(p1)) * 0.3 + Math.sign(Math.sin(p2)) * 0.3;
    out[i] = sq * Math.exp(-t * 14);
  }
  return out;
};

/** Tom: pitch sweep sine, pitch per tom. */
function tomRenderer(freq: number): Renderer {
  return (sr) => {
    const out = samples(sr, 0.3);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = freq * (1 + 0.4 * Math.exp(-t * 22));
      phase += (TWO_PI * f) / sr;
      out[i] = Math.tanh(Math.sin(phase) * 1.3) * Math.exp(-t * 13) * 0.9;
    }
    return out;
  };
}

/** Metronome: short sine blip. */
function clickRenderer(freq: number): Renderer {
  return (sr) => {
    const out = samples(sr, 0.05);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase += (TWO_PI * freq) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 70) * 0.7;
    }
    return out;
  };
}

const RENDERERS: Record<SoundName, Renderer> = {
  kick,
  snare: snareRenderer(1.0),
  snareGhost: snareRenderer(1.0), // level handled by velocity gain
  xstick,
  hihatClosed: metalRenderer(55, 0.5, 0.09),
  hihatOpen: metalRenderer(9, 0.45, 0.5),
  hihatFoot: metalRenderer(70, 0.35, 0.07),
  ride,
  rideBell,
  crash: metalRenderer(3.5, 0.4, 1.4),
  stacker: metalRenderer(28, 0.5, 0.14),
  cowbell,
  tom1: tomRenderer(196),
  tom2: tomRenderer(155),
  tom3: tomRenderer(110),
  tom4: tomRenderer(82),
  metronome: clickRenderer(1200),
  metronomeAccent: clickRenderer(1800),
};

export type DrumKit = Record<SoundName, AudioBuffer>;

export function buildDrumKit(ctx: BaseAudioContext): DrumKit {
  const kit = {} as DrumKit;
  for (const name of Object.keys(RENDERERS) as SoundName[]) {
    const data = RENDERERS[name](ctx.sampleRate);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    kit[name] = buffer;
  }
  return kit;
}
