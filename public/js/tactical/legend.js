/**
 * js/tactical/legend.js
 * Barra de Legenda Dinâmica e Inspetor de Candles no Gráfico Tático.
 * Contagem regressiva da vela atual (15m / 1h).
 */

import { state, formatPrice, formatVolume } from './state.js';

export function renderDefaultLegend() {
  if (!state.candles.length) return;
  const last = state.candles[state.candles.length - 1];
  formatLegendHTML(null, last);
}

export function updateLegendOnHover(param) {
  const candle = state.candles.find(c => c.time === param.time);
  if (!candle) {
    renderDefaultLegend();
    return;
  }
  formatLegendHTML(null, candle);
}

export function formatLegendHTML(leg, c) {
  const isUp = c.close >= c.open;
  const pColor = isUp ? '#0ecb81' : '#f6465d';
  const diff = c.close - c.open;
  const pct = c.open > 0 ? ((diff / c.open) * 100).toFixed(2) : '0.00';
  const sign = diff >= 0 ? '+' : '';

  const baseLower = (state.baseAsset || 'btc').toLowerCase();
  const iconImg = `<img src="assets/icons/${baseLower}.png" style="width:16px;height:16px;border-radius:50%;vertical-align:middle;margin-right:3px;box-shadow:0 0 4px rgba(0,0,0,0.4);" alt="${state.baseAsset}" onerror="this.style.display='none'">`;

  // Atualiza o Ticker no Topo
  const tickerEl = document.getElementById('tac-ticker-content');
  if (tickerEl) {
    tickerEl.innerHTML = `
      ${iconImg}
      <strong style="color:var(--tac-text-primary);font-size:11.5px;">${state.currentSymbol}</strong>
      <span style="color:${pColor};font-weight:700;margin-left:3px;font-size:11.5px;">$${formatPrice(c.close)}</span>
      <span style="color:${pColor};font-size:10.5px;margin-left:1px;">(${sign}${pct}%)</span>
    `;
  }

  // 1. Atualiza o OHLC no canto superior esquerdo DENTRO do gráfico (Estilo Binance)
  const chartContainer = document.getElementById('tac-chart-main');
  if (chartContainer) {
    let ohlcOverlay = document.getElementById('tac-chart-ohlc');
    if (!ohlcOverlay) {
      ohlcOverlay = document.createElement('div');
      ohlcOverlay.id = 'tac-chart-ohlc';
      ohlcOverlay.className = 'tac-ohlc-overlay';
      chartContainer.appendChild(ohlcOverlay);
    }
    ohlcOverlay.innerHTML = `
      <span><span class="ohlc-label">O</span><span class="ohlc-val">${formatPrice(c.open)}</span></span>
      <span><span class="ohlc-label">H</span><span class="ohlc-val">${formatPrice(c.high)}</span></span>
      <span><span class="ohlc-label">L</span><span class="ohlc-val">${formatPrice(c.low)}</span></span>
      <span><span class="ohlc-label">C</span><span class="ohlc-val" style="color:${pColor};font-weight:700;">${formatPrice(c.close)}</span></span>
      <span style="color:${pColor};font-size:10.5px;">${sign}${formatPrice(diff)} (${sign}${pct}%)</span>
    `;
  }

  // Volume Real 72h e 8h posicionados no header ao lado do par
  const status72h = c.isAccum
    ? '<span style="color:#0ecb81;font-weight:700;">🟢 EMPIRE 72h ACÚMULO</span>'
    : '<span style="color:#f6465d;font-weight:700;">🔴 EMPIRE 72h DISTRIB.</span>';
  const net72Text = formatVolume(c.netAccum72h, state.baseAsset);
  const p72hVal = c.isAccum ? c.vwapBuy : c.vwapSell;
  const p72hStr = (state.empireTagsVisible && p72hVal) ? ` · $${formatPrice(p72hVal)}` : '';

  const status8h = c.isIntraAccum
    ? '<span style="color:#38b6ff;font-weight:700;">🔷 EMPIRE 8h ACÚMULO</span>'
    : '<span style="color:#ff7043;font-weight:700;">🔶 EMPIRE 8h DISTRIB.</span>';
  const net8Text = formatVolume(c.netAccum8h, state.baseAsset);
  const p8hVal = c.isIntraAccum ? c.intraBuy : c.intraSell;
  const p8hStr = (state.empireTagsVisible && p8hVal) ? ` · $${formatPrice(p8hVal)}` : '';

  const el72h = document.getElementById('tac-empire-72h-val');
  if (el72h) {
    el72h.innerHTML = `${status72h} <span style="color:${c.isAccum ? '#0ecb81' : '#f6465d'};font-weight:600;">[${net72Text}${p72hStr}]</span>`;
    el72h.title = `EMPIRE 72h: ${c.isAccum ? 'Acumulação Institucional' : 'Distribuição Institucional'} (${net72Text})`;
  }

  const el8h = document.getElementById('tac-empire-8h-val');
  if (el8h) {
    el8h.innerHTML = `${status8h} <span style="color:${c.isIntraAccum ? '#38b6ff' : '#ff7043'};font-weight:600;">[${net8Text}${p8hStr}]</span>`;
    el8h.title = `EMPIRE 8h: ${c.isIntraAccum ? 'Acumulação Intraday' : 'Distribuição Intraday'} (${net8Text})`;
  }

  updateCandleCountdown();
}

export function updateCandleCountdown() {
  const tf = state.currentTimeframe || '15m';
  const now = Date.now();
  let intervalMs = 15 * 60 * 1000;
  if (tf === '1h') intervalMs = 60 * 60 * 1000;
  else if (tf === '1d') intervalMs = 24 * 60 * 60 * 1000;

  const nextClose = (Math.floor(now / intervalMs) + 1) * intervalMs;
  const diffSec = Math.max(0, Math.floor((nextClose - now) / 1000));

  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  const timeStr = h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const container = document.getElementById('tac-chart-main');
  if (!container) return;

  let countdownBadge = document.getElementById('tac-price-countdown-badge');
  if (!countdownBadge) {
    countdownBadge = document.createElement('div');
    countdownBadge.id = 'tac-price-countdown-badge';
    countdownBadge.className = 'tac-price-countdown-badge';
    container.appendChild(countdownBadge);
  }

  countdownBadge.textContent = timeStr;

  if (diffSec <= 30) {
    countdownBadge.classList.add('closing-soon');
  } else {
    countdownBadge.classList.remove('closing-soon');
  }

  // Posiciona acoplado na escala de preços vertical direita (junto ao preço atual da vela)
  if (state.series.candles && state.candles.length) {
    const lastCandle = state.candles[state.candles.length - 1];
    const y = state.series.candles.priceToCoordinate(lastCandle.close);
    const maxH = container.clientHeight || 450;

    let psw = 58;
    if (state.charts.main && typeof state.charts.main.priceScale === 'function') {
      try { psw = state.charts.main.priceScale('right').width() || 58; } catch (_) {}
    }
    const targetW = Math.max(38, psw - 12);

    if (y !== null && y >= 10 && y <= maxH - 25) {
      countdownBadge.style.top = `${Math.round(y + 11)}px`;
      countdownBadge.style.width = `${targetW}px`;
      countdownBadge.style.display = 'inline-flex';
    } else {
      countdownBadge.style.display = 'none';
    }
  } else {
    countdownBadge.style.display = 'none';
  }
}

// ─── Tooltip Flutuante de Candle com Regra dos 3 Segundos ───────────────────
let candleTooltipTimer = null;
let currentCandleHoverTime = null;

export function hideCandleTooltip() {
  if (candleTooltipTimer) {
    clearTimeout(candleTooltipTimer);
    candleTooltipTimer = null;
  }
  currentCandleHoverTime = null;
  const tooltip = document.getElementById('tac-candle-tooltip');
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

export function handleCandleTooltipHover(param, container) {
  const tooltip = document.getElementById('tac-candle-tooltip');
  if (!tooltip || !container || !param || !param.time || !param.point) {
    hideCandleTooltip();
    return;
  }

  const candle = state.candles.find(c => c.time === param.time);
  if (!candle) {
    hideCandleTooltip();
    return;
  }

  // Se mudou de candle, reinicia a contagem de 3 segundos
  if (currentCandleHoverTime !== param.time) {
    currentCandleHoverTime = param.time;

    if (candleTooltipTimer) {
      clearTimeout(candleTooltipTimer);
      candleTooltipTimer = null;
    }

    // Esconde o tooltip se estava aberto em outra barra anterior
    tooltip.style.display = 'none';

    const targetPoint = { x: param.point.x, y: param.point.y };
    const targetTime = param.time;

    candleTooltipTimer = setTimeout(() => {
      if (currentCandleHoverTime === targetTime) {
        renderCandleTooltip(candle, targetPoint, container, tooltip);
      }
    }, 3000);
  }
}

function formatCandleTime(unixSec) {
  if (!unixSec) return '--';
  const d = new Date(unixSec * 1000);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}, ${hora}:${min}`;
}

function renderCandleTooltip(c, point, container, tooltip) {
  if (!c || !tooltip || !container) return;

  const isUp = c.close >= c.open;
  const diff = c.close - c.open;
  const pct = c.open > 0 ? ((diff / c.open) * 100).toFixed(2) : '0.00';
  const sign = diff >= 0 ? '+' : '';
  const tfStr = state.currentTimeframe || '15m';
  const timeStr = formatCandleTime(c.time);
  const coinName = (state.baseAsset || state.currentSymbol.replace('USDT', '')).toUpperCase();

  tooltip.innerHTML = `
    <div class="tac-candle-tooltip-header">
      <span class="tac-candle-tooltip-time">🕒 ${timeStr} (${tfStr})</span>
      <span class="tac-candle-badge ${isUp ? 'buy' : 'sell'}">
        ${isUp ? '▲ ALTA ' + sign + pct + '%' : '▼ BAIXA ' + sign + pct + '%'}
      </span>
    </div>
    <div class="tac-candle-tooltip-body">
      <div class="tac-candle-row">
        <span class="tac-candle-lbl">• Abertura (O):</span>
        <span class="tac-candle-val white">$${formatPrice(c.open)}</span>
      </div>
      <div class="tac-candle-row">
        <span class="tac-candle-lbl">• Máxima (H):</span>
        <span class="tac-candle-val green">$${formatPrice(c.high)}</span>
      </div>
      <div class="tac-candle-row">
        <span class="tac-candle-lbl">• Mínima (L):</span>
        <span class="tac-candle-val red">$${formatPrice(c.low)}</span>
      </div>
      <div class="tac-candle-row">
        <span class="tac-candle-lbl">• Fechamento (C):</span>
        <span class="tac-candle-val ${isUp ? 'green' : 'red'}">$${formatPrice(c.close)}</span>
      </div>
      <div class="tac-vol-divider"></div>
      <div class="tac-candle-row">
        <span class="tac-candle-lbl">• Volume (V):</span>
        <span class="tac-candle-val white">${formatVolume(c.volume, coinName)}</span>
      </div>
    </div>
  `;

  tooltip.style.borderTopColor = isUp ? '#0ecb81' : '#f6465d';

  // Posicionamento inteligente próximo ao cursor
  const containerW = container.clientWidth;
  const containerH = container.clientHeight || 450;
  const tipW = 190;
  const tipH = 160;

  let left = point.x + 18;
  let top = point.y - 25;

  if (left + tipW > containerW - 12) {
    left = Math.max(10, point.x - tipW - 18);
  }
  if (top + tipH > containerH - 12) {
    top = Math.max(10, containerH - tipH - 12);
  }
  if (top < 10) top = 10;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.display = 'block';
}
