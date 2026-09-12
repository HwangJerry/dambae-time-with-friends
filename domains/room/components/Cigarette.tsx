'use client';
import Image from 'next/image';
import { useId, type CSSProperties } from 'react';
import { CIGARETTE_DURATION_MS } from '../types';

export const BURNABLE_FRACTION = 0.65;
const ORIGINAL_TIP_FRACTION = 0.055;
const ASH_CYCLE_MS = 18_000;
const MIN_ASH_FRACTION = 0.018;
const ASH_GROWTH_FRACTION = 0.035;

export function getBurnGeometry(progress: number) {
  const fraction = Math.max(0, Math.min(1, progress));
  const elapsed = fraction * CIGARETTE_DURATION_MS;
  const ashCycle = (elapsed % ASH_CYCLE_MS) / ASH_CYCLE_MS;
  const paperEdge = ORIGINAL_TIP_FRACTION + fraction * BURNABLE_FRACTION;
  const ashLength = MIN_ASH_FRACTION + ashCycle * ASH_GROWTH_FRACTION;
  return { paperEdge, ashLength, ashTop: paperEdge - ashLength };
}

/** One fixed paper/filter texture; ash and embers share the same burn edge. */
export function Cigarette({
  progress = 0,
  lit = false,
}: {
  progress?: number;
  lit?: boolean;
}) {
  const textureId = useId().replaceAll(':', '');
  const { paperEdge, ashLength, ashTop } = getBurnGeometry(progress);
  const style = {
    '--paper-edge': `${paperEdge * 100}%`,
    '--ash-top': `${ashTop * 100}%`,
    '--ash-length': `${ashLength * 100}%`,
  } as CSSProperties;
  return (
    <div
      className={`cigarette ${lit ? 'is-lit' : 'is-cold'}`}
      style={style}
      aria-hidden="true"
    >
      <div className="cigarette-layer cigarette-paper">
        <Image
          unoptimized
          width={1197}
          height={1314}
          className="cigarette-photo"
          src="/images/cigarette.png"
          alt=""
          draggable={false}
        />
      </div>
      <svg
        className="cigarette-ash"
        viewBox="0 0 30 45"
        preserveAspectRatio="none"
      >
        <defs>
          <filter id={textureId} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".7 .35"
              numOctaves="3"
              seed="8"
              result="grain"
            />
            <feColorMatrix in="grain" type="saturate" values="0" />
            <feComposite in2="SourceGraphic" operator="in" />
            <feBlend in2="SourceGraphic" mode="multiply" />
          </filter>
          <linearGradient id={`${textureId}-shade`}>
            <stop stopColor="#363430" />
            <stop offset=".35" stopColor="#b6b0a4" />
            <stop offset=".7" stopColor="#868278" />
            <stop offset="1" stopColor="#252421" />
          </linearGradient>
        </defs>
        <path
          d="M3 5L7 3L11 5L15 1L21 4L26 2L28 8L27 16L29 22L27 29L28 44L22 43L17 45L12 43L6 45L2 43L3 32L1 26L3 18Z"
          fill={`url(#${textureId}-shade)`}
          filter={`url(#${textureId})`}
        />
        <path
          d="M3 14L9 16L17 14M14 24L21 26L27 23M3 34L12 32L17 34"
          fill="none"
          stroke="#211f1d"
          strokeWidth="1.1"
          opacity=".7"
        />
      </svg>
      <span className="charred-edge" />
      {lit && (
        <>
          <span className="ember-aura" />
          <span className="ember-grains" />
          <span className="falling-ash">
            <i />
            <i />
            <i />
          </span>
        </>
      )}
    </div>
  );
}
