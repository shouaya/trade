#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT, 'configs', 'generated', 'regime-routing', 'BTCJPY_dual_year_router_v9_loss_recheck_strict.json');
const OUTPUT_PATH = path.join(ROOT, 'configs', 'generated', 'regime-routing', 'BTCJPY_dual_year_router_v10_weekly_refined.json');
const POLICY_CATALOG_PATH = path.join(ROOT, 'configs', 'generated', 'regime-routing', 'BTCJPY_dual_year_router_v10_weekly_refined.policy.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildStrategyRef(router, strategyKey) {
  if (!strategyKey) {
    return null;
  }

  const strategy = router.strategyCatalog?.[strategyKey];
  if (!strategy) {
    return null;
  }

  return {
    strategyKey,
    strategyLabel: strategy.shortLabel,
    strategyName: strategy.strategyName
  };
}

function formatNumericCondition(label, condition) {
  if (!condition || typeof condition !== 'object') {
    return null;
  }

  const parts = [];
  if (condition.gt !== undefined) parts.push(`> ${condition.gt}`);
  if (condition.gte !== undefined) parts.push(`>= ${condition.gte}`);
  if (condition.lt !== undefined) parts.push(`< ${condition.lt}`);
  if (condition.lte !== undefined) parts.push(`<= ${condition.lte}`);

  if (!parts.length) {
    return null;
  }

  return `${label} ${parts.join(' & ')}`;
}

function summarizeWhen(when) {
  if (!when || typeof when !== 'object') {
    return '-';
  }

  const parts = [];
  if (Array.isArray(when.featureBucket) && when.featureBucket.length) {
    parts.push(`bucket=${when.featureBucket.join('/')}`);
  }

  for (const [label, key] of [
    ['rv', 'realizedVolPct'],
    ['ret', 'absReturnPct'],
    ['rg', 'avgRangePct'],
    ['up', 'upMinuteRatio']
  ]) {
    const text = formatNumericCondition(label, when[key]);
    if (text) {
      parts.push(text);
    }
  }

  if (Array.isArray(when.anyOf) && when.anyOf.length) {
    const anyParts = when.anyOf
      .map((entry) => summarizeWhen(entry))
      .filter(Boolean)
      .map((entry) => `(${entry})`);
    if (anyParts.length) {
      parts.push(`anyOf ${anyParts.join(' OR ')}`);
    }
  }

  return parts.join(' ; ') || '-';
}

function toCatalogEntry(router, rule) {
  return {
    eventSegment: rule.id,
    featureSummary: summarizeWhen(rule.when),
    ruleId: rule.id,
    layer: rule.layer,
    actionType: rule.action.type,
    riskCap: rule.action.riskCap ?? null,
    riskMultiplier: rule.action.riskMultiplier ?? null,
    strategy: buildStrategyRef(router, rule.action.strategyKey),
    rationale: rule.rationale ?? null
  };
}

function buildPolicyCatalog(router) {
  return {
    symbol: router.symbol,
    routerVersion: router.routerVersion,
    catalogVersion: `${router.routerVersion}_policy_catalog`,
    generatedDate: router.generatedDate,
    eventSegments: router.rules
      .filter((rule) => ['monthly_guard', 'weekly_guard'].includes(rule.layer))
      .sort((left, right) => left.priority - right.priority)
      .map((rule) => toCatalogEntry(router, rule)),
    dailyGuards: router.rules
      .filter((rule) => ['daily_router', 'loss_recheck'].includes(rule.layer))
      .sort((left, right) => left.priority - right.priority)
      .map((rule) => toCatalogEntry(router, rule)),
    defaultFallback: {
      action: router.executionModel?.defaultFallback?.action ?? 'trade',
      riskMultiplier: router.executionModel?.defaultFallback?.riskMultiplier ?? 1,
      strategy: buildStrategyRef(router, router.executionModel?.defaultFallback?.strategyKey)
    }
  };
}

function main() {
  const base = loadJson(INPUT_PATH);
  const router = JSON.parse(JSON.stringify(base));

  router.routerVersion = 'dual_year_v10_weekly_refined';
  router.generatedDate = new Date().toISOString().slice(0, 10);
  router.policyCatalogPath = path.basename(POLICY_CATALOG_PATH);
  router.source = {
    ...(router.source ?? {}),
    baseRouterVersion: base.routerVersion,
    notes: [
      ...((router.source && Array.isArray(router.source.notes)) ? router.source.notes : []),
      'Version 10 keeps the strict v9 loss_recheck layer and refines the weekly range router around the old W13 bucket.',
      'The main fix is to stop treating high-vol normal range weeks as generic range_rich trades and to carve out narrow subtype rules for the 2024 problem clusters.'
    ]
  };

  router.strategyCatalog = {
    ...router.strategyCatalog,
    range_extreme_down: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB65-MF6-MS9-MSG3-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB65/MF6/MS9/H8/SL1.5/TP1.5',
      role: 'extreme range down reversal'
    },
    range_extreme_up: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB65-MF4-MS9-MSG4-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB65/MF4/MS9/H6/SL1.5/TP1.5',
      role: 'extreme range up continuation'
    },
    range_tight_bearish: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS32-OB65-MF6-MS12-MSG4-HT0-MP1-LOT0.008-H6-ATRSL2-ATRTP1',
      shortLabel: 'RP7/OS32/OB65/MF6/MS12/H6/SL2/TP1',
      role: 'tight bearish range rebound'
    },
    range_tight_bearish_moderate_up: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB68-MF6-MS12-MSG4-HT0-MP1-LOT0.008-H8-ATRSL2-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB68/MF6/MS12/H8/SL2/TP1.5',
      role: 'moderate up tight bearish range'
    },
    range_tight_flat: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS32-OB68-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H6-ATRSL2-ATRTP1',
      shortLabel: 'RP7/OS32/OB68/MF4/MS9/H6/SL2/TP1',
      role: 'tight flat range rotation'
    },
    mixed_extreme_rebound: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB65-MF6-MS12-MSG3-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB65/MF6/MS12/H6/SL1.5/TP1.5',
      role: 'extreme mixed rebound'
    },
    range_low_tight_bearish_up: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS35-OB68-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS35/OB68/MF4/MS9/H8/SL1.5/TP1.5',
      role: 'low-vol tight bearish up range'
    },
    crash_rebound_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB65-MF6-MS12-MSG3-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1',
      shortLabel: 'RP5/OS32/OB65/MF6/MS12/H6/SL1.5/TP1',
      role: 'crash rebound day'
    },
    high_range_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS32-OB65-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H6-ATRSL2-ATRTP1',
      shortLabel: 'RP7/OS32/OB65/MF4/MS9/H6/SL2/TP1',
      role: 'high-range neutral day'
    },
    mixed_down_reversal_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS35-OB65-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS35/OB65/MF4/MS9/H6/SL1.5/TP1.5',
      role: 'mixed down reversal day'
    },
    dead_low_vol_bounce_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS35-OB68-MF6-MS12-MSG4-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP7/OS35/OB68/MF6/MS12/H8/SL1.5/TP1.5',
      role: 'dead low-vol bounce day'
    },
    low_vol_rotation_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS35-OB68-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP7/OS35/OB68/MF4/MS9/H8/SL1.5/TP1.5',
      role: 'low-vol rotation day'
    },
    pseudo_balance_breakout_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS35-OB65-MF4-MS12-MSG4-HT0-MP1-LOT0.008-H8-ATRSL2-ATRTP1.5',
      shortLabel: 'RP7/OS35/OB65/MF4/MS12/H8/SL2/TP1.5',
      role: 'pseudo-balance breakout day'
    },
    strong_breakout_reversion_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS32-OB65-MF6-MS12-MSG3-HT0-MP1-LOT0.008-H6-ATRSL2-ATRTP1.5',
      shortLabel: 'RP7/OS32/OB65/MF6/MS12/H6/SL2/TP1.5',
      role: 'strong breakout reversion day'
    },
    crash_fast_rebound_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB65-MF4-MS9-MSG4-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB65/MF4/MS9/H6/SL1.5/TP1.5',
      role: 'fast crash rebound day'
    },
    mixed_up_breakout_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS35-OB68-MF6-MS12-MSG4-HT0-MP1-LOT0.008-H6-ATRSL2-ATRTP1',
      shortLabel: 'RP7/OS35/OB68/MF6/MS12/H6/SL2/TP1',
      role: 'mixed up breakout day'
    },
    mixed_up_extension_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB68-MF6-MS12-MSG4-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB68/MF6/MS12/H8/SL1.5/TP1.5',
      role: 'mixed up extension day'
    },
    mixed_negative_rotation_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS35-OB68-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1',
      shortLabel: 'RP5/OS35/OB68/MF4/MS9/H8/SL1.5/TP1',
      role: 'mixed negative rotation day'
    },
    mixed_positive_rotation_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS35-OB68-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H8-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS35/OB68/MF4/MS9/H8/SL1.5/TP1.5',
      role: 'mixed positive rotation day'
    },
    mixed_positive_pulse_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS32-OB65-MF4-MS12-MSG3-HT0-MP1-LOT0.008-H8-ATRSL2-ATRTP1.5',
      shortLabel: 'RP5/OS32/OB65/MF4/MS12/H8/SL2/TP1.5',
      role: 'mixed positive pulse day'
    },
    mixed_deep_rebound_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP5-OS35-OB65-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1.5',
      shortLabel: 'RP5/OS35/OB65/MF4/MS9/H6/SL1.5/TP1.5',
      role: 'mixed deep rebound day'
    },
    range_mid_breakout_day: {
      strategyName: 'GMOCOIN-RSIMACD-RP7-OS35-OB65-MF4-MS12-MSG4-HT0-MP1-LOT0.008-H8-ATRSL2-ATRTP1.5',
      shortLabel: 'RP7/OS35/OB65/MF4/MS12/H8/SL2/TP1.5',
      role: 'moderate range-mid breakout day'
    }
  };

  const weeklyRules = router.rules.filter((rule) => rule.layer === 'weekly_guard' && ![
    'W13A_RANGE_EXTREME_DOWN_WEEK',
    'W13B_RANGE_EXTREME_UP_WEEK',
    'W13C_RANGE_HIGH_NORMAL_STOP',
    'W13D1_TIGHT_BEARISH_MODERATE_UP_WEEK',
    'W13D_TIGHT_BEARISH_RANGE_WEEK',
    'W13E_TIGHT_FLAT_RANGE_WEEK',
    'W13F_MIXED_EXTREME_REBOUND_WEEK',
    'W13G_LOW_TIGHT_BEARISH_UP_WEEK'
  ].includes(rule.id));
  const nonWeeklyRules = router.rules.filter((rule) => rule.layer !== 'weekly_guard');

  const refinedWeeklyRules = [
    {
      id: 'W13A_RANGE_EXTREME_DOWN_WEEK',
      layer: 'weekly_guard',
      priority: 131,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 9.8 },
        absReturnPct: { gte: 3 },
        avgRangePct: { gte: 0.1 }
      },
      action: {
        type: 'trade',
        riskCap: 1,
        strategyKey: 'range_extreme_down'
      },
      rationale: 'The isolated extreme-down rich-range week behaved much better with the lighter RP5/MF6-MS9 reversal than with the generic rich-range template.'
    },
    {
      id: 'W13B_RANGE_EXTREME_UP_WEEK',
      layer: 'weekly_guard',
      priority: 132,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 9.3 },
        absReturnPct: { gte: 2, lte: 2.8 },
        avgRangePct: { gte: 0.108 },
        upMinuteRatio: { gte: 48.8 }
      },
      action: {
        type: 'trade',
        riskCap: 1,
        strategyKey: 'range_extreme_up'
      },
      rationale: 'The extreme-up rich-range subtype preferred the faster MF4/MS9 continuation template instead of the original MF6/MS9 range_rich mapping.'
    },
    {
      id: 'W13C_RANGE_HIGH_NORMAL_STOP',
      layer: 'weekly_guard',
      priority: 133,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 6, lte: 8.5 },
        absReturnPct: { gte: 1.5 },
        avgRangePct: { gte: 0.067, lte: 0.091 }
      },
      action: {
        type: 'reduce',
        riskCap: 0.4,
        strategyKey: 'range_tight_bearish_moderate_up'
      },
      rationale: 'High-vol normal-width range weeks now keep a small base allocation and let the daily layer choose aggressive rebound or stop behavior instead of shutting the whole week down.'
    },
    {
      id: 'W13D1_TIGHT_BEARISH_MODERATE_UP_WEEK',
      layer: 'weekly_guard',
      priority: 134,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 4.2, lte: 4.6 },
        absReturnPct: { gte: 1.3, lte: 2.2 },
        avgRangePct: { gte: 0.045, lte: 0.0485 },
        upMinuteRatio: { gte: 45.5, lte: 46.1 }
      },
      action: {
        type: 'trade',
        riskCap: 1,
        strategyKey: 'range_tight_bearish_moderate_up'
      },
      rationale: 'Moderate-up tight bearish weeks like 2024-W23 did better with the slower H8 MF6/MS12 template, while the stronger breakout subtype still prefers the faster H6 rebound mapping.'
    },
    {
      id: 'W13D_TIGHT_BEARISH_RANGE_WEEK',
      layer: 'weekly_guard',
      priority: 135,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 4.2, lte: 5.1 },
        absReturnPct: { gte: 1.3, lte: 3.2 },
        avgRangePct: { gte: 0.046, lte: 0.053 },
        upMinuteRatio: { lte: 46 }
      },
      action: {
        type: 'trade',
        riskCap: 1,
        strategyKey: 'range_tight_bearish'
      },
      rationale: 'Tight bearish range weeks with low up-minute share recovered better with the MF6/MS12 H6 rebound template than with the broad balance fallback.'
    },
    {
      id: 'W13E_TIGHT_FLAT_RANGE_WEEK',
      layer: 'weekly_guard',
      priority: 136,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 4.1, lte: 5.5 },
        absReturnPct: { lte: 1.5 },
        avgRangePct: { gte: 0.046, lte: 0.06 },
        upMinuteRatio: { gte: 46, lte: 48.5 }
      },
      action: {
        type: 'trade',
        riskCap: 1,
        strategyKey: 'range_tight_flat'
      },
      rationale: 'Tight flat range weeks form a stable subtype and respond better to the MF4/MS9 H6 rotation template than to the old generic range_rich or balance rules.'
    },
    {
      id: 'W13F_MIXED_EXTREME_REBOUND_WEEK',
      layer: 'weekly_guard',
      priority: 137,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 10 },
        absReturnPct: { gte: 3 },
        avgRangePct: { gte: 0.13 },
        upMinuteRatio: { gte: 48, lte: 49 }
      },
      action: {
        type: 'reduce',
        riskCap: 0.35,
        strategyKey: 'range_tight_bearish_moderate_up'
      },
      rationale: 'This mixed extreme whipsaw regime keeps only a small weekly base size and relies on daily overrides instead of whole-week shutdown.'
    },
    {
      id: 'W13G_LOW_TIGHT_BEARISH_UP_WEEK',
      layer: 'weekly_guard',
      priority: 138,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 3.6, lte: 4.1 },
        absReturnPct: { gte: 2.2, lte: 3 },
        avgRangePct: { lte: 0.042 },
        upMinuteRatio: { gte: 44, lte: 45 }
      },
      action: {
        type: 'trade',
        riskCap: 1,
        strategyKey: 'range_low_tight_bearish_up'
      },
      rationale: 'Low-vol tight bearish-up weeks like 2025-W36 were not true balance weeks; the H8 MF4/MS9 mean-reversion template contained the drawdown much better.'
    }
  ];

  router.rules = [
    ...nonWeeklyRules,
    ...weeklyRules,
    ...refinedWeeklyRules
  ];

  const dailyRules = router.rules
    .filter((rule) => rule.layer === 'daily_router' && ![
      'D0_CRASH_REBOUND_DAY_SWITCH',
      'D0_HIGH_RANGE_NEUTRAL_DAY_SWITCH',
      'D0_STRONG_WIDE_DAY_STOP',
      'D0_MIXED_SWING_DAY_STOP'
    ].includes(rule.id))
    .sort((left, right) => left.priority - right.priority);
  const nonDailyRules = router.rules.filter((rule) => rule.layer !== 'daily_router');

  const refinedDailyRules = [
    {
      id: 'D0A_CRASH_REBOUND_EXTREME_DAY_SWITCH',
      layer: 'daily_router',
      priority: 90,
      when: {
        featureBucket: ['crash-trend'],
        realizedVolPct: { gte: 3.5, lte: 6.5 },
        absReturnPct: { gte: 6 },
        avgRangePct: { gte: 0.12 },
        upMinuteRatio: { gte: 47.4 }
      },
      action: {
        type: 'trade',
        strategyKey: 'crash_rebound_day'
      },
      rationale: 'Only the true capitulation-and-rebound crash days keep the dedicated reversal switch; this excludes the smaller failed rebound subtype that hurt 2024-W11.'
    },
    {
      id: 'D0B_CRASH_REBOUND_TIGHT_DAY_SWITCH',
      layer: 'daily_router',
      priority: 91,
      when: {
        featureBucket: ['crash-trend'],
        realizedVolPct: { gte: 2.7, lte: 3.1 },
        absReturnPct: { gte: 2.7, lte: 3.2 },
        avgRangePct: { gte: 0.085, lte: 0.089 },
        upMinuteRatio: { gte: 48.9 }
      },
      action: {
        type: 'trade',
        strategyKey: 'crash_rebound_day'
      },
      rationale: 'The small-range crash rebound pocket is kept as a separate subtype so the router can retain the 2024-07 rebound edge without firing on the broader January loss cluster.'
    },
    {
      id: 'D0C_CRASH_FAST_REBOUND_DAY_SWITCH',
      layer: 'daily_router',
      priority: 92,
      when: {
        featureBucket: ['crash-trend'],
        realizedVolPct: { gte: 2.75, lte: 2.95 },
        absReturnPct: { gte: 5, lte: 6 },
        avgRangePct: { gte: 0.09, lte: 0.096 },
        upMinuteRatio: { gte: 48.8 }
      },
      action: {
        type: 'trade',
        strategyKey: 'crash_fast_rebound_day'
      },
      rationale: 'Moderate-vol crash rebound days behave better with the faster MF4/MS9 reversal template than with the slower crash rebound base.'
    },
    {
      id: 'D0A_HIGH_RANGE_NEUTRAL_WIDE_DAY_SWITCH',
      layer: 'daily_router',
      priority: 95,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 3.3 },
        absReturnPct: { lte: 1.5 },
        avgRangePct: { gte: 0.114 },
        upMinuteRatio: { gte: 48.8 }
      },
      action: {
        type: 'trade',
        strategyKey: 'high_range_day'
      },
      rationale: 'Only the clearly wide neutral range days keep the fast intraday rotation override; the lower-range near-neutral subtype falls back to the weekly base.'
    },
    {
      id: 'D0B_HIGH_RANGE_NEUTRAL_TIGHT_DAY_SWITCH',
      layer: 'daily_router',
      priority: 96,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 4.4, lte: 4.8 },
        absReturnPct: { lte: 0.6 },
        avgRangePct: { gte: 0.103, lte: 0.107 },
        upMinuteRatio: { gte: 48.8, lte: 49 }
      },
      action: {
        type: 'trade',
        strategyKey: 'high_range_day'
      },
      rationale: 'A narrow surgical subtype preserves the early-2024 positive neutral-range rebound day without reopening the wider March false-positive cluster.'
    },
    {
      id: 'D0C_PSEUDO_BALANCE_BREAKOUT_DAY_SWITCH',
      layer: 'daily_router',
      priority: 97,
      when: {
        featureBucket: ['range-mid-vol'],
        absReturnPct: { lte: 0.8 },
        realizedVolPct: { gte: 3.3, lte: 3.5 },
        avgRangePct: { gte: 0.109, lte: 0.1125 },
        upMinuteRatio: { gte: 50 }
      },
      action: {
        type: 'trade',
        strategyKey: 'pseudo_balance_breakout_day'
      },
      rationale: 'Some pseudo-balanced rich-range days are actually latent breakout continuation days and should not be blanket-stopped.'
    },
    {
      id: 'D0D_RANGE_RICH_BULL_TRAP_DAY_STOP',
      layer: 'daily_router',
      priority: 98,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 3.25, lte: 3.5 },
        absReturnPct: { gte: 1.2, lte: 1.5 },
        avgRangePct: { gte: 0.1, lte: 0.106 },
        upMinuteRatio: { gte: 51.5 }
      },
      action: {
        type: 'stop',
        riskMultiplier: 0
      },
      rationale: 'Bull-trap rich-range days where every candidate loses should be stopped at the day level instead of forcing the weekly range template.'
    },
    {
      id: 'D0E_STRONG_BREAKOUT_REVERSION_DAY_SWITCH',
      layer: 'daily_router',
      priority: 99,
      when: {
        featureBucket: ['strong-trend'],
        realizedVolPct: { gte: 3.5, lte: 3.8 },
        absReturnPct: { gte: 6.5 },
        avgRangePct: { gte: 0.12, lte: 0.126 },
        upMinuteRatio: { gte: 51 }
      },
      action: {
        type: 'trade',
        strategyKey: 'strong_breakout_reversion_day'
      },
      rationale: 'Large upside breakout days inside a rich-range week preferred the faster H6 MF6/MS12 reversion profile over the generic weekly range-rich mapping.'
    },
    {
      id: 'D0F_MIXED_DOWN_REVERSAL_DAY_SWITCH',
      layer: 'daily_router',
      priority: 100,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 1.85, lte: 2.0 },
        absReturnPct: { gte: 1.8, lte: 2.0 },
        avgRangePct: { gte: 0.056, lte: 0.058 },
        upMinuteRatio: { lte: 46 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_down_reversal_day'
      },
      rationale: 'Mixed down days with weaker up-minute participation can still reverse intraday; they need a dedicated fast reversal override instead of the generic mixed reduction.'
    },
    {
      id: 'D0G_LOW_VOL_ROTATION_DAY_SWITCH',
      layer: 'daily_router',
      priority: 101,
      when: {
        featureBucket: ['range-low-vol'],
        realizedVolPct: { gte: 1.68, lte: 1.78 },
        absReturnPct: { lte: 0.35 },
        avgRangePct: { gte: 0.049, lte: 0.052 },
        upMinuteRatio: { gte: 48.2 }
      },
      action: {
        type: 'trade',
        strategyKey: 'low_vol_rotation_day'
      },
      rationale: 'Low-vol rotation days with decent internal participation are better served by the H8 MF4/MS9 rotation template than by the guarded range-balance base.'
    },
    {
      id: 'D0H_DEAD_LOW_VOL_BOUNCE_DAY_SWITCH',
      layer: 'daily_router',
      priority: 102,
      when: {
        featureBucket: ['range-low-vol'],
        realizedVolPct: { gte: 1.45, lte: 1.65 },
        absReturnPct: { lte: 0.45 },
        avgRangePct: { gte: 0.035, lte: 0.04 },
        upMinuteRatio: { lte: 41.5 }
      },
      action: {
        type: 'trade',
        strategyKey: 'dead_low_vol_bounce_day'
      },
      rationale: 'A very narrow dead-low-vol subtype still produces profitable bounce entries and should override the generic dead-day stop.'
    },
    {
      id: 'D0I_RANGE_RICH_LOW_VOL_ROTATION_DAY_SWITCH',
      layer: 'daily_router',
      priority: 103,
      when: {
        featureBucket: ['range-low-vol'],
        realizedVolPct: { gte: 1.85, lte: 2.0 },
        absReturnPct: { lte: 0.8 },
        avgRangePct: { gte: 0.06, lte: 0.0625 },
        upMinuteRatio: { gte: 48.8 }
      },
      action: {
        type: 'trade',
        strategyKey: 'dead_low_vol_bounce_day'
      },
      rationale: 'Some low-vol cooldown days after rich-range expansion still reward the slower H8 bounce template rather than the weekly base.'
    },
    {
      id: 'D0J_MIXED_UP_BREAKOUT_DAY_SWITCH',
      layer: 'daily_router',
      priority: 104,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 1.72, lte: 1.82 },
        absReturnPct: { gte: 2.2, lte: 2.5 },
        avgRangePct: { gte: 0.052, lte: 0.054 },
        upMinuteRatio: { gte: 49.1, lte: 49.4 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_up_breakout_day'
      },
      rationale: 'A narrow mixed up-breakout subtype benefits from the H6 MF6/MS12 continuation-reversion profile instead of the guarded balance fallback.'
    },
    {
      id: 'D0K_MIXED_UP_EXTENSION_DAY_SWITCH',
      layer: 'daily_router',
      priority: 105,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 2.35, lte: 2.5 },
        absReturnPct: { gte: 3.7, lte: 4.2 },
        avgRangePct: { gte: 0.064, lte: 0.0665 },
        upMinuteRatio: { gte: 49.3, lte: 49.6 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_up_extension_day'
      },
      rationale: 'Stronger mixed extension days preferred the slower H8 MF6/MS12 template over the base range-balance allocation.'
    },
    {
      id: 'D0L_MIXED_NEGATIVE_ROTATION_DAY_SWITCH',
      layer: 'daily_router',
      priority: 106,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 2.4, lte: 2.55 },
        absReturnPct: { gte: 2.1, lte: 2.3 },
        avgRangePct: { gte: 0.069, lte: 0.0715 },
        upMinuteRatio: { gte: 48, lte: 48.3 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_negative_rotation_day'
      },
      rationale: 'Mixed down-rotation days inside rich-range weeks do better with the H8 MF4/MS9 TP1 rotation profile than with the generic weekly template.'
    },
    {
      id: 'D0M_MIXED_POSITIVE_PULSE_DAY_SWITCH',
      layer: 'daily_router',
      priority: 107,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 2.6, lte: 2.75 },
        absReturnPct: { gte: 1.5, lte: 1.75 },
        avgRangePct: { gte: 0.065, lte: 0.0665 },
        upMinuteRatio: { gte: 50.5, lte: 50.8 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_positive_pulse_day'
      },
      rationale: 'Positive mixed pulse days with strong internal participation respond better to the H8 MF4/MS12 pulse strategy than to the weekly rich-range base.'
    },
    {
      id: 'D0N_MIXED_POSITIVE_ROTATION_DAY_SWITCH',
      layer: 'daily_router',
      priority: 108,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 2.55, lte: 2.65 },
        absReturnPct: { gte: 2.2, lte: 2.35 },
        avgRangePct: { gte: 0.078, lte: 0.08 },
        upMinuteRatio: { gte: 48.2, lte: 48.5 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_positive_rotation_day'
      },
      rationale: 'Wider positive mixed days favored the H8 MF4/MS9 rotation profile rather than the half-size balance fallback.'
    },
    {
      id: 'D0O_MIXED_DEEP_REBOUND_DAY_SWITCH',
      layer: 'daily_router',
      priority: 109,
      when: {
        featureBucket: ['mixed-trend'],
        realizedVolPct: { gte: 2, lte: 2.15 },
        absReturnPct: { gte: 3.8, lte: 4.1 },
        avgRangePct: { gte: 0.063, lte: 0.0655 },
        upMinuteRatio: { gte: 46.1, lte: 46.4 }
      },
      action: {
        type: 'trade',
        strategyKey: 'mixed_deep_rebound_day'
      },
      rationale: 'Deep mixed down days with low up-minute share needed the fast H6 rebound template instead of the weekly base.'
    },
    {
      id: 'D0P_RANGE_MID_BREAKOUT_DAY_SWITCH',
      layer: 'daily_router',
      priority: 110,
      when: {
        featureBucket: ['range-mid-vol'],
        realizedVolPct: { gte: 2.6, lte: 2.75 },
        absReturnPct: { gte: 0.85, lte: 1 },
        avgRangePct: { gte: 0.085, lte: 0.0865 },
        upMinuteRatio: { gte: 48.9, lte: 49.1 }
      },
      action: {
        type: 'trade',
        strategyKey: 'range_mid_breakout_day'
      },
      rationale: 'Moderate-vol range-mid breakout days should switch into the H8 MF4/MS12 breakout profile instead of staying on the balance fallback.'
    }
  ];

  router.rules = [
    ...nonDailyRules,
    ...refinedDailyRules,
    ...dailyRules
  ];

  const policyCatalog = buildPolicyCatalog(router);
  writeJson(OUTPUT_PATH, router);
  writeJson(POLICY_CATALOG_PATH, policyCatalog);
  console.log(`Loss-recheck router written: ${OUTPUT_PATH}`);
  console.log(`Policy catalog written: ${POLICY_CATALOG_PATH}`);
}

main();
