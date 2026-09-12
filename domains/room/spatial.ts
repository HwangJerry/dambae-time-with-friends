export type Position = { x: number; z: number };
export const WORLD_BOUNDS = { minX: -7, maxX: 7, minZ: -2.7, maxZ: 6 };
export const FULL_VOLUME_DISTANCE = 1.8;
export const SILENT_DISTANCE = 7;
export const WALK_SPEED = 2.6;
export const POSITION_SEND_MS = 200;
export const POSITION_POLL_MS = 450;
// Furniture footprints include a small character clearance.
const OBSTACLES = [
  { minX: -2.7, maxX: 2.7, minZ: -2.7, maxZ: -1.45 },
  { minX: -4.35, maxX: -3.15, minZ: -2.7, maxZ: -1.1 },
  { minX: 3.05, maxX: 4.25, minZ: -2.7, maxZ: -1.1 },
  { minX: 4.6, maxX: 5.9, minZ: -2.7, maxZ: -1.0 },
  { minX: -0.65, maxX: 0.65, minZ: 0.35, maxZ: 1.6 },
];
export function spawnPosition(seat: number): Position {
  return { x: ((seat % 5) - 2) * 1.5, z: 2.3 + Math.floor(seat / 5) * 1.5 };
}
export function isWalkable(position: Position) {
  const { x, z } = position;
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    x >= WORLD_BOUNDS.minX &&
    x <= WORLD_BOUNDS.maxX &&
    z >= WORLD_BOUNDS.minZ &&
    z <= WORLD_BOUNDS.maxZ &&
    !OBSTACLES.some(
      (o) => x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ,
    )
  );
}
export function distanceVolume(listener: Position, speaker: Position): number {
  const distance = Math.hypot(listener.x - speaker.x, listener.z - speaker.z);
  if (distance >= SILENT_DISTANCE) return 0;
  if (distance <= FULL_VOLUME_DISTANCE) return 1;
  const t =
    (distance - FULL_VOLUME_DISTANCE) /
    (SILENT_DISTANCE - FULL_VOLUME_DISTANCE);
  return (1 - t) ** 2;
}
