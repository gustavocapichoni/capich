/**
 * js/tactical/actions.js
 * Ações de interface do usuário: troca de par, troca de timeframe,
 * e toggles visuais (médias, indicadores, nuvens, tags, linha de preço).
 */

import { state, PAIRS } from './state.js';
import { loadFiboForSymbol } from './fibo.js';
import { fetchAndRender } from './data_feed.js';
import { renderEmpireZones } from './indicators.js';
import { renderDefaultLegend, updateCandleCountdown } from './legend.js';

export function setPair(symbol) {
  if (state.currentSymbol === symbol) return;
  state.currentSymbol = symbol;
  try { localStorage.setItem('capich_tac_symbol', symbol); } catch (_) {}

  if (state.ws) {
    try {
      state.ws.onclose = null;
      state.ws.onerror = null;
      state.ws.close();
    } catch (_) {}
    state.ws = null;
  }

  const badgeEl = document.getElementById('tac-ticker-badge');
  const liveDot = document.getElementById('tac-live-dot');
  if (badgeEl) badgeEl.classList.add('connecting');
  if (liveDot) liveDot.title = 'Conectando ao par...';

  loadFiboForSymbol(symbol);

  if (window.OrderPanel) {
    window.OrderPanel.setMarketContext(symbol, 0);
  }

  PAIRS.forEach(p => {
    const btn = document.getElementById(`tac-pair-${p.symbol}`);
    if (btn) {
      if (p.symbol === symbol) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  fetchAndRender();
}

export function setTimeframe(tf) {
  if (state.currentTimeframe === tf) return;
  state.currentTimeframe = tf;
  try { localStorage.setItem('capich_tac_tf', tf); } catch (_) {}

  if (state.ws) {
    try {
      state.ws.onclose = null;
      state.ws.onerror = null;
      state.ws.close();
    } catch (_) {}
    state.ws = null;
  }

  const badgeEl = document.getElementById('tac-ticker-badge');
  const liveDot = document.getElementById('tac-live-dot');
  if (badgeEl) badgeEl.classList.add('connecting');
  if (liveDot) liveDot.title = 'Conectando ao par...';

  const btn15 = document.getElementById('tac-tf-15m');
  const btn1h = document.getElementById('tac-tf-1h');
  const btn1d = document.getElementById('tac-tf-1d');
  if (btn15) btn15.classList.toggle('active', tf === '15m');
  if (btn1h) btn1h.classList.toggle('active', tf === '1h');
  if (btn1d) btn1d.classList.toggle('active', tf === '1d');

  const timerBadge = document.getElementById('tac-candle-timer');
  if (timerBadge) {
    timerBadge.title = `Tempo restante para o fechamento do candle de ${tf}`;
  }
  updateCandleCountdown();

  const shortTitle = tf === '15m' ? 'MMA 32' : 'MMA 8';
  const longTitle  = tf === '15m' ? 'MMA 80' : 'MMA 20';
  const tagsOn = state.maVisible && state.empireTagsVisible;
  if (state.series.mmaShort) {
    state.series.mmaShort.applyOptions({
      title: tagsOn ? shortTitle : '',
      lastValueVisible: tagsOn
    });
  }
  if (state.series.mmaLong) {
    state.series.mmaLong.applyOptions({
      title: tagsOn ? longTitle : '',
      lastValueVisible: tagsOn
    });
  }

  // Bug B fix: recarregar o Fibo salvo para o símbolo atual ao trocar TF
  // O Fibo é salvo por símbolo (não por TF), então p1/p2 em preço×tempo continuam válidos
  loadFiboForSymbol(state.currentSymbol);

  fetchAndRender();
}

export function toggleMovingAverages() {
  state.maVisible = !state.maVisible;
  try { localStorage.setItem('capich_tac_ma', String(state.maVisible)); } catch (_) {}
  const btn = document.getElementById('tac-btn-ma');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.maVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Médias: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Médias: OFF';
    }
  }

  const shortTitle = state.currentTimeframe === '15m' ? 'MMA 32' : 'MMA 8';
  const longTitle  = state.currentTimeframe === '15m' ? 'MMA 80' : 'MMA 20';
  const tagsOn = state.maVisible && state.empireTagsVisible;

  if (state.series.mmaShort) {
    state.series.mmaShort.applyOptions({
      visible: state.maVisible,
      lastValueVisible: tagsOn,
      title: tagsOn ? shortTitle : ''
    });
  }
  if (state.series.mmaLong) {
    state.series.mmaLong.applyOptions({
      visible: state.maVisible,
      lastValueVisible: tagsOn,
      title: tagsOn ? longTitle : ''
    });
  }
}

export function toggleEmpire72h() {
  state.empire72hVisible = !state.empire72hVisible;
  try { localStorage.setItem('capich_tac_empire_72h', String(state.empire72hVisible)); } catch (_) {}
  const btn = document.getElementById('tac-btn-empire-72h');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.empire72hVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Empire 72h: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Empire 72h: OFF';
    }
  }

  if (state.series.vwapBuy) {
    state.series.vwapBuy.applyOptions({ visible: state.empire72hVisible });
  }
  if (state.series.vwapSell) {
    state.series.vwapSell.applyOptions({ visible: state.empire72hVisible });
  }
}

export function toggleEmpire8h() {
  state.empire8hVisible = !state.empire8hVisible;
  try { localStorage.setItem('capich_tac_empire_8h', String(state.empire8hVisible)); } catch (_) {}
  const btn = document.getElementById('tac-btn-empire-8h');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.empire8hVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Empire 8h: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Empire 8h: OFF';
    }
  }

  if (state.series.intraBuy) {
    state.series.intraBuy.applyOptions({ visible: state.empire8hVisible });
  }
  if (state.series.intraSell) {
    state.series.intraSell.applyOptions({ visible: state.empire8hVisible });
  }
}

export function toggleIndicators() {
  state.indicatorsVisible = !state.indicatorsVisible;
  state.empire72hVisible = state.indicatorsVisible;
  state.empire8hVisible = state.indicatorsVisible;
  try {
    localStorage.setItem('capich_tac_ind', String(state.indicatorsVisible));
    localStorage.setItem('capich_tac_empire_72h', String(state.empire72hVisible));
    localStorage.setItem('capich_tac_empire_8h', String(state.empire8hVisible));
  } catch (_) {}
  const btn = document.getElementById('tac-btn-ind');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.indicatorsVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Indicadores: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Indicadores: OFF';
    }
  }
  const btn72 = document.getElementById('tac-btn-empire-72h');
  if (btn72) {
    const span = btn72.querySelector('.tac-dropdown-status');
    if (state.indicatorsVisible) { btn72.classList.add('active'); if (span) span.textContent = 'ON'; }
    else { btn72.classList.remove('active'); if (span) span.textContent = 'OFF'; }
  }
  const btn8 = document.getElementById('tac-btn-empire-8h');
  if (btn8) {
    const span = btn8.querySelector('.tac-dropdown-status');
    if (state.indicatorsVisible) { btn8.classList.add('active'); if (span) span.textContent = 'ON'; }
    else { btn8.classList.remove('active'); if (span) span.textContent = 'OFF'; }
  }

  if (state.series.vwapBuy) {
    state.series.vwapBuy.applyOptions({ visible: state.empire72hVisible });
  }
  if (state.series.vwapSell) {
    state.series.vwapSell.applyOptions({ visible: state.empire72hVisible });
  }
  if (state.series.intraBuy) {
    state.series.intraBuy.applyOptions({ visible: state.empire8hVisible });
  }
  if (state.series.intraSell) {
    state.series.intraSell.applyOptions({ visible: state.empire8hVisible });
  }
  renderEmpireZones();
}

export function toggleEmpireZones72h() {
  state.zones72hVisible = !state.zones72hVisible;
  try { localStorage.setItem('capich_tac_zones_72h', String(state.zones72hVisible)); } catch (_) {}
  const btn = document.getElementById('tac-btn-zones-72h');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.zones72hVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Nuvem 72h: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Nuvem 72h: OFF';
    }
  }
  renderEmpireZones();
}

export function toggleEmpireZones8h() {
  state.zones8hVisible = !state.zones8hVisible;
  try { localStorage.setItem('capich_tac_zones_8h', String(state.zones8hVisible)); } catch (_) {}
  const btn = document.getElementById('tac-btn-zones-8h');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.zones8hVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Nuvem 8h: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Nuvem 8h: OFF';
    }
  }
  renderEmpireZones();
}

export function toggleEmpireZones() {
  state.zonesVisible = !state.zonesVisible;
  state.zones72hVisible = state.zonesVisible;
  state.zones8hVisible = state.zonesVisible;
  try {
    localStorage.setItem('capich_tac_zones', String(state.zonesVisible));
    localStorage.setItem('capich_tac_zones_72h', String(state.zones72hVisible));
    localStorage.setItem('capich_tac_zones_8h', String(state.zones8hVisible));
  } catch (_) {}
  const btn = document.getElementById('tac-btn-zones');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.zonesVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Nuvens: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Nuvens: OFF';
    }
  }
  const btn72 = document.getElementById('tac-btn-zones-72h');
  if (btn72) {
    const span = btn72.querySelector('.tac-dropdown-status');
    if (state.zonesVisible) { btn72.classList.add('active'); if (span) span.textContent = 'ON'; }
    else { btn72.classList.remove('active'); if (span) span.textContent = 'OFF'; }
  }
  const btn8 = document.getElementById('tac-btn-zones-8h');
  if (btn8) {
    const span = btn8.querySelector('.tac-dropdown-status');
    if (state.zonesVisible) { btn8.classList.add('active'); if (span) span.textContent = 'ON'; }
    else { btn8.classList.remove('active'); if (span) span.textContent = 'OFF'; }
  }
  renderEmpireZones();
}

export function toggleEmpireTags() {
  state.empireTagsVisible = !state.empireTagsVisible;
  try { localStorage.setItem('capich_tac_tags', String(state.empireTagsVisible)); } catch (_) {}
  const btn = document.getElementById('tac-btn-tags');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.empireTagsVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Tags: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Tags: OFF';
    }
  }

  const titleStr = state.empireTagsVisible ? 'EMPIRE' : '';
  const opt = {
    lastValueVisible: state.empireTagsVisible,
    title: titleStr
  };

  if (state.series.vwapBuy) state.series.vwapBuy.applyOptions(opt);
  if (state.series.vwapSell) state.series.vwapSell.applyOptions(opt);
  if (state.series.intraBuy) state.series.intraBuy.applyOptions(opt);
  if (state.series.intraSell) state.series.intraSell.applyOptions(opt);

  // Oculta/exibe também as tags (lastValueVisible) das médias móveis
  // Só aplica se as médias estiverem visíveis (maVisible); do contrário, mantém ocultas
  if (state.maVisible) {
    const shortTitle = state.currentTimeframe === '15m' ? 'MMA 32' : 'MMA 8';
    const longTitle  = state.currentTimeframe === '15m' ? 'MMA 80' : 'MMA 20';
    if (state.series.mmaShort) {
      state.series.mmaShort.applyOptions({
        lastValueVisible: state.empireTagsVisible,
        title: state.empireTagsVisible ? shortTitle : ''
      });
    }
    if (state.series.mmaLong) {
      state.series.mmaLong.applyOptions({
        lastValueVisible: state.empireTagsVisible,
        title: state.empireTagsVisible ? longTitle : ''
      });
    }
  }

  renderDefaultLegend();
}

export function togglePriceLine() {
  state.priceLineVisible = !state.priceLineVisible;
  try { localStorage.setItem('capich_tac_priceline', String(state.priceLineVisible)); } catch (_) {}
  if (state.series.candles) {
    state.series.candles.applyOptions({ priceLineVisible: state.priceLineVisible });
  }
  const btn = document.getElementById('tac-btn-priceline');
  if (btn) {
    const statusSpan = btn.querySelector('.tac-dropdown-status');
    if (state.priceLineVisible) {
      btn.classList.add('active');
      if (statusSpan) statusSpan.textContent = 'ON';
      else btn.textContent = 'Linha: ON';
    } else {
      btn.classList.remove('active');
      if (statusSpan) statusSpan.textContent = 'OFF';
      else btn.textContent = 'Linha: OFF';
    }
  }
}
