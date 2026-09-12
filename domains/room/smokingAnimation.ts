import { CIGARETTE_DURATION_MS } from './types.ts';
export const PUFF_CYCLE_MS = 10_000;
export const ASH_INTERVAL_MS = 5_500;
export const ASH_FALL_MS = 900;
export function smokingState(litAt: number | null, now: number) {
  const elapsed = litAt === null ? 0 : Math.max(0, now - litAt);
  const burning =
    litAt !== null && now >= litAt && elapsed < CIGARETTE_DURATION_MS;
  if (!burning)
    return {
      burning: false,
      elapsed,
      progress: litAt === null ? 0 : 1,
      handLift: 0,
    };
  const phase = elapsed % PUFF_CYCLE_MS;
  let handLift = 0;
  if (phase >= 1800 && phase < 2800) handLift = (phase - 1800) / 1000;
  else if (phase >= 2800 && phase < 4200) handLift = 1;
  else if (phase >= 4200 && phase < 5400) handLift = 1 - (phase - 4200) / 1200;
  handLift = handLift * handLift * (3 - 2 * handLift);
  return {
    burning,
    elapsed,
    progress: elapsed / CIGARETTE_DURATION_MS,
    handLift,
  };
}
