import { useEffect, useState } from 'react';
import TabNavigation from './components/TabNavigation';
import SimulatorPage from './pages/SimulatorPage';
import DataImportPage from './pages/DataImportPage';
import ReplayPage from './pages/ReplayPage';
import StrategyPage from './pages/StrategyPage';
import TrainPipelinePage from './pages/TrainPipelinePage';
import './App.css';

const DEFAULT_TAB = 'simulator';
const VALID_TABS = new Set([
  'simulator',
  'import',
  'replay',
  'strategies',
  'train-pipeline'
]);

function getTabFromHash(hash) {
  const normalized = String(hash || '').trim();
  const matched = normalized.match(/^#\/?([^/?#]+)/);
  const candidate = matched?.[1] || DEFAULT_TAB;
  return VALID_TABS.has(candidate) ? candidate : DEFAULT_TAB;
}

function getHashForTab(tab) {
  return `#/${tab}`;
}

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_TAB;
    }
    return getTabFromHash(window.location.hash);
  });
  const [replayTrade, setReplayTrade] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncFromHash = () => {
      setActiveTab(getTabFromHash(window.location.hash));
    };

    if (!window.location.hash) {
      window.history.replaceState(null, '', getHashForTab(DEFAULT_TAB));
    } else {
      syncFromHash();
    }

    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const handleTabChange = (tab) => {
    const nextTab = VALID_TABS.has(tab) ? tab : DEFAULT_TAB;
    setActiveTab(nextTab);

    if (typeof window !== 'undefined') {
      const nextHash = getHashForTab(nextTab);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
    }
  };

  const handleReplayTrade = (trade) => {
    setReplayTrade(trade);
    handleTabChange('simulator');
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
      case 'train-pipeline':
        return <TrainPipelinePage />;
      default:
        return <SimulatorPage />;
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>💹 交易系统控制台</h1>
      </header>

      <TabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <div className="app-main">
        {renderContent()}
      </div>
    </div>
  );
}

export default App;
