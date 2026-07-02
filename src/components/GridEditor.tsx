import {
  GrooveData,
  HIHAT_HIT_TO_CHAR,
  KICK_HIT_TO_CHAR,
  SNARE_HIT_TO_CHAR,
  cellsPerBeat,
  cellsPerMeasure,
  totalCells,
} from '../lib/grooveData';

export type Lane = 'H' | 'S' | 'K' | 'T1' | 'T2' | 'T3' | 'T4';

interface Props {
  groove: GrooveData;
  currentCell: number;
  showToms: boolean;
  onToggle: (lane: Lane, index: number) => void;
}

const LANE_LABELS: Record<Lane, string> = {
  H: 'Hi-hat',
  T1: 'Hi tom',
  T2: 'Mid tom',
  S: 'Snare',
  T3: 'Low tom', // no grid row; still parsed from URLs
  T4: 'Floor tom',
  K: 'Kick',
};

/** Top-to-bottom like a kit: cymbals, rack toms, snare, floor tom, kick. */
const LANE_ORDER: Lane[] = ['H', 'T1', 'T2', 'S', 'T4', 'K'];

export function GridEditor({ groove, currentCell, showToms, onToggle }: Props) {
  const n = totalCells(groove);
  const perBeat = cellsPerBeat(groove.timeSig, groove.div);
  const perMeasure = cellsPerMeasure(groove.timeSig, groove.div);

  const lanes = LANE_ORDER.filter((l) => showToms || !l.startsWith('T'));

  const laneChar = (lane: Lane, i: number): string => {
    if (lane === 'H') {
      const h = groove.hihat[i];
      return h ? HIHAT_HIT_TO_CHAR[h] : '';
    }
    if (lane === 'S') {
      const s = groove.snare[i];
      return s ? SNARE_HIT_TO_CHAR[s] : '';
    }
    if (lane === 'K') {
      const k = groove.kick[i];
      return k ? KICK_HIT_TO_CHAR[k] : '';
    }
    const t = groove.toms[Number(lane[1]) - 1][i];
    return t ? 'o' : '';
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
      {lanes.map((lane) => (
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
