/**
 * js/tactical/fibo.js
 * Ferramenta Interativa de Fibonacci — Multi-Fibo com array state.fibos[].
 * Fibo 1 = Projeção (proj) | Fibo 2 = Retração (retr).
 * Clique no botão → imediatamente abre modo de desenho (sem bloquear o botão).
 * Pode-se traçar quantos Fibos quiser de cada tipo.
 * Duplo clique para selecionar → Delete/Backspace para apagar.
 */

import { state, formatPrice } from './state.js';
import { tacStopAlert, renderFiboAlertBadge } from './audio_alerts.js';
import { renderEmpireZones } from './indicators.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHAVES DE ARMAZENAMENTO
// ─────────────────────────────────────────────────────────────────────────────

export function getFiboStorageKey(which, symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return which === 2 ? `capich_tac_fibo2_${sym}` : `capich_tac_fibo_${sym}`;
}

/** Chave do array multi-fibo no localStorage */
function getFibosArrayKey(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return `capich_tac_fibos_v2_${sym}`;
}

export function getFiboColorStorageKey(which) {
  return which === 2 ? 'capich_tac_fibo2_color' : 'capich_tac_fibo1_color';
}

export function getFiboColor(which) {
  const defaultColor = (which === 2) ? '#f0b90b' : '#00bcd4';
  try {
    return localStorage.getItem(getFiboColorStorageKey(which)) || defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

export function changeFiboColor(which, newColor) {
  if (!newColor) return;
  // Salva como cor padrão para os PRÓXIMOS fibos deste tipo
  // NÃO altera fibos já existentes no gráfico — cada um guarda sua própria cor
  try {
    localStorage.setItem(getFiboColorStorageKey(which), newColor);
  } catch (_) {}

  // Se há um drawingFibo pendente do mesmo tipo, atualiza a prévia
  if (state.drawingFibo) {
    const targetType = which === 2 ? 'retr' : 'proj';
    if (state.drawingFibo.type === targetType) {
      state.drawingFibo.customColor = newColor;
    }
  }

  // Sincroniza o input visual
  const colorInput = document.getElementById(which === 2 ? 'tac-fibo-color-2' : 'tac-fibo-color-1');
  if (colorInput) colorInput.value = newColor;

  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// ID ÚNICO PARA CADA FIBO
// ─────────────────────────────────────────────────────────────────────────────

function gerarFiboId(type) {
  return `${type}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA NO LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

function saveFibosToStorage(symbol) {
  try {
    const key = getFibosArrayKey(symbol);
    const data = (state.fibos || []).map(f => ({
      id: f.id,
      type: f.type,
      p1: f.p1,
      p2: f.p2,
      customColor: f.customColor
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_) {}
}

function loadFibosFromStorage(symbol) {
  try {
    const key = getFibosArrayKey(symbol);
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(f => ({
          id: f.id || gerarFiboId(f.type || 'proj'),
          type: f.type || 'proj',
          p1: f.p1 || null,
          p2: f.p2 || null,
          customColor: f.customColor || getFiboColor(f.type === 'retr' ? 2 : 1),
          active: !!(f.p1 && f.p2),
          isDragging: false,
          dragAnchor: null,
          dragStart: null,
          alert2618: { armed: false, triggered: false, soundActive: false, approachDir: null }
        })).filter(f => f.p1 && f.p2);
      }
    }
  } catch (_) {}
  return null;
}

/** Migra fibos legados (state.fibo / state.fibo2) para o novo array, se existirem */
function migrarFibosLegados(symbol) {
  const migrados = [];
  try {
    const key1 = getFiboStorageKey(1, symbol);
    const key2 = getFiboStorageKey(2, symbol);
    const s1 = localStorage.getItem(key1);
    const s2 = localStorage.getItem(key2);
    if (s1) {
      const d = JSON.parse(s1);
      if (d.p1 && d.p2) {
        migrados.push({
          id: gerarFiboId('proj'),
          type: 'proj',
          p1: d.p1, p2: d.p2,
          customColor: getFiboColor(1),
          active: true, isDragging: false, dragAnchor: null, dragStart: null,
          alert2618: { armed: false, triggered: false, soundActive: false, approachDir: null }
        });
      }
    }
    if (s2) {
      const d = JSON.parse(s2);
      if (d.p1 && d.p2) {
        migrados.push({
          id: gerarFiboId('retr'),
          type: 'retr',
          p1: d.p1, p2: d.p2,
          customColor: getFiboColor(2),
          active: true, isDragging: false, dragAnchor: null, dragStart: null,
          alert2618: { armed: false, triggered: false, soundActive: false, approachDir: null }
        });
      }
    }
  } catch (_) {}
  return migrados;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARREGAR FIBOS AO TROCAR DE PAR
// ─────────────────────────────────────────────────────────────────────────────

export function loadFiboForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';

  // Para qualquer alerta ativo
  tacStopAlert();
  renderFiboAlertBadge(false, null);

  // Cancela qualquer desenho pendente
  state.drawingFibo = null;
  state.selectedFiboId = null;
  state.dragTargetFiboId = null;

  // Reseta legados
  state.fibo.active = false;
  state.fibo.drawing = false;
  state.fibo.p1 = null;
  state.fibo.p2 = null;
  if (state.fibo.alert2618) {
    state.fibo.alert2618.armed = false;
    state.fibo.alert2618.triggered = false;
    state.fibo.alert2618.soundActive = false;
    state.fibo.alert2618.approachDir = null;
  }
  state.fibo2.active = false;
  state.fibo2.drawing = false;
  state.fibo2.p1 = null;
  state.fibo2.p2 = null;
  if (state.fibo2.alert2618) {
    state.fibo2.alert2618.armed = false;
    state.fibo2.alert2618.triggered = false;
    state.fibo2.alert2618.soundActive = false;
    state.fibo2.alert2618.approachDir = null;
  }

  try {
    // Tenta carregar o array novo
    let fibos = loadFibosFromStorage(sym);

    if (!fibos || fibos.length === 0) {
      // Migra fibos legados se existirem
      fibos = migrarFibosLegados(sym);
      if (fibos.length > 0) {
        // Salva no novo formato e remove chaves antigas
        state.fibos = fibos;
        saveFibosToStorage(sym);
        try {
          localStorage.removeItem(getFiboStorageKey(1, sym));
          localStorage.removeItem(getFiboStorageKey(2, sym));
        } catch (_) {}
      }
    }

    state.fibos = fibos || [];

    // Sincroniza cores salvas nos inputs de cor
    state.fibo.customColor = getFiboColor(1);
    state.fibo2.customColor = getFiboColor(2);
    const inp1 = document.getElementById('tac-fibo-color-1');
    const inp2 = document.getElementById('tac-fibo-color-2');
    if (inp1) inp1.value = state.fibo.customColor;
    if (inp2) inp2.value = state.fibo2.customColor;

    // Atualiza botões
    const hasProjFibo = state.fibos.some(f => f.type === 'proj' && f.p1 && f.p2);
    const hasRetrFibo = state.fibos.some(f => f.type === 'retr' && f.p1 && f.p2);
    updateFiboButtonUI(hasProjFibo ? 'placed' : 'idle', 1);
    updateFiboButtonUI(hasRetrFibo ? 'placed' : 'idle', 2);
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar Fibo do par:', sym, e);
    state.fibos = [];
    updateFiboButtonUI('idle', 1);
    updateFiboButtonUI('idle', 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATIVAR MODO DE DESENHO — botão nunca bloqueia
// ─────────────────────────────────────────────────────────────────────────────

export function toggleFiboTool(which = 1) {
  const type = which === 2 ? 'retr' : 'proj';

  // Se já está esperando o usuário desenhar (drawingFibo ativo do mesmo tipo),
  // cancela (toggle off).
  if (state.drawingFibo && state.drawingFibo.type === type) {
    state.drawingFibo = null;
    const hasFibo = state.fibos.some(f => f.type === type && f.p1 && f.p2);
    updateFiboButtonUI(hasFibo ? 'placed' : 'idle', which);
    const mc = document.getElementById('tac-chart-main');
    if (mc) {
      mc.classList.remove('fibo-mode');
      mc.style.cursor = '';
    }
    renderEmpireZones();
    return;
  }

  // Cria novo drawingFibo imediatamente — botão continua clicável
  state.drawingFibo = {
    id: gerarFiboId(type),
    type,
    customColor: getFiboColor(which),
    p1: null,
    p2: null,
    isDragging: false,
    dragAnchor: null,
    dragStart: null,
    alert2618: { armed: false, triggered: false, soundActive: false, approachDir: null }
  };

  // Botão mostra "TRAÇAR" mas não bloqueia — fica clicável para cancelar
  updateFiboButtonUI('drawing', which);

  const mc = document.getElementById('tac-chart-main');
  if (mc) mc.classList.add('fibo-mode');
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMPAR FIBOS
// ─────────────────────────────────────────────────────────────────────────────

/** Remove o fibo selecionado pelo ID do array */
export function clearFiboById(id) {
  if (!id) return;
  state.fibos = (state.fibos || []).filter(f => f.id !== id);
  if (state.selectedFiboId === id) state.selectedFiboId = null;
  saveFibosToStorage(state.currentSymbol);

  const hasProjFibo = state.fibos.some(f => f.type === 'proj' && f.p1 && f.p2);
  const hasRetrFibo = state.fibos.some(f => f.type === 'retr' && f.p1 && f.p2);
  updateFiboButtonUI(hasProjFibo ? 'placed' : 'idle', 1);
  updateFiboButtonUI(hasRetrFibo ? 'placed' : 'idle', 2);

  const mc = document.getElementById('tac-chart-main');
  if (mc && !state.drawingFibo) {
    mc.classList.remove('fibo-mode');
    mc.style.cursor = '';
  }
  renderEmpireZones();
}

/** Compatibilidade com clearFibo(which) legado — remove TODOS do tipo */
export function clearFibo(which = 1) {
  const type = which === 2 ? 'retr' : 'proj';
  state.fibos = (state.fibos || []).filter(f => f.type !== type);
  if (state.drawingFibo && state.drawingFibo.type === type) {
    state.drawingFibo = null;
  }
  state.selectedFiboId = null;
  saveFibosToStorage(state.currentSymbol);
  updateFiboButtonUI('idle', which);

  const mc = document.getElementById('tac-chart-main');
  if (mc && !state.drawingFibo) {
    mc.classList.remove('fibo-mode');
    mc.style.cursor = '';
  }

  // Para alertas
  tacStopAlert();
  renderFiboAlertBadge(false, null);
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// UI DO BOTÃO
// ─────────────────────────────────────────────────────────────────────────────

export function updateFiboButtonUI(mode, which = 1) {
  const is2 = (which === 2);
  const btn = document.getElementById(is2 ? 'tac-btn-fibo2' : 'tac-btn-fibo');
  const statusSpan = document.getElementById(is2 ? 'tac-status-fibo2' : 'tac-status-fibo1');
  if (!btn) return;

  const baseClass = is2
    ? 'tac-dropdown-item tac-btn-fibo tac-btn-fibo-2'
    : 'tac-dropdown-item tac-btn-fibo';
  const label = is2 ? '📐 Fibo 2 (Retração)' : '📐 Fibo 1 (Projeção)';

  if (mode === 'drawing') {
    btn.className = `${baseClass} drawing`;
    if (statusSpan) {
      statusSpan.textContent = 'TRAÇAR';
    } else {
      btn.textContent = '📐 Traçando...';
    }
    btn.title = is2
      ? 'Clique+arraste no gráfico para traçar Fibo 2. Clique aqui para cancelar.'
      : 'Clique+arraste no gráfico para traçar Fibo 1. Clique aqui para cancelar.';
  } else if (mode === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) {
      statusSpan.textContent = 'ATIVO';
    } else {
      btn.textContent = label;
    }
    btn.title = is2
      ? 'Fibo 2 ativo! Clique para traçar outro. Duplo clique + Delete para apagar.'
      : 'Fibo 1 ativo! Clique para traçar outro. Duplo clique + Delete para apagar.';
  } else {
    // idle
    btn.className = baseClass;
    if (statusSpan) {
      statusSpan.textContent = 'OFF';
    } else {
      btn.textContent = label;
    }
    btn.title = is2
      ? 'Clique para traçar Fibo 2 (Retração de Pernada)'
      : 'Clique para traçar Fibo 1 (Projeção / Expansões)';
  }

  // Nunca esconde o color picker
  const btnClear = document.getElementById(is2 ? 'tac-btn-fibo2-clear' : 'tac-btn-fibo-clear');
  if (btnClear) btnClear.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// DISTÂNCIA PONTO → SEGMENTO DE RETA
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// COORDENADAS COM IMÂS NOS PAVIOS
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// HIT-TEST EM UM FIBO ESPECÍFICO
// ─────────────────────────────────────────────────────────────────────────────

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

  // Verifica se o clique pegou em alguma das linhas horizontais do Fibo
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

/** Hit-test em TODOS os fibos do array — retorna { fiboObj, hit } do mais próximo */
function checkAllFibosHit(clientX, clientY, timeScale, series) {
  if (!Array.isArray(state.fibos)) return null;

  for (let i = state.fibos.length - 1; i >= 0; i--) {
    const f = state.fibos[i];
    if (!f || !f.p1 || !f.p2) continue;
    const fiboNum = f.type === 'retr' ? 2 : 1;
    const hit = checkFiboHit(f, clientX, clientY, timeScale, series, fiboNum);
    if (hit) return { fiboObj: f, hit };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COORDENADA DE TEMPO INTERPOLADA
// ─────────────────────────────────────────────────────────────────────────────

export function getInterpolatedTimeToCoordinate(timeScale, time) {
  if (!timeScale || !time) return null;

  try {
    const directCoord = timeScale.timeToCoordinate(time);
    if (directCoord !== null && directCoord !== undefined && !isNaN(directCoord)) {
      return directCoord;
    }
  } catch (_) {}

  if (state.candles && state.candles.length > 0) {
    const n = state.candles.length;
    const firstC = state.candles[0];
    const lastC  = state.candles[n - 1];

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

// ─────────────────────────────────────────────────────────────────────────────
// DESENHO DO FIBONACCI NO CANVAS
// ─────────────────────────────────────────────────────────────────────────────

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
  const userColor = fiboObj?.customColor || getFiboColor(fiboNum);

  let fibLevels;
  if (fiboNum === 2) {
    fibLevels = [
      { ratio: 1.0,   color: userColor, isMajor: true },
      { ratio: 0.786, color: userColor, isMajor: false },
      { ratio: 0.618, color: userColor, isMajor: true },
      { ratio: 0.5,   color: userColor, isMajor: true },
      { ratio: 0.382, color: userColor, isMajor: true },
      { ratio: 0.236, color: userColor, isMajor: false },
      { ratio: 0.0,   color: '#848e9c', isMajor: true }
    ];
  } else {
    fibLevels = [
      { ratio: 4.0,   color: userColor, isMajor: false },
      { ratio: 3.0,   color: userColor, isMajor: false },
      { ratio: 2.618, color: userColor, isMajor: true },
      { ratio: 2.0,   color: userColor, isMajor: false },
      { ratio: 1.618, color: userColor, isMajor: true },
      { ratio: 1.272, color: userColor, isMajor: false },
      { ratio: 1.0,   color: userColor, isMajor: true },
      { ratio: 0.786, color: userColor, isMajor: false },
      { ratio: 0.618, color: userColor, isMajor: true },
      { ratio: 0.5,   color: userColor, isMajor: true },
      { ratio: 0.382, color: userColor, isMajor: true },
      { ratio: 0.236, color: userColor, isMajor: false },
      { ratio: 0.0,   color: '#848e9c', isMajor: true }
    ];
  }

  // Verifica se está selecionado (por ID novo ou número legado)
  const isSelected = fiboObj.id
    ? (state.selectedFiboId === fiboObj.id)
    : (state.selectedFibo === fiboNum);

  ctx.save();

  // Linha guia conectando os dois pontos
  if (coordX1 !== null && coordX2 !== null) {
    const guideColor = userColor;
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = isSelected ? 1.5 : 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(coordX1, coordY1);
    ctx.lineTo(coordX2, coordY2);
    ctx.stroke();

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

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS DE MOUSE — MULTI-FIBO
// ─────────────────────────────────────────────────────────────────────────────

export function initFiboMouseEvents(mainContainer) {
  if (!mainContainer) return;

  // ── MOUSEDOWN ──────────────────────────────────────────────────────────────
  mainContainer.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    // 1. Verifica hit-test nos fibos já colocados (para arrasto)
    const hitResult = checkAllFibosHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { fiboObj, hit } = hitResult;
      state.dragTargetFiboId = fiboObj.id;
      fiboObj.isDragging = true;
      fiboObj.dragAnchor = (hit.anchor === 'level') ? 'line' : hit.anchor;
      if (hit.anchor === 'line' || hit.anchor === 'level') {
        fiboObj.dragStart = {
          clientX,
          clientY,
          p1Price: fiboObj.p1.price,
          p2Price: fiboObj.p2.price
        };
      }
      setChartScroll(false);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }

    // 2. Se há um drawingFibo pendente, inicia o traçado ao clicar no canvas
    if (state.drawingFibo) {
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null || !snap.time) return;

      state.drawingFibo.p1 = { price: snap.price, time: snap.time };
      state.drawingFibo.p2 = { price: snap.price, time: snap.time };
      state.drawingFibo.isDragging = true;
      state.drawingFibo.dragAnchor = 'p2';
      state.dragTargetFiboId = '__drawing__';

      setChartScroll(false);
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, { capture: true });

  // ── MOUSEMOVE ──────────────────────────────────────────────────────────────
  window.addEventListener('mousemove', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    // Arrasto do drawingFibo em andamento
    if (state.dragTargetFiboId === '__drawing__' && state.drawingFibo && state.drawingFibo.isDragging) {
      const pt = getPointFromClientCoords(clientX, clientY);
      if (pt && pt.price !== null && pt.time) {
        state.drawingFibo.p2 = { price: pt.price, time: pt.time };
      }
      renderEmpireZones();
      return;
    }

    // Arrasto de um fibo existente
    if (state.dragTargetFiboId && state.dragTargetFiboId !== '__drawing__') {
      const activeFibo = (state.fibos || []).find(f => f.id === state.dragTargetFiboId);
      if (activeFibo && activeFibo.isDragging && activeFibo.p1 && activeFibo.p2) {
        if (activeFibo.dragAnchor === 'p1') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeFibo.p1 = { price: pt.price, time: pt.time };
          }
        } else if (activeFibo.dragAnchor === 'p2') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeFibo.p2 = { price: pt.price, time: pt.time };
          }
        } else if (activeFibo.dragAnchor === 'line' && activeFibo.dragStart) {
          const curPrice = series.coordinateToPrice(clientY);
          const startPrice = series.coordinateToPrice(activeFibo.dragStart.clientY);
          if (curPrice !== null && startPrice !== null) {
            const dPrice = curPrice - startPrice;
            activeFibo.p1.price = activeFibo.dragStart.p1Price + dPrice;
            activeFibo.p2.price = activeFibo.dragStart.p2Price + dPrice;
          }
        }
        renderEmpireZones();
        return;
      }
    }

    // Cursor dinâmico
    const hitResult = checkAllFibosHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const anchor = hitResult.hit.anchor;
      if (anchor === 'p1' || anchor === 'p2') {
        mainContainer.style.cursor = 'grab';
      } else {
        mainContainer.style.cursor = 'move';
      }
    } else if (state.drawingFibo) {
      mainContainer.style.cursor = 'crosshair';
    } else {
      mainContainer.style.cursor = '';
    }
  });

  // ── MOUSEUP ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    // Finalizando drawingFibo
    if (state.dragTargetFiboId === '__drawing__' && state.drawingFibo) {
      const df = state.drawingFibo;
      df.isDragging = false;
      df.dragAnchor = null;
      state.dragTargetFiboId = null;

      if (df.p1 && df.p2 && Math.abs(df.p2.price - df.p1.price) > 0.00001) {
        // Fibo concluído → empurra para o array
        const fiboCompleto = {
          id: df.id,
          type: df.type,
          customColor: df.customColor,
          p1: df.p1,
          p2: df.p2,
          active: true,
          isDragging: false,
          dragAnchor: null,
          dragStart: null,
          alert2618: { armed: false, triggered: false, soundActive: false, approachDir: null }
        };
        state.fibos = state.fibos || [];
        state.fibos.push(fiboCompleto);
        saveFibosToStorage(state.currentSymbol);
      }

      // Limpa drawingFibo — botão volta para estado correto imediatamente
      state.drawingFibo = null;

      const hasProjFibo = state.fibos.some(f => f.type === 'proj' && f.p1 && f.p2);
      const hasRetrFibo = state.fibos.some(f => f.type === 'retr' && f.p1 && f.p2);
      updateFiboButtonUI(hasProjFibo ? 'placed' : 'idle', 1);
      updateFiboButtonUI(hasRetrFibo ? 'placed' : 'idle', 2);

      mainContainer.classList.remove('fibo-mode');
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
      return;
    }

    // Finalizando arrasto de fibo existente
    if (state.dragTargetFiboId && state.dragTargetFiboId !== '__drawing__') {
      const activeFibo = (state.fibos || []).find(f => f.id === state.dragTargetFiboId);
      if (activeFibo) {
        activeFibo.isDragging = false;
        activeFibo.dragAnchor = null;
        activeFibo.dragStart = null;
        if (activeFibo.p1 && activeFibo.p2) {
          if (activeFibo.alert2618) {
            activeFibo.alert2618.armed = false;
            activeFibo.alert2618.triggered = false;
            activeFibo.alert2618.approachDir = null;
          }
          saveFibosToStorage(state.currentSymbol);
        }
      }
      state.dragTargetFiboId = null;
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
    }
  });

  // ── DUPLO CLIQUE — Seleciona o Fibo para Delete ────────────────────────────
  mainContainer.addEventListener('dblclick', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllFibosHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { fiboObj } = hitResult;
      state.selectedFiboId = (state.selectedFiboId === fiboObj.id) ? null : fiboObj.id;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
    } else {
      if (state.selectedFiboId !== null) {
        state.selectedFiboId = null;
        renderEmpireZones();
      }
    }
  });

  // ── CLIQUE SIMPLES — Desseleciona se clicar fora ───────────────────────────
  mainContainer.addEventListener('click', e => {
    if (state.selectedFiboId === null) return;
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllFibosHit(clientX, clientY, timeScale, series);
    if (!hitResult) {
      state.selectedFiboId = null;
      renderEmpireZones();
    }
  });

  // ── DELETE / BACKSPACE — Apaga o Fibo selecionado ─────────────────────────
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedFiboId) {
      clearFiboById(state.selectedFiboId);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.drawingFibo) {
        // Cancela desenho pendente
        const type = state.drawingFibo.type;
        const which = type === 'retr' ? 2 : 1;
        state.drawingFibo = null;
        const hasFibo = state.fibos.some(f => f.type === type && f.p1 && f.p2);
        updateFiboButtonUI(hasFibo ? 'placed' : 'idle', which);
        const mc = document.getElementById('tac-chart-main');
        if (mc) { mc.classList.remove('fibo-mode'); mc.style.cursor = ''; }
        renderEmpireZones();
        e.preventDefault();
      } else if (state.selectedFiboId) {
        state.selectedFiboId = null;
        renderEmpireZones();
        e.preventDefault();
      }
    }
  });
}
