import { useState, useEffect } from 'react';
import { klinesAPI } from '../api/api';
import './DataImportPage.css';

function DataImportPage() {
  const [symbol, setSymbol] = useState('USDJPY');
  const [interval, setInterval] = useState('1m');
  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState('2025-02-14');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [stats, setStats] = useState([]);

  // 加载数据统计
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await klinesAPI.getStats();
      if (response.success) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  };

  const handleImport = async () => {
    if (!symbol || !interval || !startDate || !endDate) {
      alert('请填写所有字段');
      return;
    }

    setImporting(true);
    setProgress({ message: '正在从 GMO Coin 获取数据...', current: 0, total: 0 });

    try {
      // 这里应该调用后端 API 来触发数据获取和导入
      // 暂时使用前端模拟（实际应该在后端完成）
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/import/gmocoin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          startDate,
          endDate
        })
      });

      if (response.ok) {
        const result = await response.json();
        setProgress({
          message: `✅ 导入完成！共导入 ${result.count} 条数据`,
          current: result.count,
          total: result.count
        });
        loadStats();
      } else {
        throw new Error('导入失败');
      }
    } catch (error) {
      console.error('导入失败:', error);
      setProgress({
        message: `❌ 导入失败: ${error.message}`,
        current: 0,
        total: 0
      });
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(parseInt(timestamp));
    return date.toLocaleString('zh-CN');
  };

  return (
    <div className="data-import-page">
      <div className="import-container">
        <div className="import-section">
          <h2>📥 数据导入</h2>
          <p className="section-description">
            从 GMO Coin 获取历史 K 线数据并导入到数据库
          </p>

          <form className="import-form" onSubmit={(e) => { e.preventDefault(); handleImport(); }}>
            <div className="form-row">
              <div className="form-group">
                <label>交易对 (Symbol)</label>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  <option value="USDJPY">USD/JPY</option>
                  <option value="BTCJPY">BTC/JPY</option>
                  <option value="ETHJPY">ETH/JPY</option>
                  <option value="EURJPY">EUR/JPY</option>
                  <option value="GBPJPY">GBP/JPY</option>
                </select>
              </div>

              <div className="form-group">
                <label>时间间隔 (Interval)</label>
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

            <div className="form-row">
              <div className="form-group">
                <label>开始日期</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate}
                />
              </div>

              <div className="form-group">
                <label>结束日期</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>

            <button
              type="submit"
              className="import-button"
              disabled={importing}
            >
              {importing ? '⏳ 导入中...' : '🚀 开始导入'}
            </button>
          </form>

          {progress && (
            <div className={`progress-info ${progress.message.includes('✅') ? 'success' : progress.message.includes('❌') ? 'error' : ''}`}>
              <p>{progress.message}</p>
              {progress.total > 0 && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="stats-section">
          <h2>📊 数据库统计</h2>
          {stats.length === 0 ? (
            <p className="no-data">暂无数据</p>
          ) : (
            <div className="stats-grid">
              {stats.map((stat, index) => (
                <div key={index} className="stat-card">
                  <div className="stat-header">
                    <h3>{stat.symbol}</h3>
                    <span className="stat-interval">{stat.interval_type}</span>
                  </div>
                  <div className="stat-body">
                    <div className="stat-item">
                      <span className="stat-label">数据量:</span>
                      <span className="stat-value">{stat.count.toLocaleString()} 条</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">最早:</span>
                      <span className="stat-value small">{formatDate(stat.earliest)}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">最新:</span>
                      <span className="stat-value small">{formatDate(stat.latest)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="refresh-button" onClick={loadStats}>
            🔄 刷新统计
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataImportPage;
