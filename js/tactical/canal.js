/**
 * js/tactical/canal.js
 * Ferramenta Interativa de Canal de Preço no Gráfico Tático.
 * Fluxo: mousedown = P1, arrastar = live P2, mouseup = fixa linha 1 e entra modo
 * "offset" (mover mouse define P3 — a linha paralela), próximo click = finaliza canal.
 * Ambas as linhas se estendem para a direita como raios, com preenchimento translúcido.
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

export function getCanalStorageKey(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return `capich_tac_canals_${sym}`;
}

export function getCanalColorStorageKey() {
  return 'capich_tac_canal_color';
}

export function getCanalColor() {
  const defaultColor = '#f0b90b';
  try {
    return localStorage.getItem(getCanalColorStorageKey()) || defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

export function changeCanalColor(newColor) {
  if (!newColor) return;
  try {
    localStorage.setItem(getCanalColorStorageKey(), newColor);
  } catch (_) {}

  if (state.drawingCanal) {
    state.drawingCanal.customColor = newColor;
  }

  if (state.selectedCanalId && Array.isArray(state.canals)) {
    const sel = state.canals.find(c => c.id === state.selectedCanalId);
    if (sel) {
      sel.customColor = newColor;
      saveCanalsToStorage(state.currentSymbol);
    }
  }

  const colorInput = document.getElementById('tac-canal-color');
  if (colorInput) colorInput.value = newColor;

  renderEmpireZones();
}

function gerarCanalId() {
  return `canal_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: largura útil do gráfico (sem o eixo de preço)
// ─────────────────────────────────────────────────────────────────────────────

function getChartPlotWidth(timeScale, fallbackWidth) {
  if (timeScale && typeof timeScale.width === 'function') {
    const w = timeScale.width();
    if (w > 100) return w;
  }
  if (state.charts && state.charts.main && state.charts.main.chartElement) {
    return (state.charts.main.chartElement.clientWidth || fallbackWidth) - 60;
  }
  return (fallbackWidth || 800) - 60;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA NO LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

export function saveCanalsToStorage(symbol) {
  try {
    const key = getCanalStorageKey(symbol);
    const data = (state.canals || []).map(c => ({
      id: c.id,
      p1: c.p1,
      p2: c.p2,
      deltaPrice: c.deltaPrice,
      customColor: c.customColor,
      locked: !!c.locked
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_) {}
}

export function loadCanalsFromStorage(symbol) {
  try {
    const key = getCanalStorageKey(symbol);
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(c => ({
          id: c.id || gerarCanalId(),
          p1: c.p1 || null,
          p2: c.p2 || null,
          deltaPrice: c.deltaPrice !== undefined ? c.deltaPrice : null,
          customColor: c.customColor || getCanalColor(),
          locked: !!c.locked,
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        })).filter(c => c.p1 && c.p2 && c.deltaPrice !== null);
      }
    }
  } catch (_) {}
  return [];
}

export function loadCanalsForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';

  state.drawingCanal = null;
  state.selectedCanalId = null;
  state.dragTargetCanalId = null;

  try {
    state.canals = loadCanalsFromStorage(sym);

    const colorInput = document.getElementById('tac-canal-color');
    if (colorInput) colorInput.value = getCanalColor();

    const hasCanals = (state.canals || []).length > 0;
    updateCanalButtonUI(hasCanals ? 'placed' : 'idle');
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar canais do par:', sym, e);
    state.canals = [];
    updateCanalButtonUI('idle');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATIVAR MODO DE DESENHO
// ─────────────────────────────────────────────────────────────────────────────

export function toggleCanalTool() {
  if (state.drawingCanal) {
    // Cancela qualquer fase do desenho
    state.drawingCanal = null;
    state.dragTargetCanalId = null;
    const hasCanals = (state.canals || []).length > 0;
    updateCanalButtonUI(hasCanals ? 'placed' : 'idle');
    const mc = document.getElementById('tac-chart-main');
    if (mc) {
      mc.classList.remove('canal-mode');
      mc.style.cursor = '';
    }
    setChartScroll(true);
    renderEmpireZones();
    return;
  }

  state.drawingCanal = {
    id: gerarCanalId(),
    customColor: getCanalColor(),
    p1: null,
    p2: null,
    deltaPrice: null,
    phase: 'line1', // 'line1' | 'offset'
    isDragging: false,
    dragAnchor: null,
    dragStart: null
  };

  updateCanalButtonUI('drawing');

  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.add('canal-mode');
    mc.style.cursor = 'crosshair';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO VISUAL DO BOTÃO
// ─────────────────────────────────────────────────────────────────────────────

export function updateCanalButtonUI(status) {
  const btn = document.getElementById('tac-btn-canal');
  const statusSpan = document.getElementById('tac-status-canal');
  if (!btn) return;

  const baseClass = 'tac-dropdown-item tac-btn-canal';

  if (status === 'drawing') {
    btn.className = `${baseClass} active drawing`;
    if (statusSpan) statusSpan.textContent = 'DESENHAR';
    btn.title = 'Canal ativo! Clique e arraste para definir linha 1, depois clique para posicionar a paralela.';
  } else if (status === 'offset') {
    btn.className = `${baseClass} active drawing`;
    if (statusSpan) statusSpan.textContent = 'PARALELA';
    btn.title = 'Canal: mova o mouse para posicionar a linha paralela e clique para finalizar.';
  } else if (status === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) statusSpan.textContent = 'ATIVO';
    btn.title = 'Canal ativo no gráfico. Clique para traçar outro. DblClick + Delete para apagar.';
  } else {
    btn.className = baseClass;
    if (statusSpan) statusSpan.textContent = 'OFF';
    btn.title = 'Canal de Preço: Clique para traçar duas linhas paralelas no gráfico';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APAGAR CANAL(IS)
// ─────────────────────────────────────────────────────────────────────────────

export function clearCanalById(id) {
  if (!id) return;
  state.canals = (state.canals || []).filter(c => c.id !== id);
  if (state.selectedCanalId === id) state.selectedCanalId = null;
  saveCanalsToStorage(state.currentSymbol);
  const hasCanals = (state.canals || []).length > 0;
  updateCanalButtonUI(hasCanals ? 'placed' : 'idle');
  renderEmpireZones();
}

export function clearAllCanals() {
  state.canals = [];
  state.drawingCanal = null;
  state.selectedCanalId = null;
  state.dragTargetCanalId = null;
  try {
    localStorage.removeItem(getCanalStorageKey(state.currentSymbol));
  } catch (_) {}
  updateCanalButtonUI('idle');
  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.remove('canal-mode');
    mc.style.cursor = '';
  }
  setChartScroll(true);
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO NO CANVAS
// ─────────────────────────────────────────────────────────────────────────────

export function drawCanal(ctx, width, height, timeScale, series, canalObj, isSelected = false) {
  if (!canalObj || !canalObj.p1 || !canalObj.p2) return;
  if (canalObj.deltaPrice === null || canalObj.deltaPrice === undefined) return;

  const x1 = getInterpolatedTimeToCoordinate(timeScale, canalObj.p1.time);
  const y1 = series.priceToCoordinate(canalObj.p1.price);
  const x2 = getInterpolatedTimeToCoordinate(timeScale, canalObj.p2.time);
  const y2 = series.priceToCoordinate(canalObj.p2.price);

  if (x1 === null || y1 === null || x2 === null || y2 === null) return;

  // Deslocamento vertical da linha paralela em pixels
  const y1_par = series.priceToCoordinate(canalObj.p1.price + canalObj.deltaPrice);
  const y2_par = series.priceToCoordinate(canalObj.p2.price + canalObj.deltaPrice);
  if (y1_par === null || y2_par === null) return;

  const color = canalObj.customColor || '#f0b90b';
  const chartPlotWidth = getChartPlotWidth(timeScale, width);

  ctx.save();

  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }

  // ── Calcular extensão à direita (ray) ───────────────────────────────────
  // Linha 1 (principal)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dy_par = y2_par - y1_par;

  let xRayEnd = chartPlotWidth;
  let yRayEnd1, yRayEnd1_par;

  // Ponto de origem do ray (o mais à direita entre P1 e P2)
  let xOrigin, yOrigin1, yOrigin1_par;
  if (Math.abs(dx) < 0.001) {
    // Linha vertical — sem extensão útil
    xOrigin = x1;
    yOrigin1 = y1;
    yOrigin1_par = y1_par;
    xRayEnd = x1;
    yRayEnd1 = y2;
    yRayEnd1_par = y2_par;
  } else {
    const slope1 = dy / dx;
    const slope1_par = dy_par / dx;

    if (x2 >= x1) {
      xOrigin = x2;
      yOrigin1 = y2;
      yOrigin1_par = y2_par;
    } else {
      xOrigin = x1;
      yOrigin1 = y1;
      yOrigin1_par = y1_par;
    }

    yRayEnd1 = yOrigin1 + slope1 * (xRayEnd - xOrigin);
    yRayEnd1_par = yOrigin1_par + slope1_par * (xRayEnd - xOrigin);
  }

  // ── Preenchimento translúcido do canal ──────────────────────────────────
  // Quad: [x1,y1] -> [xRayEnd,yRayEnd1] -> [xRayEnd,yRayEnd1_par] -> [x1,y1_par]
  // Converte hex color para rgba
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(xRayEnd, yRayEnd1);
  ctx.lineTo(xRayEnd, yRayEnd1_par);
  ctx.lineTo(x1, y1_par);
  ctx.closePath();
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.10)`;
  ctx.fill();

  // ── Linha Principal (P1 → P2 → Ray) ────────────────────────────────────
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.4 : 1.8;

  // Segmento P1 → P2
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Ray da linha 1
  if (chartPlotWidth > xOrigin) {
    ctx.beginPath();
    ctx.moveTo(xOrigin, yOrigin1);
    ctx.lineTo(xRayEnd, yRayEnd1);
    ctx.stroke();
  }

  // ── Linha Paralela (P1_par → P2_par → Ray) ─────────────────────────────
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.0 : 1.5;

  ctx.beginPath();
  ctx.moveTo(x1, y1_par);
  ctx.lineTo(x2, y2_par);
  ctx.stroke();

  if (chartPlotWidth > xOrigin) {
    ctx.beginPath();
    ctx.moveTo(xOrigin, yOrigin1_par);
    ctx.lineTo(xRayEnd, yRayEnd1_par);
    ctx.stroke();
  }

  // ── Âncoras (quando selecionado) ────────────────────────────────────────
  if (isSelected) {
    ctx.shadowBlur = 0;
    [[x1, y1], [x2, y2], [x1, y1_par], [x2, y2_par]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#1a1d27';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO DO PREVIEW (fase offset — antes de P3 ser fixado)
// ─────────────────────────────────────────────────────────────────────────────

export function drawCanalPreview(ctx, width, height, timeScale, series, canalObj) {
  // Fase offset: renderiza com deltaPrice dinâmico (calculado a partir do cursor)
  if (!canalObj || !canalObj.p1 || !canalObj.p2) return;
  drawCanal(ctx, width, height, timeScale, series, canalObj, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// HIT TEST
// ─────────────────────────────────────────────────────────────────────────────

export function checkAllCanalsHit(clientX, clientY, timeScale, series) {
  if (!Array.isArray(state.canals) || !state.canals.length) return null;
  if (!series || !timeScale) return null;

  const chartPlotWidth = getChartPlotWidth(timeScale, 800);

  for (let i = state.canals.length - 1; i >= 0; i--) {
    const c = state.canals[i];
    if (!c || !c.p1 || !c.p2 || c.deltaPrice === null) continue;

    const x1 = getInterpolatedTimeToCoordinate(timeScale, c.p1.time);
    const y1 = series.priceToCoordinate(c.p1.price);
    const x2 = getInterpolatedTimeToCoordinate(timeScale, c.p2.time);
    const y2 = series.priceToCoordinate(c.p2.price);
    const y1_par = series.priceToCoordinate(c.p1.price + c.deltaPrice);
    const y2_par = series.priceToCoordinate(c.p2.price + c.deltaPrice);

    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    if (y1_par === null || y2_par === null) continue;

    const dx = x2 - x1;
    let xOrigin = x2 >= x1 ? x2 : x1;
    let yO1 = x2 >= x1 ? y2 : y1;
    let yO1p = x2 >= x1 ? y2_par : y1_par;
    let slope1 = Math.abs(dx) > 0.001 ? (y2 - y1) / dx : 0;
    let slope1p = Math.abs(dx) > 0.001 ? (y2_par - y1_par) / dx : 0;

    const xRayEnd = chartPlotWidth;
    const yRayEnd1 = yO1 + slope1 * (xRayEnd - xOrigin);
    const yRayEnd1p = yO1p + slope1p * (xRayEnd - xOrigin);

    // Check âncoras P1, P2
    if (Math.hypot(clientX - x1, clientY - y1) <= 9)
      return { canal: c, hit: { anchor: 'p1' } };
    if (Math.hypot(clientX - x2, clientY - y2) <= 9)
      return { canal: c, hit: { anchor: 'p2' } };
    if (Math.hypot(clientX - x1, clientY - y1_par) <= 9)
      return { canal: c, hit: { anchor: 'p1_par' } };
    if (Math.hypot(clientX - x2, clientY - y2_par) <= 9)
      return { canal: c, hit: { anchor: 'p2_par' } };

    // Check segmento linha 1 (P1→P2)
    if (distToSegment(clientX, clientY, x1, y1, x2, y2) <= 7)
      return { canal: c, hit: { anchor: 'line1' } };
    // Check ray linha 1
    if (chartPlotWidth > xOrigin && distToSegment(clientX, clientY, xOrigin, yO1, xRayEnd, yRayEnd1) <= 7)
      return { canal: c, hit: { anchor: 'line1' } };

    // Check segmento linha paralela
    if (distToSegment(clientX, clientY, x1, y1_par, x2, y2_par) <= 7)
      return { canal: c, hit: { anchor: 'line_par' } };
    // Check ray linha paralela
    if (chartPlotWidth > xOrigin && distToSegment(clientX, clientY, xOrigin, yO1p, xRayEnd, yRayEnd1p) <= 7)
      return { canal: c, hit: { anchor: 'line_par' } };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS DE MOUSE
// ─────────────────────────────────────────────────────────────────────────────

export function initCanalMouseEvents(mainContainer) {
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

    // ── FASE 1: Desenhar linha 1 (P1 → P2) ─────────────────────────────────
    if (state.drawingCanal && state.drawingCanal.phase === 'line1') {
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null || !snap.time) return;

      state.drawingCanal.p1 = { price: snap.price, time: snap.time };
      state.drawingCanal.p2 = { price: snap.price, time: snap.time };
      state.drawingCanal.deltaPrice = 0;
      state.drawingCanal.isDragging = true;
      state.dragTargetCanalId = '__drawing_canal__';

      setChartScroll(false);
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // ── FASE 2: Clique para fixar linha paralela (offset) ───────────────────
    if (state.drawingCanal && state.drawingCanal.phase === 'offset') {
      // Finaliza o canal com o deltaPrice atual
      const c = state.drawingCanal;
      if (c.p1 && c.p2 && c.deltaPrice !== null) {
        const novoCanal = {
          id: c.id,
          p1: c.p1,
          p2: c.p2,
          deltaPrice: c.deltaPrice,
          customColor: c.customColor,
          locked: false,
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        };
        state.canals = state.canals || [];
        state.canals.push(novoCanal);
        state.selectedCanalId = novoCanal.id;
        saveCanalsToStorage(state.currentSymbol);
      }

      state.drawingCanal = null;
      state.dragTargetCanalId = null;
      updateCanalButtonUI((state.canals && state.canals.length > 0) ? 'placed' : 'idle');
      mainContainer.classList.remove('canal-mode');
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // ── Arrasto de canal existente ──────────────────────────────────────────
    const hitResult = checkAllCanalsHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { canal, hit } = hitResult;
      if (canal.locked) return;

      state.selectedCanalId = canal.id;
      state.dragTargetCanalId = canal.id;
      canal.isDragging = true;
      canal.dragAnchor = hit.anchor;

      if (hit.anchor === 'line1' || hit.anchor === 'line_par') {
        const curPrice = series.coordinateToPrice(clientY);
        canal.dragStart = {
          clientX,
          clientY,
          p1Price: canal.p1.price,
          p2Price: canal.p2.price,
          deltaPrice: canal.deltaPrice,
          curPrice
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

    // ── Preview linha 1 sendo arrastada ────────────────────────────────────
    if (state.dragTargetCanalId === '__drawing_canal__' && state.drawingCanal && state.drawingCanal.isDragging) {
      const pt = getPointFromClientCoords(clientX, clientY);
      if (pt && pt.price !== null && pt.time) {
        state.drawingCanal.p2 = { price: pt.price, time: pt.time };
      }
      renderEmpireZones();
      return;
    }

    // ── Preview fase offset (mover mouse define a linha paralela) ───────────
    if (state.drawingCanal && state.drawingCanal.phase === 'offset' && state.drawingCanal.p1 && state.drawingCanal.p2) {
      const curPrice = series.coordinateToPrice(clientY);
      if (curPrice !== null) {
        // deltaPrice = distância vertical entre a linha 1 e o cursor
        // Calculamos a "price da linha 1 no tempo de P1" como referência
        // Para simplificar: deltaPrice = curPrice - P1.price (deslocamento direto)
        // Mas queremos o deslocamento em relação ao ponto mais próximo da linha 1
        // Usando a lógica de projeção do mouse sobre a linha 1:
        const p1 = state.drawingCanal.p1;
        const p2 = state.drawingCanal.p2;
        // Interpolação do preço na linha 1 no ponto X do cursor
        const x1 = getInterpolatedTimeToCoordinate(timeScale, p1.time);
        const x2 = getInterpolatedTimeToCoordinate(timeScale, p2.time);
        if (x1 !== null && x2 !== null && Math.abs(x2 - x1) > 0.001) {
          const t = (clientX - x1) / (x2 - x1);
          const priceAtCursor = p1.price + t * (p2.price - p1.price);
          state.drawingCanal.deltaPrice = curPrice - priceAtCursor;
        } else {
          state.drawingCanal.deltaPrice = curPrice - p1.price;
        }
      }
      renderEmpireZones();
      return;
    }

    // ── Arrasto de canal existente ──────────────────────────────────────────
    if (state.dragTargetCanalId && state.dragTargetCanalId !== '__drawing_canal__') {
      const activeCanal = (state.canals || []).find(c => c.id === state.dragTargetCanalId);
      if (activeCanal && activeCanal.isDragging) {
        const anchor = activeCanal.dragAnchor;

        if (anchor === 'p1') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeCanal.p1 = { price: pt.price, time: pt.time };
          }
        } else if (anchor === 'p2') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeCanal.p2 = { price: pt.price, time: pt.time };
          }
        } else if (anchor === 'p1_par') {
          // Ajusta o deltaPrice movendo a ancora inferior de P1
          const curPrice = series.coordinateToPrice(clientY);
          if (curPrice !== null) {
            activeCanal.deltaPrice = curPrice - activeCanal.p1.price;
          }
        } else if (anchor === 'p2_par') {
          const curPrice = series.coordinateToPrice(clientY);
          if (curPrice !== null) {
            activeCanal.deltaPrice = curPrice - activeCanal.p2.price;
          }
        } else if ((anchor === 'line1' || anchor === 'line_par') && activeCanal.dragStart) {
          const curPrice = series.coordinateToPrice(clientY);
          if (curPrice !== null && activeCanal.dragStart.curPrice !== null) {
            const dPrice = curPrice - activeCanal.dragStart.curPrice;
            activeCanal.p1.price = activeCanal.dragStart.p1Price + dPrice;
            activeCanal.p2.price = activeCanal.dragStart.p2Price + dPrice;
            // deltaPrice permanece o mesmo (canal mantém largura ao arrastar)
          }
        }
        renderEmpireZones();
        return;
      }
    }

    // ── Cursor dinâmico (hover) ─────────────────────────────────────────────
    if (!state.drawingCanal && !state.dragTargetCanalId) {
      const hitResult = checkAllCanalsHit(clientX, clientY, timeScale, series);
      if (hitResult) {
        const anchor = hitResult.hit.anchor;
        if (anchor === 'p1' || anchor === 'p2' || anchor === 'p1_par' || anchor === 'p2_par') {
          mainContainer.style.cursor = 'grab';
        } else {
          mainContainer.style.cursor = 'move';
        }
      }
    }
  });

  // ── MOUSEUP ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    // Finalizando arrasto da linha 1 → entra em fase offset
    if (state.dragTargetCanalId === '__drawing_canal__' && state.drawingCanal) {
      const dc = state.drawingCanal;
      dc.isDragging = false;
      dc.dragAnchor = null;
      state.dragTargetCanalId = null;
      setChartScroll(true);

      // Valida: P1 e P2 devem ser distintos
      if (dc.p1 && dc.p2 && (dc.p1.time !== dc.p2.time || Math.abs(dc.p2.price - dc.p1.price) > 0.00001)) {
        // Entra em fase offset — agora mousemove define a linha paralela
        dc.phase = 'offset';
        dc.deltaPrice = 0;
        updateCanalButtonUI('offset');
      } else {
        // Traçado muito pequeno — cancela
        state.drawingCanal = null;
        const hasCanals = (state.canals || []).length > 0;
        updateCanalButtonUI(hasCanals ? 'placed' : 'idle');
        const mc = document.getElementById('tac-chart-main');
        if (mc) { mc.classList.remove('canal-mode'); mc.style.cursor = ''; }
      }
      renderEmpireZones();
      return;
    }

    // Finalizando arrasto de canal existente
    if (state.dragTargetCanalId && state.dragTargetCanalId !== '__drawing_canal__') {
      const activeCanal = (state.canals || []).find(c => c.id === state.dragTargetCanalId);
      if (activeCanal) {
        activeCanal.isDragging = false;
        activeCanal.dragAnchor = null;
        activeCanal.dragStart = null;
        saveCanalsToStorage(state.currentSymbol);
      }
      state.dragTargetCanalId = null;
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
    }
  });

  // ── DUPLO CLIQUE — Seleciona canal ─────────────────────────────────────────
  mainContainer.addEventListener('dblclick', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllCanalsHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { canal } = hitResult;
      state.selectedCanalId = (state.selectedCanalId === canal.id) ? null : canal.id;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
    } else if (state.selectedCanalId) {
      state.selectedCanalId = null;
      renderEmpireZones();
    }
  });

  // ── CLIQUE SIMPLES — Desseleciona se clicar fora ───────────────────────────
  mainContainer.addEventListener('click', e => {
    if (!state.selectedCanalId) return;
    if (state.drawingCanal) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllCanalsHit(clientX, clientY, timeScale, series);
    if (!hitResult) {
      state.selectedCanalId = null;
      renderEmpireZones();
    }
  });

  // ── DELETE / BACKSPACE / ESCAPE ───────────────────────────────────────────
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedCanalId) {
      clearCanalById(state.selectedCanalId);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.drawingCanal) {
        state.drawingCanal = null;
        state.dragTargetCanalId = null;
        const hasCanals = (state.canals || []).length > 0;
        updateCanalButtonUI(hasCanals ? 'placed' : 'idle');
        mainContainer.classList.remove('canal-mode');
        mainContainer.style.cursor = '';
        setChartScroll(true);
        renderEmpireZones();
      }
    }
  });
}
