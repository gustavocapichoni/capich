/**
 * js/tactical/indicators.js
 * Renderização no Canvas de Volume Institucional Bicolor e Nuvens do Indicador EMPIRE.
 */

import { state } from './state.js';
import { drawFibonacciRetracement } from './fibo.js';

// Volume Bicolor Empilhado (Compra + Venda)
let hoveredVolTime = null;

function formatVolNumber(val) {
  if (val === null || val === undefined || isNaN(val)) return '0';
  const abs = Math.abs(val);
  if (abs >= 1e9) return (val / 1e9).toFixed(2) + ' B';
  if (abs >= 1e6) return (val / 1e6).toFixed(2) + ' M';
  if (abs >= 1e3) return (val / 1e3).toFixed(1) + ' K';
  return val.toFixed(2);
}

function formatCandleDateTime(unixSec) {
  const d = new Date(unixSec * 1000);
  const dia  = String(d.getDate()).padStart(2, '0');
  const mes  = String(d.getMonth() + 1).padStart(2, '0');
  const hora = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes} às ${hora}:${min}`;
}

export function renderVolumeCanvas() {
  const canvas = document.getElementById('tac-vol-canvas');
  const container = document.getElementById('tac-chart-vol');
  if (!canvas || !container || !state.charts.main) return;

  const width = container.clientWidth;
  const height = 80;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  if (!state.candles.length) return;

  const timeScale = state.charts.main.timeScale();

  let maxVol = 0;
  state.candles.forEach(c => {
    const x = timeScale.timeToCoordinate(c.time);
    if (x !== null && x >= -20 && x <= width + 20) {
      if (c.volume > maxVol) maxVol = c.volume;
    }
  });
  if (maxVol === 0) maxVol = 1;

  let barWidth = 4;
  if (state.candles.length >= 2) {
    const x0 = timeScale.timeToCoordinate(state.candles[state.candles.length - 2].time);
    const x1 = timeScale.timeToCoordinate(state.candles[state.candles.length - 1].time);
    if (x0 !== null && x1 !== null) {
      barWidth = Math.max(2, Math.abs(x1 - x0) * 0.75);
    }
  }

  let hoveredBarData = null;

  state.candles.forEach(c => {
    const x = timeScale.timeToCoordinate(c.time);
    if (x === null || x < -20 || x > width + 20) return;

    const totalH = (c.volume / maxVol) * (height - 8);
    const buyRatio = c.volume > 0 ? (c.buyV / c.volume) : 0.5;
    const buyH  = totalH * buyRatio;
    const sellH = totalH - buyH;

    const drawX = x - (barWidth / 2);
    const baseY = height - 2;

    const isHovered = (hoveredVolTime === c.time);
    if (isHovered) {
      hoveredBarData = { drawX, baseY, totalH, barWidth, x };
    }

    // Parte Verde (Compra) - Embaixo
    ctx.fillStyle = isHovered ? '#12e592' : '#0ecb81';
    ctx.fillRect(drawX, baseY - buyH, barWidth, buyH);

    // Parte Vermelha (Venda) - Em cima
    ctx.fillStyle = isHovered ? '#ff5a70' : '#f6465d';
    ctx.fillRect(drawX, baseY - totalH, barWidth, sellH);
  });

  // Desenha o highlight da barra ativa (se houver mouse hover)
  if (hoveredBarData) {
    const { drawX, baseY, totalH, barWidth: bw, x } = hoveredBarData;

    // Linha guia vertical sutil
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Moldura de destaque na barra
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(drawX - 0.5, baseY - totalH - 1, bw + 1, totalH + 2);
  }
}

// Inicializa a interatividade de mouse no Histograma de Volume com intervalo de 3s
let volEventsInitialized = false;
let volTooltipTimer = null;
let currentHoverCandleTime = null;

function renderVolumeTooltipContent(candle, closestX, containerWidth, tooltip) {
  if (!candle || !tooltip) return;

  const totalVol = candle.volume || 0;
  const buyVol   = candle.buyV || 0;
  const sellVol  = Math.max(0, totalVol - buyVol);
  const buyPct   = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;
  const sellPct  = totalVol > 0 ? (sellVol / totalVol) * 100 : 50;
  const netDelta = buyVol - sellVol;
  const coinName = state.currentSymbol.replace('USDT', '');
  const timeStr  = formatCandleDateTime(candle.time);
  const tfStr    = state.currentTimeframe || '15m';

  tooltip.innerHTML = `
    <div class="tac-vol-tooltip-header">
      <span class="tac-vol-tooltip-time">🕒 ${timeStr} (${tfStr})</span>
      <span class="tac-vol-badge ${buyPct >= 50 ? 'buy' : 'sell'}">
        ${buyPct >= 50 ? '▲ COMPRA ' + buyPct.toFixed(1) + '%' : '▼ VENDA ' + sellPct.toFixed(1) + '%'}
      </span>
    </div>
    <div class="tac-vol-tooltip-body">
      <div class="tac-vol-row">
        <span class="tac-vol-lbl">📊 Volume Total:</span>
        <span class="tac-vol-val bold">${formatVolNumber(totalVol)} ${coinName}</span>
      </div>
      <div class="tac-vol-row">
        <span class="tac-vol-lbl green">🟢 Compra (Taker):</span>
        <span class="tac-vol-val green bold">${formatVolNumber(buyVol)} (${buyPct.toFixed(1)}%)</span>
      </div>
      <div class="tac-vol-row">
        <span class="tac-vol-lbl red">🔴 Venda (Pressão):</span>
        <span class="tac-vol-val red bold">${formatVolNumber(sellVol)} (${sellPct.toFixed(1)}%)</span>
      </div>
      <div class="tac-vol-divider"></div>
      <div class="tac-vol-row">
        <span class="tac-vol-lbl">⚖️ Saldo Líquido:</span>
        <span class="tac-vol-val ${netDelta >= 0 ? 'green' : 'red'} bold">
          ${netDelta >= 0 ? '+' : ''}${formatVolNumber(netDelta)} ${coinName}
        </span>
      </div>
    </div>
  `;

  // Centraliza horizontalmente e impede de vazar nas laterais
  const tooltipX = Math.max(110, Math.min(containerWidth - 110, closestX));
  tooltip.style.left = `${tooltipX}px`;
  tooltip.style.display = 'block';

  hoveredVolTime = candle.time;
  renderVolumeCanvas();
}

export function initVolumeEvents() {
  if (volEventsInitialized) return;
  const canvas = document.getElementById('tac-vol-canvas');
  const container = document.getElementById('tac-chart-vol');
  const tooltip = document.getElementById('tac-vol-tooltip');
  if (!canvas || !container || !tooltip) return;

  volEventsInitialized = true;

  const clearTooltipHover = () => {
    if (volTooltipTimer) {
      clearTimeout(volTooltipTimer);
      volTooltipTimer = null;
    }
    currentHoverCandleTime = null;
    if (hoveredVolTime !== null || tooltip.style.display !== 'none') {
      hoveredVolTime = null;
      tooltip.style.display = 'none';
      renderVolumeCanvas();
    }
  };

  canvas.addEventListener('mousemove', (e) => {
    if (!state.candles.length || !state.charts.main) return;
    const timeScale = state.charts.main.timeScale();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const width = container.clientWidth;

    // Encontra a barra de candle mais próxima do mouseX
    let closestCandle = null;
    let minDistance = 99999;
    let closestX = 0;

    let barWidth = 4;
    if (state.candles.length >= 2) {
      const x0 = timeScale.timeToCoordinate(state.candles[state.candles.length - 2].time);
      const x1 = timeScale.timeToCoordinate(state.candles[state.candles.length - 1].time);
      if (x0 !== null && x1 !== null) {
        barWidth = Math.max(2, Math.abs(x1 - x0) * 0.75);
      }
    }

    const maxThreshold = Math.max(barWidth * 1.5, 12);

    for (const c of state.candles) {
      const x = timeScale.timeToCoordinate(c.time);
      if (x === null) continue;
      const dist = Math.abs(x - mouseX);
      if (dist < minDistance && dist <= maxThreshold) {
        minDistance = dist;
        closestCandle = c;
        closestX = x;
      }
    }

    if (closestCandle) {
      // Se mudou de vela ou iniciou um novo foco
      if (currentHoverCandleTime !== closestCandle.time) {
        currentHoverCandleTime = closestCandle.time;

        if (volTooltipTimer) {
          clearTimeout(volTooltipTimer);
          volTooltipTimer = null;
        }

        // Se o tooltip estava aberto em outra barra anterior, esconde imediatamente
        if (tooltip.style.display !== 'none' || hoveredVolTime !== null) {
          tooltip.style.display = 'none';
          hoveredVolTime = null;
          renderVolumeCanvas();
        }

        // Dispara o tooltip apenas após manter o mouse por mais de 3 segundos (3000ms)
        const targetCandle = closestCandle;
        const targetX = closestX;
        volTooltipTimer = setTimeout(() => {
          if (currentHoverCandleTime === targetCandle.time) {
            renderVolumeTooltipContent(targetCandle, targetX, width, tooltip);
          }
        }, 3000);
      }
    } else {
      clearTooltipHover();
    }
  });

  container.addEventListener('mouseleave', clearTooltipHover);
}

// Nuvem / Zonas de Acúmulo e Distribuição Institucional (EMPIRE)
export function renderEmpireZones() {
  const canvas = document.getElementById('tac-zones-canvas');
  const container = document.getElementById('tac-chart-main');
  if (!canvas || !container || !state.charts.main) return;

  const width = container.clientWidth;
  const height = container.clientHeight || 450;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const timeScale = state.charts.main.timeScale();
  const series = state.series.candles;

  let chartPlotWidth = width - 60;
  if (typeof timeScale.width === 'function' && timeScale.width() > 100) {
    chartPlotWidth = timeScale.width();
  } else if (state.charts.main && typeof state.charts.main.priceScale === 'function') {
    try {
      const psw = state.charts.main.priceScale('right').width();
      if (psw > 0) chartPlotWidth = width - psw;
    } catch (e) {}
  }

  if (state.zonesVisible && state.indicatorsVisible && state.candles.length && series) {
    function drawSegments(isAccumKey, buyKey, sellKey, is72h) {
      const segments = [];
      let curSeg = null;

      for (let i = 0; i < state.candles.length; i++) {
        const c = state.candles[i];
        const status = c[isAccumKey];
        const buyP = c[buyKey];
        const sellP = c[sellKey];

        if (status === null || status === undefined || buyP === null || sellP === null) {
          if (curSeg) { segments.push(curSeg); curSeg = null; }
          continue;
        }

        if (!curSeg || curSeg.status !== status) {
          if (curSeg) segments.push(curSeg);
          curSeg = {
            status,
            startIdx: i,
            endIdx: i
          };
        } else {
          curSeg.endIdx = i;
        }
      }
      if (curSeg) segments.push(curSeg);

      segments.forEach(seg => {
        const startC = state.candles[seg.startIdx];
        const endC   = state.candles[seg.endIdx];

        const xStart = timeScale.timeToCoordinate(startC.time);
        let xEnd = timeScale.timeToCoordinate(endC.time);

        const isCurrent = (seg.endIdx === state.candles.length - 1);
        if (isCurrent) {
          xEnd = chartPlotWidth;
        }

        if (xStart === null && xEnd === null) return;
        const leftX  = xStart !== null ? xStart : 0;
        const rightX = xEnd !== null ? Math.min(xEnd, chartPlotWidth) : chartPlotWidth;
        const segW = Math.max(rightX - leftX, 4);

        if (leftX > chartPlotWidth || rightX < 0) return;

        let topPrice = -Infinity;
        let bottomPrice = Infinity;

        for (let k = seg.startIdx; k <= seg.endIdx; k++) {
          const cd = state.candles[k];
          const bP = cd[buyKey];
          const sP = cd[sellKey];
          if (bP !== null && sP !== null) {
            topPrice = Math.max(topPrice, bP, sP);
            bottomPrice = Math.min(bottomPrice, bP, sP);
          }
        }

        if (!isFinite(topPrice) || !isFinite(bottomPrice)) return;

        const yTop = series.priceToCoordinate(topPrice);
        const yBottom = series.priceToCoordinate(bottomPrice);

        if (yTop === null || yBottom === null) return;

        const drawY = Math.min(yTop, yBottom);
        const zoneH = Math.max(Math.abs(yBottom - yTop), 6);

        ctx.save();
        if (seg.status) {
          if (is72h) {
            ctx.fillStyle = 'rgba(14, 203, 129, 0.09)';
            ctx.strokeStyle = 'rgba(14, 203, 129, 0.35)';
          } else {
            ctx.fillStyle = 'rgba(56, 182, 255, 0.08)';
            ctx.strokeStyle = 'rgba(56, 182, 255, 0.30)';
          }
        } else {
          if (is72h) {
            ctx.fillStyle = 'rgba(246, 70, 93, 0.09)';
            ctx.strokeStyle = 'rgba(246, 70, 93, 0.35)';
          } else {
            ctx.fillStyle = 'rgba(255, 112, 67, 0.08)';
            ctx.strokeStyle = 'rgba(255, 112, 67, 0.30)';
          }
        }

        ctx.fillRect(leftX, drawY, segW, zoneH);

        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(leftX, drawY);
        ctx.lineTo(leftX + segW, drawY);
        ctx.moveTo(leftX, drawY + zoneH);
        ctx.lineTo(leftX + segW, drawY + zoneH);
        ctx.stroke();

        ctx.restore();
      });
    }

    drawSegments('isAccum', 'vwapBuy', 'vwapSell', true);
    drawSegments('isIntraAccum', 'intraBuy', 'intraSell', false);
  }

  // Desenho das ferramentas Fibonacci
  if (state.fibo && state.fibo.p1 && state.fibo.p2) {
    drawFibonacciRetracement(ctx, width, height, timeScale, series, state.fibo, 1);
  }
  if (state.fibo2 && state.fibo2.p1 && state.fibo2.p2) {
    drawFibonacciRetracement(ctx, width, height, timeScale, series, state.fibo2, 2);
  }
}
