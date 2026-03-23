import type { FeeModelConfig } from '../types';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function assertNonEmptyString(value: unknown, field: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
}

function assertFiniteNumber(value: unknown, field: string, { min }: { readonly min?: number } = {}): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (min !== undefined && numeric < min) {
    throw new Error(`${field} must be >= ${min}`);
  }
  return numeric;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be explicitly true or false`);
  }
  return value;
}

export function validateFeeModelConfig(feeModel: FeeModelConfig | null | undefined, context = 'feeModel'): FeeModelConfig {
  if (!feeModel || typeof feeModel !== 'object') {
    throw new Error(`${context} is required`);
  }

  assertNonEmptyString(feeModel.venueCode, `${context}.venueCode`);
  assertFiniteNumber(feeModel.commissionRate, `${context}.commissionRate`, { min: 0 });

  if (feeModel.basis !== 'notional') {
    throw new Error(`${context}.basis must be explicitly set to "notional"`);
  }

  assertBoolean(feeModel.chargeOnEntry, `${context}.chargeOnEntry`);
  assertBoolean(feeModel.chargeOnExit, `${context}.chargeOnExit`);

  if (feeModel.market === 'exchange-leverage') {
    assertNonEmptyString(feeModel.productCode, `${context}.productCode`);
    const leverageMultiplier = assertFiniteNumber(feeModel.leverageMultiplier, `${context}.leverageMultiplier`, { min: 0 });
    if (leverageMultiplier <= 0) {
      throw new Error(`${context}.leverageMultiplier must be > 0`);
    }
    assertFiniteNumber(feeModel.dailyLeverageRate, `${context}.dailyLeverageRate`, { min: 0 });
    assertFiniteNumber(feeModel.liquidationFeeRate, `${context}.liquidationFeeRate`, { min: 0 });
    if (feeModel.forcedCloseFeeRate !== undefined) {
      assertFiniteNumber(feeModel.forcedCloseFeeRate, `${context}.forcedCloseFeeRate`, { min: 0 });
    }

    const settlementHourJst = Number(feeModel.settlementHourJst);
    if (!Number.isInteger(settlementHourJst) || settlementHourJst < 0 || settlementHourJst > 23) {
      throw new Error(`${context}.settlementHourJst must be an integer between 0 and 23`);
    }
  }

  return feeModel;
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
