import { useState } from 'react';
import './TradingPanel.css';

function TradingPanel({ currentPrice, onStartTrade, trade, tradeResult, disabled }) {
  const [direction, setDirection] = useState('long');
  const [entryPrice, setEntryPrice] = useState('');
  const [useCustomPrice, setUseCustomPrice] = useState(false);
  const [holdMinutes, setHoldMinutes] = useState(60);
  const [stopLossPips, setStopLossPips] = useState(50);
  const [takeProfitPips, setTakeProfitPips] = useState(100);
  const [lotSize, setLotSize] = useState(1);
  const [useStopLoss, setUseStopLoss] = useState(true);
  const [useTakeProfit, setUseTakeProfit] = useState(true);

  // 获取实际使用的入场价格
  const getEntryPrice = () => {
    return useCustomPrice && entryPrice ? parseFloat(entryPrice) : currentPrice;
  };

  const calculatePrice = (pips) => {
    const basePrice = getEntryPrice();
    return direction === 'long'
      ? basePrice - (pips / 100)
      : basePrice + (pips / 100);
  };

  const calculateTakeProfitPrice = (pips) => {
    const basePrice = getEntryPrice();
    return direction === 'long'
      ? basePrice + (pips / 100)
      : basePrice - (pips / 100);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const tradeParams = {
      direction,
      entryPrice: getEntryPrice(), // 传递自定义或当前价格
      holdMinutes: parseInt(holdMinutes),
      lotSize: parseFloat(lotSize),
      stopLoss: useStopLoss ? calculatePrice(stopLossPips) : null,
      takeProfit: useTakeProfit ? calculateTakeProfitPrice(takeProfitPips) : null,
    };

    onStartTrade(tradeParams);
  };

  const getExitReasonText = (reason) => {
    const reasons = {
      'stop_loss': '⛔ 触发止损',
      'take_profit': '🎯 触发止盈',
      'hold_time_reached': '⏰ 到达持仓时间'
    };
    return reasons[reason] || reason;
  };

  return (
    <div className="trading-panel">
      <h2>交易面板</h2>

      {trade && (
        <div className="active-trade">
          <h3>🔥 交易进行中</h3>
          <div className="trade-info">
            <div className="info-row">
              <span>方向:</span>
              <span className={`direction ${trade.direction}`}>
                {trade.direction === 'long' ? '📈 做多' : '📉 做空'}
              </span>
            </div>
            <div className="info-row">
              <span>入场价格:</span>
              <span>{trade.entryPrice.toFixed(3)}</span>
            </div>
            <div className="info-row">
              <span>当前价格:</span>
              <span>{currentPrice.toFixed(3)}</span>
            </div>
            {trade.stopLoss && (
              <div className="info-row">
                <span>止损:</span>
                <span className="stop-loss">{trade.stopLoss.toFixed(3)}</span>
              </div>
            )}
            {trade.takeProfit && (
              <div className="info-row">
                <span>止盈:</span>
                <span className="take-profit">{trade.takeProfit.toFixed(3)}</span>
              </div>
            )}
            <div className="info-row">
              <span>仓位:</span>
              <span>{trade.lotSize} 手</span>
            </div>
          </div>
        </div>
      )}

      {tradeResult && (
        <div className={`trade-result ${tradeResult.pnl >= 0 ? 'profit' : 'loss'}`}>
          <h3>
            {tradeResult.pnl >= 0 ? '✅ 盈利' : '❌ 亏损'}
          </h3>
          <div className="result-info">
            <div className="info-row large">
              <span>损益:</span>
              <span className="pnl">${tradeResult.pnl}</span>
            </div>
            <div className="info-row">
              <span>点数:</span>
              <span>{tradeResult.pips > 0 ? '+' : ''}{tradeResult.pips} pips</span>
            </div>
            <div className="info-row">
              <span>百分比:</span>
              <span>{tradeResult.percent > 0 ? '+' : ''}{tradeResult.percent}%</span>
            </div>
            <div className="info-row">
              <span>出场价格:</span>
              <span>{tradeResult.exitPrice.toFixed(3)}</span>
            </div>
            <div className="info-row">
              <span>持仓时间:</span>
              <span>{tradeResult.holdMinutes} 分钟</span>
            </div>
            <div className="info-row">
              <span>出场原因:</span>
              <span>{getExitReasonText(tradeResult.exitReason)}</span>
            </div>
          </div>
        </div>
      )}

      {!trade && (
        <form onSubmit={handleSubmit} className="trade-form">
          <div className="form-group">
            <label>当前价格:</label>
            <div className="current-price">{currentPrice.toFixed(3)}</div>
          </div>

          <div className="form-group">
            <label>交易方向:</label>
            <div className="direction-buttons">
              <button
                type="button"
                className={`direction-btn long ${direction === 'long' ? 'active' : ''}`}
                onClick={() => setDirection('long')}
              >
                📈 做多
              </button>
              <button
                type="button"
                className={`direction-btn short ${direction === 'short' ? 'active' : ''}`}
                onClick={() => setDirection('short')}
              >
                📉 做空
              </button>
            </div>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={useCustomPrice}
                onChange={(e) => setUseCustomPrice(e.target.checked)}
              />
              指定入场价格
            </label>
            {useCustomPrice && (
              <div className="sub-input">
                <input
                  type="number"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  min="0"
                  step="0.001"
                  placeholder={currentPrice.toFixed(3)}
                  required
                />
                <span className="hint">
                  当前: {currentPrice.toFixed(3)}
                </span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>持仓时间 (分钟):</label>
            <input
              type="number"
              value={holdMinutes}
              onChange={(e) => setHoldMinutes(e.target.value)}
              min="1"
              max="1440"
              required
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={useStopLoss}
                onChange={(e) => setUseStopLoss(e.target.checked)}
              />
              使用止损
            </label>
            {useStopLoss && (
              <div className="sub-input">
                <input
                  type="number"
                  value={stopLossPips}
                  onChange={(e) => setStopLossPips(e.target.value)}
                  min="1"
                  placeholder="止损点数"
                />
                <span className="hint">
                  ({calculatePrice(stopLossPips).toFixed(3)})
                </span>
              </div>
            )}
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={useTakeProfit}
                onChange={(e) => setUseTakeProfit(e.target.checked)}
              />
              使用止盈
            </label>
            {useTakeProfit && (
              <div className="sub-input">
                <input
                  type="number"
                  value={takeProfitPips}
                  onChange={(e) => setTakeProfitPips(e.target.value)}
                  min="1"
                  placeholder="止盈点数"
                />
                <span className="hint">
                  ({calculateTakeProfitPrice(takeProfitPips).toFixed(3)})
                </span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>仓位大小 (手):</label>
            <input
              type="number"
              value={lotSize}
              onChange={(e) => setLotSize(e.target.value)}
              min="0.01"
              max="100"
              step="0.01"
              required
            />
          </div>

          <button
            type="submit"
            className="submit-btn"
            disabled={disabled}
          >
            🚀 开始交易
          </button>
        </form>
      )}
    </div>
  );
}

export default TradingPanel;
