import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import { calculateRSI, calculateMACD } from '../utils/indicators';
import './ChartComponent.css';

function ChartComponent({ data, currentIndex, trade, tradeResult }) {
  const mainChartContainerRef = useRef(null);
  const rsiChartContainerRef = useRef(null);
  const macdChartContainerRef = useRef(null);

  const mainChartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const macdChartRef = useRef(null);

  const candlestickSeriesRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const macdLineSeriesRef = useRef(null);
  const macdSignalSeriesRef = useRef(null);
  const macdHistogramSeriesRef = useRef(null);

  // 初始化图表
  useEffect(() => {
    if (!mainChartContainerRef.current || !rsiChartContainerRef.current || !macdChartContainerRef.current) return;

    // 主图表 - K线
    const mainChart = createChart(mainChartContainerRef.current, {
      width: mainChartContainerRef.current.clientWidth,
      height: mainChartContainerRef.current.clientHeight || 400,
      layout: {
        background: { color: '#1e222d' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2b2b43' },
        horzLines: { color: '#2b2b43' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#485c7b',
      },
      timeScale: {
        borderColor: '#485c7b',
        timeVisible: true,
        secondsVisible: false,
        visible: false, // 隐藏主图时间轴
      },
    });

    const candlestickSeries = mainChart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    // RSI 图表
    const rsiChart = createChart(rsiChartContainerRef.current, {
      width: rsiChartContainerRef.current.clientWidth,
      height: 120,
      layout: {
        background: { color: '#1e222d' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2b2b43' },
        horzLines: { color: '#2b2b43' },
      },
      rightPriceScale: {
        borderColor: '#485c7b',
      },
      timeScale: {
        borderColor: '#485c7b',
        timeVisible: true,
        secondsVisible: false,
        visible: false,
      },
    });

    const rsiSeries = rsiChart.addLineSeries({
      color: '#2962FF',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    // RSI 超买超卖线
    rsiSeries.createPriceLine({
      price: 70,
      color: '#ef5350',
      lineWidth: 1,
      lineStyle: 1,
      axisLabelVisible: true,
      title: '超买',
    });

    rsiSeries.createPriceLine({
      price: 30,
      color: '#26a69a',
      lineWidth: 1,
      lineStyle: 1,
      axisLabelVisible: true,
      title: '超卖',
    });

    // MACD 图表
    const macdChart = createChart(macdChartContainerRef.current, {
      width: macdChartContainerRef.current.clientWidth,
      height: 120,
      layout: {
        background: { color: '#1e222d' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2b2b43' },
        horzLines: { color: '#2b2b43' },
      },
      rightPriceScale: {
        borderColor: '#485c7b',
      },
      timeScale: {
        borderColor: '#485c7b',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const macdHistogramSeries = macdChart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
    });

    const macdLineSeries = macdChart.addLineSeries({
      color: '#2962FF',
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });

    const macdSignalSeries = macdChart.addLineSeries({
      color: '#FF6D00',
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });

    // 保存引用
    mainChartRef.current = mainChart;
    rsiChartRef.current = rsiChart;
    macdChartRef.current = macdChart;

    candlestickSeriesRef.current = candlestickSeries;
    rsiSeriesRef.current = rsiSeries;
    macdLineSeriesRef.current = macdLineSeries;
    macdSignalSeriesRef.current = macdSignalSeries;
    macdHistogramSeriesRef.current = macdHistogramSeries;

    // 同步时间轴 - 使用标志避免循环
    let isSyncing = false;

    const syncTimeScale = (sourceChart, targetCharts) => {
      if (isSyncing) return;

      const timeRange = sourceChart.timeScale().getVisibleRange();
      if (timeRange) {
        isSyncing = true;
        targetCharts.forEach(chart => {
          try {
            chart.timeScale().setVisibleRange(timeRange);
          } catch (e) {
            // 忽略错误
          }
        });
        setTimeout(() => { isSyncing = false; }, 100);
      }
    };

    mainChart.timeScale().subscribeVisibleTimeRangeChange(() => {
      syncTimeScale(mainChart, [rsiChart, macdChart]);
    });

    rsiChart.timeScale().subscribeVisibleTimeRangeChange(() => {
      syncTimeScale(rsiChart, [mainChart, macdChart]);
    });

    macdChart.timeScale().subscribeVisibleTimeRangeChange(() => {
      syncTimeScale(macdChart, [mainChart, rsiChart]);
    });

    // 响应式
    const handleResize = () => {
      if (mainChartContainerRef.current) {
        const width = mainChartContainerRef.current.clientWidth;
        mainChart.applyOptions({ width });
        rsiChart.applyOptions({ width });
        macdChart.applyOptions({ width });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      mainChart.remove();
      rsiChart.remove();
      macdChart.remove();
    };
  }, []);

  // 更新数据和指标
  useEffect(() => {
    if (!candlestickSeriesRef.current || !data || data.length === 0 || currentIndex < 0) return;

    // 只显示到当前索引的K线数据
    const displayData = data.slice(0, currentIndex + 1);

    const formattedData = displayData.map(item => ({
      time: parseInt(item.openTime) / 1000,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
    }));

    candlestickSeriesRef.current.setData(formattedData);

    // 使用完整的历史数据计算指标，但只显示到当前索引
    // RSI 需要至少 15 根K线才能开始计算（period + 1）
    if (rsiSeriesRef.current && data.length > 14) {
      const rsiData = calculateRSI(data, 14);
      // 只显示到当前时间的RSI数据
      const currentTime = parseInt(data[currentIndex].openTime) / 1000;
      const filteredRsiData = rsiData.filter(item => item.time <= currentTime);
      rsiSeriesRef.current.setData(filteredRsiData);
    }

    // MACD 需要至少 slowPeriod + signalPeriod 根K线
    if (macdLineSeriesRef.current && data.length > 35) {
      const macdData = calculateMACD(data, 12, 26, 9);
      // 只显示到当前时间的MACD数据
      const currentTime = parseInt(data[currentIndex].openTime) / 1000;
      const filteredMacd = macdData.macd.filter(item => item.time <= currentTime);
      const filteredSignal = macdData.signal.filter(item => item.time <= currentTime);
      const filteredHistogram = macdData.histogram.filter(item => item.time <= currentTime);

      macdLineSeriesRef.current.setData(filteredMacd);
      macdSignalSeriesRef.current.setData(filteredSignal);
      macdHistogramSeriesRef.current.setData(filteredHistogram);
    }

    // 自动滚动到最新
    if (formattedData.length > 0 && mainChartRef.current) {
      mainChartRef.current.timeScale().scrollToPosition(0, false);
    }
  }, [data, currentIndex]);

  // 绘制交易标记
  useEffect(() => {
    if (!mainChartRef.current || !candlestickSeriesRef.current) return;

    // 清除所有旧的标记
    candlestickSeriesRef.current.setMarkers([]);

    const markers = [];

    // 添加入场标记
    if (trade) {
      markers.push({
        time: trade.entryTime / 1000,
        position: 'belowBar',
        color: trade.direction === 'long' ? '#26a69a' : '#ef5350',
        shape: trade.direction === 'long' ? 'arrowUp' : 'arrowDown',
        text: trade.direction === 'long' ? '买入' : '卖出',
      });

      // 绘制价格线
      if (trade.stopLoss) {
        candlestickSeriesRef.current.createPriceLine({
          price: trade.stopLoss,
          color: '#ef5350',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title: `止损 ${trade.stopLoss.toFixed(3)}`,
        });
      }

      if (trade.takeProfit) {
        candlestickSeriesRef.current.createPriceLine({
          price: trade.takeProfit,
          color: '#26a69a',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title: `止盈 ${trade.takeProfit.toFixed(3)}`,
        });
      }

      // 入场价格线
      candlestickSeriesRef.current.createPriceLine({
        price: trade.entryPrice,
        color: trade.direction === 'long' ? '#26a69a' : '#ef5350',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `入场 ${trade.entryPrice.toFixed(3)}`,
      });
    }

    // 添加出场标记
    if (tradeResult) {
      markers.push({
        time: tradeResult.exitTime / 1000,
        position: 'aboveBar',
        color: '#ffa726',
        shape: 'circle',
        text: '平仓',
      });

      // 出场价格线
      candlestickSeriesRef.current.createPriceLine({
        price: tradeResult.exitPrice,
        color: '#ffa726',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `出场 ${tradeResult.exitPrice.toFixed(3)}`,
      });
    }

    if (markers.length > 0) {
      candlestickSeriesRef.current.setMarkers(markers);
    }
  }, [trade, tradeResult]);

  return (
    <div className="chart-component">
      <div className="chart-container-wrapper">
        <div className="main-chart">
          <div className="chart-title">USD/JPY - 1分钟</div>
          <div ref={mainChartContainerRef} className="chart-container" />
        </div>
        <div className="indicator-chart">
          <div className="chart-title">RSI (14)</div>
          <div ref={rsiChartContainerRef} className="chart-container-small" />
        </div>
        <div className="indicator-chart">
          <div className="chart-title">MACD (12, 26, 9)</div>
          <div ref={macdChartContainerRef} className="chart-container-small" />
        </div>
      </div>
    </div>
  );
}

export default ChartComponent;
