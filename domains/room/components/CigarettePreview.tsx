'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { Cigarette, getBurnGeometry } from './Cigarette';
import { Smoke } from './Smoke';

const PREVIEW_DURATION_MS = 60_000;
const PREVIEW_TICK_MS = 100;
export function CigarettePreview() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => {
      setProgress(
        ((performance.now() - started) % PREVIEW_DURATION_MS) /
          PREVIEW_DURATION_MS,
      );
    }, PREVIEW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const { ashTop } = getBurnGeometry(progress);
  return (
    <div
      className="entry-art"
      style={{ '--preview-tip': ashTop } as CSSProperties}
    >
      <div className="entry-smoke">
        <Smoke active origin={100} />
      </div>
      <span className="entry-whisper">잠깐, 같이 있을래?</span>
      <Cigarette lit progress={progress} />
    </div>
  );
}
