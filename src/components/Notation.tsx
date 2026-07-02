import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface Props {
  abc: string;
  /** Single-measure grooves get centred and enlarged when printed. */
  single: boolean;
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
  }, [abc]);

  return <div className={single ? 'notation single-measure' : 'notation'} ref={ref} />;
}
