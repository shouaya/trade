import { useState, useEffect } from 'react';
import ChartComponent from './components/ChartComponent';
import TradingPanel from './components/TradingPanel';
import PlaybackControls from './components/PlaybackControls';
import './App.css';

function App() {
  const [klineData, setKlineData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000); // 1秒一根K线
  const [startTime, setStartTime] = useState(null);
  const [trade, setTrade] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);

  // 加载数据
  useEffect(() => {
    fetch('/data/sample_data.json')
      .then(res => res.json())
      .then(data => {
        setKlineData(data);
        if (data.length > 0) {
          setStartTime(new Date(parseInt(data[0].openTime)));
          // 从第35根K线开始，这样RSI和MACD都能立即显示
          // RSI需要14根，MACD需要34根作为计算基础
          setCurrentIndex(Math.min(35, data.length - 1));
        }
      })
      .catch(err => console.error('加载数据失败:', err));
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

      setTradeResult({
        exitTime: currentTime,
        exitPrice,
        exitReason,
        pnl: parseFloat(pnl.toFixed(2)),
        pips: parseFloat(pips.toFixed(2)),
        percent: parseFloat(percent.toFixed(4)),
        holdMinutes: Math.round(elapsedMinutes),
      });

      setTrade(null);
      setIsPlaying(false);
    }
  }, [currentKline, trade]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>💹 USD/JPY 交易模拟器</h1>
        <div className="current-time">
          {currentTime && currentTime.toISOString().replace('T', ' ').slice(0, 19)}
        </div>
      </header>

      <div className="app-content">
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

export default App;
