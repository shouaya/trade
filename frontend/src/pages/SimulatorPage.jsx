import { useState, useEffect } from 'react';
import ChartComponent from '../components/ChartComponent';
import TradingPanel from '../components/TradingPanel';
import PlaybackControls from '../components/PlaybackControls';
import { klinesAPI, tradesAPI } from '../api/api';
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

  // 加载数据 - 从后端 API 获取
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
          // 如果 API 没有数据，fallback 到本地 JSON
          console.warn('⚠️ API 没有数据，使用本地文件');
          const localResponse = await fetch('/data/sample_data.json');
          const data = await localResponse.json();
          setKlineData(data);
          if (data.length > 0) {
            setStartTime(new Date(parseInt(data[0].openTime)));
            setCurrentIndex(Math.min(35, data.length - 1));
          }
        }
      } catch (err) {
        console.error('❌ 加载数据失败:', err);
        setError('无法加载 K 线数据');

        // Fallback 到本地数据
        try {
          const localResponse = await fetch('/data/sample_data.json');
          const data = await localResponse.json();
          setKlineData(data);
          if (data.length > 0) {
            setStartTime(new Date(parseInt(data[0].openTime)));
            setCurrentIndex(Math.min(35, data.length - 1));
          }
          console.log('✅ 使用本地数据');
        } catch (localErr) {
          console.error('本地数据也加载失败:', localErr);
        }
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

  // 开始交易
  const handleStartTrade = (tradeParams) => {
    const entryTime = parseInt(klineData[currentIndex].openTime);
    // 使用传入的自定义价格，如果没有则使用当前K线收盘价
    const entryPrice = tradeParams.entryPrice || parseFloat(klineData[currentIndex].close);

    setTrade({
      ...tradeParams,
      entryTime,
      entryPrice,
      entryIndex: currentIndex,
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

      const result = {
        exitTime: currentTime,
        exitPrice,
        exitReason,
        pnl: parseFloat(pnl.toFixed(2)),
        pips: parseFloat(pips.toFixed(2)),
        percent: parseFloat(percent.toFixed(4)),
        holdMinutes: Math.round(elapsedMinutes),
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
        symbol: 'USDJPY'
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
