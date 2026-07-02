import { useCallback, useMemo, useRef, useState } from 'react';
import { GrooveData } from '../lib/grooveData';
import { grooveToAbc } from '../lib/grooveToAbc';
import { toUrl } from '../lib/urlCodec';
import { GroovePlayer } from '../lib/audio/player';
import { Notation } from './Notation';

/**
 * Compact player rendered when the URL carries &Embed=1 — designed to be
 * iframed into lesson pages: title, play/stop, the engraved notation, and a
 * link out to the full editor. No editing chrome.
 */
export function EmbedView({ groove }: { groove: GrooveData }) {
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<GroovePlayer | null>(null);
  const abc = useMemo(() => grooveToAbc(groove), [groove]);
  const fullUrl = window.location.pathname + toUrl(groove);

  const handlePlayStop = useCallback(() => {
    if (!playerRef.current) playerRef.current = new GroovePlayer();
    const player = playerRef.current;
    if (playing) {
      player.stop();
      setPlaying(false);
    } else {
      player.start(groove);
      setPlaying(true);
    }
  }, [playing, groove]);

  return (
    <div className="embed">
      <div className="embed-bar">
        <button className={playing ? 'play stop' : 'play'} onClick={handlePlayStop}>
          {playing ? '■' : '▶'}
        </button>
        <span className="embed-title">
          {groove.title || 'Groove'} · {groove.tempo} BPM
        </span>
        <a className="embed-open" href={fullUrl} target="_blank" rel="noreferrer">
          Open in Groove Builder ↗
        </a>
      </div>
      <Notation abc={abc} single={groove.measures === 1} />
    </div>
  );
}
