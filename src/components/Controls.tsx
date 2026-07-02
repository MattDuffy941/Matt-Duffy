import { ALLOWED_DIVS, GrooveData, isTripletDiv } from '../lib/grooveData';
import { PRESETS } from '../lib/presets';

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
  onChange: (changes: Partial<GrooveData>) => void;
  onPlayStop: () => void;
  onShare: () => void;
  onLoadPreset: (query: string) => void;
  onCountInChange: (v: boolean) => void;
  onRampChange: (v: number) => void;
  onToggleToms: () => void;
}

export function Controls({
  groove,
  playing,
  liveBpm,
  countIn,
  rampBpm,
  showToms,
  onChange,
  onPlayStop,
  onShare,
  onLoadPreset,
  onCountInChange,
  onRampChange,
  onToggleToms,
}: Props) {
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

      <button className="share" onClick={onShare} title="Copy shareable link">
        Copy link
      </button>
    </div>
  );
}
