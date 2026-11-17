/**
 * js/tactical/trendline.js
 * Ferramenta Interativa de Linha de Tendência (LTA / LTB) no Gráfico Tático.
 * Suporta múltiplos traçados, extensão à direita (ray), imã inteligente nos pavios,
 * ajuste de âncoras (P1/P2), arrasto do traçado inteiro, duplo clique para selecionar,
 * tecla Delete/Backspace para apagar e tecla F para travar/fixar.
 */

import { state, formatPrice } from './state.js';
import { renderEmpireZones } from './indicators.js';
import {
  getPointFromClientCoords,
  getInterpolatedTimeToCoordinate,
  setChartScroll,
  distToSegment
} from './fibo.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHAVES DE ARMAZENAMENTO E CORES
// ─────────────────────────────────────────────────────────────────────────────

export function getTrendlinesStorageKey(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return `capich_tac_trendlines_${sym}`;
}

export function getTrendlineColorStorageKey() {
  return 'capich_tac_trendline_color';
}

export function getTrendlineColor() {
  const defaultColor = '#f0b90b'; // Amarelo clássico institucional
  try {
    return localStorage.getItem(getTrendlineColorStorageKey()) || defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

export function changeTrendlineColor(newColor) {
  if (!newColor) return;
  try {
    localStorage.setItem(getTrendlineColorStorageKey(), newColor);
  } catch (_) {}

  // Se há um drawingTrendline pendente, atualiza a cor dele
  if (state.drawingTrendline) {
    state.drawingTrendline.customColor = newColor;
  }

  // Se há uma linha selecionada, atualiza a cor dela
  if (state.selectedTrendlineId && Array.isArray(state.trendlines)) {
    const selected = state.trendlines.find(t => t.id === state.selectedTrendlineId);
    if (selected) {
      selected.customColor = newColor;
      saveTrendlinesToStorage(state.currentSymbol);
    }
  }

  const colorInput = document.getElementById('tac-trendline-color');
  if (colorInput) colorInput.value = newColor;

  renderEmpireZones();
}

function gerarTrendlineId() {
  return `tl_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA NO LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

export function saveTrendlinesToStorage(symbol) {
  try {
    const key = getTrendlinesStorageKey(symbol);
    const data = (state.trendlines || []).map(tl => ({
      id: tl.id,
      p1: tl.p1,
      p2: tl.p2,
      customColor: tl.customColor,
      extendRight: tl.extendRight !== false,
      locked: !!tl.locked
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_) {}
}

export function loadTrendlinesFromStorage(symbol) {
  try {
    const key = getTrendlinesStorageKey(symbol);
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(tl => ({
          id: tl.id || gerarTrendlineId(),
          p1: tl.p1 || null,
          p2: tl.p2 || null,
          customColor: tl.customColor || getTrendlineColor(),
          extendRight: tl.extendRight !== false,
          locked: !!tl.locked,
          active: !!(tl.p1 && tl.p2),
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        })).filter(tl => tl.p1 && tl.p2);
      }
    }
  } catch (_) {}
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CARREGAR LINHAS DE TENDÊNCIA AO TROCAR DE PAR
// ─────────────────────────────────────────────────────────────────────────────

export function loadTrendlinesForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';

  state.drawingTrendline = null;
  state.selectedTrendlineId = null;
  state.dragTargetTrendlineId = null;

  try {
    state.trendlines = loadTrendlinesFromStorage(sym);

    const colorInput = document.getElementById('tac-trendline-color');
    if (colorInput) colorInput.value = getTrendlineColor();

    const hasTrendlines = state.trendlines.some(t => t.p1 && t.p2);
    updateTrendlineButtonUI(hasTrendlines ? 'placed' : 'idle');
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar linhas de tendência do par:', sym, e);
    state.trendlines = [];
    updateTrendlineButtonUI('idle');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATIVAR MODO DE DESENHO — botão nunca bloqueia
// ─────────────────────────────────────────────────────────────────────────────

export function toggleTrendlineTool() {
  // Se já está esperando desenhar, cancela (toggle off)
  if (state.drawingTrendline) {
    state.drawingTrendline = null;
    const hasTrendlines = (state.trendlines || []).some(t => t.p1 && t.p2);
    updateTrendlineButtonUI(hasTrendlines ? 'placed' : 'idle');
    const mc = document.getElementById('tac-chart-main');
    if (mc) {
      mc.classList.remove('trendline-mode');
      mc.style.cursor = '';
    }
    renderEmpireZones();
    return;
  }

  // Cancela desenho de fibo se estiver em andamento
  if (state.drawingFibo) {
    state.drawingFibo = null;
    const hasProjFibo = (state.fibos || []).some(f => f.type === 'proj' && f.p1 && f.p2);
    const hasRetrFibo = (state.fibos || []).some(f => f.type === 'retr' && f.p1 && f.p2);
    const statusFibo1 = document.getElementById('tac-status-fibo1');
    const statusFibo2 = document.getElementById('tac-status-fibo2');
    if (statusFibo1) statusFibo1.textContent = hasProjFibo ? 'ATIVO' : 'OFF';
    if (statusFibo2) statusFibo2.textContent = hasRetrFibo ? 'ATIVO' : 'OFF';
  }

  // Cria nova linha de tendência pendente de clique
  state.drawingTrendline = {
    id: gerarTrendlineId(),
    customColor: getTrendlineColor(),
    p1: null,
    p2: null,
    extendRight: true,
    locked: false,
    active: true,
    isDragging: false,
    dragAnchor: null,
    dragStart: null
  };

  updateTrendlineButtonUI('drawing');

  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.add('trendline-mode');
    mc.style.cursor = 'crosshair';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO VISUAL DO BOTÃO
// ─────────────────────────────────────────────────────────────────────────────

export function updateTrendlineButtonUI(status) {
  const btn = document.getElementById('tac-btn-trendline');
  const statusSpan = document.getElementById('tac-status-trendline');
  if (!btn) return;

  const baseClass = 'tac-dropdown-item tac-btn-trendline';

  if (status === 'drawing') {
    btn.className = `${baseClass} active drawing`;
    if (statusSpan) statusSpan.textContent = 'DESENHAR';
    btn.title = 'Modo Linha de Tendência ativo! Clique e arraste no gráfico. Clique novamente para cancelar.';
  } else if (status === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) statusSpan.textContent = 'ATIVO';
    btn.title = 'Linha de Tendência ativa! Clique para traçar outra. Duplo clique + Delete para apagar.';
  } else {
    btn.className = baseClass;
    if (statusSpan) statusSpan.textContent = 'OFF';
    btn.title = 'Linha de Tendência (LTA / LTB): Clique para traçar no gráfico';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APAGAR LINHA(S)
// ─────────────────────────────────────────────────────────────────────────────

export function clearTrendlineById(id) {
  if (!id) return;
  state.trendlines = (state.trendlines || []).filter(t => t.id !== id);
  if (state.selectedTrendlineId === id) {
    state.selectedTrendlineId = null;
  }
  saveTrendlinesToStorage(state.currentSymbol);
  const hasTrendlines = (state.trendlines || []).some(t => t.p1 && t.p2);
  updateTrendlineButtonUI(hasTrendlines ? 'placed' : 'idle');
  renderEmpireZones();
}

export function clearAllTrendlines() {
  state.trendlines = [];
  state.drawingTrendline = null;
  state.selectedTrendlineId = null;
  state.dragTargetTrendlineId = null;
  try {
    localStorage.removeItem(getTrendlinesStorageKey(state.currentSymbol));
  } catch (_) {}
  updateTrendlineButtonUI('idle');
  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.remove('trendline-mode');
    mc.style.cursor = '';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// HIT TEST — DETECÇÃO DE CLIQUES E MOUSEOVER
// ─────────────────────────────────────────────────────────────────────────────

export function checkAllTrendlinesHit(clientX, clientY, timeScale, series) {
  if (!Array.isArray(state.trendlines) || !state.trendlines.length) return null;
  if (!series || !timeScale) return null;

  const chartPlotWidth = (typeof timeScale.width === 'function' && timeScale.width() > 100)
    ? timeScale.width()
    : ((state.charts.main && state.charts.main.chartElement ? state.charts.main.chartElement.clientWidth : 800) - 60);

  // Percorre do mais recente para o mais antigo (prioriza o que está por cima)
  for (let i = state.trendlines.length - 1; i >= 0; i--) {
    const tl = state.trendlines[i];
    if (!tl || !tl.p1 || !tl.p2) continue;

    const x1 = getInterpolatedTimeToCoordinate(timeScale, tl.p1.time);
    const y1 = series.priceToCoordinate(tl.p1.price);
    const x2 = getInterpolatedTimeToCoordinate(timeScale, tl.p2.time);
    const y2 = series.priceToCoordinate(tl.p2.price);

    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

    // 1. Âncora P1
    if (Math.hypot(clientX - x1, clientY - y1) <= 9) {
      return { tl, hit: { anchor: 'p1' } };
    }

    // 2. Âncora P2
    if (Math.hypot(clientX - x2, clientY - y2) <= 9) {
      return { tl, hit: { anchor: 'p2' } };
    }

    // 3. Segmento P1 -> P2
    const distSegment = distToSegment(clientX, clientY, x1, y1, x2, y2);
    if (distSegment <= 7) {
      return { tl, hit: { anchor: 'line' } };
    }

    // 4. Extensão Ray para a direita
    if (tl.extendRight !== false) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (Math.abs(dx) > 0.001) {
        let xStartRay, yStartRay, slope;
        if (x2 >= x1) {
          xStartRay = x2;
          yStartRay = y2;
          slope = dy / dx;
        } else {
          xStartRay = x1;
          yStartRay = y1;
          slope = -dy / -dx;
        }

        if (chartPlotWidth > xStartRay) {
          const xEndRay = chartPlotWidth;
          const yEndRay = yStartRay + slope * (xEndRay - xStartRay);
          const distRay = distToSegment(clientX, clientY, xStartRay, yStartRay, xEndRay, yEndRay);
          if (distRay <= 7) {
            return { tl, hit: { anchor: 'line' } };
          }
        }
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO NO CANVAS
// ─────────────────────────────────────────────────────────────────────────────

export function drawTrendline(ctx, width, height, timeScale, series, tlObj, isSelected = false) {
  if (!tlObj || !tlObj.p1 || !tlObj.p2) return;

  const x1 = getInterpolatedTimeToCoordinate(timeScale, tlObj.p1.time);
  const y1 = series.priceToCoordinate(tlObj.p1.price);
  const x2 = getInterpolatedTimeToCoordinate(timeScale, tlObj.p2.time);
  const y2 = series.priceToCoordinate(tlObj.p2.price);

  if (x1 === null || y1 === null || x2 === null || y2 === null) return;

  const color = tlObj.customColor || '#f0b90b';
  const chartPlotWidth = (typeof timeScale.width === 'function' && timeScale.width() > 100)
    ? timeScale.width()
    : (width - 60);

  ctx.save();

  // Se selecionado, desenha contorno sutil brilhante
  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }

  // ── Traçado da Linha Principal (Segmento P1 -> P2)
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.6 : 1.8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // ── Extensão Ray à Direita (como visto na Imagem 1)
  if (tlObj.extendRight !== false) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) > 0.001) {
      let xOrigin, yOrigin, slope;
      if (x2 >= x1) {
        xOrigin = x2;
        yOrigin = y2;
        slope = dy / dx;
      } else {
        xOrigin = x1;
        yOrigin = y1;
        slope = dy / dx;
      }

      if (chartPlotWidth > xOrigin) {
        const xTarget = chartPlotWidth;
        const yTarget = yOrigin + slope * (xTarget - xOrigin);

        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 2.2 : 1.6;
        ctx.beginPath();
        ctx.moveTo(xOrigin, yOrigin);
        ctx.lineTo(xTarget, yTarget);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS DE MOUSE — INTERAÇÃO COM LINHAS DE TENDÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

export function initTrendlineMouseEvents(mainContainer) {
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

    // 1. Se estamos em modo de desenho de linha de tendência
    if (state.drawingTrendline) {
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null || !snap.time) return;

      state.drawingTrendline.p1 = { price: snap.price, time: snap.time };
      state.drawingTrendline.p2 = { price: snap.price, time: snap.time };
      state.drawingTrendline.isDragging = true;
      state.drawingTrendline.dragAnchor = 'p2';
      state.dragTargetTrendlineId = '__drawing_trendline__';

      setChartScroll(false);
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // 2. Verifica se clicou em uma linha de tendência já existente para arrastar
    const hitResult = checkAllTrendlinesHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { tl, hit } = hitResult;
      if (tl.locked) return;

      state.selectedTrendlineId = tl.id;
      state.dragTargetTrendlineId = tl.id;
      tl.isDragging = true;
      tl.dragAnchor = hit.anchor;

      if (hit.anchor === 'line') {
        tl.dragStart = {
          clientX,
          clientY,
          p1Price: tl.p1.price,
          p2Price: tl.p2.price
        };
      }

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

    // Arrasto da linha sendo desenhada no momento
    if (state.dragTargetTrendlineId === '__drawing_trendline__' && state.drawingTrendline && state.drawingTrendline.isDragging) {
      const pt = getPointFromClientCoords(clientX, clientY);
      if (pt && pt.price !== null && pt.time) {
        state.drawingTrendline.p2 = { price: pt.price, time: pt.time };
      }
      renderEmpireZones();
      return;
    }

    // Arrasto de uma linha de tendência existente
    if (state.dragTargetTrendlineId && state.dragTargetTrendlineId !== '__drawing_trendline__') {
      const activeTL = (state.trendlines || []).find(t => t.id === state.dragTargetTrendlineId);
      if (activeTL && activeTL.isDragging && activeTL.p1 && activeTL.p2) {
        if (activeTL.dragAnchor === 'p1') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeTL.p1 = { price: pt.price, time: pt.time };
          }
        } else if (activeTL.dragAnchor === 'p2') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeTL.p2 = { price: pt.price, time: pt.time };
          }
        } else if (activeTL.dragAnchor === 'line' && activeTL.dragStart) {
          const curPrice = series.coordinateToPrice(clientY);
          const startPrice = series.coordinateToPrice(activeTL.dragStart.clientY);
          if (curPrice !== null && startPrice !== null) {
            const dPrice = curPrice - startPrice;
            activeTL.p1.price = activeTL.dragStart.p1Price + dPrice;
            activeTL.p2.price = activeTL.dragStart.p2Price + dPrice;
          }
        }
        renderEmpireZones();
        return;
      }
    }

    // Cursor dinâmico se passar o mouse sobre linhas existentes
    if (!state.drawingFibo && !state.dragTargetFiboId) {
      const hitResult = checkAllTrendlinesHit(clientX, clientY, timeScale, series);
      if (hitResult) {
        const anchor = hitResult.hit.anchor;
        if (anchor === 'p1' || anchor === 'p2') {
          mainContainer.style.cursor = 'grab';
        } else {
          mainContainer.style.cursor = 'move';
        }
      } else if (state.drawingTrendline) {
        mainContainer.style.cursor = 'crosshair';
      }
    }
  });

  // ── MOUSEUP ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    // Finalizando linha sendo desenhada
    if (state.dragTargetTrendlineId === '__drawing_trendline__' && state.drawingTrendline) {
      const dtl = state.drawingTrendline;
      dtl.isDragging = false;
      dtl.dragAnchor = null;
      state.dragTargetTrendlineId = null;

      // Valida distância mínima para evitar traçados acidentais com 1 pixel
      if (dtl.p1 && dtl.p2 && (dtl.p1.time !== dtl.p2.time || Math.abs(dtl.p2.price - dtl.p1.price) > 0.00001)) {
        const novaLinha = {
          id: dtl.id,
          p1: dtl.p1,
          p2: dtl.p2,
          customColor: dtl.customColor,
          extendRight: dtl.extendRight !== false,
          locked: false,
          active: true,
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        };
        state.trendlines = state.trendlines || [];
        state.trendlines.push(novaLinha);
        state.selectedTrendlineId = novaLinha.id;
        saveTrendlinesToStorage(state.currentSymbol);
      }

      state.drawingTrendline = null;
      updateTrendlineButtonUI((state.trendlines && state.trendlines.length > 0) ? 'placed' : 'idle');

      mainContainer.classList.remove('trendline-mode');
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
      return;
    }

    // Finalizando arrasto de linha existente
    if (state.dragTargetTrendlineId && state.dragTargetTrendlineId !== '__drawing_trendline__') {
      const activeTL = (state.trendlines || []).find(t => t.id === state.dragTargetTrendlineId);
      if (activeTL) {
        activeTL.isDragging = false;
        activeTL.dragAnchor = null;
        activeTL.dragStart = null;
        saveTrendlinesToStorage(state.currentSymbol);
      }
      state.dragTargetTrendlineId = null;
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
    }
  });

  // ── DUPLO CLIQUE — Seleciona a Linha para Delete ───────────────────────────
  mainContainer.addEventListener('dblclick', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllTrendlinesHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { tl } = hitResult;
      state.selectedTrendlineId = (state.selectedTrendlineId === tl.id) ? null : tl.id;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
    } else if (state.selectedTrendlineId) {
      state.selectedTrendlineId = null;
      renderEmpireZones();
    }
  });

  // ── CLIQUE SIMPLES — Desseleciona se clicar fora ───────────────────────────
  mainContainer.addEventListener('click', e => {
    if (!state.selectedTrendlineId) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllTrendlinesHit(clientX, clientY, timeScale, series);
    if (!hitResult) {
      state.selectedTrendlineId = null;
      renderEmpireZones();
    }
  });

  // ── DELETE / BACKSPACE / ESCAPE ───────────────────────────────────────────
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedTrendlineId) {
      clearTrendlineById(state.selectedTrendlineId);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.drawingTrendline) {
        state.drawingTrendline = null;
        updateTrendlineButtonUI((state.trendlines && state.trendlines.length > 0) ? 'placed' : 'idle');
        mainContainer.classList.remove('trendline-mode');
        mainContainer.style.cursor = '';
        setChartScroll(true);
        renderEmpireZones();
      }
    }
  });
}
