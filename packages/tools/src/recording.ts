/** Browser recording limits. Kept out of the Playwright module so startup can skip it. */

export const RECORDING_LIMIT_MS = 10 * 60 * 1000;
export const RECORDING_EVENT_CAP = 2_000;

export function recordingAccepts(startedAt: number, now: number, count: number): boolean {
  return now - startedAt <= RECORDING_LIMIT_MS && count < RECORDING_EVENT_CAP;
}
