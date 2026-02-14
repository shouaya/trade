import './PlaybackControls.css';

function PlaybackControls({
  isPlaying,
  currentIndex,
  totalLength,
  speed,
  onPlay,
  onPause,
  onReset,
  onSpeedChange,
  onSeek,
}) {
  const speedOptions = [
    { value: 1000, label: '1x (1秒/根) - 默认速度' },
    { value: 500, label: '2x (1秒/2根)' },
    { value: 200, label: '5x (1秒/5根)' },
    { value: 100, label: '10x (1秒/10根)' },
    { value: 50, label: '20x (1秒/20根)' },
    { value: 25, label: '40x (1秒/40根)' },
    { value: 10, label: '100x (1秒/100根)' },
  ];

  const progress = totalLength > 0 ? (currentIndex / totalLength) * 100 : 0;

  const handleSeek = (e) => {
    const newIndex = parseInt(e.target.value);
    onSeek(newIndex);
  };

  return (
    <div className="playback-controls">
      <div className="controls-row">
        <button
          className="control-btn"
          onClick={onReset}
          title="重置"
        >
          ⏮️ 重置
        </button>

        {isPlaying ? (
          <button
            className="control-btn primary"
            onClick={onPause}
            title="暂停"
          >
            ⏸️ 暂停
          </button>
        ) : (
          <button
            className="control-btn primary"
            onClick={onPlay}
            disabled={currentIndex >= totalLength - 1}
            title="播放"
          >
            ▶️ 播放
          </button>
        )}

        <div className="speed-control">
          <label>速度:</label>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseInt(e.target.value))}
            className="speed-select"
          >
            {speedOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="progress-info">
          {currentIndex} / {totalLength} ({progress.toFixed(1)}%)
        </div>
      </div>

      <div className="progress-bar-container">
        <input
          type="range"
          min="0"
          max={totalLength - 1}
          value={currentIndex}
          onChange={handleSeek}
          className="progress-bar"
          disabled={isPlaying}
        />
      </div>
    </div>
  );
}

export default PlaybackControls;
