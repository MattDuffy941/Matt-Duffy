import { useState } from 'react';
import { ALLOWED_DIVS, GrooveData, isTripletDiv } from '../lib/grooveData';
import { PRESETS } from '../lib/presets';
import { KIT_OPTIONS } from '../lib/audio/sampleKit';
import { videoRecordingSupported } from '../lib/video/recordVideo';

const DIV_LABELS: Record<number, string> = {
  8: '8th notes',
  12: '8th triplets',
  16: '16th notes',
  24: '16th triplets',
  32: '32nd notes',
  48: '32nd triplets',
};

interface Props {
  groove: GrooveData;
  playing: boolean;
  liveBpm: number | null;
  countIn: boolean;
  rampBpm: number;
  showToms: boolean;
  showSticking: boolean;
  kitName: string;
  onChange: (changes: Partial<GrooveData>) => void;
  onPlayStop: () => void;
  onShare: () => void;
  onLoadPreset: (query: string) => void;
  onCountInChange: (v: boolean) => void;
  onRampChange: (v: number) => void;
  onToggleToms: () => void;
  onToggleSticking: () => void;
  onExportPdf: () => void;
  onSave: () => void;
  onCopyEmbed: () => void;
  onKitChange: (id: string) => void;
  recording: boolean;
  onRecord: (format: 'webm' | 'mp4', loops: number) => void;
}

export function Controls({
  groove,
  playing,
  liveBpm,
  countIn,
  rampBpm,
  showToms,
  showSticking,
  kitName,
  onChange,
  onPlayStop,
  onShare,
  onLoadPreset,
  onCountInChange,
  onRampChange,
  onToggleToms,
  onToggleSticking,
  onExportPdf,
  onSave,
  onCopyEmbed,
  onKitChange,
  recording,
  onRecord,
}: Props) {
  const [videoFormat, setVideoFormat] = useState<'webm' | 'mp4'>('webm');
  const [videoLoops, setVideoLoops] = useState(2);
  const canRecord = videoRecordingSupported();

  return (
    <div className="controls">
      <button className={playing ? 'play stop' : 'play'} onClick={onPlayStop}>
        {playing ? '■ Stop' : '▶ Play'}
      </button>

      <label>
        Preset
        <select value="" onChange={(e) => e.target.value && onLoadPreset(e.target.value)}>
          <option value="">load…</option>
          {PRESETS.map((p) => (
            <option key={p.name} value={p.query}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Title
        <input
          type="text"
          className="title-input"
          placeholder="Name this groove…"
          value={groove.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </label>

      <label>
        Tempo
        <input
          type="range"
          min={20}
          max={400}
          value={groove.tempo}
          onChange={(e) => onChange({ tempo: Number(e.target.value) })}
        />
        <input
          type="number"
          min={20}
          max={400}
          value={groove.tempo}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (t >= 20 && t <= 400) onChange({ tempo: t });
          }}
        />
        <span className="unit">BPM</span>
        {liveBpm !== null && liveBpm !== groove.tempo && (
          <span className="live-bpm">now {liveBpm}</span>
        )}
      </label>

      <label>
        Time
        <select
          value={groove.timeSig.top}
          onChange={(e) =>
            onChange({ timeSig: { ...groove.timeSig, top: Number(e.target.value) } })
          }
        >
          {[2, 3, 4, 5, 6, 7, 9, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        /
        <select
          value={groove.timeSig.bottom}
          onChange={(e) =>
            onChange({ timeSig: { ...groove.timeSig, bottom: Number(e.target.value) } })
          }
        >
          {[4, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label>
        Grid
        <select value={groove.div} onChange={(e) => onChange({ div: Number(e.target.value) })}>
          {ALLOWED_DIVS.map((d) => (
            <option key={d} value={d}>
              {DIV_LABELS[d]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Measures
        <select
          value={groove.measures}
          onChange={(e) => onChange({ measures: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 6, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className={isTripletDiv(groove.div) ? 'disabled' : ''}>
        Swing
        <input
          type="range"
          min={0}
          max={100}
          value={groove.swing}
          disabled={isTripletDiv(groove.div)}
          onChange={(e) => onChange({ swing: Number(e.target.value) })}
        />
        <span className="unit">{groove.swing}%</span>
      </label>

      <label>
        Click
        <select
          value={groove.metronomeFreq}
          onChange={(e) => onChange({ metronomeFreq: Number(e.target.value) })}
        >
          <option value={0}>off</option>
          <option value={4}>quarters</option>
          <option value={8}>8ths</option>
          <option value={16}>16ths</option>
        </select>
      </label>

      <label>
        Sound
        <select value={kitName} onChange={(e) => onKitChange(e.target.value)}>
          {KIT_OPTIONS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <input
          type="checkbox"
          checked={countIn}
          onChange={(e) => onCountInChange(e.target.checked)}
        />
        Count-in
      </label>

      <label title="Raise the tempo each time the loop repeats">
        Speed up
        <select value={rampBpm} onChange={(e) => onRampChange(Number(e.target.value))}>
          <option value={0}>off</option>
          <option value={1}>+1/loop</option>
          <option value={2}>+2/loop</option>
          <option value={5}>+5/loop</option>
          <option value={10}>+10/loop</option>
        </select>
      </label>

      <button className="toms-toggle" onClick={onToggleToms}>
        {showToms ? 'Hide toms' : 'Show toms'}
      </button>

      <button className="toms-toggle" onClick={onToggleSticking}>
        {showSticking ? 'Hide sticking' : 'Sticking'}
      </button>

      <button
        className="toms-toggle"
        onClick={onSave}
        title="Save this groove to My Grooves on this device"
      >
        Save
      </button>

      <button
        className="toms-toggle"
        onClick={onExportPdf}
        title="Download the sheet music as a PDF"
      >
        Export PDF
      </button>

      <button className="share" onClick={onShare} title="Copy shareable link">
        Copy link
      </button>

      <button
        className="toms-toggle embed-btn"
        onClick={onCopyEmbed}
        title="Copy an <iframe> snippet to embed this groove in a lesson page"
      >
        Embed code
      </button>

      {canRecord && (
        <label title="Record a play-along video with a marker moving in time">
          Video
          <select
            value={videoLoops}
            disabled={recording}
            onChange={(e) => setVideoLoops(Number(e.target.value))}
          >
            <option value={1}>1 loop</option>
            <option value={2}>2 loops</option>
            <option value={4}>4 loops</option>
            <option value={8}>8 loops</option>
          </select>
          <select
            value={videoFormat}
            disabled={recording}
            onChange={(e) => setVideoFormat(e.target.value as 'webm' | 'mp4')}
          >
            <option value="webm">WebM</option>
            <option value="mp4">MP4</option>
          </select>
          <button
            className="toms-toggle"
            disabled={recording}
            onClick={() => onRecord(videoFormat, videoLoops)}
          >
            {recording ? 'Recording…' : '● Record'}
          </button>
        </label>
      )}
    </div>
  );
}
