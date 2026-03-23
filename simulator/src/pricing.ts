import type { ExecutionDirection, PriceSnapshot, TriggerReason } from './types.js';

export function readNumericField(
  snapshot: PriceSnapshot,
  snakeField: keyof PriceSnapshot,
  camelField: keyof PriceSnapshot,
  fallback: number
): number;
export function readNumericField(
  snapshot: PriceSnapshot,
  snakeField: keyof PriceSnapshot,
  camelField: keyof PriceSnapshot,
  fallback: null
): null;
export function readNumericField(
  snapshot: PriceSnapshot,
  snakeField: keyof PriceSnapshot,
  camelField: keyof PriceSnapshot,
  fallback: number | null
): number | null {
  const rawValue = snapshot[snakeField] ?? snapshot[camelField];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function getMidPrice(snapshot: PriceSnapshot): number {
  const close = Number(snapshot.close);
  const bidClose = readNumericField(snapshot, 'bid_close', 'bidClose', null);
  const askClose = readNumericField(snapshot, 'ask_close', 'askClose', null);

  if (bidClose !== null && askClose !== null) {
    return (bidClose + askClose) / 2;
  }

  return close;
}

export function getReferencePrice(snapshot: PriceSnapshot, direction: ExecutionDirection, isEntry: boolean): number {
  const close = Number(snapshot.close);
  const bidClose = readNumericField(snapshot, 'bid_close', 'bidClose', close);
  const askClose = readNumericField(snapshot, 'ask_close', 'askClose', close);

  if (direction === 'long') {
    return isEntry ? askClose : bidClose;
  }

  return isEntry ? bidClose : askClose;
}

export function getTriggerPrice(
  snapshot: PriceSnapshot,
  direction: ExecutionDirection,
  reason: TriggerReason,
  fallbackPrice: number
): number {
  const bidHigh = readNumericField(snapshot, 'bid_high', 'bidHigh', readNumericField(snapshot, 'high', 'high', fallbackPrice));
  const bidLow = readNumericField(snapshot, 'bid_low', 'bidLow', readNumericField(snapshot, 'low', 'low', fallbackPrice));
  const askHigh = readNumericField(snapshot, 'ask_high', 'askHigh', readNumericField(snapshot, 'high', 'high', fallbackPrice));
  const askLow = readNumericField(snapshot, 'ask_low', 'askLow', readNumericField(snapshot, 'low', 'low', fallbackPrice));

  if (direction === 'long') {
    return reason === 'stop_loss' ? bidLow : bidHigh;
  }

  return reason === 'stop_loss' ? askHigh : askLow;
}
