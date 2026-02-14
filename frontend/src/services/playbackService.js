/**
 * 播放服务 - 业务逻辑
 * 负责加载数据和播放控制
 */

import { klinesAPI } from '../api/api.js';
import { createPlaybackController } from '../hooks/usePlaybackControl.js';

/**
 * 加载 K 线数据
 * @param {Object} params - UI 参数
 * @param {string} params.symbol - 交易对
 * @param {string} params.interval - 时间周期（如 '1m', '5m'）
 * @param {number} [params.limit] - 限制数量
 * @param {string} [params.startDate] - 开始日期
 * @param {string} [params.startTime] - 开始时间
 * @param {string} [params.endDate] - 结束日期
 * @param {string} [params.endTime] - 结束时间
 * @returns {Promise<Array>} K 线数据数组
 */
export async function loadKlineData(params) {
  const { symbol, interval, limit, startDate, startTime, endDate, endTime } = params;

  // 转换 interval 格式: 1m -> 1min, 1h -> 1hour, 1d -> 1day
  const dbInterval = interval
    .replace(/^(\d+)m$/, '$1min')
    .replace(/^(\d+)h$/, '$1hour')
    .replace(/^(\d+)d$/, '$1day');

  // 构建查询参数
  const apiParams = {
    symbol,
    interval: dbInterval,
    limit: limit || 5000
  };

  // 如果指定了时间范围
  if (startDate && endDate) {
    // 使用 'Z' 后缀明确指定为UTC时间，避免浏览器转换为本地时区
    const startTimestamp = new Date(`${startDate}T${startTime}:00Z`).getTime();
    const endTimestamp = new Date(`${endDate}T${endTime}:59Z`).getTime();
    apiParams.start = startTimestamp;
    apiParams.end = endTimestamp;
  }

  // 调用 API 获取 K 线数据
  const response = await klinesAPI.getKlines(apiParams);

  if (!response.success) {
    throw new Error(response.message || '加载数据失败');
  }

  if (!response.data || response.data.length === 0) {
    throw new Error('未找到符合条件的 K 线数据');
  }

  console.log(`✅ 加载了 ${response.data.length} 条 K 线数据`);

  return response.data;
}

/**
 * 播放 K 线数据（业务逻辑）
 * @param {Object} params - 播放参数
 * @param {Array} params.klineData - K 线数据
 * @param {number} params.speed - 播放速度（毫秒）
 * @param {Function} params.onUpdate - 更新回调函数
 * @param {Function} params.onComplete - 完成回调函数
 * @returns {Object} 播放控制器
 */
export function startPlayback(params) {
  const { klineData, speed, onUpdate, onComplete } = params;

  const controller = createPlaybackController();
  controller.setData(klineData);

  let currentIndex = -1;

  const setCurrentIndex = (updater) => {
    const newIndex = typeof updater === 'function' ? updater(currentIndex) : updater;
    currentIndex = newIndex;

    const kline = klineData[currentIndex];
    if (kline && onUpdate) {
      onUpdate(currentIndex, kline);
    }
  };

  const setIsPlaying = (value) => {
    if (!value) {
      controller.stop();
      if (onComplete) {
        onComplete();
      }
    }
  };

  controller.start(speed, setCurrentIndex, setIsPlaying);

  return controller;
}
