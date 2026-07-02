import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GrooveData,
  HihatHit,
  KickHit,
  SnareHit,
  remapLane,
  totalCells,
} from './lib/grooveData';
import { parseUrl, toUrl } from './lib/urlCodec';
import { grooveToAbc } from './lib/grooveToAbc';
import { GroovePlayer } from './lib/audio/player';
import { Controls } from './components/Controls';
import { GridEditor, Lane } from './components/GridEditor';
import { Notation } from './components/Notation';

/** Shown when the page is opened with no query string. */
const DEFAULT_GROOVE_URL =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|';

const H_CYCLE: (HihatHit | null)[] = [null, 'normal', 'accent', 'open'];
const S_CYCLE: (SnareHit | null)[] = [null, 'normal', 'accent', 'ghost'];
const K_CYCLE: (KickHit | null)[] = [null, 'normal', 'splash', 'kickAndSplash'];

function cloneGroove(g: GrooveData): GrooveData {
  return {
    ...g,
    hihat: [...g.hihat],
    snare: [...g.snare],
    kick: [...g.kick],
    toms: [[...g.toms[0]], [...g.toms[1]], [...g.toms[2]], [...g.toms[3]]],
  };
}

function cycleNext<H>(cycle: (H | null)[], current: H | null): H | null {
  const i = cycle.indexOf(current);
  if (i === -1) return null; // exotic hit loaded from a URL: clicking clears it
  return cycle[(i + 1) % cycle.length];
}

export default function App() {
  const [groove, setGroove] = useState<GrooveData>(() =>
    parseUrl(window.location.search || DEFAULT_GROOVE_URL),
  );
  const [playing, setPlaying] = useState(false);
  const [currentCell, setCurrentCell] = useState(-1);
  const playerRef = useRef<GroovePlayer | null>(null);

  const getPlayer = useCallback((): GroovePlayer => {
    if (!playerRef.current) {
      playerRef.current = new GroovePlayer();
      playerRef.current.onStep = (cell) => setCurrentCell(cell);
    }
    return playerRef.current;
  }, []);

  // The URL is the document: every edit rewrites it.
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname + toUrl(groove));
  }, [groove]);

  // Live edits reach the player without restarting playback.
  useEffect(() => {
    playerRef.current?.updateGroove(groove);
  }, [groove]);

  useEffect(() => () => playerRef.current?.dispose(), []);

  const abc = useMemo(() => grooveToAbc(groove), [groove]);

  const handleToggle = useCallback(
    (lane: Lane, index: number) => {
      setGroove((prev) => {
        const next = cloneGroove(prev);
        if (lane === 'H') {
          next.hihat[index] = cycleNext(H_CYCLE, prev.hihat[index]);
          if (next.hihat[index]) getPlayer().preview({ hihat: next.hihat[index]! });
        } else if (lane === 'S') {
          next.snare[index] = cycleNext(S_CYCLE, prev.snare[index]);
          if (next.snare[index]) getPlayer().preview({ snare: next.snare[index]! });
        } else {
          next.kick[index] = cycleNext(K_CYCLE, prev.kick[index]);
          if (next.kick[index]) getPlayer().preview({ kick: next.kick[index]! });
        }
        return next;
      });
    },
    [getPlayer],
  );

  const handleChange = useCallback((changes: Partial<GrooveData>) => {
    setGroove((prev) => {
      const next = { ...cloneGroove(prev), ...changes };
      const n = totalCells(next);
      if (n !== totalCells(prev)) {
        next.hihat = remapLane(prev.hihat, n);
        next.snare = remapLane(prev.snare, n);
        next.kick = remapLane(prev.kick, n);
        next.toms = [
          remapLane(prev.toms[0], n),
          remapLane(prev.toms[1], n),
          remapLane(prev.toms[2], n),
          remapLane(prev.toms[3], n),
        ];
      }
      return next;
    });
  }, []);

  const handlePlayStop = useCallback(() => {
    const player = getPlayer();
    if (playing) {
      player.stop();
      setPlaying(false);
      setCurrentCell(-1);
    } else {
      player.start(groove);
      setPlaying(true);
    }
  }, [playing, groove, getPlayer]);

  const handleShare = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>GrooveScribe Clone</h1>
        <p className="tagline">Click the grid to write a groove — the URL is your document.</p>
      </header>
      <Controls
        groove={groove}
        playing={playing}
        onChange={handleChange}
        onPlayStop={handlePlayStop}
        onShare={handleShare}
      />
      <GridEditor groove={groove} currentCell={currentCell} onToggle={handleToggle} />
      <Notation abc={abc} />
      <footer>
        <p>
          A clean-room recreation of the core of{' '}
          <a href="https://github.com/montulli/GrooveScribe" target="_blank" rel="noreferrer">
            GrooveScribe
          </a>
          . Legend — hi-hat: x normal · X accent · o open; snare: o normal · O accent · g ghost;
          kick: o kick · x hi-hat foot · X both.
        </p>
      </footer>
    </div>
  );
}
