import { useState, useEffect } from 'react';
import { klinesAPI } from '../api/api';
import './DataImportPage.css';

function DataImportPage() {
  const [symbol, setSymbol] = useState('USDJPY');
  const [interval, setInterval] = useState('1min');
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
      // 转换日期格式: YYYY-MM-DD -> YYYYMMDD
      const formatDateForAPI = (dateStr) => dateStr.replace(/-/g, '');

      // 转换 symbol 格式: USDJPY -> USD_JPY
      const gmoSymbol = symbol === 'USDJPY' ? 'USD_JPY' :
                        symbol === 'BTCJPY' ? 'BTC_JPY' :
                        symbol === 'ETHJPY' ? 'ETH_JPY' :
                        symbol === 'EURJPY' ? 'EUR_JPY' :
                        symbol === 'GBPJPY' ? 'GBP_JPY' : symbol;

      // interval 已经是正确格式 (1min, 15min, 30min, 1hour, 4hour)
      const gmoInterval = interval;

      const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/import/gmocoin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: gmoSymbol,
          interval: gmoInterval,
          priceType: 'BID',
          startDate: formatDateForAPI(startDate),
          endDate: formatDateForAPI(endDate)
        })
      });

      const result = await response.json();

      if (result.success) {
        const totalImported = result.imported || 0;
        const skipped = result.skipped || 0;
        const errors = result.errors || [];

        let message = `✅ 导入完成！新增 ${totalImported} 条，跳过 ${skipped} 条`;
        if (errors.length > 0) {
          message += `\n⚠️ ${errors.length} 个日期导入失败`;
        }

        setProgress({
          message,
          current: totalImported,
          total: totalImported + skipped
        });
        loadStats();
      } else {
        throw new Error(result.message || result.error || '导入失败');
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
                  <option value="1min">1 分钟</option>
                  <option value="15min">15 分钟</option>
                  <option value="30min">30 分钟</option>
                  <option value="1hour">1 小时</option>
                  <option value="4hour">4 小时</option>
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
