/**
 * js/tactical/sr_zone.js
 * Ferramenta Interativa de Faixa / Zona de Suporte e Resistência no Gráfico Tático.
 * Ao selecionar dois pontos, abre uma faixa translúcida com níveis superior (Resistência)
 * e inferior (Suporte) que se estendem automaticamente para a direita até a escala de preços,
 * badges de cotação em ambas as extremidades, ajuste de bordas, arraste da faixa inteira,
 * duplo clique para selecionar e Delete para apagar.
 */

import { state, formatPrice } from './state.js';
import { renderEmpireZones } from './indicators.js';
import {
  getPointFromClientCoords,
  getInterpolatedTimeToCoordinate,
  setChartScroll
} from './fibo.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHAVES DE ARMAZENAMENTO E CORES
// ─────────────────────────────────────────────────────────────────────────────

export function getSRZoneStorageKey(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return `capich_tac_sr_zones_${sym}`;
}

export function getSRZoneColorStorageKey() {
  return 'capich_tac_sr_zone_color';
}

export function getSRZoneColor() {
  const defaultColor = '#00bcd4'; // Ciano / Teal clássico institucional (como nas imagens da Binance)
  try {
    return localStorage.getItem(getSRZoneColorStorageKey()) || defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

export function changeSRZoneColor(newColor) {
  if (!newColor) return;
  try {
    localStorage.setItem(getSRZoneColorStorageKey(), newColor);
  } catch (_) {}

  if (state.drawingSRZone) {
    state.drawingSRZone.customColor = newColor;
  }

  if (state.selectedSRZoneId && Array.isArray(state.srZones)) {
    const selected = state.srZones.find(z => z.id === state.selectedSRZoneId);
    if (selected) {
      selected.customColor = newColor;
      saveSRZonesToStorage(state.currentSymbol);
    }
  }

  const colorInput = document.getElementById('tac-sr-zone-color');
  if (colorInput) colorInput.value = newColor;

  renderEmpireZones();
}

function hexToRgba(hex, alpha = 0.16) {
  if (!hex || typeof hex !== 'string') return `rgba(0, 188, 212, ${alpha})`;
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return `rgba(0, 188, 212, ${alpha})`;
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function gerarSRZoneId() {
  return `zone_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function getChartPlotWidth(timeScale, width) {
  let plotW = width ? (width - 60) : 800;
  if (timeScale && typeof timeScale.width === 'function' && timeScale.width() > 100) {
    plotW = timeScale.width();
  } else if (state.charts.main && typeof state.charts.main.priceScale === 'function') {
    try {
      const psw = state.charts.main.priceScale('right').width();
      if (psw > 0 && width) plotW = width - psw;
    } catch (_) {}
  }
  return plotW;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA NO LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

export function saveSRZonesToStorage(symbol) {
  try {
    const key = getSRZoneStorageKey(symbol);
    const data = (state.srZones || []).map(z => ({
      id: z.id,
      p1: z.p1,
      p2: z.p2,
      customColor: z.customColor,
      extendRight: z.extendRight !== false,
      locked: !!z.locked
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_) {}
}

export function loadSRZonesFromStorage(symbol) {
  try {
    const key = getSRZoneStorageKey(symbol);
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(z => ({
          id: z.id || gerarSRZoneId(),
          p1: z.p1 || null,
          p2: z.p2 || null,
          customColor: z.customColor || getSRZoneColor(),
          extendRight: z.extendRight !== false,
          locked: !!z.locked,
          active: !!(z.p1 && z.p2),
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        })).filter(z => z.p1 && z.p2);
      }
    }
  } catch (_) {}
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CARREGAR ZONAS AO TROCAR DE PAR
// ─────────────────────────────────────────────────────────────────────────────

export function loadSRZonesForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';

  state.drawingSRZone = null;
  state.selectedSRZoneId = null;
  state.dragTargetSRZoneId = null;

  try {
    state.srZones = loadSRZonesFromStorage(sym);

    const colorInput = document.getElementById('tac-sr-zone-color');
    if (colorInput) colorInput.value = getSRZoneColor();

    const hasZones = state.srZones.length > 0;
    updateSRZoneButtonUI(hasZones ? 'placed' : 'idle');
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar Faixas S/R do par:', sym, e);
    state.srZones = [];
    updateSRZoneButtonUI('idle');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATIVAR MODO DE DESENHO — botão nunca bloqueia
// ─────────────────────────────────────────────────────────────────────────────

export function toggleSRZoneTool() {
  if (state.drawingSRZone) {
    state.drawingSRZone = null;
    const hasZones = (state.srZones || []).length > 0;
    updateSRZoneButtonUI(hasZones ? 'placed' : 'idle');
    const mc = document.getElementById('tac-chart-main');
    if (mc) {
      mc.classList.remove('sr-zone-mode');
      mc.style.cursor = '';
    }
    renderEmpireZones();
    return;
  }

  // Cancela outros desenhos pendentes
  if (state.drawingFibo) state.drawingFibo = null;
  if (state.drawingTrendline) state.drawingTrendline = null;
  if (state.drawingSR) state.drawingSR = false;

  state.drawingSRZone = {
    id: gerarSRZoneId(),
    customColor: getSRZoneColor(),
    p1: null,
    p2: null,
    extendRight: true,
    locked: false,
    active: true,
    isDragging: false,
    dragAnchor: null,
    dragStart: null
  };

  updateSRZoneButtonUI('drawing');

  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.add('sr-zone-mode');
    mc.style.cursor = 'crosshair';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO VISUAL DO BOTÃO
// ─────────────────────────────────────────────────────────────────────────────

export function updateSRZoneButtonUI(status) {
  const btn = document.getElementById('tac-btn-sr-zone');
  const statusSpan = document.getElementById('tac-status-sr-zone');
  if (!btn) return;

  const baseClass = 'tac-dropdown-item tac-btn-sr-zone';

  if (status === 'drawing') {
    btn.className = `${baseClass} active drawing`;
    if (statusSpan) statusSpan.textContent = 'DESENHAR';
    btn.title = 'Modo Faixa S/R ativo! Clique e arraste para abrir a faixa no gráfico.';
  } else if (status === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) statusSpan.textContent = 'ATIVO';
    btn.title = 'Faixa S/R ativa! Clique para traçar outra. Duplo clique + Delete para apagar.';
  } else {
    btn.className = baseClass;
    if (statusSpan) statusSpan.textContent = 'OFF';
    btn.title = 'Faixa de Suporte e Resistência (Zona): Clique para traçar no gráfico';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APAGAR ZONA(S)
// ─────────────────────────────────────────────────────────────────────────────

export function clearSRZoneById(id) {
  if (!id) return;
  state.srZones = (state.srZones || []).filter(z => z.id !== id);
  if (state.selectedSRZoneId === id) {
    state.selectedSRZoneId = null;
  }
  saveSRZonesToStorage(state.currentSymbol);
  const hasZones = (state.srZones || []).length > 0;
  updateSRZoneButtonUI(hasZones ? 'placed' : 'idle');
  renderEmpireZones();
}

export function clearAllSRZones() {
  state.srZones = [];
  state.drawingSRZone = null;
  state.selectedSRZoneId = null;
  state.dragTargetSRZoneId = null;
  try {
    localStorage.removeItem(getSRZoneStorageKey(state.currentSymbol));
  } catch (_) {}
  updateSRZoneButtonUI('idle');
  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.remove('sr-zone-mode');
    mc.style.cursor = '';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// HIT TEST
// ─────────────────────────────────────────────────────────────────────────────

export function checkAllSRZonesHit(clientX, clientY, timeScale, series) {
  if (!Array.isArray(state.srZones) || !state.srZones.length) return null;
  if (!series || !timeScale) return null;

  const container = document.getElementById('tac-chart-main');
  const width = container ? container.clientWidth : 800;
  const chartPlotWidth = getChartPlotWidth(timeScale, width);

  for (let i = state.srZones.length - 1; i >= 0; i--) {
    const z = state.srZones[i];
    if (!z || !z.p1 || !z.p2) continue;

    const x1 = getInterpolatedTimeToCoordinate(timeScale, z.p1.time);
    const x2 = getInterpolatedTimeToCoordinate(timeScale, z.p2.time);
    const y1 = series.priceToCoordinate(z.p1.price);
    const y2 = series.priceToCoordinate(z.p2.price);

    if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

    const leftX   = Math.min(x1, x2);
    const rightX  = Math.max(x1, x2);
    const topY    = Math.min(y1, y2);
    const bottomY = Math.max(y1, y2);

    const extendRight = z.extendRight !== false;
    const endX = extendRight ? Math.max(rightX, chartPlotWidth) : rightX;

    // 1. Bordas para redimensionamento
    const nearTop    = Math.abs(clientY - topY) <= 7 && clientX >= leftX - 6 && clientX <= endX + 6;
    const nearBottom = Math.abs(clientY - bottomY) <= 7 && clientX >= leftX - 6 && clientX <= endX + 6;
    const nearLeft   = Math.abs(clientX - leftX) <= 7 && clientY >= topY - 6 && clientY <= bottomY + 6;
    const nearRight  = Math.abs(clientX - rightX) <= 7 && clientY >= topY - 6 && clientY <= bottomY + 6;

    if (nearTop && nearLeft)     return { zone: z, hit: { anchor: 'nw' } };
    if (nearTop && nearRight)    return { zone: z, hit: { anchor: 'ne' } };
    if (nearBottom && nearLeft)  return { zone: z, hit: { anchor: 'sw' } };
    if (nearBottom && nearRight) return { zone: z, hit: { anchor: 'se' } };
    if (nearTop)                 return { zone: z, hit: { anchor: 'top' } };
    if (nearBottom)              return { zone: z, hit: { anchor: 'bottom' } };
    if (nearLeft)                return { zone: z, hit: { anchor: 'left' } };
    if (nearRight)               return { zone: z, hit: { anchor: 'right' } };

    // 2. Interior da faixa para arrasto inteiro
    if (clientX >= leftX && clientX <= endX && clientY >= topY && clientY <= bottomY) {
      return { zone: z, hit: { anchor: 'inside' } };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO NO CANVAS
// ─────────────────────────────────────────────────────────────────────────────

export function drawSRZone(ctx, width, height, timeScale, series, zoneObj, isSelected = false) {
  if (!zoneObj || !zoneObj.p1 || !zoneObj.p2) return;

  const x1 = getInterpolatedTimeToCoordinate(timeScale, zoneObj.p1.time);
  const x2 = getInterpolatedTimeToCoordinate(timeScale, zoneObj.p2.time);
  const y1 = series.priceToCoordinate(zoneObj.p1.price);
  const y2 = series.priceToCoordinate(zoneObj.p2.price);

  if (x1 === null || x2 === null || y1 === null || y2 === null) return;

  const chartPlotWidth = getChartPlotWidth(timeScale, width);

  const leftX   = Math.min(x1, x2);
  const rightX  = Math.max(x1, x2);
  const topY    = Math.min(y1, y2);
  const bottomY = Math.max(y1, y2);

  const extendRight = zoneObj.extendRight !== false;
  const drawEndX = extendRight ? Math.max(rightX, chartPlotWidth) : rightX;

  const boxW = Math.max(2, drawEndX - leftX);
  const boxH = Math.max(2, bottomY - topY);

  const color = zoneObj.customColor || getSRZoneColor();
  const topPrice    = Math.max(zoneObj.p1.price, zoneObj.p2.price);
  const bottomPrice = Math.min(zoneObj.p1.price, zoneObj.p2.price);

  ctx.save();

  // ── 1. Preenchimento Translúcido da Faixa
  ctx.fillStyle = hexToRgba(color, isSelected ? 0.22 : 0.15);
  ctx.fillRect(leftX, topY, boxW, boxH);

  // ── 2. Contorno / Bordas Superior e Inferior
  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.2 : 1.5;

  ctx.beginPath();
  // Borda vertical na esquerda (início da faixa)
  ctx.moveTo(leftX, topY);
  ctx.lineTo(leftX, bottomY);
  // Linha superior (Resistência estendida para a direita)
  ctx.moveTo(leftX, topY);
  ctx.lineTo(drawEndX, topY);
  // Linha inferior (Suporte estendido para a direita)
  ctx.moveTo(leftX, bottomY);
  ctx.lineTo(drawEndX, bottomY);
  // Borda vertical no limite direito do gráfico
  ctx.moveTo(drawEndX, topY);
  ctx.lineTo(drawEndX, bottomY);
  ctx.stroke();

  // ── 3. Badges de Preço no Limite Direito da Faixa (encostado na escala)
  const drawPriceBadge = (priceVal, yCoord, prefix) => {
    const text = `${prefix}: $${formatPrice(priceVal)}`;
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const textW = ctx.measureText(text).width;

    const bX = drawEndX - 4;
    const bY = yCoord - 2;

    ctx.fillStyle = 'rgba(15, 23, 30, 0.9)';
    ctx.fillRect(bX - textW - 4, bY - 11, textW + 6, 12);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bX - textW - 4, bY - 11, textW + 6, 12);

    ctx.fillStyle = color;
    ctx.fillText(text, bX - 1, bY);
  };

  drawPriceBadge(topPrice, topY, 'RES');
  drawPriceBadge(bottomPrice, bottomY, 'SUP');

  // ── 4. Alças de Seleção nos Pontos Âncora (apenas quando selecionado com duplo clique)
  if (isSelected) {
    const midX = (leftX + rightX) / 2;
    const midY = (topY + bottomY) / 2;
    const handlePositions = [
      [leftX, topY],
      [midX, topY],
      [rightX, topY],
      [leftX, midY],
      [midX, midY],
      [rightX, midY],
      [leftX, bottomY],
      [midX, bottomY],
      [rightX, bottomY]
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

export function initSRZoneMouseEvents(mainContainer) {
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

    // 1. Se estamos traçando uma nova faixa
    if (state.drawingSRZone) {
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null || !snap.time) return;

      state.drawingSRZone.p1 = { price: snap.price, time: snap.time };
      state.drawingSRZone.p2 = { price: snap.price, time: snap.time };
      state.drawingSRZone.extendRight = true;
      state.drawingSRZone.isDragging = true;
      state.dragTargetSRZoneId = '__drawing_zone__';

      setChartScroll(false);
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // 2. Se clicou em uma faixa existente para arrastar ou redimensionar
    const hitResult = checkAllSRZonesHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { zone, hit } = hitResult;
      if (zone.locked) return;

      state.selectedSRZoneId = zone.id;
      state.dragTargetSRZoneId = zone.id;
      zone.isDragging = true;
      zone.dragAnchor = hit.anchor;

      zone.dragStart = {
        clientX,
        clientY,
        p1Price: zone.p1.price,
        p2Price: zone.p2.price,
        p1Time: zone.p1.time,
        p2Time: zone.p2.time
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

    // Arrasto da faixa sendo traçada no momento
    if (state.dragTargetSRZoneId === '__drawing_zone__' && state.drawingSRZone && state.drawingSRZone.isDragging) {
      const pt = getPointFromClientCoords(clientX, clientY);
      if (pt && pt.price !== null && pt.time) {
        state.drawingSRZone.p2 = { price: pt.price, time: pt.time };
        state.drawingSRZone.extendRight = true;
      }
      renderEmpireZones();
      return;
    }

    // Arrasto ou redimensionamento de faixa existente
    if (state.dragTargetSRZoneId && state.dragTargetSRZoneId !== '__drawing_zone__') {
      const activeZone = (state.srZones || []).find(z => z.id === state.dragTargetSRZoneId);
      if (activeZone && activeZone.isDragging && activeZone.dragStart) {
        const curPrice = series.coordinateToPrice(clientY);
        const startPrice = series.coordinateToPrice(activeZone.dragStart.clientY);

        if (activeZone.dragAnchor === 'inside') {
          // Move faixa inteira
          if (curPrice !== null && startPrice !== null) {
            const dPrice = curPrice - startPrice;
            activeZone.p1.price = activeZone.dragStart.p1Price + dPrice;
            activeZone.p2.price = activeZone.dragStart.p2Price + dPrice;
          }
          const curPoint = getPointFromClientCoords(clientX, clientY);
          const startPoint = getPointFromClientCoords(activeZone.dragStart.clientX, activeZone.dragStart.clientY);
          if (curPoint && startPoint && curPoint.time && startPoint.time) {
            const dTime = curPoint.time - startPoint.time;
            activeZone.p1.time = activeZone.dragStart.p1Time + dTime;
            activeZone.p2.time = activeZone.dragStart.p2Time + dTime;
          }
        } else {
          // Redimensionamento de borda ou âncora
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            const isP1Top = activeZone.p1.price >= activeZone.p2.price;
            const topKey = isP1Top ? 'p1' : 'p2';
            const botKey = isP1Top ? 'p2' : 'p1';

            const isP1Left = activeZone.p1.time <= activeZone.p2.time;
            const leftKey = isP1Left ? 'p1' : 'p2';
            const rightKey = isP1Left ? 'p2' : 'p1';

            if (activeZone.dragAnchor === 'top' || activeZone.dragAnchor === 'nw' || activeZone.dragAnchor === 'ne') {
              activeZone[topKey].price = pt.price;
            }
            if (activeZone.dragAnchor === 'bottom' || activeZone.dragAnchor === 'sw' || activeZone.dragAnchor === 'se') {
              activeZone[botKey].price = pt.price;
            }
            if (activeZone.dragAnchor === 'left' || activeZone.dragAnchor === 'nw' || activeZone.dragAnchor === 'sw') {
              activeZone[leftKey].time = pt.time;
            }
            if (activeZone.dragAnchor === 'right' || activeZone.dragAnchor === 'ne' || activeZone.dragAnchor === 'se') {
              activeZone[rightKey].time = pt.time;
            }
          }
        }

        renderEmpireZones();
        return;
      }
    }

    // Cursor dinâmico
    if (!state.drawingFibo && !state.dragTargetFiboId && !state.drawingTrendline && !state.dragTargetTrendlineId && !state.drawingSR && !state.dragTargetSRId) {
      const hitResult = checkAllSRZonesHit(clientX, clientY, timeScale, series);
      if (hitResult) {
        const a = hitResult.hit.anchor;
        if (a === 'top' || a === 'bottom') mainContainer.style.cursor = 'ns-resize';
        else if (a === 'left' || a === 'right') mainContainer.style.cursor = 'ew-resize';
        else if (a === 'nw' || a === 'se') mainContainer.style.cursor = 'nwse-resize';
        else if (a === 'ne' || a === 'sw') mainContainer.style.cursor = 'nesw-resize';
        else mainContainer.style.cursor = 'move';
      } else if (state.drawingSRZone) {
        mainContainer.style.cursor = 'crosshair';
      }
    }
  });

  // ── MOUSEUP ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    // Finalizando faixa sendo traçada
    if (state.dragTargetSRZoneId === '__drawing_zone__' && state.drawingSRZone) {
      const dz = state.drawingSRZone;
      dz.isDragging = false;
      dz.dragAnchor = null;
      state.dragTargetSRZoneId = null;

      if (dz.p1 && dz.p2 && Math.abs(dz.p2.price - dz.p1.price) > 0.00001) {
        const novaFaixa = {
          id: dz.id,
          p1: dz.p1,
          p2: dz.p2,
          customColor: dz.customColor,
          extendRight: true,
          locked: false,
          active: true,
          isDragging: false,
          dragAnchor: null,
          dragStart: null
        };
        state.srZones = state.srZones || [];
        state.srZones.push(novaFaixa);
        state.selectedSRZoneId = novaFaixa.id;
        saveSRZonesToStorage(state.currentSymbol);
      }

      state.drawingSRZone = null;
      updateSRZoneButtonUI((state.srZones && state.srZones.length > 0) ? 'placed' : 'idle');

      mainContainer.classList.remove('sr-zone-mode');
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
      return;
    }

    // Finalizando arrasto de faixa existente
    if (state.dragTargetSRZoneId && state.dragTargetSRZoneId !== '__drawing_zone__') {
      const activeZone = (state.srZones || []).find(z => z.id === state.dragTargetSRZoneId);
      if (activeZone) {
        activeZone.isDragging = false;
        activeZone.dragAnchor = null;
        activeZone.dragStart = null;
        saveSRZonesToStorage(state.currentSymbol);
      }
      state.dragTargetSRZoneId = null;
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

    const hitResult = checkAllSRZonesHit(clientX, clientY, timeScale, series);
    if (hitResult) {
      const { zone } = hitResult;
      state.selectedSRZoneId = (state.selectedSRZoneId === zone.id) ? null : zone.id;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
    } else if (state.selectedSRZoneId) {
      state.selectedSRZoneId = null;
      renderEmpireZones();
    }
  });

  // ── CLIQUE SIMPLES FORA ────────────────────────────────────────────────────
  mainContainer.addEventListener('click', e => {
    if (!state.selectedSRZoneId) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
    if (!series || !timeScale) return;

    const hitResult = checkAllSRZonesHit(clientX, clientY, timeScale, series);
    if (!hitResult) {
      state.selectedSRZoneId = null;
      renderEmpireZones();
    }
  });

  // ── DELETE / BACKSPACE / ESCAPE ───────────────────────────────────────────
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedSRZoneId) {
      clearSRZoneById(state.selectedSRZoneId);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.drawingSRZone) {
        state.drawingSRZone = null;
        updateSRZoneButtonUI((state.srZones && state.srZones.length > 0) ? 'placed' : 'idle');
        mainContainer.classList.remove('sr-zone-mode');
        mainContainer.style.cursor = '';
        setChartScroll(true);
        renderEmpireZones();
      }
    }
  });
}
