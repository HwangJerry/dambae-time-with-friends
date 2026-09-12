import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceVolume,
  isWalkable,
  spawnPosition,
  FULL_VOLUME_DISTANCE,
  SILENT_DISTANCE,
} from '../domains/room/spatial.ts';
test('proximity gain is full nearby, fades monotonically and is exactly silent at cutoff', () => {
  const listener = { x: 0, z: 0 };
  assert.equal(distanceVolume(listener, listener), 1);
  assert.equal(distanceVolume(listener, { x: FULL_VOLUME_DISTANCE, z: 0 }), 1);
  let previous = 1;
  for (let d = FULL_VOLUME_DISTANCE; d < SILENT_DISTANCE; d += 0.1) {
    const volume = distanceVolume(listener, { x: d, z: 0 });
    assert(volume >= 0 && volume <= previous);
    previous = volume;
  }
  assert.equal(distanceVolume(listener, { x: SILENT_DISTANCE, z: 0 }), 0);
  assert.equal(distanceVolume(listener, { x: 20, z: 0 }), 0);
  assert.equal(
    distanceVolume(listener, { x: 3, z: 4 }),
    distanceVolume(listener, { x: -4, z: -3 }),
  );
});
test('all ten spawn points are distinct and furniture does not overlap walkable space', () => {
  const spawns = Array.from({ length: 10 }, (_, i) => spawnPosition(i));
  assert(spawns.every(isWalkable));
  assert.equal(new Set(spawns.map((p) => JSON.stringify(p))).size, 10);
  assert.equal(isWalkable({ x: 0, z: -2 }), false);
  assert.equal(isWalkable({ x: 0, z: 1 }), false);
  assert.equal(isWalkable({ x: Infinity, z: 1 }), false);
});
