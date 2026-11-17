/**
 * js/tactical/sr_line.js
 * Ferramenta Interativa de Linha Horizontal (Suporte e Resistência) no Gráfico Tático.
 * Suporta múltiplos níveis, imã inteligente nos pavios das velas, arrasto vertical,
 * duplo clique para selecionar, tecla Delete/Backspace para apagar e tecla F para travar.
 */

import { state, formatPrice } from './state.js';
import { renderEmpireZones } from './indicators.js';
import { getPointFromClientCoords, setChartScroll } from './fibo.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHAVES DE ARMAZENAMENTO E CORES
// ─────────────────────────────────────────────────────────────────────────────

export function getSRStorageKey(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  return `capich_tac_sr_${sym}`;
}

export function getSRColorStorageKey() {
  return 'capich_tac_sr_color';
}

export function getSRColor() {
  const defaultColor = '#38bdf8'; // Azul Celeste institucional
  try {
    return localStorage.getItem(getSRColorStorageKey()) || defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

export function changeSRColor(newColor) {
  if (!newColor) return;
  try {
    localStorage.setItem(getSRColorStorageKey(), newColor);
  } catch (_) {}

  // Se há uma linha selecionada, atualiza a cor dela
  if (state.selectedSRId && Array.isArray(state.srLines)) {
    const selected = state.srLines.find(s => s.id === state.selectedSRId);
    if (selected) {
      selected.customColor = newColor;
      saveSRLinesToStorage(state.currentSymbol);
    }
  }

  const colorInput = document.getElementById('tac-sr-color');
  if (colorInput) colorInput.value = newColor;

  renderEmpireZones();
}

function gerarSRId() {
  return `sr_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA NO LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

export function saveSRLinesToStorage(symbol) {
  try {
    const key = getSRStorageKey(symbol);
    const data = (state.srLines || []).map(s => ({
      id: s.id,
      price: s.price,
      customColor: s.customColor,
      locked: !!s.locked
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_) {}
}

export function loadSRLinesFromStorage(symbol) {
  try {
    const key = getSRStorageKey(symbol);
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(s => ({
          id: s.id || gerarSRId(),
          price: Number(s.price),
          customColor: s.customColor || getSRColor(),
          locked: !!s.locked,
          isDragging: false
        })).filter(s => s.price !== null && !isNaN(s.price));
      }
    }
  } catch (_) {}
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CARREGAR LINHAS AO TROCAR DE PAR
// ─────────────────────────────────────────────────────────────────────────────

export function loadSRLinesForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';

  state.drawingSR = false;
  state.selectedSRId = null;
  state.dragTargetSRId = null;

  try {
    state.srLines = loadSRLinesFromStorage(sym);

    const colorInput = document.getElementById('tac-sr-color');
    if (colorInput) colorInput.value = getSRColor();

    const hasLines = state.srLines.length > 0;
    updateSRButtonUI(hasLines ? 'placed' : 'idle');
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao carregar Suporte/Resistência do par:', sym, e);
    state.srLines = [];
    updateSRButtonUI('idle');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATIVAR MODO DE DESENHO — botão nunca bloqueia
// ─────────────────────────────────────────────────────────────────────────────

export function toggleSRTool() {
  if (state.drawingSR) {
    state.drawingSR = false;
    const hasLines = (state.srLines || []).length > 0;
    updateSRButtonUI(hasLines ? 'placed' : 'idle');
    const mc = document.getElementById('tac-chart-main');
    if (mc) {
      mc.classList.remove('sr-mode');
      mc.style.cursor = '';
    }
    renderEmpireZones();
    return;
  }

  // Cancela outros desenhos pendentes
  if (state.drawingFibo) {
    state.drawingFibo = null;
  }
  if (state.drawingTrendline) {
    state.drawingTrendline = null;
  }

  state.drawingSR = true;
  updateSRButtonUI('drawing');

  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.add('sr-mode');
    mc.style.cursor = 'crosshair';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO VISUAL DO BOTÃO
// ─────────────────────────────────────────────────────────────────────────────

export function updateSRButtonUI(status) {
  const btn = document.getElementById('tac-btn-sr');
  const statusSpan = document.getElementById('tac-status-sr');
  if (!btn) return;

  const baseClass = 'tac-dropdown-item tac-btn-sr';

  if (status === 'drawing') {
    btn.className = `${baseClass} active drawing`;
    if (statusSpan) statusSpan.textContent = 'CLIQUE';
    btn.title = 'Clique no gráfico onde deseja posicionar o Suporte / Resistência. Clique novamente para cancelar.';
  } else if (status === 'placed') {
    btn.className = `${baseClass} active`;
    if (statusSpan) statusSpan.textContent = 'ATIVO';
    btn.title = 'Suporte / Resistência ativo! Clique para adicionar outro nível. Duplo clique + Delete para apagar.';
  } else {
    btn.className = baseClass;
    if (statusSpan) statusSpan.textContent = 'OFF';
    btn.title = 'Linha Horizontal de Suporte / Resistência: Clique para traçar no gráfico';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APAGAR LINHA(S)
// ─────────────────────────────────────────────────────────────────────────────

export function clearSRLineById(id) {
  if (!id) return;
  state.srLines = (state.srLines || []).filter(s => s.id !== id);
  if (state.selectedSRId === id) {
    state.selectedSRId = null;
  }
  saveSRLinesToStorage(state.currentSymbol);
  const hasLines = (state.srLines || []).length > 0;
  updateSRButtonUI(hasLines ? 'placed' : 'idle');
  renderEmpireZones();
}

export function clearAllSRLines() {
  state.srLines = [];
  state.drawingSR = false;
  state.selectedSRId = null;
  state.dragTargetSRId = null;
  try {
    localStorage.removeItem(getSRStorageKey(state.currentSymbol));
  } catch (_) {}
  updateSRButtonUI('idle');
  const mc = document.getElementById('tac-chart-main');
  if (mc) {
    mc.classList.remove('sr-mode');
    mc.style.cursor = '';
  }
  renderEmpireZones();
}

// ─────────────────────────────────────────────────────────────────────────────
// HIT TEST
// ─────────────────────────────────────────────────────────────────────────────

export function checkAllSRLinesHit(clientY, series) {
  if (!Array.isArray(state.srLines) || !state.srLines.length) return null;
  if (!series) return null;

  for (let i = state.srLines.length - 1; i >= 0; i--) {
    const s = state.srLines[i];
    if (s.price === null || s.price === undefined) continue;

    const y = series.priceToCoordinate(s.price);
    if (y === null || y === undefined) continue;

    if (Math.abs(clientY - y) <= 6) {
      return { sr: s };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO NO CANVAS
// ─────────────────────────────────────────────────────────────────────────────

export function drawSRLine(ctx, width, height, timeScale, series, srObj, isSelected = false) {
  if (!srObj || srObj.price === null || srObj.price === undefined) return;

  const y = series.priceToCoordinate(srObj.price);
  if (y === null || y === undefined || y < -10 || y > height + 10) return;

  const color = srObj.customColor || getSRColor();
  const chartPlotWidth = (typeof timeScale.width === 'function' && timeScale.width() > 100)
    ? timeScale.width()
    : (width - 60);

  ctx.save();

  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
  }

  // ── Traçado da Linha Horizontal
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.4 : 1.6;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(y));
  ctx.lineTo(chartPlotWidth, Math.round(y));
  ctx.stroke();

  // ── Badge de Preço na extremidade direita do gráfico
  const formattedPrice = formatPrice(srObj.price);
  const labelText = `S/R: $${formattedPrice}`;

  ctx.font = "bold 9.5px 'JetBrains Mono', 'Fira Code', monospace";
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const textW = ctx.measureText(labelText).width;

  const labelRightX = chartPlotWidth - 6;
  const labelY = y - 3;

  ctx.fillStyle = 'rgba(11, 14, 17, 0.88)';
  ctx.fillRect(labelRightX - textW - 5, labelY - 11, textW + 8, 13);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(labelRightX - textW - 5, labelY - 11, textW + 8, 13);

  ctx.fillStyle = color;
  ctx.fillText(labelText, labelRightX - 1, labelY);

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS DE MOUSE
// ─────────────────────────────────────────────────────────────────────────────

export function initSRMouseEvents(mainContainer) {
  if (!mainContainer) return;

  // ── MOUSEDOWN ──────────────────────────────────────────────────────────────
  mainContainer.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    if (!series) return;

    // 1. Se estiver no modo de colocação de nova linha
    if (state.drawingSR) {
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null) return;

      const novaLinha = {
        id: gerarSRId(),
        price: snap.price,
        customColor: getSRColor(),
        locked: false,
        isDragging: false
      };

      state.srLines = state.srLines || [];
      state.srLines.push(novaLinha);
      state.selectedSRId = novaLinha.id;
      saveSRLinesToStorage(state.currentSymbol);

      state.drawingSR = false;
      updateSRButtonUI('placed');

      mainContainer.classList.remove('sr-mode');
      mainContainer.style.cursor = '';
      renderEmpireZones();

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // 2. Se clicou em uma linha existente para arrastar verticalmente
    const hitResult = checkAllSRLinesHit(clientY, series);
    if (hitResult) {
      const { sr } = hitResult;
      if (sr.locked) return;

      state.selectedSRId = sr.id;
      state.dragTargetSRId = sr.id;
      sr.isDragging = true;

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
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    if (!series) return;

    // Arrasto vertical de linha existente
    if (state.dragTargetSRId) {
      const activeSR = (state.srLines || []).find(s => s.id === state.dragTargetSRId);
      if (activeSR && activeSR.isDragging) {
        const newPrice = series.coordinateToPrice(clientY);
        if (newPrice !== null && !isNaN(newPrice)) {
          activeSR.price = newPrice;
          renderEmpireZones();
        }
        return;
      }
    }

    // Cursor dinâmico
    if (!state.drawingFibo && !state.dragTargetFiboId && !state.drawingTrendline && !state.dragTargetTrendlineId) {
      const hitResult = checkAllSRLinesHit(clientY, series);
      if (hitResult) {
        mainContainer.style.cursor = 'ns-resize';
      } else if (state.drawingSR) {
        mainContainer.style.cursor = 'crosshair';
      }
    }
  });

  // ── MOUSEUP ────────────────────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    if (state.dragTargetSRId) {
      const activeSR = (state.srLines || []).find(s => s.id === state.dragTargetSRId);
      if (activeSR) {
        activeSR.isDragging = false;
        saveSRLinesToStorage(state.currentSymbol);
      }
      state.dragTargetSRId = null;
      mainContainer.style.cursor = '';
      setChartScroll(true);
      renderEmpireZones();
    }
  });

  // ── DUPLO CLIQUE ───────────────────────────────────────────────────────────
  mainContainer.addEventListener('dblclick', e => {
    const rect = mainContainer.getBoundingClientRect();
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    if (!series) return;

    const hitResult = checkAllSRLinesHit(clientY, series);
    if (hitResult) {
      const { sr } = hitResult;
      state.selectedSRId = (state.selectedSRId === sr.id) ? null : sr.id;
      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
    } else if (state.selectedSRId) {
      state.selectedSRId = null;
      renderEmpireZones();
    }
  });

  // ── CLIQUE SIMPLES FORA ────────────────────────────────────────────────────
  mainContainer.addEventListener('click', e => {
    if (!state.selectedSRId) return;

    const rect = mainContainer.getBoundingClientRect();
    const clientY = e.clientY - rect.top;

    const series = state.series.candles;
    if (!series) return;

    const hitResult = checkAllSRLinesHit(clientY, series);
    if (!hitResult) {
      state.selectedSRId = null;
      renderEmpireZones();
    }
  });

  // ── TECLAS DELETE / BACKSPACE / ESCAPE ──────────────────────────────────────
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedSRId) {
      clearSRLineById(state.selectedSRId);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.drawingSR) {
        state.drawingSR = false;
        updateSRButtonUI((state.srLines && state.srLines.length > 0) ? 'placed' : 'idle');
        mainContainer.classList.remove('sr-mode');
        mainContainer.style.cursor = '';
        renderEmpireZones();
      }
    }
  });
}
