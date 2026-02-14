import { useState, useEffect } from 'react';
import { tradesAPI } from '../api/api';
import './ReplayPage.css';

function ReplayPage({ onReplayTrade }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState({
    direction: 'all',
    exitReason: 'all',
    sortBy: 'created_at',
    sortOrder: 'desc'
  });

  useEffect(() => {
    loadTrades();
    loadStats();
  }, [filter]);

  const loadTrades = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter.direction !== 'all') params.direction = filter.direction;
      if (filter.exitReason !== 'all') params.exitReason = filter.exitReason;

      const response = await tradesAPI.getTrades(params);
      if (response.success) {
        let sortedTrades = [...response.data];

        // 排序
        sortedTrades.sort((a, b) => {
          const aValue = a[filter.sortBy];
          const bValue = b[filter.sortBy];
          const order = filter.sortOrder === 'desc' ? -1 : 1;

          if (aValue < bValue) return -order;
          if (aValue > bValue) return order;
          return 0;
        });

        setTrades(sortedTrades);
      }
    } catch (error) {
      console.error('加载交易记录失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await tradesAPI.getStats();
      if (response.success) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(parseInt(timestamp)).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getExitReasonText = (reason) => {
    const reasons = {
      'stop_loss': '⛔ 止损',
      'take_profit': '🎯 止盈',
      'hold_time_reached': '⏰ 到期',
      'manual': '👋 手动'
    };
    return reasons[reason] || reason;
  };

  const handleReplay = (trade) => {
    // 切换到模拟页面并回放这笔交易
    if (onReplayTrade) {
      onReplayTrade(trade);
    }
  };

  return (
    <div className="replay-page">
      {/* 统计摘要 */}
      {stats && (
        <div className="stats-summary">
          <div className="stat-card-mini">
            <div className="stat-label">总交易</div>
            <div className="stat-value">{stats.total_trades}</div>
          </div>
          <div className="stat-card-mini success">
            <div className="stat-label">盈利交易</div>
            <div className="stat-value">{stats.winning_trades}</div>
          </div>
          <div className="stat-card-mini error">
            <div className="stat-label">亏损交易</div>
            <div className="stat-value">{stats.losing_trades}</div>
          </div>
          <div className="stat-card-mini">
            <div className="stat-label">胜率</div>
            <div className="stat-value">{stats.win_rate}%</div>
          </div>
          <div className={`stat-card-mini ${parseFloat(stats.total_pnl) >= 0 ? 'success' : 'error'}`}>
            <div className="stat-label">总损益</div>
            <div className="stat-value">${stats.total_pnl}</div>
          </div>
          <div className="stat-card-mini">
            <div className="stat-label">平均损益</div>
            <div className="stat-value">${stats.avg_pnl}</div>
          </div>
        </div>
      )}

      {/* 过滤器 */}
      <div className="filter-bar">
        <select
          value={filter.direction}
          onChange={(e) => setFilter({ ...filter, direction: e.target.value })}
        >
          <option value="all">全部方向</option>
          <option value="long">📈 做多</option>
          <option value="short">📉 做空</option>
        </select>

        <select
          value={filter.exitReason}
          onChange={(e) => setFilter({ ...filter, exitReason: e.target.value })}
        >
          <option value="all">全部原因</option>
          <option value="stop_loss">⛔ 止损</option>
          <option value="take_profit">🎯 止盈</option>
          <option value="hold_time_reached">⏰ 到期</option>
        </select>

        <select
          value={filter.sortBy}
          onChange={(e) => setFilter({ ...filter, sortBy: e.target.value })}
        >
          <option value="created_at">按时间</option>
          <option value="pnl">按损益</option>
          <option value="pips">按点数</option>
          <option value="percent">按百分比</option>
        </select>

        <select
          value={filter.sortOrder}
          onChange={(e) => setFilter({ ...filter, sortOrder: e.target.value })}
        >
          <option value="desc">降序</option>
          <option value="asc">升序</option>
        </select>

        <button className="refresh-btn" onClick={() => { loadTrades(); loadStats(); }}>
          🔄 刷新
        </button>
      </div>

      {/* 交易列表 */}
      <div className="trades-list">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : trades.length === 0 ? (
          <div className="no-trades">暂无交易记录</div>
        ) : (
          trades.map(trade => (
            <div key={trade.id} className={`trade-card ${parseFloat(trade.pnl) >= 0 ? 'profit' : 'loss'}`}>
              <div className="trade-header">
                <div className="trade-id">#{trade.id}</div>
                <div className={`trade-direction ${trade.direction}`}>
                  {trade.direction === 'long' ? '📈 做多' : '📉 做空'}
                </div>
                <div className="trade-strategy">{trade.strategy_name || '手动交易'}</div>
              </div>

              <div className="trade-body">
                <div className="trade-row">
                  <div className="trade-col">
                    <span className="label">入场时间:</span>
                    <span className="value">{formatDate(trade.entry_time)}</span>
                  </div>
                  <div className="trade-col">
                    <span className="label">出场时间:</span>
                    <span className="value">{formatDate(trade.exit_time)}</span>
                  </div>
                </div>

                <div className="trade-row">
                  <div className="trade-col">
                    <span className="label">入场价格:</span>
                    <span className="value">{parseFloat(trade.entry_price).toFixed(3)}</span>
                  </div>
                  <div className="trade-col">
                    <span className="label">出场价格:</span>
                    <span className="value">{parseFloat(trade.exit_price).toFixed(3)}</span>
                  </div>
                </div>

                <div className="trade-row">
                  {trade.stop_loss && (
                    <div className="trade-col">
                      <span className="label">止损:</span>
                      <span className="value stop-loss">{parseFloat(trade.stop_loss).toFixed(3)}</span>
                    </div>
                  )}
                  {trade.take_profit && (
                    <div className="trade-col">
                      <span className="label">止盈:</span>
                      <span className="value take-profit">{parseFloat(trade.take_profit).toFixed(3)}</span>
                    </div>
                  )}
                </div>

                <div className="trade-row">
                  <div className="trade-col">
                    <span className="label">持仓时间:</span>
                    <span className="value">{trade.actual_hold_minutes} 分钟</span>
                  </div>
                  <div className="trade-col">
                    <span className="label">出场原因:</span>
                    <span className="value">{getExitReasonText(trade.exit_reason)}</span>
                  </div>
                </div>

                <div className="trade-results">
                  <div className="result-item">
                    <span className="result-label">损益:</span>
                    <span className={`result-value pnl ${parseFloat(trade.pnl) >= 0 ? 'profit' : 'loss'}`}>
                      ${trade.pnl}
                    </span>
                  </div>
                  <div className="result-item">
                    <span className="result-label">点数:</span>
                    <span className="result-value">{trade.pips} pips</span>
                  </div>
                  <div className="result-item">
                    <span className="result-label">收益率:</span>
                    <span className="result-value">{trade.percent}%</span>
                  </div>
                </div>

                {trade.notes && (
                  <div className="trade-notes">
                    <span className="label">备注:</span>
                    <span className="value">{trade.notes}</span>
                  </div>
                )}
              </div>

              <div className="trade-actions">
                <button className="replay-button" onClick={() => handleReplay(trade)}>
                  🔁 复盘此交易
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ReplayPage;
