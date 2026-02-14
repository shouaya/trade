import { useState } from 'react';
import TabNavigation from './components/TabNavigation';
import SimulatorPage from './pages/SimulatorPage';
import DataImportPage from './pages/DataImportPage';
import ReplayPage from './pages/ReplayPage';
import StrategyPage from './pages/StrategyPage';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('simulator');
  const [replayTrade, setReplayTrade] = useState(null);

  const handleReplayTrade = (trade) => {
    setReplayTrade(trade);
    setActiveTab('simulator');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'simulator':
        return <SimulatorPage replayTrade={replayTrade} />;
      case 'import':
        return <DataImportPage />;
      case 'replay':
        return <ReplayPage onReplayTrade={handleReplayTrade} />;
      case 'strategies':
        return <StrategyPage />;
      default:
        return <SimulatorPage />;
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>💹 USD/JPY 交易系统</h1>
      </header>

      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="app-main">
        {renderContent()}
      </div>
    </div>
  );
}

export default App;
