import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface Props {
  abc: string;
}

export function Notation({ abc }: Props) {
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

  return <div className="notation" ref={ref} />;
}
