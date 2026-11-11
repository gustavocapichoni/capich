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
  updateFiboButtonUI
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
  toggleEmpireZones,
  toggleEmpireTags,
  togglePriceLine
} from './tactical/actions.js';

import {
  toggleAdvisor,
  closeAdvisor,
  renderAdvisorContent,
  updateAdvisorIfOpen
} from './tactical/advisor.js';

// ─── Registro Global de Ações (Compatibilidade Total com onclick inline) ─────
window._toggleTacMA         = toggleMovingAverages;
window._toggleTacInd        = toggleIndicators;
window._toggleTacZones      = toggleEmpireZones;
window._toggleTacEmpireTags = toggleEmpireTags;
window._toggleTacPriceLine  = togglePriceLine;
window._toggleTacFibo       = () => toggleFiboTool(1);
window._clearTacFibo        = () => clearFibo(1);
window._toggleTacFibo2      = () => toggleFiboTool(2);
window._clearTacFibo2       = () => clearFibo(2);
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
