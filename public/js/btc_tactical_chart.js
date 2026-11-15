/**
 * btc_tactical_chart.js
 * Gráfico Tático Multi-Pares — TradingView Lightweight Charts v4.1.1
 * Módulo Orquestrador Principal (Modularizado)
 */

import { state, loadUserPreferences } from './tactical/state.js';
import {
  buildHTML,
  toggleOracleHelp,
  closeOracleHelp,
  toggleHudHelp,
  closeHudHelp,
  initHelpListeners
} from './tactical/dom.js';
import {
  loadFiboForSymbol,
  toggleFiboTool,
  clearFibo,
  clearFiboById,
  updateFiboButtonUI,
  changeFiboColor
} from './tactical/fibo.js';
import {
  initCharts,
  syncChartHeightToPanel
} from './tactical/chart_core.js';
import {
  fetchAndRender,
  fetchPersonalIndexLive,
  fetchOiLive,
  fetchGlobalOi,
  updateOracleHUD,
  syncLivePriceFallback
} from './tactical/data_feed.js';
import { updateCandleCountdown } from './tactical/legend.js';
import {
  setPair,
  setTimeframe,
  toggleMovingAverages,
  toggleIndicators,
  toggleEmpire72h,
  toggleEmpire8h,
  toggleEmpireZones,
  toggleEmpireZones72h,
  toggleEmpireZones8h,
  toggleEmpireTags,
  togglePriceLine,
  zoomInChart,
  zoomOutChart,
  scrollChartLeft,
  scrollChartRight,
  resetChartZoom
} from './tactical/actions.js';

import {
  toggleAdvisor,
  closeAdvisor,
  renderAdvisorContent,
  updateAdvisorIfOpen
} from './tactical/advisor.js';

import {
  addPriceAlert,
  removePriceAlert,
  clearAllPriceAlerts,
  updatePriceAlertButton,
  renderPriceAlertBadge,
  stopPriceAlertSound,
  priceAlerts
} from './tactical/audio_alerts.js';

// ─── Registro Global de Ações (Compatibilidade Total com onclick inline) ─────
window._toggleTacMA         = toggleMovingAverages;
window._toggleTacInd        = toggleIndicators;
window._toggleTacEmpire72h  = toggleEmpire72h;
window._toggleTacEmpire8h   = toggleEmpire8h;
window._toggleTacZones      = toggleEmpireZones;
window._toggleTacZones72h   = toggleEmpireZones72h;
window._toggleTacZones8h    = toggleEmpireZones8h;
window._toggleTacEmpireTags = toggleEmpireTags;
window._toggleTacPriceLine  = togglePriceLine;
window._tacZoomIn           = zoomInChart;
window._tacZoomOut          = zoomOutChart;
window._tacScrollLeft       = scrollChartLeft;
window._tacScrollRight      = scrollChartRight;
window._tacResetZoom        = resetChartZoom;
window._toggleTacFibo       = () => toggleFiboTool(1);
window._clearTacFibo        = () => clearFibo(1);
window._toggleTacFibo2      = () => toggleFiboTool(2);
window._clearTacFibo2       = () => clearFibo(2);
window._clearTacFiboById    = (id) => clearFiboById(id);
window._changeTacFiboColor  = (which, color) => changeFiboColor(which, color);
window._setTacTF            = setTimeframe;
window._setTacPair          = setPair;
window._toggleTacOracleHelp = toggleOracleHelp;
window._closeTacOracleHelp  = closeOracleHelp;
window._toggleTacHudHelp    = toggleHudHelp;
window._closeTacHudHelp     = closeHudHelp;
window._syncTacChartHeight  = syncChartHeightToPanel;
window._toggleTacAdvisor    = toggleAdvisor;
window._closeTacAdvisor     = closeAdvisor;
window._refreshTacAdvisor   = renderAdvisorContent;
window._updateAdvisorIfOpen = updateAdvisorIfOpen;

// ─── Modal Alerta de Preço ───────────────────────────────────────────────────

function _renderPriceAlertList() {
  const list = document.getElementById('tac-pal-list');
  const wrap = document.getElementById('tac-pal-list-wrap');
  if (!list || !wrap) return;

  if (!priceAlerts.length) {
    wrap.classList.remove('has-items');
    list.innerHTML = '';
    return;
  }

  wrap.classList.add('has-items');
  list.innerHTML = priceAlerts.map(a => {
    const fmtPrice = Number(a.targetPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    const dirIcon = a.direction === 'above' ? '📈' : '📉';
    const dirTxt = a.direction === 'above' ? 'Alerta acima' : 'Alerta abaixo';
    const statusClass = a.triggered ? ' triggered' : '';
    const statusBadge = a.triggered ? ' <span style="color:#ff4444;font-size:9px;">DISPARADO</span>' : '';
    const labelHtml = a.label ? `<span class="tac-pal-list-item-label">${a.label}</span>` : '';
    return `
      <div class="tac-pal-list-item${statusClass}">
        <div class="tac-pal-list-item-info">
          <span class="tac-pal-list-item-price">${dirIcon} $${fmtPrice}${statusBadge}</span>
          <span class="tac-pal-list-item-dir">${dirTxt}${labelHtml ? '' : ''}</span>
          ${labelHtml}
        </div>
        <button class="tac-pal-list-item-del" onclick="window._removePriceAlert('${a.id}')" title="Remover alerta">✕</button>
      </div>
    `;
  }).join('');
}

window._openPriceAlertModal = () => {
  const modal = document.getElementById('tac-price-alert-modal');
  if (!modal) return;
  // Preenche a dica com o preço atual
  const assetEl = document.getElementById('tac-pal-asset');
  if (assetEl) assetEl.textContent = (state.baseAsset || 'BTC') + '/USDT';
  const hint = document.getElementById('tac-pal-hint');
  if (hint) {
    const cp = state.currentPrice;
    hint.textContent = cp ? `Preço atual: $${Number(cp).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : '';
  }
  // Limpa inputs
  const inp = document.getElementById('tac-pal-input');
  if (inp) { inp.value = ''; }
  const lblInp = document.getElementById('tac-pal-label-input');
  if (lblInp) { lblInp.value = ''; }
  _renderPriceAlertList();
  modal.style.display = 'flex';
  setTimeout(() => { if (inp) inp.focus(); }, 80);
};

window._closePriceAlertModal = () => {
  const modal = document.getElementById('tac-price-alert-modal');
  if (modal) modal.style.display = 'none';
};

window._confirmPriceAlert = () => {
  const inp = document.getElementById('tac-pal-input');
  const lblInp = document.getElementById('tac-pal-label-input');
  const hint = document.getElementById('tac-pal-hint');
  if (!inp) return;

  const val = parseFloat(inp.value);
  if (!val || isNaN(val) || val <= 0) {
    if (hint) { hint.textContent = '⚠️ Informe um preço válido.'; hint.style.color = '#ff4444'; }
    inp.focus();
    return;
  }

  const label = lblInp ? lblInp.value.trim() : '';
  const alert = addPriceAlert(val, label);
  if (!alert) {
    if (hint) { hint.textContent = '⚠️ Não foi possível criar o alerta.'; hint.style.color = '#ff4444'; }
    return;
  }

  // Atualiza dica com confirmação
  if (hint) {
    const dir = alert.direction === 'above' ? '↑ acima de' : '↓ abaixo de';
    const fmtP = Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    hint.textContent = `✓ Alerta criado: ${dir} $${fmtP}`;
    hint.style.color = '#00bcd4';
  }
  inp.value = '';
  if (lblInp) lblInp.value = '';
  _renderPriceAlertList();
};

window._removePriceAlert = (id) => {
  removePriceAlert(id);
  _renderPriceAlertList();
};

window._clearAllPriceAlerts = () => {
  clearAllPriceAlerts();
  _renderPriceAlertList();
};

// Enter no input de preço confirma
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('tac-pal-input');
  if (inp) inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') window._confirmPriceAlert();
    if (e.key === 'Escape') window._closePriceAlertModal();
  });
});

// ─── Controle dos Menus Dropdown (Indicadores & Ferramentas) ───
window._toggleTacDropdown = (id) => {
  const target = document.getElementById(id);
  const allDropdowns = document.querySelectorAll('.tac-dropdown');
  allDropdowns.forEach(dd => {
    if (dd !== target) dd.classList.remove('open');
  });
  if (target) target.classList.toggle('open');
};

// Fecha dropdowns se clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tac-dropdown')) {
    document.querySelectorAll('.tac-dropdown').forEach(dd => dd.classList.remove('open'));
  }
});

// ─── Detecção de Tela Cheia (F11 e Fullscreen API) para Ocultar Topbar ─────
function checkFullscreenState() {
  const isFsApi = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  // No F11 nativo do navegador, a janela assume a resolução total do monitor
  const isScreenFs = (window.innerHeight >= window.screen.height - 4 && window.innerWidth >= window.screen.width - 4);
  const isFullscreen = isFsApi || isScreenFs;

  if (isFullscreen) {
    document.body.classList.add('fullscreen-mode');
  } else {
    document.body.classList.remove('fullscreen-mode');
  }

  if (window._syncTacChartHeight) {
    window._syncTacChartHeight();
  }
}

window.addEventListener('resize', checkFullscreenState);
document.addEventListener('fullscreenchange', checkFullscreenState);
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    setTimeout(checkFullscreenState, 150);
    setTimeout(checkFullscreenState, 500);
  }
  // Atalho estilo Binance / TradingView: Alt + R para resetar visualização do gráfico
  if (e.altKey && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR')) {
    e.preventDefault();
    resetChartZoom();
  }
});

function init() {
  loadUserPreferences();
  buildHTML();
  initHelpListeners();
  loadFiboForSymbol(state.currentSymbol);

  if (window.OrderPanel && typeof window.OrderPanel.init === 'function') {
    window.OrderPanel.init();
  }

  initCharts();
  fetchAndRender();
  fetchPersonalIndexLive();
  fetchGlobalOi();

  setInterval(fetchPersonalIndexLive, 2200);
  setInterval(fetchOiLive, 4000);
  setInterval(fetchGlobalOi, 15000);
  setInterval(updateOracleHUD, 2500);
  setInterval(syncLivePriceFallback, 2500);
  updateCandleCountdown();
  setInterval(updateCandleCountdown, 1000);

  // Restaura estado visual dos botões Fibo caso venham do localStorage
  if (state.fibo.active && state.fibo.p1 && state.fibo.p2) {
    requestAnimationFrame(() => updateFiboButtonUI('placed', 1));
  }
  if (state.fibo2.active && state.fibo2.p1 && state.fibo2.p2) {
    requestAnimationFrame(() => updateFiboButtonUI('placed', 2));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
