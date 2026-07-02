import { useEffect, useRef, useState } from 'react';
import {
  GrooveData,
  HIHAT_HIT_TO_CHAR,
  KICK_HIT_TO_CHAR,
  SNARE_HIT_TO_CHAR,
  STICKING_HIT_TO_CHAR,
  cellsPerBeat,
  cellsPerMeasure,
  totalCells,
} from '../lib/grooveData';

export type Lane = 'H' | 'S' | 'K' | 'T1' | 'T2' | 'T3' | 'T4' | 'ST';

interface Props {
  groove: GrooveData;
  currentCell: number;
  showToms: boolean;
  showSticking: boolean;
  onToggle: (lane: Lane, index: number) => void;
  /** Set a cell to an explicit tab character (null = clear). */
  onSetCell: (lane: Lane, index: number, char: string | null) => void;
}

const LANE_LABELS: Record<Lane, string> = {
  ST: 'Sticking',
  H: 'Hi-hat',
  T1: 'Hi tom',
  T2: 'Mid tom',
  S: 'Snare',
  T3: 'Low tom', // no grid row; still parsed from URLs
  T4: 'Floor tom',
  K: 'Kick',
};

/** Top-to-bottom like a kit: sticking, cymbals, rack toms, snare, floor tom, kick. */
const LANE_ORDER: Lane[] = ['ST', 'H', 'T1', 'T2', 'S', 'T4', 'K'];

interface MenuItem {
  char: string | null;
  label: string;
}

/** Right-click palette per lane (tab chars are the canonical vocabulary). */
const MENU_ITEMS: Record<'H' | 'S' | 'K' | 'T' | 'ST', MenuItem[]> = {
  ST: [
    { char: null, label: 'Off' },
    { char: 'R', label: 'Right hand' },
    { char: 'L', label: 'Left hand' },
    { char: 'B', label: 'Both hands' },
  ],
  H: [
    { char: null, label: 'Off' },
    { char: 'x', label: 'Hi-hat' },
    { char: 'X', label: 'Hi-hat accent' },
    { char: 'o', label: 'Open hi-hat' },
    { char: '+', label: 'Foot close' },
    { char: 'r', label: 'Ride' },
    { char: 'b', label: 'Ride bell' },
    { char: 'c', label: 'Crash' },
    { char: 's', label: 'Stacker' },
    { char: 'm', label: 'Cowbell' },
  ],
  S: [
    { char: null, label: 'Off' },
    { char: 'o', label: 'Snare' },
    { char: 'O', label: 'Accent' },
    { char: 'g', label: 'Ghost note' },
    { char: 'x', label: 'Cross-stick' },
    { char: 'f', label: 'Flam' },
    { char: 'd', label: 'Drag' },
    { char: 'b', label: 'Buzz' },
  ],
  K: [
    { char: null, label: 'Off' },
    { char: 'o', label: 'Kick' },
    { char: 'x', label: 'Hi-hat foot splash' },
    { char: 'X', label: 'Kick + splash' },
  ],
  T: [
    { char: null, label: 'Off' },
    { char: 'o', label: 'Tom hit' },
  ],
};

interface MenuState {
  lane: Lane;
  index: number;
  x: number;
  y: number;
}

function menuKey(lane: Lane): 'H' | 'S' | 'K' | 'T' | 'ST' {
  if (lane === 'ST') return 'ST';
  if (lane.startsWith('T')) return 'T';
  return lane as 'H' | 'S' | 'K';
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_DRIFT_PX = 10;

export function GridEditor({
  groove,
  currentCell,
  showToms,
  showSticking,
  onToggle,
  onSetCell,
}: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuOpenedAt = useRef(0);
  const longPress = useRef<{
    timer: ReturnType<typeof setTimeout>;
    fired: boolean;
    x: number;
    y: number;
  } | null>(null);
  const n = totalCells(groove);
  const perBeat = cellsPerBeat(groove.timeSig, groove.div);
  const perMeasure = cellsPerMeasure(groove.timeSig, groove.div);

  const openMenu = (lane: Lane, index: number, x: number, y: number) => {
    const itemCount = MENU_ITEMS[menuKey(lane)].length;
    menuOpenedAt.current = Date.now();
    setMenu({
      lane,
      index,
      x: Math.min(x, window.innerWidth - 200),
      y: Math.max(8, Math.min(y, window.innerHeight - itemCount * 38 - 50)),
    });
  };

  const closeMenuGuarded = () => {
    // ignore the synthetic click that can follow a long-press release
    if (Date.now() - menuOpenedAt.current < 350) return;
    setMenu(null);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const lanes = LANE_ORDER.filter((l) => {
    if (l === 'ST') return showSticking;
    if (l.startsWith('T')) return showToms;
    return true;
  });

  const laneChar = (lane: Lane, i: number): string => {
    if (lane === 'ST') {
      const s = groove.stickings[i];
      return s ? STICKING_HIT_TO_CHAR[s] : '';
    }
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

  const menuItems: MenuItem[] = menu ? MENU_ITEMS[menuKey(menu.lane)] : [];

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
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(lane, i, e.clientX, e.clientY);
                }}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  const state = {
                    timer: 0 as unknown as ReturnType<typeof setTimeout>,
                    fired: false,
                    x: t.clientX,
                    y: t.clientY,
                  };
                  state.timer = setTimeout(() => {
                    state.fired = true;
                    // offset so the menu isn't under the finger on release
                    openMenu(lane, i, state.x + 10, state.y - 30);
                  }, LONG_PRESS_MS);
                  longPress.current = state;
                }}
                onTouchMove={(e) => {
                  const s = longPress.current;
                  if (!s) return;
                  const t = e.touches[0];
                  if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > LONG_PRESS_DRIFT_PX) {
                    clearTimeout(s.timer);
                    longPress.current = null;
                  }
                }}
                onTouchEnd={(e) => {
                  const s = longPress.current;
                  if (s) {
                    clearTimeout(s.timer);
                    // a completed long-press must not also fire the click-cycle
                    if (s.fired && e.cancelable) e.preventDefault();
                  }
                  longPress.current = null;
                }}
                onTouchCancel={() => {
                  const s = longPress.current;
                  if (s) clearTimeout(s.timer);
                  longPress.current = null;
                }}
                title={`${LANE_LABELS[lane]} — cell ${i + 1} (right-click or long-press for all sounds)`}
              >
                {laneChar(lane, i)}
              </button>
            ))}
          </div>
        </div>
      ))}

      {menu && (
        <>
          <div
            className="menu-backdrop"
            onClick={closeMenuGuarded}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="cell-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="cell-menu-title">
              {LANE_LABELS[menu.lane]} — cell {menu.index + 1}
            </div>
            {menuItems.map((item) => (
              <button
                key={item.label}
                className={
                  (laneChar(menu.lane, menu.index) || null) === item.char
                    ? 'cell-menu-item active'
                    : 'cell-menu-item'
                }
                onClick={() => {
                  onSetCell(menu.lane, menu.index, item.char);
                  setMenu(null);
                }}
              >
                <span className="cell-menu-char">{item.char ?? '–'}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
