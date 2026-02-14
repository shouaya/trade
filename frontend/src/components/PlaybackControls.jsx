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
    { value: 2000, label: '0.5x' },
    { value: 1000, label: '1x' },
    { value: 500, label: '2x' },
    { value: 250, label: '4x' },
    { value: 100, label: '10x' },
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
