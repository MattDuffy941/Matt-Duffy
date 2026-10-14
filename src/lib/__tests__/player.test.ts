import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyGroove, totalCells } from '../grooveData';
import { GroovePlayer, PlayOptions } from '../audio/player';

vi.mock('../audio/drumSynth', () => ({
  buildDrumKit: () => new Proxy({}, { get: (_kit, name) => ({ name }) }),
}));
vi.mock('../audio/sampleKit', () => ({ SAMPLE_KITS: {}, loadSampleKit: vi.fn() }));

const sounds: { name: string; when: number }[] = [];
class FakeAudioContext {
  state = 'running';
  destination = {};
  get currentTime() { return Date.now() / 1000; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createDynamicsCompressor() { return { threshold: { value: 0 }, ratio: { value: 1 }, connect() {} }; }
  createBufferSource() {
    return { buffer: null as { name: string } | null, connect() {}, start(when: number) {
      sounds.push({ name: this.buffer!.name, when });
    } };
  }
}

let player: GroovePlayer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  sounds.length = 0;
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  player = new GroovePlayer();
});
afterEach(() => {
  player.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function start(options: PlayOptions = {}, measures = 4, timeSig = { top: 4, bottom: 4 }) {
  const groove = createEmptyGroove({ tempo: 120, div: 8, measures, timeSig, metronomeFreq: 4 });
  // A kick on each bar's first cell lets us compare real scheduling against clicks.
  for (let cell = 0; cell < totalCells(groove); cell += totalCells(groove) / measures) groove.kick[cell] = 'normal';
  player.start(groove, options);
  await Promise.resolve();
  return groove;
}

function barStarts() { return sounds.filter((sound) => sound.name === 'kick').map((sound) => sound.when); }
function expectedBars(tempos: number[], beats = 4, initial = 0.08) {
  let when = initial;
  return tempos.map((tempo) => { const start = when; when += beats * 60 / tempo; return start; });
}
function expectTimes(actual: number[], expected: number[]) {
  expect(actual.length).toBeGreaterThanOrEqual(expected.length);
  expected.forEach((when, index) => expect(actual[index]).toBeCloseTo(when, 8));
}

describe('bar-based speed-up playback', () => {
  it('increases every three bars inside a four-bar groove and keeps clicks aligned across wraps', async () => {
    const changes = vi.fn();
    player.onTempoChange = changes;
    await start({ rampBpm: 2, rampEveryBars: 3, targetTempo: 125 });
    vi.advanceTimersByTime(25000);
    const expected = expectedBars([120, 120, 120, 122, 122, 122, 124, 124, 124, 125, 125, 125]);
    expectTimes(barStarts(), expected);
    expectTimes(sounds.filter((sound) => sound.name === 'metronomeAccent').map((sound) => sound.when), expected);
    expect(changes.mock.calls.map(([bpm]) => bpm)).toEqual([122, 124, 125]);
    expect(player.playing).toBe(true);
  });

  it('reports the tempo when the faster bar becomes audible, excluding the count-in', async () => {
    const changes: { bpm: number; when: number }[] = [];
    player.onTempoChange = (bpm) => changes.push({ bpm, when: Date.now() / 1000 });
    await start({ countIn: true, rampBpm: 5, rampEveryBars: 3, targetTempo: 125 });
    vi.advanceTimersByTime(8070);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(changes).toHaveLength(1);
    expect(changes[0].bpm).toBe(125);
    expect(changes[0].when).toBeCloseTo(8.08, 2);
    expectTimes(barStarts(), [2.08, 4.08, 6.08, 8.08]);
  });

  it.each([{ top: 3, bottom: 4 }, { top: 6, bottom: 8 }])('counts musical bars in $top/$bottom', async (timeSig) => {
    await start({ rampBpm: 7, rampEveryBars: 2, targetTempo: 130 }, 3, timeSig);
    vi.advanceTimersByTime(16000);
    const expected = expectedBars([120, 120, 127, 127, 130], timeSig.top);
    expectTimes(barStarts(), expected);
    expectTimes(sounds.filter((sound) => sound.name === 'metronomeAccent').map((sound) => sound.when), expected);
  });

  it.each([120, 90])('holds the starting speed when the target is %s, without slowing down', async (targetTempo) => {
    const changes = vi.fn();
    player.onTempoChange = changes;
    await start({ rampBpm: 2, rampEveryBars: 1, targetTempo });
    vi.advanceTimersByTime(10000);
    expectTimes(barStarts(), expectedBars([120, 120, 120, 120, 120]));
    expect(changes).not.toHaveBeenCalled();
  });

  it('preserves legacy per-loop speed-up for existing callers', async () => {
    await start({ rampBpmPerLoop: 5, targetTempo: 130 }, 2);
    vi.advanceTimersByTime(13000);
    expectTimes(barStarts(), expectedBars([120, 120, 125, 125, 130, 130]));
  });

  it('plays steadily when speed-up is off and safely ignores an invalid increase', async () => {
    await start({ rampBpm: NaN, rampEveryBars: NaN, targetTempo: NaN });
    vi.advanceTimersByTime(10000);
    expectTimes(barStarts(), expectedBars([120, 120, 120, 120, 120]));
  });

  it('cancels pending tempo cues on Stop and restarts the bar count at the starting tempo', async () => {
    const changes = vi.fn();
    player.onTempoChange = changes;
    await start({ rampBpm: 2, rampEveryBars: 1, targetTempo: 126 });
    vi.advanceTimersByTime(1900);
    player.stop();
    vi.advanceTimersByTime(1000);
    expect(changes).not.toHaveBeenCalled();
    sounds.length = 0;
    await start({ rampBpm: 2, rampEveryBars: 3, targetTempo: 126 });
    vi.advanceTimersByTime(8100);
    expectTimes(barStarts(), expectedBars([120, 120, 120, 122], 4, 2.98));
    expect(changes.mock.calls.map(([bpm]) => bpm)).toEqual([122]);
  });

  it('keeps the chosen increase, frequency and target after changing the grid', async () => {
    const groove = await start({ rampBpm: 2, rampEveryBars: 3, targetTempo: 123 }, 1);
    vi.advanceTimersByTime(500);
    sounds.length = 0;
    const larger = createEmptyGroove({ ...groove, measures: 2, kick: undefined });
    larger.kick[0] = 'normal';
    larger.kick[8] = 'normal';
    player.updateGroove(larger);
    await Promise.resolve();
    vi.advanceTimersByTime(11000);
    expectTimes(barStarts(), expectedBars([120, 120, 120, 122, 122, 122], 4, 0.58));
  });

  it('keeps the musical position and aligned clicks when the starting tempo is edited', async () => {
    const groove = await start({ rampBpm: 5, rampEveryBars: 3, targetTempo: 130 });
    vi.advanceTimersByTime(1000);
    sounds.length = 0;
    player.updateGroove({ ...groove, tempo: 60 });
    vi.advanceTimersByTime(10500);
    // At the edit, 0.92s of the first bar has played: its remaining 1.08s
    // doubles at 60 BPM. The next bars keep their original musical order.
    const expected = [3.16, 7.16, 11.16];
    expectTimes(barStarts(), expected);
    expectTimes(sounds.filter((sound) => sound.name === 'metronomeAccent').map((sound) => sound.when), expected);
  });
});
