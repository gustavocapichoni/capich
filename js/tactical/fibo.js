/**
 * js/tactical/fibo.js
 * Ferramenta Interativa de Fibonacci (Fibo 1 Principal + Fibo 2 Cluster Boroden).
 * Manipulação de âncoras, persistência no localStorage e renderização no Canvas.
 */

import { state, formatPrice } from './state.js';
import { tacStopAlert, renderFiboAlertBadge } from './audio_alerts.js';
import { renderEmpireZones } from './indicators.js';

export function getFiboStorageKey(which, symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return which === 2 ? `capich_tac_fibo2_${sym}` : `capich_tac_fibo_${sym}`;
}

export function loadFiboForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  if (state.fibo.alert2618) {
    state.fibo.alert2618.armed = false;
    state.fibo.alert2618.triggered = false;
    state.fibo.alert2618.soundActive = false;
    state.fibo.alert2618.approachDir = null;
  }
  if (state.fibo2?.alert2618) {
    state.fibo2.alert2618.armed = false;
    state.fibo2.alert2618.triggered = false;
    state.fibo2.alert2618.soundActive = false;
    state.fibo2.alert2618.approachDir = null;
  }
  tacStopAlert();
  renderFiboAlertBadge(false, null);

  try {
    // Fibo 1
    const key1 = getFiboStorageKey(1, sym);
    const savedFibo = localStorage.getItem(key1);
    if (savedFibo) {
      const fiboData = JSON.parse(savedFibo);
      if (fiboData.p1 && fiboData.p2) {
        state.fibo.p1 = fiboData.p1;
        state.fibo.p2 = fiboData.p2;
        state.fibo.active = true;
        state.fibo.drawing = false;
      } else {
        state.fibo.active = false;
        state.fibo.p1 = null;
        state.fibo.p2 = null;
      }
    } else {
      state.fibo.active = false;
      state.fibo.p1 = null;
      state.fibo.p2 = null;
    }

    // Fibo 2
    const key2 = getFiboStorageKey(2, sym);
    const savedFibo2 = localStorage.getItem(key2);
    if (savedFibo2) {
      const fiboData2 = JSON.parse(savedFibo2);
      if (fiboData2.p1 && fiboData2.p2) {
        state.fibo2.p1 = fiboData2.p1;
        state.fibo2.p2 = fiboData2.p2;
        state.fibo2.active = true;
        state.fibo2.drawing = false;
      } else {
        state.fibo2.active = false;
        state.fibo2.p1 = null;
        state.fibo2.p2 = null;
      }
    } else {
      state.fibo2.active = false;
      state.fibo2.p1 = null;
      state.fibo2.p2 = null;
    }

    updateFiboButtonUI(state.fibo.active ? 'placed' : 'idle', 1);
    updateFiboButtonUI(state.fibo2.active ? 'placed' : 'idle', 2);
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar Fibo do par:', sym, e);
  }
}

export function toggleFiboTool(which = 1) {
  const is2 = (which === 2);
  const targetFibo = is2 ? state.fibo2 : state.fibo;
  const otherFibo  = is2 ? state.fibo : state.fibo2;

  // Cancela o modo desenho do outro se estivesse aberto
  if (otherFibo.drawing) {
    otherFibo.drawing = false;
    updateFiboButtonUI(otherFibo.active ? 'placed' : 'idle', is2 ? 1 : 2);
  }

  // Entra no modo de traçar o Fibo selecionado
  targetFibo.active = true;
  targetFibo.drawing = true;
  targetFibo.isDragging = false;
  targetFibo.dragAnchor = null;
  targetFibo.p1 = null;
  targetFibo.p2 = null;

  if (targetFibo.alert2618) {
    targetFibo.alert2618.armed = false;
    targetFibo.alert2618.triggered = false;
    targetFibo.alert2618.soundActive = false;
    targetFibo.alert2618.approachDir = null;
    tacStopAlert();
    renderFiboAlertBadge(false, null);
  }

  updateFiboButtonUI('drawing', which);
  const mc = document.getElementById('tac-chart-main');
  if (mc) mc.classList.add('fibo-mode');
  renderEmpireZones();
}

export function clearFibo(which = 1) {
  const is2 = (which === 2);
  const targetFibo = is2 ? state.fibo2 : state.fibo;
  const storageKey = getFiboStorageKey(which, state.currentSymbol);

  if (state.selectedFibo === which) {
    state.selectedFibo = null;
  }

  targetFibo.active = false;
  targetFibo.drawing = false;
  targetFibo.isDragging = false;
  targetFibo.dragAnchor = null;
  targetFibo.p1 = null;
  targetFibo.p2 = null;

  if (targetFibo.alert2618) {
    targetFibo.alert2618.armed = false;
    targetFibo.alert2618.triggered = false;
    targetFibo.alert2618.soundActive = false;
    targetFibo.alert2618.approachDir = null;
    tacStopAlert();
    renderFiboAlertBadge(false, null);
  }

  try { localStorage.removeItem(storageKey); } catch (_) {}
  updateFiboButtonUI('idle', which);

  const mc = document.getElementById('tac-chart-main');
  if (mc && !state.fibo.drawing && !state.fibo2.drawing) {
    mc.classList.remove('fibo-mode');
    mc.style.cursor = '';
  }
  renderEmpireZones();
}

export function updateFiboButtonUI(mode, which = 1) {
  const is2 = (which === 2);
  const btn = document.getElementById(is2 ? 'tac-btn-fibo2' : 'tac-btn-fibo');
  const btnClear = document.getElementById(is2 ? 'tac-btn-fibo2-clear' : 'tac-btn-fibo-clear');
  const statusSpan = document.getElementById(is2 ? 'tac-status-fibo2' : 'tac-status-fibo1');
  if (!btn) return;

  const baseClass = is2 ? 'tac-dropdown-item tac-btn-fibo tac-btn-fibo-2' : 'tac-dropdown-item tac-btn-fibo';
  const label = is2 ? '📐 Fibo 2' : '📐 Fibo 1';

  if (mode === 'drawing') {
    btn.className = `${baseClass} drawing`;
    if (statusSpan) {
      statusSpan.textContent = 'Traçando...';
    } else {
      btn.textContent = '📐 Traçando...';
    }
    btn.title = 'Clique e arraste no gráfico do Ponto 1 ao Ponto 2';
    if (btnClear) btnClear.style.display = 'none';
  } else if (mode === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) {
      statusSpan.textContent = 'ATIVO';
    } else {
      btn.textContent = label;
    }
    btn.title = is2
      ? 'Fibo 2 ativo (Cluster Carolyn Boroden)! Arraste para ajustar ou clique no ✕ para limpar.'
      : 'Fibo 1 ativo (Principal)! Arraste para ajustar ou clique no ✕ para limpar.';
    if (btnClear) btnClear.style.display = 'inline-flex';
  } else {
    btn.className = baseClass;
    if (statusSpan) {
      statusSpan.textContent = 'OFF';
    } else {
      btn.textContent = label;
    }
    btn.title = is2
      ? 'Clique para traçar Fibo 2 (Retrações de Pernada Menor / Cluster Boroden)'
      : 'Clique para traçar Fibo 1 (Principal: Retrações + Expansões até 4.0)';
    if (btnClear) btnClear.style.display = 'none';
  }
}

// Distância ponto -> segmento de reta (para agarrar linha diagonal)
export function distToSegment(px, py, x1, y1, x2, y2) {
  if (x1 === null || y1 === null || x2 === null || y2 === null) return Infinity;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Mapeamento de coordenadas com ímã cirúrgico
export function getPointFromClientCoords(clientX, clientY) {
  const series = state.series.candles;
  const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
  if (!series || !timeScale || !state.candles.length) return null;

  let bestCandle = null;
  let minDistX = Infinity;

  for (let i = 0; i < state.candles.length; i++) {
    const c = state.candles[i];
    const cx = timeScale.timeToCoordinate(c.time);
    if (cx === null || cx === undefined) continue;
    const dx = Math.abs(cx - clientX);
    if (dx < minDistX) {
      minDistX = dx;
      bestCandle = c;
    }
  }

  let targetTime = null;
  if (bestCandle) {
    targetTime = bestCandle.time;
  } else {
    targetTime = timeScale.coordinateToTime(clientX);
    if (!targetTime && state.candles.length) {
      targetTime = state.candles[state.candles.length - 1].time;
    }
  }

  const rawPrice = series.coordinateToPrice(clientY);
  if (rawPrice === null || rawPrice === undefined) return null;

  let finalPrice = rawPrice;
  let isSnap = false;

  // Imã inteligente nos pavios se o cursor estiver a menos de 30px
  if (bestCandle && minDistX <= 30) {
    const yHigh = series.priceToCoordinate(bestCandle.high);
    const yLow  = series.priceToCoordinate(bestCandle.low);
    const distHigh = (yHigh !== null && yHigh !== undefined) ? Math.abs(yHigh - clientY) : Infinity;
    const distLow  = (yLow  !== null && yLow  !== undefined) ? Math.abs(yLow  - clientY) : Infinity;

    if (distHigh <= 22 && distHigh <= distLow) {
      finalPrice = bestCandle.high;
      targetTime = bestCandle.time;
      isSnap = true;
    } else if (distLow <= 22) {
      finalPrice = bestCandle.low;
      targetTime = bestCandle.time;
      isSnap = true;
    }
  }

  return { price: finalPrice, time: targetTime, isSnap };
}

export function setChartScroll(enabled) {
  if (state.charts && state.charts.main) {
    try {
      state.charts.main.applyOptions({
        handleScroll: enabled,
        handleScale: enabled
      });
    } catch (_) {}
  }
}

export function checkFiboHit(fiboObj, clientX, clientY, timeScale, series, fiboNum = 1) {
  if (!fiboObj || !fiboObj.p1 || !fiboObj.p2) return null;
  const x1 = fiboObj.p1.time ? getInterpolatedTimeToCoordinate(timeScale, fiboObj.p1.time) : null;
  const y1 = series.priceToCoordinate(fiboObj.p1.price);
  const x2 = fiboObj.p2.time ? getInterpolatedTimeToCoordinate(timeScale, fiboObj.p2.time) : null;
  const y2 = series.priceToCoordinate(fiboObj.p2.price);

  const d1 = (x1 !== null && y1 !== null) ? Math.hypot(x1 - clientX, y1 - clientY) : Infinity;
  const d2 = (x2 !== null && y2 !== null) ? Math.hypot(x2 - clientX, y2 - clientY) : Infinity;
  const dLine = (x1 !== null && y1 !== null && x2 !== null && y2 !== null)
    ? distToSegment(clientX, clientY, x1, y1, x2, y2)
    : Infinity;

  if (d1 <= 20) return { anchor: 'p1' };
  if (d2 <= 20) return { anchor: 'p2' };
  if (dLine <= 12) return { anchor: 'line', clientX, clientY, p1Price: fiboObj.p1.price, p2Price: fiboObj.p2.price };

  // Verifica também se o clique pegou em alguma das linhas horizontais do Fibo
  const priceDiff = fiboObj.p2.price - fiboObj.p1.price;
  const ratios = fiboNum === 2
    ? [1.0, 0.786, 0.618, 0.5, 0.382, 0.236, 0.0]
    : [4.0, 3.0, 2.618, 2.0, 1.618, 1.272, 1.0, 0.786, 0.618, 0.5, 0.382, 0.236, 0.0];

  let startX = 0;
  if (x1 !== null && x2 !== null) startX = Math.min(x1, x2);
  else if (x1 !== null) startX = x1;
  else if (x2 !== null) startX = x2;

  let endX = window.innerWidth;
  if (typeof timeScale.width === 'function' && timeScale.width() > 100) {
    endX = timeScale.width();
  }

  if (clientX >= startX - 10 && clientX <= endX + 10) {
    for (const r of ratios) {
      const levPrice = fiboObj.p1.price + (priceDiff * r);
      const ly = series.priceToCoordinate(levPrice);
      if (ly !== null && Math.abs(clientY - ly) <= 8) {
        return { anchor: 'level', ratio: r, price: levPrice };
      }
    }
  }

  return null;
}

// Converte tempo unix para coordenada X, com fallback seguro para qualquer Timeframe
export function getInterpolatedTimeToCoordinate(timeScale, time) {
  if (!timeScale || !time) return null;

  try {
    const directCoord = timeScale.timeToCoordinate(time);
    if (directCoord !== null && directCoord !== undefined && !isNaN(directCoord)) {
      return directCoord;
    }
  } catch (_) {}

  // Se o candle exato não tiver barra com esse timestamp no timeframe atual (ex: 15m -> 1h),
  // interpola a coordenada usando a escala de tempo lógica ou os candles carregados
  if (state.candles && state.candles.length > 0) {
    const n = state.candles.length;
    const firstC = state.candles[0];
    const lastC  = state.candles[n - 1];

    // Se o ponto estiver antes do primeiro candle carregado
    if (time <= firstC.time) {
      const x0 = timeScale.timeToCoordinate(firstC.time);
      if (x0 !== null && x0 !== undefined) {
        if (n > 1) {
          const x1 = timeScale.timeToCoordinate(state.candles[1].time);
          const dt = state.candles[1].time - firstC.time;
          if (x1 !== null && dt > 0) {
            const pxPerSec = (x1 - x0) / dt;
            return x0 - (firstC.time - time) * pxPerSec;
          }
        }
        return x0;
      }
    }

    // Se o ponto estiver depois do último candle carregado
    if (time >= lastC.time) {
      const xLast = timeScale.timeToCoordinate(lastC.time);
      if (xLast !== null && xLast !== undefined) {
        if (n > 1) {
          const xPrev = timeScale.timeToCoordinate(state.candles[n - 2].time);
          const dt = lastC.time - state.candles[n - 2].time;
          if (xPrev !== null && dt > 0) {
            const pxPerSec = (xLast - xPrev) / dt;
            return xLast + (time - lastC.time) * pxPerSec;
          }
        }
        return xLast;
      }
    }

    // Procura por busca binária os candles imediatamente anterior e posterior
    let low = 0, high = n - 1;
    let idx = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (state.candles[mid].time <= time) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (idx >= 0 && idx < n) {
      const cBefore = state.candles[idx];
      const cAfter  = (idx + 1 < n) ? state.candles[idx + 1] : cBefore;

      const xBefore = timeScale.timeToCoordinate(cBefore.time);
      if (cBefore.time === cAfter.time || idx === n - 1) {
        return xBefore;
      }
      const xAfter = timeScale.timeToCoordinate(cAfter.time);

      if (xBefore !== null && xAfter !== null) {
        const span = cAfter.time - cBefore.time;
        const ratio = span > 0 ? (time - cBefore.time) / span : 0;
        return xBefore + (xAfter - xBefore) * ratio;
      } else if (xBefore !== null) {
        return xBefore;
      } else if (xAfter !== null) {
        return xAfter;
      }
    }
  }

  return null;
}

export function drawFibonacciRetracement(ctx, width, height, timeScale, series, fiboObj = state.fibo, fiboNum = 1) {
  if (!fiboObj || !fiboObj.p1 || !fiboObj.p2) return;

  const p1 = fiboObj.p1;
  const p2 = fiboObj.p2;

  const x1 = p1.time ? getInterpolatedTimeToCoordinate(timeScale, p1.time) : null;
  const y1 = series.priceToCoordinate(p1.price);
  const x2 = p2.time ? getInterpolatedTimeToCoordinate(timeScale, p2.time) : null;
  const y2 = series.priceToCoordinate(p2.price);

  const coordY1 = (y1 !== null && y1 !== undefined) ? y1 : null;
  const coordY2 = (y2 !== null && y2 !== undefined) ? y2 : null;
  const coordX1 = (x1 !== null && x1 !== undefined) ? x1 : null;
  const coordX2 = (x2 !== null && x2 !== undefined) ? x2 : null;

  // Se os preços forem válidos, calculamos startX mesmo se algum X for null
  if (coordY1 === null || coordY2 === null) return;

  let startX = 0;
  if (coordX1 !== null && coordX2 !== null) {
    startX = Math.min(coordX1, coordX2);
  } else if (coordX1 !== null) {
    startX = coordX1;
  } else if (coordX2 !== null) {
    startX = coordX2;
  }
  startX = Math.max(0, startX);

  let endX = width - 60;
  if (typeof timeScale.width === 'function' && timeScale.width() > 100) {
    endX = timeScale.width();
  } else if (state.charts.main && typeof state.charts.main.priceScale === 'function') {
    try {
      const psw = state.charts.main.priceScale('right').width();
      if (psw > 0) endX = width - psw;
    } catch (e) {}
  }

  const priceDiff = p2.price - p1.price;

  let fibLevels;
  if (fiboNum === 2) {
    fibLevels = [
      { ratio: 1.0,   color: 'rgba(240, 185, 11, 0.5)', isMajor: true },
      { ratio: 0.786, color: 'rgba(240, 185, 11, 0.5)', isMajor: false },
      { ratio: 0.618, color: 'rgba(240, 185, 11, 0.5)', isMajor: true },
      { ratio: 0.5,   color: 'rgba(240, 185, 11, 0.5)', isMajor: true },
      { ratio: 0.382, color: 'rgba(240, 185, 11, 0.5)', isMajor: true },
      { ratio: 0.236, color: 'rgba(240, 185, 11, 0.5)', isMajor: false },
      { ratio: 0.0,   color: 'rgba(132, 142, 156, 0.5)', isMajor: true }
    ];
  } else {
    fibLevels = [
      { ratio: 4.0,   color: '#0ecb81', isMajor: false },
      { ratio: 3.0,   color: '#0ecb81', isMajor: false },
      { ratio: 2.618, color: '#0ecb81', isMajor: true },
      { ratio: 2.0,   color: '#0ecb81', isMajor: false },
      { ratio: 1.618, color: '#0ecb81', isMajor: true },
      { ratio: 1.272, color: '#0ecb81', isMajor: false },
      { ratio: 1.0,   color: '#0ecb81', isMajor: true },
      { ratio: 0.786, color: '#0ecb81', isMajor: false },
      { ratio: 0.618, color: '#0ecb81', isMajor: true },
      { ratio: 0.5,   color: '#0ecb81', isMajor: true },
      { ratio: 0.382, color: '#0ecb81', isMajor: true },
      { ratio: 0.236, color: '#0ecb81', isMajor: false },
      { ratio: 0.0,   color: '#787b86', isMajor: true }
    ];
  }

  const isSelected = (state.selectedFibo === fiboNum);

  ctx.save();

  // Linha guia conectando os dois pontos (se ambos os pontos X estiverem visíveis)
  if (coordX1 !== null && coordX2 !== null) {
    const guideColor = fiboNum === 2 ? 'rgba(240, 185, 11, 0.5)' : '#f0b90b';
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = isSelected ? 1.5 : 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(coordX1, coordY1);
    ctx.lineTo(coordX2, coordY2);
    ctx.stroke();

    // Se estiver selecionado, exibe pequenos marcadores de seleção nas pontas
    if (isSelected) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = guideColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      [ [coordX1, coordY1], [coordX2, coordY2] ].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }
  }

  // Linhas horizontais e rótulos
  fibLevels.forEach(lev => {
    const targetPrice = p1.price + (priceDiff * lev.ratio);
    const y = series.priceToCoordinate(targetPrice);
    if (y === null || y < -10 || y > height + 10) return;

    ctx.setLineDash([]);
    ctx.strokeStyle = lev.color;
    ctx.lineWidth = isSelected ? (lev.isMajor ? 1.4 : 1.0) : (lev.isMajor ? 0.8 : 0.5);
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();

    const formattedPrice = formatPrice(targetPrice);
    const labelText = fiboNum === 2 ? `F2: ${lev.ratio} (${formattedPrice})` : `${lev.ratio} (${formattedPrice})`;

    ctx.font = "bold 9.5px 'JetBrains Mono', 'Fira Code', monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const textW = ctx.measureText(labelText).width;

    const labelRightX = endX - 6;
    const labelY = fiboNum === 2 ? (y - 3) : (y - 2);

    ctx.fillStyle = 'rgba(11, 14, 17, 0.88)';
    ctx.fillRect(labelRightX - textW - 4, labelY - 10, textW + 6, 12);

    ctx.fillStyle = lev.color;
    ctx.fillText(labelText, labelRightX, labelY);
  });

  ctx.restore();
}

// Inicializa a escuta de eventos de mouse no container para arrasto e desenho de Fibo
export function initFiboMouseEvents(mainContainer) {
  if (!mainContainer) return;

  mainContainer.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const h2 = checkFiboHit(state.fibo2, clientX, clientY, timeScale, series, 2);
    const h1 = checkFiboHit(state.fibo, clientX, clientY, timeScale, series, 1);

    if (h2) {
      state.dragTargetFibo = 2;
      state.fibo2.isDragging = true;
      state.fibo2.dragAnchor = (h2.anchor === 'level') ? 'line' : h2.anchor;
      if (h2.anchor === 'line' || h2.anchor === 'level') {
        state.fibo2.dragStart = {
          clientX,
          clientY,
          p1Price: state.fibo2.p1.price,
          p2Price: state.fibo2.p2.price
        };
      }
      setChartScroll(false);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    } else if (h1) {
      state.dragTargetFibo = 1;
      state.fibo.isDragging = true;
      state.fibo.dragAnchor = (h1.anchor === 'level') ? 'line' : h1.anchor;
      if (h1.anchor === 'line' || h1.anchor === 'level') {
        state.fibo.dragStart = {
          clientX,
          clientY,
          p1Price: state.fibo.p1.price,
          p2Price: state.fibo.p2.price
        };
      }
      setChartScroll(false);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }

    if (!state.fibo.drawing && !state.fibo2.drawing) {
      return;
    }

    const snap = getPointFromClientCoords(clientX, clientY);
    if (!snap || snap.price === null || !snap.time) return;

    const isDrawing2 = state.fibo2.drawing;
    const targetFibo = isDrawing2 ? state.fibo2 : state.fibo;
    state.dragTargetFibo = isDrawing2 ? 2 : 1;

    targetFibo.isDragging = true;
    targetFibo.dragAnchor = 'p2';
    setChartScroll(false);
    targetFibo.p1 = { price: snap.price, time: snap.time };
    targetFibo.p2 = { price: snap.price, time: snap.time };

    renderEmpireZones();
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, { capture: true });

  window.addEventListener('mousemove', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const activeDraggingFibo = (state.dragTargetFibo === 2) ? state.fibo2 : (state.dragTargetFibo === 1) ? state.fibo : null;
    if (activeDraggingFibo && activeDraggingFibo.isDragging && activeDraggingFibo.p1 && activeDraggingFibo.p2) {
      if (activeDraggingFibo.dragAnchor === 'p1') {
        const pt = getPointFromClientCoords(clientX, clientY);
        if (pt && pt.price !== null && pt.time) {
          activeDraggingFibo.p1 = { price: pt.price, time: pt.time };
        }
      } else if (activeDraggingFibo.dragAnchor === 'p2') {
        const pt = getPointFromClientCoords(clientX, clientY);
        if (pt && pt.price !== null && pt.time) {
          activeDraggingFibo.p2 = { price: pt.price, time: pt.time };
        }
      } else if (activeDraggingFibo.dragAnchor === 'line' && activeDraggingFibo.dragStart) {
        const curPrice = series.coordinateToPrice(clientY);
        const startPrice = series.coordinateToPrice(activeDraggingFibo.dragStart.clientY);
        if (curPrice !== null && startPrice !== null) {
          const dPrice = curPrice - startPrice;
          activeDraggingFibo.p1.price = activeDraggingFibo.dragStart.p1Price + dPrice;
          activeDraggingFibo.p2.price = activeDraggingFibo.dragStart.p2Price + dPrice;
        }
      }

      renderEmpireZones();
      return;
    }

    const h2 = checkFiboHit(state.fibo2, clientX, clientY, timeScale, series, 2);
    const h1 = checkFiboHit(state.fibo, clientX, clientY, timeScale, series, 1);

    if ((h2 && (h2.anchor === 'p1' || h2.anchor === 'p2')) || (h1 && (h1.anchor === 'p1' || h1.anchor === 'p2'))) {
      mainContainer.style.cursor = 'grab';
    } else if ((h2 && (h2.anchor === 'line' || h2.anchor === 'level')) || (h1 && (h1.anchor === 'line' || h1.anchor === 'level'))) {
      mainContainer.style.cursor = 'move';
    } else if (state.fibo.drawing || state.fibo2.drawing) {
      mainContainer.style.cursor = 'crosshair';
    } else {
      mainContainer.style.cursor = '';
    }
  });

  window.addEventListener('mouseup', () => {
    if (!state.dragTargetFibo) return;

    const isTarget2 = (state.dragTargetFibo === 2);
    const currentDragFibo = isTarget2 ? state.fibo2 : state.fibo;
    const fiboNum = isTarget2 ? 2 : 1;
    const storageKey = getFiboStorageKey(fiboNum, state.currentSymbol);

    if (!currentDragFibo.isDragging) {
      state.dragTargetFibo = null;
      return;
    }

    currentDragFibo.isDragging = false;
    currentDragFibo.dragAnchor = null;
    currentDragFibo.dragStart = null;
    state.dragTargetFibo = null;

    if (currentDragFibo.drawing) {
      if (currentDragFibo.p1 && currentDragFibo.p2 && Math.abs(currentDragFibo.p2.price - currentDragFibo.p1.price) > 0.00001) {
        currentDragFibo.drawing = false;
        currentDragFibo.active = true;
        if (currentDragFibo.alert2618) {
          currentDragFibo.alert2618.armed = false;
          currentDragFibo.alert2618.triggered = false;
          currentDragFibo.alert2618.approachDir = null;
        }
        if (!state.fibo.drawing && !state.fibo2.drawing) {
          mainContainer.classList.remove('fibo-mode');
        }
        updateFiboButtonUI('placed', fiboNum);
        try { localStorage.setItem(storageKey, JSON.stringify({ p1: currentDragFibo.p1, p2: currentDragFibo.p2 })); } catch (_) {}
      }
    } else if (currentDragFibo.active && currentDragFibo.p1 && currentDragFibo.p2) {
      if (currentDragFibo.alert2618) {
        currentDragFibo.alert2618.armed = false;
        currentDragFibo.alert2618.triggered = false;
        currentDragFibo.alert2618.approachDir = null;
      }
      try { localStorage.setItem(storageKey, JSON.stringify({ p1: currentDragFibo.p1, p2: currentDragFibo.p2 })); } catch (_) {}
    }

    mainContainer.style.cursor = '';
    setChartScroll(true);
    renderEmpireZones();
  });

  // Duplo clique sobre o Fibonacci para selecioná-lo
  mainContainer.addEventListener('dblclick', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hit2 = checkFiboHit(state.fibo2, clientX, clientY, timeScale, series, 2);
    const hit1 = checkFiboHit(state.fibo, clientX, clientY, timeScale, series, 1);

    if (hit2 && state.fibo2.active) {
      state.selectedFibo = (state.selectedFibo === 2) ? null : 2;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      return;
    } else if (hit1 && state.fibo.active) {
      state.selectedFibo = (state.selectedFibo === 1) ? null : 1;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      return;
    } else {
      // Se deu duplo clique fora dos fibos, desseleciona
      if (state.selectedFibo !== null) {
        state.selectedFibo = null;
        renderEmpireZones();
      }
    }
  });

  // Se clicar em qualquer outra parte do gráfico sem ser arrastar fibo, desseleciona
  mainContainer.addEventListener('click', e => {
    if (state.selectedFibo === null) return;
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hit2 = checkFiboHit(state.fibo2, clientX, clientY, timeScale, series, 2);
    const hit1 = checkFiboHit(state.fibo, clientX, clientY, timeScale, series, 1);

    if (!hit1 && !hit2) {
      state.selectedFibo = null;
      renderEmpireZones();
    }
  });

  // Tecla Delete / Backspace para excluir o Fibonacci selecionado
  window.addEventListener('keydown', e => {
    // Ignora se o usuário estiver digitando em algum campo de input ou textarea
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedFibo) {
      const fiboToDelete = state.selectedFibo;
      state.selectedFibo = null;
      clearFibo(fiboToDelete);
      e.preventDefault();
    } else if (e.key === 'Escape' && state.selectedFibo) {
      state.selectedFibo = null;
      renderEmpireZones();
      e.preventDefault();
    }
  });
}
