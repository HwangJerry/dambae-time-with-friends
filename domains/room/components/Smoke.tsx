'use client';
import { useEffect, useRef } from 'react';
type Puff = {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  phase: number;
};
const PARTICLE_SPAWN_MS = 90;
const PARTICLE_LIFE_MS = 7_500;
/** Lightweight buoyant particles; animation never drives the shared burn clock. */
export function Smoke({
  active,
  origin = 80,
}: {
  active: boolean;
  origin?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    originRef = useRef(origin);
  useEffect(() => {
    originRef.current = origin;
  }, [origin]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !active) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    let width = 240,
      height = 500,
      frame = 0,
      previous = 0,
      spawn = 0;
    let puffs: Puff[] = [];
    const resize = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(devicePixelRatio, 2);
      element.width = width * ratio;
      element.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    });
    resize.observe(element);
    const texture = document.createElement('canvas');
    texture.width = 96;
    texture.height = 96;
    const brush = texture.getContext('2d')!;
    const gradient = brush.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, 'rgba(178,189,202,.14)');
    gradient.addColorStop(0.28, 'rgba(136,147,162,.075)');
    gradient.addColorStop(1, 'rgba(90,102,118,0)');
    brush.fillStyle = gradient;
    brush.fillRect(0, 0, 96, 96);
    function draw(time: number) {
      const delta = previous ? Math.min(time - previous, 60) : 16;
      previous = time;
      ctx!.clearRect(0, 0, width, height);
      if (!document.hidden) {
        spawn += delta;
        if (spawn > PARTICLE_SPAWN_MS) {
          spawn = 0;
          puffs.push({
            x: width * 0.5,
            y: (height * originRef.current) / 100,
            age: 0,
            life: PARTICLE_LIFE_MS,
            size: 8,
            phase: Math.random() * Math.PI * 2,
          });
        }
        puffs = puffs.filter((p) => p.age < p.life && p.y > -80);
        for (const puff of puffs) {
          puff.age += delta;
          const t = puff.age / puff.life;
          puff.y -= delta * 0.039;
          puff.x +=
            Math.sin(puff.y * 0.025 + time * 0.0004 + puff.phase) *
            delta *
            0.009;
          puff.size = 9 + t * 85;
          ctx!.globalAlpha = Math.sin(Math.PI * t) * 0.68;
          ctx!.drawImage(
            texture,
            puff.x - puff.size,
            puff.y - puff.size,
            puff.size * 2,
            puff.size * 2,
          );
        }
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      ctx.clearRect(0, 0, width, height);
    };
  }, [active]);
  return <canvas ref={canvas} className="smoke-canvas" aria-hidden="true" />;
}
