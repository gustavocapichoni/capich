/**
 * js/tactical/measure.js
 * Ferramenta Interativa de Medição de Preço (Stop / Take / Variação / Range).
 * Permite ao trader traçar um intervalo entre dois pontos para medir variação absoluta ($),
 * percentual (%), direção com seta (Take/Long para cima, Stop/Short para baixo)
 * e badges de cotação na escala de preço.
 */

import { state, formatPrice } from './state.js';
import { renderEmpireZones } from './indicators.js';
import {
  getPointFromClientCoords,
  getInterpolatedTimeToCoordinate,
  setChartScroll
} from './fibo.js';
import { getChartPlotWidth } from './sr_zone.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHAVES DE ARMAZENAMENTO E CORES
// ─────────────────────────────────────────────────────────────────────────────

export function getMeasureStorageKey(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return `capich_tac_measures_${sym}`;
}

export function getMeasureColorStorageKey() {
  return 'capich_tac_measure_color';
}

export function getMeasureColor() {
  const defaultColor = '#38bdf8'; // Azul claro celeste institucional
  try {
    return localStorage.getItem(getMeasureColorStorageKey()) || defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

export function changeMeasureColor(newColor) {
  if (!newColor) return;
  try {
    localStorage.setItem(getMeasureColorStorageKey(), newColor);
  } catch (_) {}

  if (state.drawingMeasure) {
    state.drawingMeasure.customColor = newColor;
  }

  if (state.selectedMeasureId && Array.isArray(state.measures)) {
    const selected = state.measures.find(m => m.id === state.selectedMeasureId);
    if (selected) {
      selected.customColor = newColor;
      saveMeasuresToStorage(state.currentSymbol);
    }
  }

  const colorInput = document.getElementById('tac-measure-color');
  if (colorInput) colorInput.value = newColor;

  renderEmpireZones();
}

function hexToRgba(hex, alpha = 0.16) {
  if (!hex || typeof hex !== 'string') return `rgba(56, 189, 248, ${alpha})`;
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return `rgba(56, 189, 248, ${alpha})`;
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function gerarMeasureId() {
  return `meas_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA NO LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

export function saveMeasuresToStorage(symbol) {
  try {
    const key = getMeasureStorageKey(symbol);
    const data = (state.measures || []).map(m => ({
      id: m.id,
      p1: m.p1,
      p2: m.p2,
      customColor: m.customColor,
      locked: !!m.locked
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_) {}
}

export function loadMeasuresFromStorage(symbol) {
  try {
    const key = getMeasureStorageKey(symbol);
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(m => ({
          id: m.id || gerarMeasureId(),
          p1: m.p1 || null,
          p2: m.p2 || null,
          customColor: m.customColor || getMeasureColor(),
          locked: !!m.locked,
          active: !!(m.p1 && m.p2),
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        })).filter(m => m.p1 && m.p2);
      }
    }
  } catch (_) {}
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CARREGAR MEDIDORES AO TROCAR DE PAR
// ─────────────────────────────────────────────────────────────────────────────

export function loadMeasuresForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';

  state.drawingMeasure = null;
  state.selectedMeasureId = null;
  state.dragTargetMeasureId = null;

  try {
    state.measures = loadMeasuresFromStorage(sym);

    const colorInput = document.getElementById('tac-measure-color');
    if (colorInput) colorInput.value = getMeasureColor();

    const hasMeasures = state.measures.length > 0;
    updateMeasureButtonUI(hasMeasures ? 'placed' : 'idle');
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar Medidores do par:', sym, e);
    state.measures = [];
    updateMeasureButtonUI('idle');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATIVAR MODO DE DESENHO — botão nunca bloqueia
// ─────────────────────────────────────────────────────────────────────────────

export function toggleMeasureTool() {
  if (state.drawingMeasure) {
    state.drawingMeasure = null;
    const hasMeasures = (state.measures || []).length > 0;
    updateMeasureButtonUI(hasMeasures ? 'placed' : 'idle');
    const mc = document.getElementById('tac-chart-main');
    if (mc) {
      mc.classList.remove('measure-mode');
      mc.style.cursor = '';
    }
    renderEmpireZones();
    return;
  }

  // Cancela outros desenhos pendentes
  if (state.drawingFibo) state.drawingFibo = null;
  if (state.drawingTrendline) state.drawingTrendline = null;
  if (state.drawingSR) state.drawingSR = false;
  if (state.drawingSRZone) state.drawingSRZone = null;

  state.drawingMeasure = {
    id: gerarMeasureId(),
    customColor: getMeasureColor(),
    p1: null,
    p2: null,
    locked: false,
    active: true,
    isDragging: false,
    dragAnchor: null,
    dragStart: null
  };

  updateMeasureButtonUI('drawing');

  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.add('measure-mode');
    mc.style.cursor = 'crosshair';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO VISUAL DO BOTÃO
// ─────────────────────────────────────────────────────────────────────────────

export function updateMeasureButtonUI(status) {
  const btn = document.getElementById('tac-btn-measure');
  const statusSpan = document.getElementById('tac-status-measure');
  if (!btn) return;

  const baseClass = 'tac-dropdown-item tac-btn-measure';

  if (status === 'drawing') {
    btn.className = `${baseClass} active drawing`;
    if (statusSpan) statusSpan.textContent = 'MEDIR';
    btn.title = 'Modo Medidor ativo! Clique e arraste para medir stop/take no gráfico.';
  } else if (status === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) statusSpan.textContent = 'ATIVO';
    btn.title = 'Medidor ativo! Clique para traçar outro. Duplo clique + Delete para apagar.';
  } else {
    btn.className = baseClass;
    if (statusSpan) statusSpan.textContent = 'OFF';
    btn.title = 'Medidor de Stop / Take (Variação de Preço): Clique para medir no gráfico';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APAGAR MEDIDOR(ES)
// ─────────────────────────────────────────────────────────────────────────────

export function clearMeasureById(id) {
  if (!id) return;
  state.measures = (state.measures || []).filter(m => m.id !== id);
  if (state.selectedMeasureId === id) {
    state.selectedMeasureId = null;
  }
  saveMeasuresToStorage(state.currentSymbol);
  const hasMeasures = (state.measures || []).length > 0;
  updateMeasureButtonUI(hasMeasures ? 'placed' : 'idle');
  renderEmpireZones();
}

export function clearAllMeasures() {
  state.measures = [];
  state.drawingMeasure = null;
  state.selectedMeasureId = null;
  state.dragTargetMeasureId = null;
  try {
    localStorage.removeItem(getMeasureStorageKey(state.currentSymbol));
  } catch (_) {}
  updateMeasureButtonUI('idle');
  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.remove('measure-mode');
    mc.style.cursor = '';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// HIT TEST
// ─────────────────────────────────────────────────────────────────────────────

export function checkAllMeasuresHit(clientX, clientY, timeScale, series) {
  if (!Array.isArray(state.measures) || !state.measures.length) return null;
  if (!series || !timeScale) return null;

  for (let i = state.measures.length - 1; i >= 0; i--) {
    const m = state.measures[i];
    if (!m || !m.p1 || !m.p2) continue;

    const x1 = getInterpolatedTimeToCoordinate(timeScale, m.p1.time);
    const x2 = getInterpolatedTimeToCoordinate(timeScale, m.p2.time);
    const y1 = series.priceToCoordinate(m.p1.price);
    const y2 = series.priceToCoordinate(m.p2.price);

    if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

    const leftX   = Math.min(x1, x2);
    const rightX  = Math.max(x1, x2);
    const topY    = Math.min(y1, y2);
    const bottomY = Math.max(y1, y2);
    const centerX = (leftX + rightX) / 2;

    // 1. Bordas horizontais (P1 e P2)
    const nearTop    = Math.abs(clientY - topY) <= 7 && clientX >= leftX - 6 && clientX <= rightX + 6;
    const nearBottom = Math.abs(clientY - bottomY) <= 7 && clientX >= leftX - 6 && clientX <= rightX + 6;
    const nearLeft   = Math.abs(clientX - leftX) <= 7 && clientY >= topY - 6 && clientY <= bottomY + 6;
    const nearRight  = Math.abs(clientX - rightX) <= 7 && clientY >= topY - 6 && clientY <= bottomY + 6;
    const nearCenter = Math.abs(clientX - centerX) <= 7 && clientY >= topY - 6 && clientY <= bottomY + 6;

    if (nearTop && nearLeft)     return { measure: m, hit: { anchor: 'nw' } };
    if (nearTop && nearRight)    return { measure: m, hit: { anchor: 'ne' } };
    if (nearBottom && nearLeft)  return { measure: m, hit: { anchor: 'sw' } };
    if (nearBottom && nearRight) return { measure: m, hit: { anchor: 'se' } };
    if (nearTop)                 return { measure: m, hit: { anchor: 'top' } };
    if (nearBottom)              return { measure: m, hit: { anchor: 'bottom' } };
    if (nearLeft)                return { measure: m, hit: { anchor: 'left' } };
    if (nearRight)               return { measure: m, hit: { anchor: 'right' } };
    if (nearCenter)              return { measure: m, hit: { anchor: 'center-line' } };

    // 2. Interior do medidor para arraste inteiro
    if (clientX >= leftX && clientX <= rightX && clientY >= topY && clientY <= bottomY) {
      return { measure: m, hit: { anchor: 'inside' } };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO NO CANVAS
// ─────────────────────────────────────────────────────────────────────────────

export function drawMeasure(ctx, width, height, timeScale, series, measureObj, isSelected = false) {
  if (!measureObj || !measureObj.p1 || !measureObj.p2) return;

  const x1 = getInterpolatedTimeToCoordinate(timeScale, measureObj.p1.time);
  const x2 = getInterpolatedTimeToCoordinate(timeScale, measureObj.p2.time);
  const y1 = series.priceToCoordinate(measureObj.p1.price);
  const y2 = series.priceToCoordinate(measureObj.p2.price);

  if (x1 === null || x2 === null || y1 === null || y2 === null) return;

  const chartPlotWidth = getChartPlotWidth(timeScale, width);

  const leftX   = Math.min(x1, x2);
  const rightX  = Math.max(x1, x2);
  const topY    = Math.min(y1, y2);
  const bottomY = Math.max(y1, y2);
  const centerX = (leftX + rightX) / 2;

  const boxW = Math.max(2, rightX - leftX);
  const boxH = Math.max(2, bottomY - topY);

  const deltaPrice = measureObj.p2.price - measureObj.p1.price;
  const isPositive = deltaPrice >= 0;
  const pct = measureObj.p1.price !== 0 ? ((deltaPrice / measureObj.p1.price) * 100) : 0;

  // Cor principal: segue o padrão da Binance (verde para alta/gain, vermelho para baixa/loss, ou personalizável)
  const defaultThemeColor = isPositive ? '#0ecb81' : '#f6465d';
  const color = measureObj.customColor || defaultThemeColor;

  ctx.save();

  // ── 1. Área Sombreada Translúcida
  ctx.fillStyle = hexToRgba(defaultThemeColor, isSelected ? 0.16 : 0.08);
  ctx.fillRect(leftX, topY, boxW, boxH);

  // ── 2. Linhas Horizontais nos Níveis P1 e P2
  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 1.8 : 1.2;

  ctx.beginPath();
  // Nível superior
  ctx.moveTo(leftX, topY);
  ctx.lineTo(rightX, topY);
  // Nível inferior
  ctx.moveTo(leftX, bottomY);
  ctx.lineTo(rightX, bottomY);
  ctx.stroke();

  // ── 3. Seta Vertical Central de Direção
  ctx.beginPath();
  ctx.moveTo(centerX, y1);
  ctx.lineTo(centerX, y2);
  ctx.stroke();

  // Cabeça da seta apontando para P2 (direção da medição)
  const arrowSize = 6;
  const arrowDir = (y2 < y1) ? -1 : 1; // -1 = para cima (gain), +1 = para baixo (loss)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(centerX, y2);
  ctx.lineTo(centerX - arrowSize, y2 - arrowDir * arrowSize * 1.5);
  ctx.lineTo(centerX + arrowSize, y2 - arrowDir * arrowSize * 1.5);
  ctx.closePath();
  ctx.fill();

  // ── 4. Badges de Preço na Escala Lateral Direita
  const drawAxisBadge = (priceVal, yCoord) => {
    const text = `$${formatPrice(priceVal)}`;
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const textW = ctx.measureText(text).width;

    const bX = chartPlotWidth - 4;
    const bY = yCoord - 2;

    ctx.fillStyle = 'rgba(15, 23, 30, 0.92)';
    ctx.fillRect(bX - textW - 4, bY - 11, textW + 6, 12);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bX - textW - 4, bY - 11, textW + 6, 12);

    ctx.fillStyle = color;
    ctx.fillText(text, bX - 1, bY);
  };

  drawAxisBadge(measureObj.p1.price, y1);
  drawAxisBadge(measureObj.p2.price, y2);

  // ── 5. Badge Central de Medição (Estilo TradingView / Binance: ΔPreço (Δ%) Ticks)
  const sign = isPositive ? '+' : '';
  const priceDiffStr = `${sign}${formatPrice(deltaPrice)}`;
  const pctStr = `${sign}${pct.toFixed(2)}%`;
  const badgeText = `${priceDiffStr} (${pctStr})`;

  ctx.font = "bold 10.5px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(badgeText).width;

  // Posição do badge: acima de P2 se subiu, abaixo de P2 se caiu
  const badgeH = 18;
  const badgeW = textW + 16;
  const badgeY = (y2 < y1) ? (y2 - 14) : (y2 + 14);

  // Fundo escuro do badge
  ctx.fillStyle = 'rgba(15, 23, 30, 0.95)';
  ctx.beginPath();
  const rad = 4;
  const bLeft = centerX - badgeW / 2;
  const bTop = badgeY - badgeH / 2;
  ctx.roundRect ? ctx.roundRect(bLeft, bTop, badgeW, badgeH, rad) : ctx.rect(bLeft, bTop, badgeW, badgeH);
  ctx.fill();

  // Borda colorida de acordo com o sinal (Verde = Gain, Vermelho = Loss)
  ctx.strokeStyle = defaultThemeColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Texto com a cor do resultado
  ctx.fillStyle = defaultThemeColor;
  ctx.fillText(badgeText, centerX, badgeY);

  // ── 6. Alças de Seleção (apenas quando selecionado com duplo clique)
  if (isSelected) {
    const handlePositions = [
      [leftX, topY],
      [centerX, topY],
      [rightX, topY],
      [leftX, (topY + bottomY) / 2],
      [rightX, (topY + bottomY) / 2],
      [leftX, bottomY],
      [centerX, bottomY],
      [rightX, bottomY],
      [x1, y1],
      [x2, y2]
    ];

    handlePositions.forEach(([hx, hy]) => {
      ctx.fillStyle = '#14171d';
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS DE MOUSE
// ─────────────────────────────────────────────────────────────────────────────

export function initMeasureMouseEvents(mainContainer) {
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

    // 1. Se estamos traçando uma nova medição
    if (state.drawingMeasure) {
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null || !snap.time) return;

      state.drawingMeasure.p1 = { price: snap.price, time: snap.time };
      state.drawingMeasure.p2 = { price: snap.price, time: snap.time };
      state.drawingMeasure.isDragging = true;
      state.dragTargetMeasureId = '__drawing_measure__';

      setChartScroll(false);
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // 2. Se clicou em uma medição existente para arrastar ou redimensionar
    const hitResult = checkAllMeasuresHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { measure, hit } = hitResult;
      if (measure.locked) return;

      state.selectedMeasureId = measure.id;
      state.dragTargetMeasureId = measure.id;
      measure.isDragging = true;
      measure.dragAnchor = hit.anchor;

      measure.dragStart = {
        clientX,
        clientY,
        p1Price: measure.p1.price,
        p2Price: measure.p2.price,
        p1Time: measure.p1.time,
        p2Time: measure.p2.time
      };

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

    // Arrasto da medição sendo traçada no momento
    if (state.dragTargetMeasureId === '__drawing_measure__' && state.drawingMeasure && state.drawingMeasure.isDragging) {
      const pt = getPointFromClientCoords(clientX, clientY);
      if (pt && pt.price !== null && pt.time) {
        state.drawingMeasure.p2 = { price: pt.price, time: pt.time };
      }
      renderEmpireZones();
      return;
    }

    // Arrasto ou redimensionamento de medição existente
    if (state.dragTargetMeasureId && state.dragTargetMeasureId !== '__drawing_measure__') {
      const activeM = (state.measures || []).find(m => m.id === state.dragTargetMeasureId);
      if (activeM && activeM.isDragging && activeM.dragStart) {
        const curPrice = series.coordinateToPrice(clientY);
        const startPrice = series.coordinateToPrice(activeM.dragStart.clientY);

        if (activeM.dragAnchor === 'inside') {
          // Move medição inteira
          if (curPrice !== null && startPrice !== null) {
            const dPrice = curPrice - startPrice;
            activeM.p1.price = activeM.dragStart.p1Price + dPrice;
            activeM.p2.price = activeM.dragStart.p2Price + dPrice;
          }
          const curPoint = getPointFromClientCoords(clientX, clientY);
          const startPoint = getPointFromClientCoords(activeM.dragStart.clientX, activeM.dragStart.clientY);
          if (curPoint && startPoint && curPoint.time && startPoint.time) {
            const dTime = curPoint.time - startPoint.time;
            activeM.p1.time = activeM.dragStart.p1Time + dTime;
            activeM.p2.time = activeM.dragStart.p2Time + dTime;
          }
        } else {
          // Redimensionamento de nível ou âncora
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            const isP1Top = activeM.p1.price >= activeM.p2.price;
            const topKey = isP1Top ? 'p1' : 'p2';
            const botKey = isP1Top ? 'p2' : 'p1';

            const isP1Left = activeM.p1.time <= activeM.p2.time;
            const leftKey = isP1Left ? 'p1' : 'p2';
            const rightKey = isP1Left ? 'p2' : 'p1';

            if (activeM.dragAnchor === 'top' || activeM.dragAnchor === 'nw' || activeM.dragAnchor === 'ne') {
              activeM[topKey].price = pt.price;
            }
            if (activeM.dragAnchor === 'bottom' || activeM.dragAnchor === 'sw' || activeM.dragAnchor === 'se') {
              activeM[botKey].price = pt.price;
            }
            if (activeM.dragAnchor === 'left' || activeM.dragAnchor === 'nw' || activeM.dragAnchor === 'sw') {
              activeM[leftKey].time = pt.time;
            }
            if (activeM.dragAnchor === 'right' || activeM.dragAnchor === 'ne' || activeM.dragAnchor === 'se') {
              activeM[rightKey].time = pt.time;
            }
          }
        }

        renderEmpireZones();
        return;
      }
    }

    // Cursor dinâmico
    if (!state.drawingFibo && !state.dragTargetFiboId && !state.drawingTrendline && !state.dragTargetTrendlineId && !state.drawingSR && !state.dragTargetSRId && !state.drawingSRZone && !state.dragTargetSRZoneId) {
      const hitResult = checkAllMeasuresHit(clientX, clientY, timeScale, series);
      if (hitResult) {
        const a = hitResult.hit.anchor;
        if (a === 'top' || a === 'bottom') mainContainer.style.cursor = 'ns-resize';
        else if (a === 'left' || a === 'right') mainContainer.style.cursor = 'ew-resize';
        else if (a === 'nw' || a === 'se') mainContainer.style.cursor = 'nwse-resize';
        else if (a === 'ne' || a === 'sw') mainContainer.style.cursor = 'nesw-resize';
        else mainContainer.style.cursor = 'move';
      } else if (state.drawingMeasure) {
        mainContainer.style.cursor = 'crosshair';
      }
    }
  });

  // ── MOUSEUP ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    // Finalizando medição sendo traçada
    if (state.dragTargetMeasureId === '__drawing_measure__' && state.drawingMeasure) {
      const dm = state.drawingMeasure;
      dm.isDragging = false;
      dm.dragAnchor = null;
      state.dragTargetMeasureId = null;

      if (dm.p1 && dm.p2 && Math.abs(dm.p2.price - dm.p1.price) > 0.00001) {
        const novoMedidor = {
          id: dm.id,
          p1: dm.p1,
          p2: dm.p2,
          customColor: dm.customColor,
          locked: false,
          active: true,
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        };
        state.measures = state.measures || [];
        state.measures.push(novoMedidor);
        state.selectedMeasureId = novoMedidor.id;
        saveMeasuresToStorage(state.currentSymbol);
      }

      state.drawingMeasure = null;
      updateMeasureButtonUI((state.measures && state.measures.length > 0) ? 'placed' : 'idle');

      mainContainer.classList.remove('measure-mode');
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
      return;
    }

    // Finalizando arrasto de medição existente
    if (state.dragTargetMeasureId && state.dragTargetMeasureId !== '__drawing_measure__') {
      const activeM = (state.measures || []).find(m => m.id === state.dragTargetMeasureId);
      if (activeM) {
        activeM.isDragging = false;
        activeM.dragAnchor = null;
        activeM.dragStart = null;
        saveMeasuresToStorage(state.currentSymbol);
      }
      state.dragTargetMeasureId = null;
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
    }
  });

  // ── DUPLO CLIQUE ───────────────────────────────────────────────────────────
  mainContainer.addEventListener('dblclick', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllMeasuresHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { measure } = hitResult;
      state.selectedMeasureId = (state.selectedMeasureId === measure.id) ? null : measure.id;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
    } else if (state.selectedMeasureId) {
      state.selectedMeasureId = null;
      renderEmpireZones();
    }
  });

  // ── CLIQUE SIMPLES FORA ────────────────────────────────────────────────────
  mainContainer.addEventListener('click', e => {
    if (!state.selectedMeasureId) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllMeasuresHit(clientX, clientY, timeScale, series);
    if (!hitResult) {
      state.selectedMeasureId = null;
      renderEmpireZones();
    }
  });

  // ── DELETE / BACKSPACE / ESCAPE ───────────────────────────────────────────
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedMeasureId) {
      clearMeasureById(state.selectedMeasureId);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.drawingMeasure) {
        state.drawingMeasure = null;
        updateMeasureButtonUI((state.measures && state.measures.length > 0) ? 'placed' : 'idle');
        mainContainer.classList.remove('measure-mode');
        mainContainer.style.cursor = '';
        setChartScroll(true);
        renderEmpireZones();
      }
    }
  });
}
