import { useState, useEffect } from 'react';
import ChartComponent from '../components/ChartComponent';
import TradingPanel from '../components/TradingPanel';
import PlaybackControls from '../components/PlaybackControls';
import { klinesAPI, tradesAPI } from '../api/api';
import { calculateRSI, calculateMACD } from '../utils/indicators';
import './SimulatorPage.css';

function SimulatorPage({ replayTrade }) {
  const [klineData, setKlineData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000); // 1秒一根K线
  const [startTime, setStartTime] = useState(null);
  const [trade, setTrade] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 加载数据 - 仅从后端 API 获取
  useEffect(() => {
    async function loadKlineData() {
      try {
        setLoading(true);
        setError(null);

        // 从 API 获取 K 线数据
        const response = await klinesAPI.getKlines({
          symbol: 'USDJPY',
          interval: '1m',
          limit: 5000
        });

        if (response.success && response.data.length > 0) {
          setKlineData(response.data);
          setStartTime(new Date(parseInt(response.data[0].openTime)));
          // 从第35根K线开始，这样RSI和MACD都能立即显示
          setCurrentIndex(Math.min(35, response.data.length - 1));
          console.log(`✅ 加载了 ${response.data.length} 条 K 线数据`);
        } else {
          // API 没有数据
          setError('数据库中没有 K 线数据，请先使用"数据导入"页面导入数据');
          console.warn('⚠️ 数据库中没有数据');
        }
      } catch (err) {
        console.error('❌ 加载数据失败:', err);
        setError(`无法加载 K 线数据: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }

    loadKlineData();
  }, []);

  // 播放控制
  useEffect(() => {
    if (!isPlaying || currentIndex >= klineData.length) {
      if (currentIndex >= klineData.length) {
        setIsPlaying(false);
      }
      return;
    }

    const timer = setInterval(() => {
      setCurrentIndex(prev => {
        const next = prev + 1;
        if (next >= klineData.length) {
          setIsPlaying(false);
          return prev;
        }
        return next;
      });
    }, speed);

    return () => clearInterval(timer);
  }, [isPlaying, currentIndex, klineData.length, speed]);

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

  return (
    <div className="simulator-page">
      <div className="simulator-header">
        <h2>💹 实时交易模拟</h2>
        <div className="current-time">
          {currentTime && currentTime.toISOString().replace('T', ' ').slice(0, 19)}
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
              setCurrentIndex(0);
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
