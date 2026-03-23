import './TabNavigation.css';

function TabNavigation({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'simulator', label: '📈 交易模拟', icon: '🎮' },
    { id: 'import', label: '📥 数据导入', icon: '⬇️' },
    { id: 'replay', label: '🔁 历史复盘', icon: '📊' },
    { id: 'strategies', label: '⚙️ 策略管理', icon: '🎯' },
    { id: 'train-pipeline', label: '🧭 训练流程', icon: '🧩' },
  ];

  return (
    <div className="tab-navigation">
      {tabs.map(tab => (
        <a
          key={tab.id}
          href={`#/${tab.id}`}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={(event) => {
            event.preventDefault();
            onTabChange(tab.id);
          }}
        >
          <span className="tab-icon">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
        </a>
      ))}
    </div>
  );
}

export default TabNavigation;
