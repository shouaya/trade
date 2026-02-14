/**
 * 播放控制 Hook
 * 从 SimulatorPage 中提取的核心播放逻辑，便于测试
 */

import { useEffect, useRef } from 'react';

/**
 * 播放控制 Hook
 * @param {boolean} isPlaying - 是否正在播放
 * @param {number} speed - 播放速度（毫秒）
 * @param {Array} klineData - K线数据数组
 * @param {Function} setCurrentIndex - 更新当前索引的函数
 * @param {Function} setIsPlaying - 更新播放状态的函数
 * @returns {Object} - 返回 ref 对象
 */
export function usePlaybackControl(isPlaying, speed, klineData, setCurrentIndex, setIsPlaying) {
  const klineDataRef = useRef([]);
  const isPlayingRef = useRef(false);

  // 同步数据到 ref
  useEffect(() => {
    klineDataRef.current = klineData;
  }, [klineData]);

  // 同步 isPlaying 到 ref
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 播放控制
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = setInterval(() => {
      setCurrentIndex(prev => {
        const dataLength = klineDataRef.current.length;
        const next = prev + 1;

        if (next >= dataLength) {
          setIsPlaying(false);
          return prev;
        }
        return next;
      });
    }, speed);

    return () => {
      clearInterval(timer);
    };
  }, [isPlaying, speed]);

  return { klineDataRef, isPlayingRef };
}

/**
 * 创建播放控制函数（用于测试）
 * 不依赖 React hooks，纯函数实现
 */
export function createPlaybackController() {
  const klineDataRef = { current: [] };
  const isPlayingRef = { current: false };
  let timer = null;

  const start = (speed, setCurrentIndex, setIsPlaying) => {
    if (timer) {
      clearInterval(timer);
    }

    isPlayingRef.current = true;

    timer = setInterval(() => {
      setCurrentIndex(prev => {
        const dataLength = klineDataRef.current.length;
        const next = prev + 1;

        if (next >= dataLength) {
          setIsPlaying(false);
          isPlayingRef.current = false;
          clearInterval(timer);
          timer = null;
          return prev;
        }
        return next;
      });
    }, speed);

    return timer;
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    isPlayingRef.current = false;
  };

  const setData = (data) => {
    klineDataRef.current = data;
  };

  return {
    klineDataRef,
    isPlayingRef,
    start,
    stop,
    setData,
  };
}
