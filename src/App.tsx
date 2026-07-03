import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GrooveData,
  HihatHit,
  KickHit,
  SnareHit,
  remapLane,
  totalCells,
} from './lib/grooveData';
import { parseUrl, toUrl, laneHasHits } from './lib/urlCodec';
import {
  HIHAT_CHAR_TO_HIT,
  KICK_CHAR_TO_HIT,
  SNARE_CHAR_TO_HIT,
  STICKING_CHAR_TO_HIT,
  Sticking,
} from './lib/grooveData';
import { grooveToAbc } from './lib/grooveToAbc';
import { exportPdf } from './lib/exportPdf';
import { SavedGroove, deleteGroove, listGrooves, saveGroove } from './lib/library';
import { EmbedView } from './components/EmbedView';
import { SavedGrooves } from './components/SavedGrooves';
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
const ST_CYCLE: (Sticking | null)[] = [null, 'R', 'L', 'B'];

function cloneGroove(g: GrooveData): GrooveData {
  return {
    ...g,
    hihat: [...g.hihat],
    snare: [...g.snare],
    kick: [...g.kick],
    toms: [[...g.toms[0]], [...g.toms[1]], [...g.toms[2]], [...g.toms[3]]],
    stickings: [...g.stickings],
  };
}

function cycleNext<H>(cycle: (H | null)[], current: H | null): H | null {
  const i = cycle.indexOf(current);
  if (i === -1) return null; // exotic hit loaded from a URL: clicking clears it
  return cycle[(i + 1) % cycle.length];
}

/** &Embed=1 renders the compact iframe player instead of the editor. */
const IS_EMBED = /(^|[?&])embed=1(&|$)/i.test(window.location.search);

export default function App() {
  const [groove, setGroove] = useState<GrooveData>(() =>
    parseUrl(window.location.search || DEFAULT_GROOVE_URL),
  );
  const [playing, setPlaying] = useState(false);
  const [currentCell, setCurrentCell] = useState(-1);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [countIn, setCountIn] = useState(false);
  const [rampBpm, setRampBpm] = useState(0);
  const [showToms, setShowToms] = useState(() => groove.toms.some((l) => laneHasHits(l)));
  const [showSticking, setShowSticking] = useState(() => laneHasHits(groove.stickings));
  const [saved, setSaved] = useState<SavedGroove[]>(() => listGrooves());
  const [kitName, setKitName] = useState('synth');
  const playerRef = useRef<GroovePlayer | null>(null);

  const getPlayer = useCallback((): GroovePlayer => {
    if (!playerRef.current) {
      playerRef.current = new GroovePlayer();
      playerRef.current.onStep = (cell) => setCurrentCell(cell);
      playerRef.current.onTempoChange = (bpm) => setLiveBpm(bpm);
    }
    return playerRef.current;
  }, []);

  // The URL is the document: every edit rewrites it. (Skipped in embed mode,
  // where the URL must keep its &Embed=1 flag and nothing is editable.)
  useEffect(() => {
    if (IS_EMBED) return;
    window.history.replaceState(null, '', window.location.pathname + toUrl(groove));
  }, [groove]);

  // Browser tab / print header shows the groove's name.
  useEffect(() => {
    document.title = groove.title ? `${groove.title} — Groove Builder` : 'Groove Builder — Drum Groove Editor';
  }, [groove.title]);

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
        if (lane === 'ST') {
          next.stickings[index] = cycleNext(ST_CYCLE, prev.stickings[index]);
        } else if (lane === 'H') {
          next.hihat[index] = cycleNext(H_CYCLE, prev.hihat[index]);
          if (next.hihat[index]) getPlayer().preview({ hihat: next.hihat[index]! });
        } else if (lane === 'S') {
          next.snare[index] = cycleNext(S_CYCLE, prev.snare[index]);
          if (next.snare[index]) getPlayer().preview({ snare: next.snare[index]! });
        } else if (lane === 'K') {
          next.kick[index] = cycleNext(K_CYCLE, prev.kick[index]);
          if (next.kick[index]) getPlayer().preview({ kick: next.kick[index]! });
        } else {
          const t = (Number(lane[1]) - 1) as 0 | 1 | 2 | 3;
          next.toms[t][index] = prev.toms[t][index] ? null : 'normal';
          if (next.toms[t][index]) getPlayer().preview({ tom: (t + 1) as 1 | 2 | 3 | 4 });
        }
        return next;
      });
    },
    [getPlayer],
  );

  const handleSetCell = useCallback(
    (lane: Lane, index: number, char: string | null) => {
      setGroove((prev) => {
        const next = cloneGroove(prev);
        if (lane === 'ST') {
          next.stickings[index] = char ? STICKING_CHAR_TO_HIT[char] ?? null : null;
        } else if (lane === 'H') {
          next.hihat[index] = char ? HIHAT_CHAR_TO_HIT[char] ?? null : null;
          if (next.hihat[index]) getPlayer().preview({ hihat: next.hihat[index]! });
        } else if (lane === 'S') {
          next.snare[index] = char ? SNARE_CHAR_TO_HIT[char] ?? null : null;
          if (next.snare[index]) getPlayer().preview({ snare: next.snare[index]! });
        } else if (lane === 'K') {
          next.kick[index] = char ? KICK_CHAR_TO_HIT[char] ?? null : null;
          if (next.kick[index]) getPlayer().preview({ kick: next.kick[index]! });
        } else {
          const t = (Number(lane[1]) - 1) as 0 | 1 | 2 | 3;
          next.toms[t][index] = char ? 'normal' : null;
          if (next.toms[t][index]) getPlayer().preview({ tom: (t + 1) as 1 | 2 | 3 | 4 });
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
        next.stickings = remapLane(prev.stickings, n);
      }
      return next;
    });
  }, []);

  const handleLoadQuery = useCallback((query: string) => {
    const g = parseUrl(query);
    setGroove(g);
    setShowToms((prev) => prev || g.toms.some((l) => laneHasHits(l)));
    setShowSticking((prev) => prev || laneHasHits(g.stickings));
  }, []);

  const handleSave = useCallback(() => {
    const name = groove.title.trim() || window.prompt('Name this groove:')?.trim();
    if (!name) return;
    const named = groove.title.trim() === name ? groove : { ...cloneGroove(groove), title: name };
    if (named !== groove) setGroove(named);
    saveGroove(name, toUrl(named));
    setSaved(listGrooves());
  }, [groove]);

  const handleDeleteSaved = useCallback((id: string) => {
    deleteGroove(id);
    setSaved(listGrooves());
  }, []);

  const handleKitChange = useCallback(
    (id: string) => {
      setKitName(id);
      void getPlayer().setKit(id);
    },
    [getPlayer],
  );

  const handleCopyEmbed = useCallback(() => {
    const url =
      window.location.origin + window.location.pathname + toUrl(groove) + '&Embed=1';
    const title = groove.title || 'Groove Builder';
    const snippet = `<iframe src="${url}" width="100%" height="300" style="border:0;border-radius:8px" title="${title}" loading="lazy"></iframe>`;
    void navigator.clipboard?.writeText(snippet);
  }, [groove]);

  const handlePlayStop = useCallback(() => {
    const player = getPlayer();
    if (playing) {
      player.stop();
      setPlaying(false);
      setCurrentCell(-1);
      setLiveBpm(null);
    } else {
      player.start(groove, { countIn, rampBpmPerLoop: rampBpm });
      setPlaying(true);
      setLiveBpm(null);
    }
  }, [playing, groove, countIn, rampBpm, getPlayer]);

  const handleShare = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href);
  }, []);

  const handleExportPdf = useCallback(() => {
    const container = document.querySelector<HTMLElement>('.notation');
    if (container) void exportPdf(container, groove.title);
  }, [groove.title]);

  if (IS_EMBED) {
    return <EmbedView groove={groove} />;
  }

  return (
    <div className="app">
      <header>
        <h1>Groove Builder</h1>
        <p className="tagline">Click the grid to write a groove — the URL is your document.</p>
      </header>
      <Controls
        groove={groove}
        playing={playing}
        liveBpm={liveBpm}
        countIn={countIn}
        rampBpm={rampBpm}
        showToms={showToms}
        showSticking={showSticking}
        kitName={kitName}
        onChange={handleChange}
        onPlayStop={handlePlayStop}
        onShare={handleShare}
        onLoadPreset={handleLoadQuery}
        onCountInChange={setCountIn}
        onRampChange={setRampBpm}
        onToggleToms={() => setShowToms((v) => !v)}
        onToggleSticking={() => setShowSticking((v) => !v)}
        onExportPdf={handleExportPdf}
        onSave={handleSave}
        onCopyEmbed={handleCopyEmbed}
        onKitChange={handleKitChange}
      />
      <SavedGrooves grooves={saved} onLoad={handleLoadQuery} onDelete={handleDeleteSaved} />
      <GridEditor
        groove={groove}
        currentCell={currentCell}
        showToms={showToms}
        showSticking={showSticking}
        onToggle={handleToggle}
        onSetCell={handleSetCell}
      />
      <Notation abc={abc} single={groove.measures === 1} />
      <footer>
        <p>
          Groove Builder — a clean-room recreation of the core of{' '}
          <a href="https://github.com/montulli/GrooveScribe" target="_blank" rel="noreferrer">
            GrooveScribe
          </a>
          . Click a cell to cycle common sounds;{' '}
          <strong>right-click or long-press for the full menu</strong> (ride, crash, cross-stick,
          flams and more). Acoustic (
          <a href="https://github.com/sgossner/VCSL" target="_blank" rel="noreferrer">
            VCSL
          </a>
          ) and TR-808 (
          <a
            href="https://github.com/tidalcycles/sounds-tr808-fischer"
            target="_blank"
            rel="noreferrer"
          >
            tidalcycles
          </a>
          ) sample kits are CC0 public domain.
        </p>
      </footer>
    </div>
  );
}
