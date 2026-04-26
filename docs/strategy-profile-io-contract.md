# Strategy Profile I/O Contract

## Purpose

This document defines the shared JSON contract between:

- `D:/git/trade`: offline strategy training, backtest, validation, and selection
- `D:/git/ai.weget.jp`: strategy import, approval, persistence, bot dispatch, venue adapters, and runtime execution

The contract has two files:

- Input file: `trade_strategy_artifact.v1`
- Output file: `aiweget_strategy_profile_import.v1`

`trade` owns the input file. `ai.weget.jp` owns the output file and the runtime
profile stored in `ai_bot_strategy_profiles.profile_json`.

The two formats are intentionally separate. A training result is not the same as
a runtime profile.

The strategy semantics must be venue-neutral. `skill-stratium-trader` is the
first runtime target, but the same strategy artifact must be able to target
`skill-gmo-coin`, `skill-gmo-fx`, and future venue skills such as OKX,
Hyperliquid, and Binance through venue adapters.

## Flow

```text
trade training/backtest/rolling decision
  -> trade_strategy_artifact.v1
  -> import/conversion tool
  -> aiweget_strategy_profile_import.v1
  -> ai_bot_strategy_profiles.profile_json
  -> bot-host sync
  -> skill-stratium-trader runtime
```

## Design Rules

- `trade_strategy_artifact.v1` must be complete enough to reproduce the selected
  strategy decision without reading script constants.
- `aiweget_strategy_profile_import.v1.profile_json` must be directly consumable
  by the target skill runtime.
- Strategy semantics belong to the shared strategy profile and deterministic
  strategy engine, not to a single exchange skill.
- Venue skills must implement market data, account state, quantity conversion,
  order submission, cancellation, and reconciliation adapters.
- Runtime deployment settings must not be stored in the training artifact:
  Stratium URL, account id, credentials, bearer token env vars, and auto-submit
  toggles remain bot-host or platform config.
- Training metrics are audit/provenance data. They should not change runtime
  behavior unless they are explicitly mapped into profile fields.
- Unsupported training semantics must be represented explicitly in
  `compatibility.unsupported_features`, not silently dropped.

## File 1: Input

File kind: `trade_strategy_artifact.v1`

Owner: `D:/git/trade`

Consumer: import/conversion tool

Suggested path:

```text
train/exports/strategy-artifacts/*.json
```

### Input Schema

```json
{
  "artifact_schema_version": "trade_strategy_artifact.v1",
  "artifact_id": "trade-weekly-2026-02-20-usdjpy-rsi-atr",
  "generated_at": "2026-04-24T00:00:00.000Z",
  "producer": {
    "repository": "trade",
    "commit": null,
    "run_type": "weekly_rolling",
    "source_config": "configs/generated/weekly/weekly_2026_02_20_validate.json",
    "source_report": "reports/weekly/weekly_2026_02_20_decision.json"
  },
  "target": {
    "runtime": "ai.weget.strategy-runtime",
    "runtime_profile_schema_version": "1.0.0",
    "skill_id": "stratium-trader",
    "package_name": "@ai.weget.jp/skill-stratium-trader",
    "venue_adapter": "stratium",
    "supported_venue_adapters": ["stratium", "gmo_coin", "gmo_fx", "okx", "hyperliquid", "binance"]
  },
  "market": {
    "symbol": "USDJPY",
    "venue_code": "GMOCOIN",
    "market_type": "fx",
    "interval_type": "1min",
    "price_type": "bid_ask",
    "timezone": "UTC",
    "venue_symbol": "USD_JPY",
    "base_asset": "USD",
    "quote_asset": "JPY"
  },
  "decision": {
    "action": "fallback",
    "reason": "both windows favor the slow family",
    "selected_params": {
      "strategy_name": "GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H30-ATRSL4-ATRTP4",
      "strategy_type": "rsi_only",
      "template_hint": "rsi_atr_reversion_v1",
      "direction": "both",
      "rsi": {
        "period": 14,
        "oversold": 30,
        "overbought": 70
      },
      "risk": {
        "max_positions": 1,
        "lot_size": 0.1,
        "lot_unit": "fx_lot",
        "max_hold_minutes": 30
      },
      "atr": {
        "sl_multiplier": 4,
        "tp_multiplier": 4,
        "period": 14
      },
      "schedule": {
        "expression": "* 0-19 * * 1-5",
        "time_restriction": {
          "enabled": true,
          "utc_exclude_start": "19:30",
          "utc_exclude_end": "23:59"
        }
      },
      "executor_features": {
        "enable_ma200_filter": true,
        "enable_multi_timeframe": true,
        "enable_atr_sizing": true,
        "enable_trailing_stop": true,
        "enable_rsi_reversion": true
      },
      "fee_model": {
        "venue_code": "GMOCOIN",
        "commission_rate": 0.00002,
        "basis": "notional",
        "charge_on_entry": true,
        "charge_on_exit": true
      }
    }
  },
  "performance": {
    "training": {
      "window_start": "2025-11-21",
      "window_end": "2026-02-20",
      "total_trades": 176,
      "win_rate_pct": 64.77,
      "gross_pnl": 786,
      "total_commission": 352,
      "net_pnl": 434,
      "avg_net_pnl": 2.47,
      "max_drawdown": -403,
      "profit_factor": 1.1815,
      "sharpe_ratio": 0.0524,
      "score": 13.3806
    },
    "validation": {
      "window_start": "2026-02-21",
      "window_end": "2026-02-27",
      "total_trades": 17,
      "win_rate_pct": 58.82,
      "gross_pnl": 69,
      "total_commission": 34,
      "net_pnl": 35,
      "avg_net_pnl": 2.06,
      "max_drawdown": -106,
      "profit_factor": 1.1746,
      "sharpe_ratio": 0.0701,
      "score": 1.3118
    },
    "consensus": {
      "family_3m": "slow",
      "family_1m": "slow",
      "agreement_level": "strong",
      "shared_atrsl_band": [3.5, 4],
      "shared_atrtp_band": [3, 4]
    }
  },
  "runtime_mapping_hints": {
    "decision_tick_seconds": 5,
    "feature_window_seconds": 60,
    "review_window_seconds": 300,
    "entry_order_qty": {
      "value": 0.1,
      "unit": "fx_lot",
      "requires_symbol_adapter": true
    },
    "fixed_bps_fallback": {
      "stop_loss_bps": 20,
      "take_profit_bps": 30,
      "source": "operator_default_until_atr_dynamic_runtime_exists"
    },
    "max_spread_bps": 6,
    "ai_review_required": true
  },
  "compatibility": {
    "runtime_supported_template": false,
    "expected_runtime_template": "rsi_mean_reversion",
    "unsupported_features": [
      "atr_dynamic_exit",
      "ma200_filter",
      "multi_timeframe_rsi",
      "trailing_stop",
      "trading_schedule"
    ],
    "conversion_mode": "degraded_fixed_bps"
  }
}
```

### Required Input Fields

- `artifact_schema_version`
- `artifact_id`
- `generated_at`
- `producer.repository`
- `producer.run_type`
- `target.runtime`
- `target.skill_id`
- `market.symbol`
- `market.venue_code`
- `market.market_type`
- `decision.action`
- `decision.selected_params.strategy_name`
- `decision.selected_params.strategy_type`
- `decision.selected_params.rsi`
- `decision.selected_params.risk`
- `compatibility.conversion_mode`

### Input Field Notes

`trade` reports alone are not sufficient as input because weekly and monthly
reports omit constants such as RSI thresholds, fee model, schedule, and executor
feature flags. The input artifact must carry those values explicitly.

The input file may be generated from an existing validate config plus report:

- validate config provides strategy constants
- report provides selected action, metrics, consensus, and provenance

## File 2: Output

File kind: `aiweget_strategy_profile_import.v1`

Owner: `D:/git/ai.weget.jp`

Producer: import/conversion tool

Consumer: Platform or infra strategy profile save API

Suggested path:

```text
docs/examples/strategy-profile-imports/*.json
```

Only `profile_json` is written to `ai_bot_strategy_profiles.profile_json` in the
current control plane.

### Output Schema

```json
{
  "import_schema_version": "aiweget_strategy_profile_import.v1",
  "import_id": "import-trade-weekly-2026-02-20-usdjpy-rsi-atr",
  "created_at": "2026-04-24T00:00:00.000Z",
  "source_artifact": {
    "artifact_schema_version": "trade_strategy_artifact.v1",
    "artifact_id": "trade-weekly-2026-02-20-usdjpy-rsi-atr",
    "source_path": "D:/git/trade/train/exports/strategy-artifacts/trade-weekly-2026-02-20-usdjpy-rsi-atr.json"
  },
  "target": {
    "bot_id": null,
    "skill_id": "stratium-trader",
    "package_name": "@ai.weget.jp/skill-stratium-trader",
    "venue_adapter": "stratium"
  },
  "profile_json": {
    "profile_schema_version": "1.0.0",
    "strategy_id": "trade_usdjpy_rsi_atr_weekly_2026_02_20",
    "strategy_version": "2026.02.20",
    "template": "rsi_atr_reversion_v1",
    "description": "Imported from trade weekly rolling decision 2026-02-20",
    "source": {
      "repository": "trade",
      "generated_at": "2026-04-24T00:00:00.000Z",
      "config_name": "weekly_2026_02_20_validate"
    },
    "market": {
      "symbol": "USDJPY",
      "venue_symbol": "USD_JPY",
      "venue_code": "GMOCOIN",
      "market_type": "fx",
      "decision_tick_seconds": 5,
      "feature_window_seconds": 60,
      "review_window_seconds": 300,
      "market_mode": "intraday_only",
      "position_mode": "single_position"
    },
    "entry": {
      "direction": "both",
      "return_15s_bps_min": 8,
      "near_rolling_high_bps_max": 2,
      "near_rolling_low_bps_max": 2,
      "max_spread_bps": 6,
      "signal_strength_divisor": 20,
      "rsi_period": 14,
      "rsi_oversold": 30,
      "rsi_overbought": 70
    },
    "exit": {
      "mode": "atr_dynamic",
      "stop_loss_bps": 20,
      "take_profit_bps": 30,
      "atr_period": 14,
      "atr_stop_loss_multiplier": 4,
      "atr_take_profit_multiplier": 4,
      "max_holding_seconds": 1800,
      "rsi_reversion_exit": 55
    },
    "risk": {
      "max_position_qty": 0.1,
      "max_concurrent_orders": 1,
      "cooldown_seconds": 0,
      "kill_switch_default": false,
      "max_session_loss": 0,
      "max_drawdown": 0,
      "dynamic_kill_switch": true,
      "symbol_whitelist": ["USDJPY"]
    },
    "executor": {
      "entry_order_qty": 0.1,
      "entry_order_qty_unit": "fx_lot",
      "entry_order_type": "marketable_limit",
      "time_in_force": "Ioc",
      "cancel_stale_orders": true,
      "stale_order_cancel_seconds": 20,
      "order_submit_timeout_ms": 5000,
      "order_submit_max_retries": 0,
      "order_reconciliation_timeout_seconds": 30,
      "require_flat_before_entry": true
    },
    "ai": {
      "review_required": true,
      "model_hint": "gpt-5.4",
      "timeout_ms": 4500,
      "on_timeout": "defer"
    }
  },
  "conversion": {
    "mode": "native",
    "warnings": [
      "target runtime must advertise native support before this profile can be used in production"
    ],
    "unsupported_features": []
  },
  "provenance_json": {
    "performance": {},
    "decision": {},
    "market": {},
    "raw_selected_params": {}
  }
}
```

### Required Output Fields

- `import_schema_version`
- `import_id`
- `created_at`
- `source_artifact.artifact_id`
- `target.skill_id`
- `profile_json.profile_schema_version`
- `profile_json.strategy_id`
- `profile_json.strategy_version`
- `profile_json.template`
- `profile_json.market`
- `profile_json.entry`
- `profile_json.exit`
- `profile_json.risk`
- `profile_json.executor`
- `profile_json.ai`
- `conversion.mode`

## Mapping Table

| Input field | Output field | Rule |
| --- | --- | --- |
| `artifact_id` | `source_artifact.artifact_id` | Copy |
| `producer.repository` | `profile_json.source.repository` | Copy |
| `producer.source_config` | `profile_json.source.config_name` | File stem |
| `generated_at` | `profile_json.source.generated_at` | Copy |
| `market.symbol` | `profile_json.market.symbol` | Copy or symbol adapter |
| `decision.selected_params.template_hint` | `profile_json.template` | Must be runtime-supported |
| `selected_params.rsi.period` | `profile_json.entry.rsi_period` | Copy |
| `selected_params.rsi.oversold` | `profile_json.entry.rsi_oversold` | Copy |
| `selected_params.rsi.overbought` | `profile_json.entry.rsi_overbought` | Copy |
| `selected_params.risk.max_positions` | `profile_json.risk.max_concurrent_orders` | Copy, minimum 1 |
| `selected_params.risk.lot_size` | `profile_json.executor.entry_order_qty` | Requires market adapter |
| `selected_params.risk.lot_size` | `profile_json.risk.max_position_qty` | Requires market adapter |
| `selected_params.risk.max_hold_minutes` | `profile_json.exit.max_holding_seconds` | `minutes * 60` |
| `selected_params.atr.period` | `profile_json.exit.atr_period` | Required for `atr_dynamic` |
| `selected_params.atr.sl_multiplier` | `profile_json.exit.atr_stop_loss_multiplier` | Required for `atr_dynamic` |
| `selected_params.atr.tp_multiplier` | `profile_json.exit.atr_take_profit_multiplier` | Required for `atr_dynamic` |
| `selected_params.schedule` | `profile_json.schedule` | Required before production native mode |
| `selected_params.executor_features` | `profile_json.features` | Required before production native mode |
| `runtime_mapping_hints.fixed_bps_fallback.stop_loss_bps` | `profile_json.exit.stop_loss_bps` | Copy if current runtime lacks ATR |
| `runtime_mapping_hints.fixed_bps_fallback.take_profit_bps` | `profile_json.exit.take_profit_bps` | Copy if current runtime lacks ATR |
| `runtime_mapping_hints.max_spread_bps` | `profile_json.entry.max_spread_bps` | Copy |
| `runtime_mapping_hints.ai_review_required` | `profile_json.ai.review_required` | Copy |
| `compatibility.unsupported_features` | `conversion.unsupported_features` | Copy |

## Runtime Compatibility Modes

### `native`

The runtime supports all selected strategy semantics. No degraded mapping is
required.

Production import requires `native` mode. `degraded_fixed_bps` is acceptable only
for local smoke tests or explicitly labelled paper experiments.

### `degraded_fixed_bps`

The runtime does not support ATR dynamic exits. The importer uses
`runtime_mapping_hints.fixed_bps_fallback` for `exit.stop_loss_bps` and
`exit.take_profit_bps`.

### `blocked`

The artifact cannot be safely converted. The importer must not write
`profile_json` to the DB.

Use `blocked` when:

- selected template is unknown
- symbol cannot be adapted
- position size cannot be adapted
- stop/take fallback is missing while ATR dynamic runtime is unavailable
- the decision action is `pause`

## Current Implementation Status

As of 2026-04-25, `D:/git/ai.weget.jp` has the first shared runtime in place:

- `@ai.weget.jp/trading-engine`
- template `rsi_atr_reversion_v1`
- RSI / ATR / MA200 / multi-timeframe aggregation
- ATR dynamic stop/take, trailing stop, RSI reversion, max hold,
  no-overnight / no-weekend, and schedule checks
- long / short parity for `direction = both`
- runtime capability matching
- deterministic replay
- `skill-stratium-trader` delegates strategy decisions to the shared engine

The remaining blocker for native acceptance is no longer "runtime does not have
the features"; it is parity evidence:

- `trade` must export a complete `trade_strategy_artifact.v1`.
- `trade` must export at least one golden replay fixture containing candles and
  expected decisions from the current `StrategyExecutor`.
- `ai.weget.jp` must replay the same artifact and candles with
  `@ai.weget.jp/trading-engine` and match the expected decisions.

Until golden replay parity passes, production import must still be treated as
not proven, even when `conversion.mode = native`.

## Multi-Venue Runtime Architecture

The long-term target is not "Stratium strategy code copied into every skill".
The target is:

```text
Strategy artifact
  -> shared strategy profile
  -> deterministic strategy engine
  -> venue adapter
  -> exchange-specific skill
```

### Shared Strategy Engine

The shared engine must own:

- candle/tick normalization
- rolling feature windows
- RSI calculation
- ATR calculation
- MA200 filter
- multi-timeframe aggregation
- signal generation
- stop/take/hold/trailing/RSI-reversion exits
- schedule and time restriction checks
- risk gates that are independent of a specific exchange
- deterministic replay mode

The engine currently lives in `D:/git/ai.weget.jp/packages-public/trading-engine`
as `@ai.weget.jp/trading-engine`. Venue skills should call that package instead
of copying strategy logic.

### Venue Adapter

Each executable skill must expose the same adapter shape:

```ts
type TradingVenueAdapter = {
  venue: string;
  marketType: 'fx' | 'spot' | 'margin' | 'perp';
  normalizeSymbol(input: string): string;
  normalizeQuantity(input: {
    symbol: string;
    value: number;
    unit: 'fx_lot' | 'base' | 'quote_notional' | 'contract';
  }): { quantity: number; unit: string };
  getMarketSnapshot(symbol: string): Promise<unknown>;
  getOpenPositions(symbol: string): Promise<unknown[]>;
  getOpenOrders(symbol: string): Promise<unknown[]>;
  submitOrder(intent: unknown): Promise<unknown>;
  cancelOrder(orderRef: unknown): Promise<unknown>;
  closePosition(intent: unknown): Promise<unknown>;
  mapExchangeEvent(event: unknown): unknown;
};
```

`skill-stratium-trader` should implement this first. Then:

- `skill-gmo-fx` maps `fx_lot` and FX symbols such as `USDJPY`
- `skill-gmo-coin` maps crypto symbols and base quantity
- future `skill-okx`, `skill-hyperliquid`, and `skill-binance` map contract,
  perp, spot, and venue-specific order constraints

### Runtime Capability Declaration

Every strategy-capable skill must declare runtime capabilities before import:

```json
{
  "skill_id": "gmo-fx",
  "venue_adapter": "gmo_fx",
  "strategy_runtime": {
    "profile_schema_versions": ["1.0.0"],
    "templates": ["rsi_atr_reversion_v1"],
    "features": [
      "atr_dynamic_exit",
      "ma200_filter",
      "multi_timeframe_rsi",
      "trailing_stop",
      "trading_schedule",
      "long_short"
    ],
    "quantity_units": ["fx_lot"],
    "order_types": ["market", "marketable_limit"],
    "time_in_force": ["Ioc"]
  }
}
```

The importer must compare artifact requirements against this capability block.
If a required feature is missing, import must be `blocked` for production.

## First Implementation Target: `skill-stratium-trader`

Before production use, `skill-stratium-trader` must execute
`trade_strategy_artifact.v1` semantics in `native` mode.

Required work:

1. Add `rsi_atr_reversion_v1` as a first-class template.
2. Extend profile types and validators for:
   - `exit.mode = atr_dynamic`
   - ATR period and multipliers
   - MA200 filter flag
   - multi-timeframe RSI settings
   - trailing stop settings
   - trading schedule and time restriction
   - quantity unit
3. Make signal generation match `trade`:
   - RSI period / oversold / overbought
   - optional MA200 filter
   - optional multi-timeframe RSI
   - long and short signals when `direction = both`
4. Make exit logic match `trade`:
   - ATR dynamic SL/TP
   - trailing stop
   - RSI reversion exit
   - max hold minutes
   - no-overnight / no-weekend / configured schedule
5. Add a Stratium venue adapter:
   - symbol conversion
   - quantity conversion
   - market snapshot
   - position/open order state
   - submit/cancel/close
   - exchange event normalization
6. Add deterministic replay tests against exported `trade` fixtures.

Native acceptance criteria:

- Given the same candle stream and artifact, `skill-stratium-trader` produces
  the same entry/exit decisions as `trade` for a golden replay fixture.
- Imported profiles with unsupported features are rejected before save or start.
- Runtime status shows the active strategy id, template, features, and venue
  adapter.
- Every submitted order has idempotent client order id and reconciliation state.
- Live mode cannot start unless profile compatibility is `native`.

## Production Rollout Rule

For production trading:

- `conversion.mode` must be `native`.
- `compatibility.unsupported_features` must be empty.
- target skill capability check must pass.
- operator approval must be explicit.
- bot-host must still own credentials and auto-submit authority.
- imported strategy must be observable in Platform before execution.

## Required Changes In `trade`

1. Add an exporter that writes `trade_strategy_artifact.v1`.
2. Export from concrete selected strategy data, not only report summaries.
3. Include schedule, fee model, executor feature flags, RSI values, ATR values,
   lot unit, and source file provenance.
4. Add snapshot tests for exported artifacts.
5. Add golden replay fixture export:
   - source artifact
   - candle slice
   - expected decisions from `StrategyExecutor`
   - expected trade lifecycle
6. Keep old reports, but do not use reports as the importer input.

Recommended trade-side files for the first implementation:

```text
train/src/scripts/export-strategy-artifact.ts
train/src/services/strategy-artifact-exporter.ts
train/test/strategy-artifact-exporter.test.ts
train/exports/strategy-artifacts/*.json
train/exports/golden-replay/*.json
```

## Required Changes In `ai.weget.jp`

1. Add an importer/converter for `trade_strategy_artifact.v1`.
2. Validate `aiweget_strategy_profile_import.v1.profile_json` before saving.
3. Show conversion warnings in Platform before applying a profile.
4. Save only `profile_json` to `ai_bot_strategy_profiles.profile_json` for the
   current DB shape.
5. Preserve `provenance_json` in a future audit table or profile metadata after
   the DB boundary is defined.
6. Add runtime support for currently unsupported features before using
   `conversion.mode = native`.

## Acceptance Criteria

- A `trade_strategy_artifact.v1` file can be converted without reading any
  training script constants.
- The converter refuses `blocked` artifacts.
- The output `profile_json` passes `normalizeStrategyProfile`.
- Platform can show the selected strategy, warnings, and target bot before save.
- bot-host can sync the saved profile and start the runtime without fallbacking
  to an empty/default strategy silently.
