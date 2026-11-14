/**
 * js/tactical/chart_core.js
 * Inicialização e ciclo de vida do gráfico TradingView Lightweight Charts v4.1.1.
 * Gerenciamento de séries, sincronização de altura com o painel de ordens e observadores de redimensionamento.
 */

import { state, getPrecisionForSymbol } from './state.js';
import { renderVolumeCanvas, renderEmpireZones, initVolumeEvents } from './indicators.js';
import { renderDefaultLegend, updateLegendOnHover, handleCandleTooltipHover, hideCandleTooltip, updateCandleCountdown } from './legend.js';
import { drawTop10Gauge, drawBasketGauge, drawTruckGauge } from './hud_gauges.js';
import { initFiboMouseEvents } from './fibo.js';

export function applyPriceFormatToSeries(symbol) {
  const precision = getPrecisionForSymbol(symbol);
  const minMove = 1 / Math.pow(10, precision);
  const formatOpt = {
    priceFormat: {
      type: 'price',
      precision,
      minMove
    }
  };

  if (state.series.candles)   state.series.candles.applyOptions(formatOpt);
  if (state.series.mmaShort)  state.series.mmaShort.applyOptions(formatOpt);
  if (state.series.mmaLong)   state.series.mmaLong.applyOptions(formatOpt);
  if (state.series.vwapBuy)   state.series.vwapBuy.applyOptions(formatOpt);
  if (state.series.vwapSell)  state.series.vwapSell.applyOptions(formatOpt);
  if (state.series.intraBuy)  state.series.intraBuy.applyOptions(formatOpt);
  if (state.series.intraSell) state.series.intraSell.applyOptions(formatOpt);
}

export function syncChartHeightToPanel() {
  const mainContainer = document.getElementById('tac-chart-main');
  const panel = document.getElementById('binance-order-panel');
  if (!panel || !mainContainer || !state.charts.main) return;

  const panelHeight = panel.offsetHeight || panel.clientHeight;
  if (panelHeight > 400) {
    const volHeight = 80;
    const targetChartHeight = Math.max(420, panelHeight - volHeight);

    mainContainer.style.height = `${targetChartHeight}px`;
    state.charts.main.applyOptions({
      width: mainContainer.clientWidth,
      height: targetChartHeight
    });
    renderEmpireZones();
    renderVolumeCanvas();
    if (window.ChartPositions && typeof window.ChartPositions.updateBadgePositions === 'function') {
      window.ChartPositions.updateBadgePositions();
    }
  }
}

export function initCharts() {
  if (typeof LightweightCharts === 'undefined') {
    console.error('[BTC Tactical] LightweightCharts not loaded!');
    return;
  }

  const mainContainer = document.getElementById('tac-chart-main');
  if (!mainContainer) return;

  const baseTheme = {
    layout: {
      background: { type: 'solid', color: '#000000' },
      textColor: '#848e9c',
      fontSize: 11
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal
    },
    localization: {
      locale: 'pt-BR',
      dateFormat: 'dd/MM/yyyy',
      timeFormatter: (timestamp) => {
        const d = new Date(timestamp * 1000);
        return d.toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }
    },
    timeScale: {
      borderColor: '#2b313a',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 16,
      barSpacing: 8,
      minBarSpacing: 3,
      shiftVisibleRangeOnNewBar: true,
      tickMarkFormatter: (time, tickMarkType) => {
        const d = new Date(time * 1000);
        if (tickMarkType === 0) { // Year
          return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric' });
        }
        if (tickMarkType === 1) { // Month
          return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', month: 'short' });
        }
        if (tickMarkType === 2) { // Day
          return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
        }
        // Time (Horário de Brasília UTC-3)
        return d.toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }
    }
  };

  const initialH = mainContainer.clientHeight || 450;
  state.charts.main = LightweightCharts.createChart(mainContainer, {
    ...baseTheme,
    width: mainContainer.clientWidth,
    height: initialH,
    rightPriceScale: {
      borderColor: '#2b313a',
      scaleMargins: { top: 0.08, bottom: 0.1 }
    }
  });

  // 1. Candles
  state.series.candles = state.charts.main.addCandlestickSeries({
    upColor: '#00bcd4',
    downColor: '#af0000',
    borderVisible: false,
    wickUpColor: '#00bcd4',
    wickDownColor: '#af0000',
    priceLineVisible: state.priceLineVisible
  });

  // Linhas de posições da Binance com arrasto de TP/SL
  if (window.ChartPositions) {
    window.ChartPositions.setTargetSeries(state.series.candles, state.charts.main, mainContainer);
  }

  const shortTitle = state.currentTimeframe === '15m' ? 'MMA 32' : 'MMA 8';
  const longTitle  = state.currentTimeframe === '15m' ? 'MMA 80' : 'MMA 20';
  const initMaTagsOn = state.maVisible && state.empireTagsVisible;

  // 2. MMAs (Amarela e Branca)
  state.series.mmaShort = state.charts.main.addLineSeries({
    color: '#f0b90b',
    lineWidth: 1,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lastValueVisible: initMaTagsOn,
    title: initMaTagsOn ? shortTitle : ''
  });

  state.series.mmaLong = state.charts.main.addLineSeries({
    color: '#ffffff',
    lineWidth: 1.5,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lastValueVisible: initMaTagsOn,
    title: initMaTagsOn ? longTitle : ''
  });

  const empireTitle = state.empireTagsVisible ? 'EMPIRE' : '';

  // 3. Indicador EMPIRE 72h
  state.series.vwapBuy = state.charts.main.addLineSeries({
    color: '#0ecb81',
    lineWidth: 2,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lastValueVisible: state.empireTagsVisible,
    visible: state.empire72hVisible,
    title: empireTitle
  });

  state.series.vwapSell = state.charts.main.addLineSeries({
    color: '#f6465d',
    lineWidth: 2,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lastValueVisible: state.empireTagsVisible,
    visible: state.empire72hVisible,
    title: empireTitle
  });

  // 4. Volume Real 8h (Intraday)
  state.series.intraBuy = state.charts.main.addLineSeries({
    color: '#38b6ff',
    lineWidth: 1.2,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lastValueVisible: state.empireTagsVisible,
    visible: state.empire8hVisible,
    title: empireTitle
  });

  state.series.intraSell = state.charts.main.addLineSeries({
    color: '#ff7043',
    lineWidth: 1.2,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lastValueVisible: state.empireTagsVisible,
    visible: state.empire8hVisible,
    title: empireTitle
  });

  applyPriceFormatToSeries(state.currentSymbol);

  const onChartVisualChange = () => {
    renderVolumeCanvas();
    renderEmpireZones();
    if (window.ChartPositions && typeof window.ChartPositions.updateBadgePositions === 'function') {
      window.ChartPositions.updateBadgePositions();
    }
    if (typeof updateCandleCountdown === 'function') {
      updateCandleCountdown();
    }
  };

  state.charts.main.timeScale().subscribeVisibleTimeRangeChange(onChartVisualChange);
  try {
    state.charts.main.timeScale().subscribeVisibleLogicalRangeChange(onChartVisualChange);
  } catch (_) {}

  // Sincroniza posições durante zoom ou arrasto de escalas e pan
  let isChartMouseDown = false;
  let chartDragRaf = null;
  const loopChartSync = () => {
    onChartVisualChange();
    if (isChartMouseDown) {
      chartDragRaf = requestAnimationFrame(loopChartSync);
    }
  };

  mainContainer.addEventListener('mousedown', () => {
    isChartMouseDown = true;
    cancelAnimationFrame(chartDragRaf);
    chartDragRaf = requestAnimationFrame(loopChartSync);
  }, { capture: true });

  window.addEventListener('mouseup', () => {
    if (isChartMouseDown) {
      isChartMouseDown = false;
      cancelAnimationFrame(chartDragRaf);
      onChartVisualChange();
    }
  });

  mainContainer.addEventListener('wheel', () => {
    onChartVisualChange();
    requestAnimationFrame(onChartVisualChange);
  }, { passive: true });

  state.charts.main.subscribeCrosshairMove(param => {
    if (!param || !param.time) {
      state.isHovering = false;
      renderDefaultLegend();
      hideCandleTooltip();
      return;
    }
    state.isHovering = true;
    updateLegendOnHover(param);
    handleCandleTooltipHover(param, mainContainer);
  });

  mainContainer.addEventListener('mouseleave', () => {
    state.isHovering = false;
    renderDefaultLegend();
    hideCandleTooltip();
    if (!state.fibo.drawing) {
      mainContainer.style.cursor = '';
    }
  });

  // Inicializa eventos interativos de mouse do Fibonacci e Volume
  initFiboMouseEvents(mainContainer);
  initVolumeEvents();

  const ro = new ResizeObserver(() => {
    if (state.charts.main && mainContainer) {
      state.charts.main.applyOptions({
        width: mainContainer.clientWidth,
        height: mainContainer.clientHeight || 450
      });
      renderVolumeCanvas();
      renderEmpireZones();
      drawTop10Gauge();
      drawBasketGauge();
      drawTruckGauge();
    }
  });
  ro.observe(mainContainer);

  window._syncTacChartHeight = syncChartHeightToPanel;

  const panelEl = document.getElementById('binance-order-panel');
  if (panelEl) {
    const panelRo = new ResizeObserver(() => {
      syncChartHeightToPanel();
    });
    panelRo.observe(panelEl);
  }

  setTimeout(syncChartHeightToPanel, 100);
  setTimeout(syncChartHeightToPanel, 400);
  setTimeout(syncChartHeightToPanel, 1000);
  window.addEventListener('resize', syncChartHeightToPanel);
}
