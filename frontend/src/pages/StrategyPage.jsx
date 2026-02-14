import { useState, useEffect } from 'react';
import { strategiesAPI } from '../api/api';
import './StrategyPage.css';

function StrategyPage() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingStrategy, setEditingStrategy] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    symbol: 'USDJPY',
    direction: 'long',
    // 入场条件
    entryRsiMin: null,
    entryRsiMax: null,
    entryMacdMin: null,
    entryMacdMax: null,
    entryPriceMin: null,
    entryPriceMax: null,
    // 出场条件
    exitRsiMin: null,
    exitRsiMax: null,
    exitMacdMin: null,
    exitMacdMax: null,
    exitPriceMin: null,
    exitPriceMax: null,
    // 风险管理
    stopLossPips: 50,
    takeProfitPips: 100,
    holdMinutes: 60,
    lotSize: 1,
    // 时间过滤
    allowedHoursStart: null,
    allowedHoursEnd: null,
    allowedWeekdays: null,
  });

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      setLoading(true);
      const response = await strategiesAPI.getStrategies();
      if (response.success) {
        setStrategies(response.data);
      }
    } catch (error) {
      console.error('加载策略失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name) {
      alert('请输入策略名称');
      return;
    }

    try {
      const strategyData = {
        name: formData.name,
        description: formData.description,
        isActive: true,
        parameters: {
          symbol: formData.symbol,
          direction: formData.direction,
          entry: {
            rsi: {
              min: formData.entryRsiMin ? parseFloat(formData.entryRsiMin) : null,
              max: formData.entryRsiMax ? parseFloat(formData.entryRsiMax) : null
            },
            macd: {
              min: formData.entryMacdMin ? parseFloat(formData.entryMacdMin) : null,
              max: formData.entryMacdMax ? parseFloat(formData.entryMacdMax) : null
            },
            price: {
              min: formData.entryPriceMin ? parseFloat(formData.entryPriceMin) : null,
              max: formData.entryPriceMax ? parseFloat(formData.entryPriceMax) : null
            }
          },
          exit: {
            rsi: {
              min: formData.exitRsiMin ? parseFloat(formData.exitRsiMin) : null,
              max: formData.exitRsiMax ? parseFloat(formData.exitRsiMax) : null
            },
            macd: {
              min: formData.exitMacdMin ? parseFloat(formData.exitMacdMin) : null,
              max: formData.exitMacdMax ? parseFloat(formData.exitMacdMax) : null
            },
            price: {
              min: formData.exitPriceMin ? parseFloat(formData.exitPriceMin) : null,
              max: formData.exitPriceMax ? parseFloat(formData.exitPriceMax) : null
            }
          },
          risk: {
            stopLossPips: parseFloat(formData.stopLossPips),
            takeProfitPips: parseFloat(formData.takeProfitPips),
            holdMinutes: parseInt(formData.holdMinutes),
            lotSize: parseFloat(formData.lotSize)
          },
          timeFilter: {
            allowedHoursStart: formData.allowedHoursStart,
            allowedHoursEnd: formData.allowedHoursEnd,
            allowedWeekdays: formData.allowedWeekdays
          }
        }
      };

      const response = await strategiesAPI.createStrategy(strategyData);
      if (response.success) {
        alert('✅ 策略创建成功！');
        setShowForm(false);
        resetForm();
        loadStrategies();
      }
    } catch (error) {
      console.error('创建策略失败:', error);
      alert('❌ 创建失败: ' + error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      symbol: 'USDJPY',
      direction: 'long',
      entryRsiMin: null,
      entryRsiMax: null,
      entryMacdMin: null,
      entryMacdMax: null,
      entryPriceMin: null,
      entryPriceMax: null,
      exitRsiMin: null,
      exitRsiMax: null,
      exitMacdMin: null,
      exitMacdMax: null,
      exitPriceMin: null,
      exitPriceMax: null,
      stopLossPips: 50,
      takeProfitPips: 100,
      holdMinutes: 60,
      lotSize: 1,
      allowedHoursStart: null,
      allowedHoursEnd: null,
      allowedWeekdays: null,
    });
    setEditingStrategy(null);
  };

  const parseParameters = (params) => {
    if (typeof params === 'string') {
      try {
        return JSON.parse(params);
      } catch (e) {
        return {};
      }
    }
    return params || {};
  };

  return (
    <div className="strategy-page">
      <div className="strategy-header">
        <h1>⚙️ 策略管理</h1>
        <button
          className="new-strategy-btn"
          onClick={() => {
            setShowForm(!showForm);
            if (!showForm) resetForm();
          }}
        >
          {showForm ? '❌ 取消' : '➕ 新建策略'}
        </button>
      </div>

      {showForm && (
        <div className="strategy-form-container">
          <h2>{editingStrategy ? '编辑策略' : '创建新策略'}</h2>
          <form className="strategy-form" onSubmit={handleSubmit}>
            {/* 基本信息 */}
            <div className="form-section">
              <h3>📝 基本信息</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>策略名称 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="例如: RSI超卖反弹策略"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>交易对</label>
                  <select
                    value={formData.symbol}
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                  >
                    <option value="USDJPY">USD/JPY</option>
                    <option value="BTCJPY">BTC/JPY</option>
                    <option value="ETHJPY">ETH/JPY</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>方向</label>
                  <select
                    value={formData.direction}
                    onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
                  >
                    <option value="long">📈 做多</option>
                    <option value="short">📉 做空</option>
                    <option value="both">🔄 双向</option>
                  </select>
                </div>
              </div>
              <div className="form-group full-width">
                <label>策略描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="描述你的策略逻辑..."
                  rows="3"
                />
              </div>
            </div>

            {/* 入场条件 */}
            <div className="form-section">
              <h3>📍 入场条件</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>RSI 最小值</label>
                  <input
                    type="number"
                    value={formData.entryRsiMin || ''}
                    onChange={(e) => setFormData({ ...formData, entryRsiMin: e.target.value })}
                    placeholder="例如: 30"
                    min="0"
                    max="100"
                    step="0.1"
                  />
                </div>
                <div className="form-group">
                  <label>RSI 最大值</label>
                  <input
                    type="number"
                    value={formData.entryRsiMax || ''}
                    onChange={(e) => setFormData({ ...formData, entryRsiMax: e.target.value })}
                    placeholder="例如: 40"
                    min="0"
                    max="100"
                    step="0.1"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>MACD 最小值</label>
                  <input
                    type="number"
                    value={formData.entryMacdMin || ''}
                    onChange={(e) => setFormData({ ...formData, entryMacdMin: e.target.value })}
                    placeholder="例如: -0.01"
                    step="0.0001"
                  />
                </div>
                <div className="form-group">
                  <label>MACD 最大值</label>
                  <input
                    type="number"
                    value={formData.entryMacdMax || ''}
                    onChange={(e) => setFormData({ ...formData, entryMacdMax: e.target.value })}
                    placeholder="例如: 0.01"
                    step="0.0001"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>价格最小值</label>
                  <input
                    type="number"
                    value={formData.entryPriceMin || ''}
                    onChange={(e) => setFormData({ ...formData, entryPriceMin: e.target.value })}
                    placeholder="例如: 145.000"
                    step="0.001"
                  />
                </div>
                <div className="form-group">
                  <label>价格最大值</label>
                  <input
                    type="number"
                    value={formData.entryPriceMax || ''}
                    onChange={(e) => setFormData({ ...formData, entryPriceMax: e.target.value })}
                    placeholder="例如: 150.000"
                    step="0.001"
                  />
                </div>
              </div>
            </div>

            {/* 出场条件 */}
            <div className="form-section">
              <h3>🚪 出场条件</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>RSI 最小值</label>
                  <input
                    type="number"
                    value={formData.exitRsiMin || ''}
                    onChange={(e) => setFormData({ ...formData, exitRsiMin: e.target.value })}
                    min="0"
                    max="100"
                    step="0.1"
                  />
                </div>
                <div className="form-group">
                  <label>RSI 最大值</label>
                  <input
                    type="number"
                    value={formData.exitRsiMax || ''}
                    onChange={(e) => setFormData({ ...formData, exitRsiMax: e.target.value })}
                    min="0"
                    max="100"
                    step="0.1"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>MACD 最小值</label>
                  <input
                    type="number"
                    value={formData.exitMacdMin || ''}
                    onChange={(e) => setFormData({ ...formData, exitMacdMin: e.target.value })}
                    step="0.0001"
                  />
                </div>
                <div className="form-group">
                  <label>MACD 最大值</label>
                  <input
                    type="number"
                    value={formData.exitMacdMax || ''}
                    onChange={(e) => setFormData({ ...formData, exitMacdMax: e.target.value })}
                    step="0.0001"
                  />
                </div>
              </div>
            </div>

            {/* 风险管理 */}
            <div className="form-section">
              <h3>🛡️ 风险管理</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>止损 (pips)</label>
                  <input
                    type="number"
                    value={formData.stopLossPips}
                    onChange={(e) => setFormData({ ...formData, stopLossPips: e.target.value })}
                    min="1"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>止盈 (pips)</label>
                  <input
                    type="number"
                    value={formData.takeProfitPips}
                    onChange={(e) => setFormData({ ...formData, takeProfitPips: e.target.value })}
                    min="1"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>持仓时间 (分钟)</label>
                  <input
                    type="number"
                    value={formData.holdMinutes}
                    onChange={(e) => setFormData({ ...formData, holdMinutes: e.target.value })}
                    min="1"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>仓位大小 (手)</label>
                  <input
                    type="number"
                    value={formData.lotSize}
                    onChange={(e) => setFormData({ ...formData, lotSize: e.target.value })}
                    min="0.01"
                    step="0.01"
                    required
                  />
                </div>
              </div>
            </div>

            <button type="submit" className="submit-button">
              💾 保存策略
            </button>
          </form>
        </div>
      )}

      {/* 策略列表 */}
      <div className="strategies-list">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : strategies.length === 0 ? (
          <div className="no-strategies">
            暂无策略，点击"新建策略"创建第一个策略
          </div>
        ) : (
          strategies.map(strategy => {
            const params = parseParameters(strategy.parameters);
            return (
              <div key={strategy.id} className="strategy-card">
                <div className="strategy-card-header">
                  <h3>{strategy.name}</h3>
                  <span className={`status-badge ${strategy.is_active ? 'active' : 'inactive'}`}>
                    {strategy.is_active ? '✅ 启用' : '⏸️ 禁用'}
                  </span>
                </div>
                <p className="strategy-description">{strategy.description}</p>

                {params.symbol && (
                  <div className="strategy-details">
                    <div className="detail-item">
                      <span className="label">交易对:</span>
                      <span className="value">{params.symbol}</span>
                    </div>
                    {params.risk && (
                      <>
                        <div className="detail-item">
                          <span className="label">止损/止盈:</span>
                          <span className="value">{params.risk.stopLossPips}/{params.risk.takeProfitPips} pips</span>
                        </div>
                        <div className="detail-item">
                          <span className="label">持仓时间:</span>
                          <span className="value">{params.risk.holdMinutes} 分钟</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="strategy-actions">
                  <button className="edit-btn">✏️ 编辑</button>
                  <button className="test-btn">🧪 回测</button>
                  <button className="delete-btn">🗑️ 删除</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default StrategyPage;
