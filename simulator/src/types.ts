export type MarketType = 'fx' | 'coin';
export type QuantityMode = 'lot' | 'base';
export type ExecutionDirection = 'long' | 'short';
export type TriggerReason = 'stop_loss' | 'take_profit';

export interface SymbolSpec {
  readonly symbol: string;
  readonly marketType: MarketType;
  readonly quantityMode: QuantityMode;
  readonly unitsPerLot: number;
  readonly pipSize: number;
  readonly quoteCurrency: string;
  readonly initialCapital: number;
}

export interface FeeModelConfig {
  readonly venueCode: string;
  readonly commissionRate: number;
  readonly basis: 'notional';
  readonly chargeOnEntry: boolean;
  readonly chargeOnExit: boolean;
  readonly market?: 'spot' | 'exchange-leverage' | 'crypto-fx' | 'fx';
  readonly productCode?: string;
  readonly apiFeeRate?: number;
  readonly makerRate?: number;
  readonly takerRate?: number;
  readonly leverageMultiplier?: number;
  readonly dailyLeverageRate?: number;
  readonly liquidationFeeRate?: number;
  readonly forcedCloseFeeRate?: number;
  readonly settlementHourJst?: number;
  readonly referenceUrl?: string;
  readonly notes?: string;
}

export interface PriceSnapshot {
  readonly close: string;
  readonly high?: string | null | undefined;
  readonly low?: string | null | undefined;
  readonly bid_close?: string | null | undefined;
  readonly ask_close?: string | null | undefined;
  readonly bid_high?: string | null | undefined;
  readonly bid_low?: string | null | undefined;
  readonly ask_high?: string | null | undefined;
  readonly ask_low?: string | null | undefined;
  readonly bidClose?: string | null | undefined;
  readonly askClose?: string | null | undefined;
  readonly bidHigh?: string | null | undefined;
  readonly bidLow?: string | null | undefined;
  readonly askHigh?: string | null | undefined;
  readonly askLow?: string | null | undefined;
  readonly open_time?: string | undefined;
  readonly openTime?: string | undefined;
  readonly symbol?: string | undefined;
}

export interface TradeOutcome {
  readonly grossPnl: number;
  readonly commissionFee: number;
  readonly netPnl: number;
  readonly pips: number;
  readonly percent: number;
}

export interface ExecutionPositionSnapshot {
  readonly direction: ExecutionDirection;
  readonly entryPrice: number;
  readonly lotSize: number;
  readonly entryTime: number;
  readonly entryIndex: number;
}

export interface ResolveVenueSymbolSpecParams {
  readonly venue?: string;
  readonly symbol: string;
  readonly override?: SymbolSpec;
}

export interface ResolveVenueFeeModelParams {
  readonly venue?: string;
  readonly symbol: string;
  readonly market?: FeeModelConfig['market'];
}

export interface VenueResolver {
  readonly id: string;
  resolveSymbolSpec(params: ResolveVenueSymbolSpecParams): SymbolSpec;
  resolveFeeModel(params: ResolveVenueFeeModelParams): FeeModelConfig;
}
