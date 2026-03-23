import type { PriceSnapshot } from './types.js';

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function getPriceSnapshotOpenTime(snapshot: PriceSnapshot): number | null {
  const rawValue = snapshot.open_time ?? snapshot.openTime;
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
}

export function enumerateJstSettlementTimes(
  entryTimeMs: number,
  exitTimeMs: number,
  settlementHourJst: number
): readonly number[] {
  if (exitTimeMs <= entryTimeMs) {
    return [];
  }

  const settlementTimes: number[] = [];
  const entryJstMs = entryTimeMs + JST_OFFSET_MS;
  const exitJstMs = exitTimeMs + JST_OFFSET_MS;
  const entryDayStartJstMs = Math.floor(entryJstMs / DAY_MS) * DAY_MS;
  let cursorJstMs = entryDayStartJstMs + settlementHourJst * 60 * 60 * 1000;

  if (cursorJstMs <= entryJstMs) {
    cursorJstMs += DAY_MS;
  }

  while (cursorJstMs <= exitJstMs) {
    settlementTimes.push(cursorJstMs - JST_OFFSET_MS);
    cursorJstMs += DAY_MS;
  }

  return settlementTimes;
}
