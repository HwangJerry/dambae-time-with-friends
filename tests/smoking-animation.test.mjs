import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smokingState } from '../domains/room/smokingAnimation.ts';
import { CIGARETTE_DURATION_MS } from '../domains/room/types.ts';
test('no puff motion before lighting, after finishing, or before a future start', () => {
  for (const state of [
    smokingState(null, 5000),
    smokingState(1000, 500),
    smokingState(1000, 1000 + CIGARETTE_DURATION_MS),
  ]) {
    assert.equal(state.burning, false);
    assert.equal(state.handLift, 0);
  }
});
test('puff gesture periodically raises and lowers the hand only while burning', () => {
  assert.equal(smokingState(1000, 1100).handLift, 0);
  assert.equal(smokingState(1000, 4100).handLift, 1);
  assert.equal(smokingState(1000, 7100).handLift, 0);
  assert.equal(smokingState(1000, 14100).handLift, 1);
});
