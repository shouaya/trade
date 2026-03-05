/**
 * 生成滚动窗口配置文件
 *
 * 为每个月生成：
 * 1. 训练配置（使用过去12个月数据）
 * 2. 验证配置（只在当月验证）
 */

const fs = require('fs');
const path = require('path');

// 配置目录
const ROLLING_WINDOW_DIR = path.join(__dirname, '../configs/rolling_window');
const VALIDATION_DIR = path.join(ROLLING_WINDOW_DIR, 'validation');

// 确保目录存在
if (!fs.existsSync(ROLLING_WINDOW_DIR)) {
  fs.mkdirSync(ROLLING_WINDOW_DIR, { recursive: true });
}
if (!fs.existsSync(VALIDATION_DIR)) {
  fs.mkdirSync(VALIDATION_DIR, { recursive: true });
}

/**
 * 获取月份的最后一天
 */
function getLastDayOfMonth(year, month) {
  const date = new Date(year, month, 0);
  return date.getDate();
}

/**
 * 转换日期为时间戳
 */
function dateToTimestamp(dateStr) {
  return new Date(dateStr).getTime();
}

/**
 * 生成月度配置
 */
function generateMonthlyConfigs() {
  const months = [
    // 2025年1月到12月
    { exec: '2025-01', trainStart: '2024-01', trainEnd: '2024-12' },
    { exec: '2025-02', trainStart: '2024-02', trainEnd: '2025-01' },
    { exec: '2025-03', trainStart: '2024-03', trainEnd: '2025-02' },
    { exec: '2025-04', trainStart: '2024-04', trainEnd: '2025-03' },
    { exec: '2025-05', trainStart: '2024-05', trainEnd: '2025-04' },
    { exec: '2025-06', trainStart: '2024-06', trainEnd: '2025-05' },
    { exec: '2025-07', trainStart: '2024-07', trainEnd: '2025-06' },
    { exec: '2025-08', trainStart: '2024-08', trainEnd: '2025-07' },
    { exec: '2025-09', trainStart: '2024-09', trainEnd: '2025-08' },
    { exec: '2025-10', trainStart: '2024-10', trainEnd: '2025-09' },
    { exec: '2025-11', trainStart: '2024-11', trainEnd: '2025-10' },
    { exec: '2025-12', trainStart: '2024-12', trainEnd: '2025-11' },
    // 2026年1月到2月
    { exec: '2026-01', trainStart: '2025-01', trainEnd: '2025-12' },
    { exec: '2026-02', trainStart: '2025-02', trainEnd: '2026-01' }
  ];

  months.forEach(({ exec, trainStart, trainEnd }) => {
    generateTrainingConfig(exec, trainStart, trainEnd);
    generateValidationConfig(exec);
  });

  console.log(`\n✅ 成功生成 ${months.length * 2} 个配置文件！`);
  console.log(`   - ${months.length} 个训练配置`);
  console.log(`   - ${months.length} 个验证配置`);
}

/**
 * 生成训练配置
 */
function generateTrainingConfig(execMonth, trainStartMonth, trainEndMonth) {
  const [execYear, execMo] = execMonth.split('-');
  const [trainStartYear, trainStartMo] = trainStartMonth.split('-');
  const [trainEndYear, trainEndMo] = trainEndMonth.split('-');

  const trainStartDay = `${trainStartYear}-${trainStartMo}-01`;
  const trainEndDay = `${trainEndYear}-${trainEndMo}-${getLastDayOfMonth(parseInt(trainEndYear), parseInt(trainEndMo))}`;

  const config = {
    name: `ROLLING_${execMonth.replace('-', '_')}_TRAIN`,
    description: `${execMonth}执行月 - 使用${trainStartMonth}到${trainEndMonth}数据训练`,
    timeRange: {
      startTimeMs: dateToTimestamp(`${trainStartDay}T00:00:00.000Z`),
      endTimeMs: dateToTimestamp(`${trainEndDay}T23:59:00.000Z`),
      startIso: `${trainStartDay}T00:00:00.000Z`,
      endIso: `${trainEndDay}T23:59:00.000Z`
    },
    market: {
      symbol: "USDJPY",
      intervalType: "1min"
    },
    database: {
      tableName: `backtest_results_rolling_${execMonth.replace('-', '_')}_train`
    },
    strategy: {
      types: ["rsi_only"],
      parameters: {
        rsi: {
          period: [14],
          oversold: [30],
          overbought: [70]
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.1],
          maxHoldMinutes: [5, 10, 15, 20, 25, 30]
        },
        atr: {
          slMultiplier: [2.0, 2.5, 3.0, 3.5, 4.0],
          tpMultiplier: [3.0, 4.0, 5.0, 6.0, 7.0]
        },
        tradingSchedule: "* 0-19 * * 1-5",
        tradingTimeRestriction: {
          enabled: true,
          utcExcludeStart: "19:30",
          utcExcludeEnd: "23:59",
          description: "排除UTC 19:30-23:59"
        }
      }
    },
    executor: {
      version: "v3",
      options: {
        enableMA200Filter: true,
        enableMultiTimeframe: true,
        enableATRSizing: true,
        enableTrailingStop: true,
        enableRSIReversion: true
      }
    },
    output: {
      topN: 10,
      strategyNamePrefix: `Rolling-${execMonth}-`,
      descriptionPrefix: `滚动窗口${execMonth}月策略`
    }
  };

  const filename = `train_${execMonth.replace('-', '_')}.json`;
  const filepath = path.join(ROLLING_WINDOW_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(config, null, 2));
  console.log(`✓ 生成训练配置: ${filename}`);
}

/**
 * 生成验证配置
 */
function generateValidationConfig(execMonth) {
  const [execYear, execMo] = execMonth.split('-');

  const valStartDay = `${execYear}-${execMo}-01`;
  const valEndDay = `${execYear}-${execMo}-${getLastDayOfMonth(parseInt(execYear), parseInt(execMo))}`;

  const config = {
    name: `ROLLING_${execMonth.replace('-', '_')}_VALIDATE`,
    description: `${execMonth}执行月 - 使用该月最佳策略在${execMonth}验证`,
    timeRange: {
      startTimeMs: dateToTimestamp(`${valStartDay}T00:00:00.000Z`),
      endTimeMs: dateToTimestamp(`${valEndDay}T23:59:00.000Z`),
      startIso: `${valStartDay}T00:00:00.000Z`,
      endIso: `${valEndDay}T23:59:00.000Z`
    },
    market: {
      symbol: "USDJPY",
      intervalType: "1min"
    },
    database: {
      tableName: `backtest_results_rolling_${execMonth.replace('-', '_')}_validate`
    },
    strategy: {
      types: ["rsi_only"],
      parameters: {
        rsi: {
          period: [14],
          oversold: [30],
          overbought: [70]
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.1],
          maxHoldMinutes: "{{FROM_TRAINING_RESULT}}"
        },
        atr: {
          slMultiplier: "{{FROM_TRAINING_RESULT}}",
          tpMultiplier: "{{FROM_TRAINING_RESULT}}"
        },
        tradingSchedule: "* 0-19 * * 1-5",
        tradingTimeRestriction: {
          enabled: true,
          utcExcludeStart: "19:30",
          utcExcludeEnd: "23:59"
        }
      }
    },
    executor: {
      version: "v3",
      options: {
        enableMA200Filter: true,
        enableMultiTimeframe: true,
        enableATRSizing: true,
        enableTrailingStop: true,
        enableRSIReversion: true
      }
    },
    sourceTrainingTable: `backtest_results_rolling_${execMonth.replace('-', '_')}_train`,
    note: "此配置的参数会从训练结果的最佳策略中自动填充"
  };

  const filename = `validate_${execMonth.replace('-', '_')}.json`;
  const filepath = path.join(VALIDATION_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(config, null, 2));
  console.log(`✓ 生成验证配置: validation/${filename}`);
}

// 执行生成
console.log('开始生成滚动窗口配置文件...\n');
generateMonthlyConfigs();
console.log('\n配置文件位置:');
console.log(`  训练配置: ${ROLLING_WINDOW_DIR}/train_YYYY_MM.json`);
console.log(`  验证配置: ${VALIDATION_DIR}/validate_YYYY_MM.json`);
