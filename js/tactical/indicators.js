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

  // Escala máxima de Volume das Barras e Futuros
  let maxVol = 0;
  // Escala máxima independente de Volume Spot para não ficar esmagado
  let maxSpotVol = 0;

  state.candles.forEach(c => {
    const x = timeScale.timeToCoordinate(c.time);
    if (x !== null && x >= -20 && x <= width + 20) {
      const spotTotal = (c.spotBuy || 0) + (c.spotSell || 0);
      const futTotal  = (c.futBuy  || 0) + (c.futSell  || 0);
      const combined  = c.volume || 0;
      const mx = Math.max(futTotal, combined);
      if (mx > maxVol) maxVol = mx;
      if (spotTotal > maxSpotVol) maxSpotVol = spotTotal;
    }
  });
  if (maxVol === 0) maxVol = 1;
  if (maxSpotVol === 0) maxSpotVol = 1;

  let barWidth = 4;
  if (state.candles.length >= 2) {
    const x0 = timeScale.timeToCoordinate(state.candles[state.candles.length - 2].time);
    const x1 = timeScale.timeToCoordinate(state.candles[state.candles.length - 1].time);
    if (x0 !== null && x1 !== null) {
      barWidth = Math.max(2, Math.abs(x1 - x0) * 0.75);
    }
  }

  const baseY = height - 2;

  // ── Grade e Escala Numérica de Volume à Direita (estilo Binance) ──────────
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // Linha de 100% (topo)
  const yTop = baseY - (height - 12);
  ctx.beginPath();
  ctx.moveTo(0, yTop);
  ctx.lineTo(width, yTop);
  ctx.stroke();

  // Linha de 50% (meio)
  const yMid = baseY - ((height - 12) * 0.5);
  ctx.beginPath();
  ctx.moveTo(0, yMid);
  ctx.lineTo(width, yMid);
  ctx.stroke();
  ctx.setLineDash([]);

  // Rótulos numéricos na lateral direita
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#848e9c';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatVolNumber(maxVol), width - 8, yTop + 6);
  ctx.fillText(formatVolNumber(maxVol * 0.5), width - 8, yMid);
  ctx.restore();

  let hoveredBarData = null;

  state.candles.forEach(c => {
    const x = timeScale.timeToCoordinate(c.time);
    if (x === null || x < -20 || x > width + 20) return;

    const totalH = (c.volume / maxVol) * (height - 12);
    const buyRatio = c.volume > 0 ? (c.buyV / c.volume) : 0.5;
    const buyH  = totalH * buyRatio;
    const sellH = totalH - buyH;

    const drawX = x - (barWidth / 2);

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

  // ── Linha Spot (Branco) e Linha Futures (Azul #0c3299) ───────────────────
  // Coleta pontos visíveis para desenhar as linhas de forma suave e contínua
  const spotPoints = [];
  const futPoints  = [];

  state.candles.forEach(c => {
    const x = timeScale.timeToCoordinate(c.time);
    if (x === null || x < -20 || x > width + 20) return;

    const spotTotal = (c.spotBuy || 0) + (c.spotSell || 0);
    const futTotal  = (c.futBuy  || 0) + (c.futSell  || 0);

    // Linha Spot usa maxSpotVol proporcional (atingindo até 85% do topo para perfeita oscilação natural)
    spotPoints.push({ x, y: baseY - (spotTotal / maxSpotVol) * (height - 14) });
    // Linha Futuros usa maxVol proporcional
    futPoints.push({  x, y: baseY - (futTotal  / maxVol)     * (height - 12) });
  });

  // Desenha linha Futures (Azul #0c3299 com espessura fina de 1.1px)
  if (futPoints.length >= 2) {
    ctx.save();
    ctx.strokeStyle = '#2b66ff';
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(futPoints[0].x, futPoints[0].y);
    for (let i = 1; i < futPoints.length; i++) {
      ctx.lineTo(futPoints[i].x, futPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Desenha linha Spot (Branco translúcido com espessura fina de 1.1px)
  if (spotPoints.length >= 2) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(spotPoints[0].x, spotPoints[0].y);
    for (let i = 1; i < spotPoints.length; i++) {
      ctx.lineTo(spotPoints[i].x, spotPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Desenha o highlight da barra ativa (se houver mouse hover)
  if (hoveredBarData) {
    const { drawX, baseY: bY, totalH, barWidth: bw, x } = hoveredBarData;

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
    ctx.strokeRect(drawX - 0.5, bY - totalH - 1, bw + 1, totalH + 2);
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
        <span class="tac-vol-lbl" style="color:#ffffff;">⚪ Vol. Spot:</span>
        <span class="tac-vol-val bold" style="color:#ffffff;">${formatVolNumber((candle.spotBuy || 0) + (candle.spotSell || 0))} ${coinName}</span>
      </div>
      <div class="tac-vol-row">
        <span class="tac-vol-lbl" style="color:#4d88ff;">🔵 Vol. Futuros:</span>
        <span class="tac-vol-val bold" style="color:#4d88ff;">${formatVolNumber((candle.futBuy || 0) + (candle.futSell || 0))} ${coinName}</span>
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

  if (state.candles.length && series && (state.zones72hVisible || state.zones8hVisible)) {
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
            ctx.fillStyle = 'rgba(0, 188, 212, 0.09)';
            ctx.strokeStyle = 'rgba(0, 188, 212, 0.35)';
          } else {
            ctx.fillStyle = 'rgba(0, 188, 212, 0.08)';
            ctx.strokeStyle = 'rgba(0, 188, 212, 0.30)';
          }
        } else {
          if (is72h) {
            ctx.fillStyle = 'rgba(175, 0, 0, 0.12)';
            ctx.strokeStyle = 'rgba(175, 0, 0, 0.40)';
          } else {
            ctx.fillStyle = 'rgba(175, 0, 0, 0.10)';
            ctx.strokeStyle = 'rgba(175, 0, 0, 0.35)';
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

    if (state.zones72hVisible) {
      drawSegments('isAccum', 'vwapBuy', 'vwapSell', true);
    }
    if (state.zones8hVisible) {
      drawSegments('isIntraAccum', 'intraBuy', 'intraSell', false);
    }
  }

  // Desenho das ferramentas Fibonacci (Múltiplos Fibos Dinâmicos)
  if (Array.isArray(state.fibos)) {
    state.fibos.forEach((f, idx) => {
      if (f && f.p1 && f.p2) {
        drawFibonacciRetracement(ctx, width, height, timeScale, series, f, f.type === 'retr' ? 2 : 1);
      }
    });
  }
  // Desenho do Fibo enquanto o usuário está arrastando para traçar no gráfico
  if (state.drawingFibo && state.drawingFibo.p1 && state.drawingFibo.p2) {
    drawFibonacciRetracement(ctx, width, height, timeScale, series, state.drawingFibo, state.drawingFibo.type === 'retr' ? 2 : 1);
  }
  // Suporte aos legados se existirem
  if (state.fibo && state.fibo.p1 && state.fibo.p2 && (!state.fibos || !state.fibos.length)) {
    drawFibonacciRetracement(ctx, width, height, timeScale, series, state.fibo, 1);
  }
  if (state.fibo2 && state.fibo2.p1 && state.fibo2.p2 && (!state.fibos || !state.fibos.length)) {
    drawFibonacciRetracement(ctx, width, height, timeScale, series, state.fibo2, 2);
  }

  // Desenho da Linha de Preço Cortada (apenas da vela atual para frente / direita)
  if (state.priceLineVisible !== false && state.candles && state.candles.length && series) {
    const lastCandle = state.candles[state.candles.length - 1];
    const livePrice = (state.currentPrice !== null && state.currentPrice !== undefined) ? state.currentPrice : (lastCandle ? lastCandle.close : null);
    if (livePrice !== null && livePrice !== undefined) {
      const y = series.priceToCoordinate(livePrice);
      const startX = timeScale.timeToCoordinate(lastCandle.time);
      if (y !== null && startX !== null && y >= 0 && y <= height) {
        ctx.save();
        const isBull = lastCandle.close >= lastCandle.open;
        ctx.strokeStyle = isBull ? 'rgba(0, 188, 212, 0.85)' : 'rgba(246, 70, 93, 0.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([1.5, 2.5]); // Linha pontilhada (pontinhos finos)
        ctx.beginPath();
        ctx.moveTo(Math.max(0, startX), Math.round(y));
        ctx.lineTo(chartPlotWidth, Math.round(y));
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
