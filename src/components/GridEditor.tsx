import {
  GrooveData,
  HIHAT_HIT_TO_CHAR,
  KICK_HIT_TO_CHAR,
  SNARE_HIT_TO_CHAR,
  cellsPerBeat,
  cellsPerMeasure,
  totalCells,
} from '../lib/grooveData';

export type Lane = 'H' | 'S' | 'K';

interface Props {
  groove: GrooveData;
  currentCell: number;
  onToggle: (lane: Lane, index: number) => void;
}

const LANE_LABELS: Record<Lane, string> = { H: 'Hi-hat', S: 'Snare', K: 'Kick' };

export function GridEditor({ groove, currentCell, onToggle }: Props) {
  const n = totalCells(groove);
  const perBeat = cellsPerBeat(groove.timeSig, groove.div);
  const perMeasure = cellsPerMeasure(groove.timeSig, groove.div);

  const laneChar = (lane: Lane, i: number): string => {
    if (lane === 'H') {
      const h = groove.hihat[i];
      return h ? HIHAT_HIT_TO_CHAR[h] : '';
    }
    if (lane === 'S') {
      const s = groove.snare[i];
      return s ? SNARE_HIT_TO_CHAR[s] : '';
    }
    const k = groove.kick[i];
    return k ? KICK_HIT_TO_CHAR[k] : '';
  };

  const cellClass = (lane: Lane, i: number): string => {
    const classes = ['cell'];
    if (i % perMeasure === 0) classes.push('measure-start');
    else if (i % perBeat === 0) classes.push('beat-start');
    if (i === currentCell) classes.push('playhead');
    if (laneChar(lane, i)) classes.push('on');
    return classes.join(' ');
  };

  return (
    <div className="grid-editor" style={{ ['--cells' as string]: n }}>
      {(['H', 'S', 'K'] as Lane[]).map((lane) => (
        <div className="lane" key={lane}>
          <div className="lane-label">{LANE_LABELS[lane]}</div>
          <div className="lane-cells">
            {Array.from({ length: n }, (_, i) => (
              <button
                key={i}
                className={cellClass(lane, i)}
                onClick={() => onToggle(lane, i)}
                title={`${LANE_LABELS[lane]} — cell ${i + 1}`}
              >
                {laneChar(lane, i)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
