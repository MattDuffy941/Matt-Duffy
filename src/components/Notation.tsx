import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface Props {
  abc: string;
  /** Single-measure grooves get centred and enlarged when printed. */
  single: boolean;
}

/** X-head glyph fingerprint: the abcjs x-notehead path draws its arms with
 *  distinctive `l 1.86 1.5` segments that no other head glyph uses. */
function isXHead(head: SVGPathElement): boolean {
  return (head.getAttribute('d') || '').includes('l 1.86 1.5');
}

/** Parse an abcjs stem path (a thin 4-point rectangle) into its corners. */
function parseStem(d: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const m = /^M ([\d.-]+) ([\d.-]+)L [\d.-]+ ([\d.-]+)L ([\d.-]+) /.exec(d);
  if (!m) return null;
  return { x1: Number(m[1]), y1: Number(m[2]), y2: Number(m[3]), x2: Number(m[4]) };
}

/**
 * abcjs runs the stem of an X-head note through the head's upper arm down to
 * its centre. Trim each such stem so it stops at the tip of the X instead:
 * up-stems end at the top of the X, down-stems start at its bottom.
 */
function trimXHeadStems(container: HTMLElement): void {
  const OVERLAP = 0.8; // keep a hair of contact so the stem doesn't float
  for (const note of container.querySelectorAll<SVGGElement>('g.abcjs-note')) {
    const heads = [...note.querySelectorAll<SVGPathElement>('path.abcjs-notehead')];
    const stems = [...note.querySelectorAll<SVGPathElement>('path.abcjs-stem')];
    if (heads.length === 0 || stems.length === 0) continue;

    const boxes = heads.map((head) => ({ head, box: head.getBBox() }));
    const lowest = boxes.reduce((a, b) => (a.box.y + a.box.height > b.box.y + b.box.height ? a : b));
    const highest = boxes.reduce((a, b) => (a.box.y < b.box.y ? a : b));

    for (const stem of stems) {
      const d = stem.getAttribute('d') || '';
      const p = parseStem(d);
      if (!p) continue;
      const top = Math.min(p.y1, p.y2);
      const bottom = Math.max(p.y1, p.y2);
      // Up-stem: the head sits at the bottom of the stem; down-stem: at the top.
      const lowestCentre = lowest.box.y + lowest.box.height / 2;
      const highestCentre = highest.box.y + highest.box.height / 2;
      const isUp = Math.abs(bottom - lowestCentre) < Math.abs(top - highestCentre);

      if (isUp && isXHead(lowest.head)) {
        const newBottom = lowest.box.y + OVERLAP;
        if (newBottom > top) {
          stem.setAttribute(
            'd',
            `M ${p.x1} ${top}L ${p.x1} ${newBottom}L ${p.x2} ${newBottom}L ${p.x2} ${top}z`,
          );
        }
      } else if (!isUp && isXHead(highest.head)) {
        const newTop = highest.box.y + highest.box.height - OVERLAP;
        if (newTop < bottom) {
          stem.setAttribute(
            'd',
            `M ${p.x1} ${newTop}L ${p.x1} ${bottom}L ${p.x2} ${bottom}L ${p.x2} ${newTop}z`,
          );
        }
      }
    }
  }
}

export function Notation({ abc, single }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    abcjs.renderAbc(ref.current, abc, {
      add_classes: true,
      responsive: 'resize',
      staffwidth: 700,
      paddingtop: 8,
      paddingbottom: 8,
    });
    trimXHeadStems(ref.current);
  }, [abc]);

  return <div className={single ? 'notation single-measure' : 'notation'} ref={ref} />;
}
