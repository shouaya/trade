import { useState, useEffect, useRef } from 'react';
import ChartComponent from '../components/ChartComponent';
import TradingPanel from '../components/TradingPanel';
import PlaybackControls from '../components/PlaybackControls';
import { klinesAPI, tradesAPI } from '../api/api';
import { loadKlineData as loadKlineDataService } from '../services/playbackService';
import { usePlaybackControl } from '../hooks/usePlaybackControl';
import { calculateRSI, calculateMACD } from '../utils/indicators';
import './SimulatorPage.css';

function SimulatorPage({ replayTrade }) {
  const [klineData, setKlineData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000); // 1秒一根K线（默认速度）
  const [startTime, setStartTime] = useState(null);
  const [trade, setTrade] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 使用 ref 避免闭包问题
  const klineDataRef = useRef([]);
  const isPlayingRef = useRef(false);

  // 数据源选择
  const [symbol, setSymbol] = useState('USDJPY');
  const [interval, setInterval] = useState('1m');
  const [startDate, setStartDate] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('00:00');
  const [endDate, setEndDate] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('23:59');
  const [showDataSelector, setShowDataSelector] = useState(true);
  const [dataRangeInfo, setDataRangeInfo] = useState(null);

  // 加载数据源的时间范围信息
  useEffect(() => {
    async function loadDataRange() {
      try {
        // 检查 interval 是否有效
        if (!interval) {
          return;
        }

        const response = await klinesAPI.getStats();
        if (response.success && response.data) {
          // 转换 interval 格式以匹配数据库: 1m -> 1min, 1h -> 1hour, 1d -> 1day
          const dbInterval = interval
            .replace(/^(\d+)m$/, '$1min')
            .replace(/^(\d+)h$/, '$1hour')
            .replace(/^(\d+)d$/, '$1day');

          // 找到当前选择的数据源信息
          const info = response.data.find(
            item => item.symbol === symbol && item.interval_type === dbInterval
          );
          setDataRangeInfo(info);
        }
      } catch (err) {
        console.error('获取数据范围失败:', err);
      }
    }
    loadDataRange();
  }, [symbol, interval]);

  // 加载数据 - 调用业务代码
  const loadKlineData = async () => {
    try {
      setLoading(true);
      setError(null);

      // 构建参数
      const params = {
        symbol,
        interval,
        limit: 5000
      };

      // 如果指定了时间范围
      if (startDate && endDate) {
        params.startDate = startDate;
        params.startTime = startTimeInput;
        params.endDate = endDate;
        params.endTime = endTimeInput;
      }

      // 调用业务代码加载数据
      const data = await loadKlineDataService(params);

      setKlineData(data);
      klineDataRef.current = data; // 同步到 ref
      setStartTime(new Date(parseInt(data[0].openTime)));
      // 从第35根K线开始，这样RSI和MACD都能立即显示
      setCurrentIndex(Math.min(35, data.length - 1));
      setShowDataSelector(false);
    } catch (err) {
      console.error('❌ 加载数据失败:', err);
      setError(`无法加载 K 线数据: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 使用播放控制 Hook（和测试使用同一套代码）
  usePlaybackControl(isPlaying, speed, klineData, setCurrentIndex, setIsPlaying);

  // 当前K线和时间
  const currentKline = klineData[currentIndex];
  const currentTime = currentKline
    ? new Date(parseInt(currentKline.openTime))
    : startTime;

  // 获取指定索引位置的指标值
  const getIndicatorValues = (index) => {
    if (index < 0 || index >= klineData.length) return null;

    const indicators = {
      rsi: null,
      macd: null,
      macdSignal: null,
      macdHistogram: null
    };

    // 计算 RSI（需要至少 15 根K线）
    if (index >= 14 && klineData.length > 14) {
      const rsiData = calculateRSI(klineData, 14);
      const currentTime = parseInt(klineData[index].openTime) / 1000;
      const rsiPoint = rsiData.find(item => item.time === currentTime);
      if (rsiPoint) {
        indicators.rsi = rsiPoint.value;
      }
    }

    // 计算 MACD（需要至少 35 根K线）
    if (index >= 34 && klineData.length > 35) {
      const macdData = calculateMACD(klineData, 12, 26, 9);
      const currentTime = parseInt(klineData[index].openTime) / 1000;
      const macdPoint = macdData.macd.find(item => item.time === currentTime);
      const signalPoint = macdData.signal.find(item => item.time === currentTime);
      const histogramPoint = macdData.histogram.find(item => item.time === currentTime);

      if (macdPoint) indicators.macd = macdPoint.value;
      if (signalPoint) indicators.macdSignal = signalPoint.value;
      if (histogramPoint) indicators.macdHistogram = histogramPoint.value;
    }

    return indicators;
  };

  // 开始交易
  const handleStartTrade = (tradeParams) => {
    const entryTime = parseInt(klineData[currentIndex].openTime);
    // 使用传入的自定义价格，如果没有则使用当前K线收盘价
    const entryPrice = tradeParams.entryPrice || parseFloat(klineData[currentIndex].close);

    // 获取入场时的指标值
    const entryIndicators = getIndicatorValues(currentIndex);

    setTrade({
      ...tradeParams,
      entryTime,
      entryPrice,
      entryIndex: currentIndex,
      // 保存入场时的指标值
      entryRsi: entryIndicators?.rsi,
      entryMacd: entryIndicators?.macd,
      entryMacdSignal: entryIndicators?.macdSignal,
      entryMacdHistogram: entryIndicators?.macdHistogram,
    });

    setTradeResult(null);
  };

  // 检查交易状态
  useEffect(() => {
    if (!trade || !currentKline) return;

    const currentPrice = parseFloat(currentKline.close);
    const high = parseFloat(currentKline.high);
    const low = parseFloat(currentKline.low);
    const currentTime = parseInt(currentKline.openTime);
    const elapsedMinutes = (currentTime - trade.entryTime) / 60000;

    let exitReason = null;
    let exitPrice = null;

    // 检查止损止盈
    if (trade.direction === 'long') {
      if (trade.stopLoss && low <= trade.stopLoss) {
        exitReason = 'stop_loss';
        exitPrice = trade.stopLoss;
      } else if (trade.takeProfit && high >= trade.takeProfit) {
        exitReason = 'take_profit';
        exitPrice = trade.takeProfit;
      }
    } else {
      if (trade.stopLoss && high >= trade.stopLoss) {
        exitReason = 'stop_loss';
        exitPrice = trade.stopLoss;
      } else if (trade.takeProfit && low <= trade.takeProfit) {
        exitReason = 'take_profit';
        exitPrice = trade.takeProfit;
      }
    }

    // 检查持仓时间
    if (!exitReason && elapsedMinutes >= trade.holdMinutes) {
      exitReason = 'hold_time_reached';
      exitPrice = currentPrice;
    }

    // 如果触发退出
    if (exitReason) {
      const priceDiff = trade.direction === 'long'
        ? exitPrice - trade.entryPrice
        : trade.entryPrice - exitPrice;

      const pips = priceDiff * 100;
      const pnl = pips * 10 * (trade.lotSize || 1);
      const percent = (priceDiff / trade.entryPrice) * 100;

      // 获取出场时的指标值
      const exitIndicators = getIndicatorValues(currentIndex);

      const result = {
        exitTime: currentTime,
        exitPrice,
        exitReason,
        pnl: parseFloat(pnl.toFixed(2)),
        pips: parseFloat(pips.toFixed(2)),
        percent: parseFloat(percent.toFixed(4)),
        holdMinutes: Math.round(elapsedMinutes),
        // 保存出场时的指标值
        exitRsi: exitIndicators?.rsi,
        exitMacd: exitIndicators?.macd,
        exitMacdSignal: exitIndicators?.macdSignal,
        exitMacdHistogram: exitIndicators?.macdHistogram,
      };

      setTradeResult(result);
      setTrade(null);
      setIsPlaying(false);

      // 保存交易记录到数据库
      saveTradeToDatabase(trade, result);
    }
  }, [currentKline, trade]);

  // 保存交易记录到数据库
  const saveTradeToDatabase = async (tradeData, result) => {
    try {
      const tradeRecord = {
        direction: tradeData.direction,
        entryTime: tradeData.entryTime,
        entryPrice: tradeData.entryPrice,
        entryIndex: tradeData.entryIndex,
        lotSize: tradeData.lotSize || 1,
        holdMinutes: tradeData.holdMinutes,
        stopLoss: tradeData.stopLoss,
        takeProfit: tradeData.takeProfit,
        exitTime: result.exitTime,
        exitPrice: result.exitPrice,
        exitReason: result.exitReason,
        pnl: result.pnl,
        pips: result.pips,
        percent: result.percent,
        actualHoldMinutes: result.holdMinutes,
        strategyName: tradeData.strategyName || '手动交易',
        symbol: 'USDJPY',
        // 入场时的指标值
        entryRsi: tradeData.entryRsi,
        entryMacd: tradeData.entryMacd,
        entryMacdSignal: tradeData.entryMacdSignal,
        entryMacdHistogram: tradeData.entryMacdHistogram,
        // 出场时的指标值
        exitRsi: result.exitRsi,
        exitMacd: result.exitMacd,
        exitMacdSignal: result.exitMacdSignal,
        exitMacdHistogram: result.exitMacdHistogram,
      };

      const response = await tradesAPI.createTrade(tradeRecord);
      if (response.success) {
        console.log('✅ 交易记录已保存到数据库, ID:', response.tradeId);
      }
    } catch (error) {
      console.error('❌ 保存交易记录失败:', error);
    }
  };

  // 显示数据选择器
  if (showDataSelector || klineData.length === 0) {
    return (
      <div className="simulator-page">
        <div className="data-selector">
          <h2>📊 选择模拟数据源</h2>
          <p className="selector-description">
            选择交易对、时间间隔和时间范围来加载历史数据进行模拟交易
          </p>

          <div className="selector-form">
            <div className="form-row">
              <div className="form-group">
                <label>交易对</label>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  <option value="USDJPY">USD/JPY</option>
                  <option value="BTCJPY">BTC/JPY</option>
                  <option value="ETHJPY">ETH/JPY</option>
                  <option value="EURJPY">EUR/JPY</option>
                  <option value="GBPJPY">GBP/JPY</option>
                </select>
              </div>

              <div className="form-group">
                <label>时间间隔</label>
                <select value={interval} onChange={(e) => setInterval(e.target.value)}>
                  <option value="1m">1 分钟</option>
                  <option value="5m">5 分钟</option>
                  <option value="15m">15 分钟</option>
                  <option value="1h">1 小时</option>
                  <option value="4h">4 小时</option>
                  <option value="1d">1 天</option>
                </select>
              </div>
            </div>

            {dataRangeInfo && (
              <div className="data-range-info">
                <div className="info-icon">ℹ️</div>
                <div className="info-content">
                  <div className="info-title">可用数据范围</div>
                  <div className="info-details">
                    <span>共 {dataRangeInfo.count.toLocaleString()} 条数据</span>
                    <span className="separator">•</span>
                    <span>
                      {new Date(parseInt(dataRangeInfo.earliest)).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                      })}
                      {' 至 '}
                      {new Date(parseInt(dataRangeInfo.latest)).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                      })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!dataRangeInfo && (
              <div className="data-range-info warning">
                <div className="info-icon">⚠️</div>
                <div className="info-content">
                  <div className="info-title">暂无数据</div>
                  <div className="info-details">
                    该数据源暂无可用数据，请先到"数据导入"页面导入数据
                  </div>
                </div>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>开始日期（可选）</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || undefined}
                  min={dataRangeInfo ? new Date(parseInt(dataRangeInfo.earliest)).toISOString().split('T')[0] : undefined}
                />
              </div>

              <div className="form-group">
                <label>开始时间</label>
                <input
                  type="time"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>结束日期（可选）</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  max={dataRangeInfo ? new Date(parseInt(dataRangeInfo.latest)).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                />
              </div>

              <div className="form-group">
                <label>结束时间</label>
                <input
                  type="time"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                />
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              className="load-button"
              onClick={loadKlineData}
              disabled={loading}
            >
              {loading ? '⏳ 加载中...' : '🚀 开始模拟'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="simulator-page">
      <div className="simulator-header">
        <h2>💹 实时交易模拟</h2>
        <div className="header-info">
          <div className="data-info">
            <span className="data-label">{symbol} • {interval}</span>
            {startDate && endDate && (
              <span className="data-range"> • {startDate} 至 {endDate}</span>
            )}
          </div>
          <div className="current-time">
            {currentTime && currentTime.toISOString().replace('T', ' ').slice(0, 19)}
          </div>
          <button
            className="change-data-button"
            onClick={() => {
              setShowDataSelector(true);
              setIsPlaying(false);
              setTrade(null);
              setTradeResult(null);
            }}
          >
            🔄 切换数据源
          </button>
        </div>
      </div>

      <div className="simulator-content">
        <div className="chart-section">
          <ChartComponent
            data={klineData}
            currentIndex={currentIndex}
            trade={trade}
            tradeResult={tradeResult}
          />

          <PlaybackControls
            isPlaying={isPlaying}
            currentIndex={currentIndex}
            totalLength={klineData.length}
            speed={speed}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onReset={() => {
              setCurrentIndex(Math.min(35, klineData.length - 1));
              setIsPlaying(false);
              setTrade(null);
              setTradeResult(null);
            }}
            onSpeedChange={setSpeed}
            onSeek={setCurrentIndex}
          />
        </div>

        <div className="trading-section">
          <TradingPanel
            currentPrice={currentKline ? parseFloat(currentKline.close) : 0}
            onStartTrade={handleStartTrade}
            trade={trade}
            tradeResult={tradeResult}
            disabled={!currentKline || currentIndex === 0}
          />
        </div>
      </div>
    </div>
  );
}

export default SimulatorPage;
