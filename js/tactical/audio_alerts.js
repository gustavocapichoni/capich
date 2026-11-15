/**
 * js/tactical/audio_alerts.js
 * Gerenciamento de notificações sonoras via Web Audio API e monitoramento de alvo 2.618 do Fibonacci.
 * Alarme sonoro contínuo e rearme inteligente sem desativar a ferramenta.
 */

import { state, formatPrice } from './state.js';

// ─── Web Audio API Nativa (Sintetizador Harmônico de Alta Fidelidade) ────────
let _tacAudioCtx = null;
let _tacAlertInterval = null;

function _getAudioContext() {
  if (!_tacAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      _tacAudioCtx = new AudioContextClass();
    }
  }
  if (_tacAudioCtx && _tacAudioCtx.state === 'suspended') {
    _tacAudioCtx.resume().catch(() => {});
  }
  return _tacAudioCtx;
}

// Desbloqueia a política de áudio do navegador no primeiro clique ou toque
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    _getAudioContext();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

// Emite bip duplo harmônico estilo alarme de terminal financeiro
function _playBeepChord() {
  try {
    const ctx = _getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Bips em frequência 880Hz (Lá) e 1175Hz (Ré agudo)
    const notes = [880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);

      gain.gain.setValueAtTime(0.28, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.18);
    });
  } catch (e) {
    console.warn('[Audio Alert] Erro ao sintetizar som:', e);
  }
}

export function tacPlayAlert() {
  if (_tacAlertInterval) return; // Já está tocando
  _playBeepChord();
  _tacAlertInterval = setInterval(_playBeepChord, 800); // Repete a cada 800ms
}

export function tacStopAlert() {
  if (_tacAlertInterval) {
    clearInterval(_tacAlertInterval);
    _tacAlertInterval = null;
  }
}

// ─── Monitoramento & Rearme Inteligente do Alvo 2.618 ───────────────────────

function _checkSingleFiboAlert(f, fiboNum, currentPrice) {
  if (!f || !f.active || !f.p1 || !f.p2 || f.drawing) return;
  if (!currentPrice || currentPrice <= 0 || !f.p1.price || !f.p2.price) return;

  // Proteção de sanidade: evita comparar com ativo diferente (ex: trocou de par mas preço ainda não atualizou)
  const ratio1 = f.p1.price / currentPrice;
  const ratio2 = f.p2.price / currentPrice;
  if (ratio1 > 3.5 || ratio1 < 0.28 || ratio2 > 3.5 || ratio2 < 0.28) return;

  const level2618 = f.p1.price + (f.p2.price - f.p1.price) * 2.618;
  if (!f.alert2618) {
    f.alert2618 = { armed: false, triggered: false, soundActive: false, approachDir: null };
  }
  const a = f.alert2618;

  // 1. Se já disparou (ou foi silenciado pelo usuário): verifica se o preço afastou da zona de teste para REARMAR
  if (a.triggered) {
    // Zona de tolerância sensível (0.12% — ex: ~$90 no BTC ou ~$0.008 no UNI)
    const retraced = a.approachDir === 'up'
      ? (currentPrice < level2618 * 0.9988) // Subia: recuou 0.12% abaixo do 2.618 = REARMA
      : (currentPrice > level2618 * 1.0012); // Descia: subiu 0.12% acima do 2.618 = REARMA

    if (retraced) {
      a.triggered = false;
      a.armed = false;
      a.approachDir = null;
      a.soundActive = false;
      tacStopAlert();
      renderFiboAlertBadge(false, null);
    }
    return;
  }

  // 2. Primeira identificação de aproximação: arma a direção
  if (!a.armed) {
    if (currentPrice < level2618) {
      a.approachDir = 'up';   // Preço está abaixo: espera subir e testar 2.618
      a.armed = true;
    } else if (currentPrice > level2618) {
      a.approachDir = 'down'; // Preço está acima: espera descer e testar 2.618
      a.armed = true;
    }
    return;
  }

  // 3. Verificação de toque ou cruzamento do nível
  if (a.armed && !a.triggered) {
    const crossed = a.approachDir === 'up'
      ? (currentPrice >= level2618)
      : (currentPrice <= level2618);

    if (crossed) {
      a.triggered = true;
      a.soundActive = true;
      a.armed = false;
      tacPlayAlert();
      renderFiboAlertBadge(true, level2618, fiboNum);
    }
  }
}

// Verifica todos os Fibos ativos
export function checkFiboAlert(currentPrice) {
  if (Array.isArray(state.fibos)) {
    state.fibos.forEach((f, idx) => {
      _checkSingleFiboAlert(f, idx + 1, currentPrice);
    });
  }
  _checkSingleFiboAlert(state.fibo, 1, currentPrice);
  _checkSingleFiboAlert(state.fibo2, 2, currentPrice);

  // Verifica alertas de preço personalizado do usuário
  checkPriceAlerts(currentPrice);
}

// ─── Alertas de Preço Personalizados (Price Alert) ───────────────────────────

// Array de alertas: [{ id, targetPrice, direction: 'above'|'below', triggered, label }]
export const priceAlerts = [];

let _priceAlertSoundActive = false;

function _playPriceAlertSound() {
  // Som ligeiramente diferente do Fibo — usa frequências mais agudas (sirene de alerta)
  try {
    const ctx = _getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Três bips ascendentes rápidos
    const notes = [880, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.09);
      gain.gain.setValueAtTime(0.32, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.16);
    });
  } catch (e) {
    console.warn('[PriceAlert] Erro ao sintetizar som:', e);
  }
}

let _priceAlertInterval = null;

function _startPriceAlertSound() {
  if (_priceAlertInterval) return;
  _playPriceAlertSound();
  _priceAlertInterval = setInterval(_playPriceAlertSound, 900);
  _priceAlertSoundActive = true;
}

export function stopPriceAlertSound() {
  if (_priceAlertInterval) {
    clearInterval(_priceAlertInterval);
    _priceAlertInterval = null;
  }
  _priceAlertSoundActive = false;
}

export function checkPriceAlerts(currentPrice) {
  if (!currentPrice || currentPrice <= 0 || !priceAlerts.length) return;
  let anyTriggered = false;

  priceAlerts.forEach(alert => {
    if (alert.triggered) return;
    const hit = alert.direction === 'above'
      ? currentPrice >= alert.targetPrice
      : currentPrice <= alert.targetPrice;

    if (hit) {
      alert.triggered = true;
      anyTriggered = true;
      _startPriceAlertSound();
      renderPriceAlertBadge(alert);
    }
  });
}

export function addPriceAlert(targetPrice, label) {
  if (!targetPrice || isNaN(targetPrice) || targetPrice <= 0) return null;
  const currentPrice = state.currentPrice || 0;
  const direction = targetPrice > currentPrice ? 'above' : 'below';
  const id = `pa_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
  const alert = { id, targetPrice, direction, triggered: false, label: label || '' };
  priceAlerts.push(alert);
  updatePriceAlertButton();
  return alert;
}

export function removePriceAlert(id) {
  const idx = priceAlerts.findIndex(a => a.id === id);
  if (idx !== -1) priceAlerts.splice(idx, 1);
  if (!priceAlerts.some(a => !a.triggered)) stopPriceAlertSound();
  if (!priceAlerts.length) renderPriceAlertBadge(null);
  updatePriceAlertButton();
}

export function clearAllPriceAlerts() {
  priceAlerts.length = 0;
  stopPriceAlertSound();
  renderPriceAlertBadge(null);
  updatePriceAlertButton();
}

export function updatePriceAlertButton() {
  const btn = document.getElementById('tac-btn-price-alert');
  const status = document.getElementById('tac-status-price-alert');
  if (!btn) return;
  const active = priceAlerts.some(a => !a.triggered);
  const triggered = priceAlerts.some(a => a.triggered);
  if (triggered) {
    btn.className = 'tac-dropdown-item tac-btn-price-alert triggered';
    if (status) status.textContent = 'ALERTA!';
  } else if (active) {
    btn.className = 'tac-dropdown-item tac-btn-price-alert active';
    if (status) status.textContent = `${priceAlerts.length} ATIVO${priceAlerts.length > 1 ? 'S' : ''}`;
  } else {
    btn.className = 'tac-dropdown-item tac-btn-price-alert';
    if (status) status.textContent = 'OFF';
  }
}

export function renderPriceAlertBadge(alert) {
  // Remove badge anterior
  const old = document.getElementById('tac-price-alert-badge');
  if (old) old.remove();
  if (!alert) return;

  const badge = document.createElement('div');
  badge.id = 'tac-price-alert-badge';

  const dir = alert.direction === 'above' ? '📈 SUBIU ATÉ' : '📉 CAIU ATÉ';
  const fmtPrice = Number(alert.targetPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const labelTxt = alert.label ? ` · ${alert.label}` : '';

  badge.style.cssText = `
    position:fixed; top:14px; left:50%; transform:translateX(-50%);
    background:linear-gradient(135deg, #af0000, #ff4444);
    color:#ffffff; font-weight:800; font-size:13px;
    padding:8px 22px; border-radius:8px; z-index:99999;
    box-shadow:0 0 26px rgba(255,68,68,0.75);
    display:flex; align-items:center; gap:12px; cursor:pointer;
    animation: tacPriceBlink 0.5s infinite alternate;
    user-select:none; white-space:nowrap;
  `;

  if (!document.head.querySelector('#tac-price-alert-style')) {
    const style = document.createElement('style');
    style.id = 'tac-price-alert-style';
    style.textContent = `
      @keyframes tacPriceBlink {
        from { opacity:1; transform:translateX(-50%) scale(1); }
        to   { opacity:0.72; transform:translateX(-50%) scale(0.98); }
      }
    `;
    document.head.appendChild(style);
  }

  badge.innerHTML = `🔔 <strong>ALERTA DE PREÇO${labelTxt}</strong>&nbsp;${dir} <strong>${fmtPrice}</strong>&nbsp;<span style="font-size:11px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:4px;">Clique para silenciar</span>`;

  badge.addEventListener('click', () => {
    stopPriceAlertSound();
    renderPriceAlertBadge(null);
    updatePriceAlertButton();
  });

  document.body.appendChild(badge);
}

// ─── Badge Visual Flutuante de Alerta ────────────────────────────────────────
export function renderFiboAlertBadge(active, level, fiboNum = 1) {
  let badge = document.getElementById('tac-fibo-alert-badge');
  if (!active) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'tac-fibo-alert-badge';
    badge.style.cssText = `
      position:fixed; top:14px; left:50%; transform:translateX(-50%);
      background:linear-gradient(135deg, #f0b90b, #ff9800);
      color:#0b0e11; font-weight:800; font-size:13px;
      padding:8px 22px; border-radius:8px; z-index:99999;
      box-shadow:0 0 26px rgba(240, 185, 11, 0.75);
      display:flex; align-items:center; gap:12px; cursor:pointer;
      animation: tacFiboBlink 0.6s infinite alternate;
      user-select:none;
    `;

    // Silencia o som e fecha a notificação visual do momento
    badge.addEventListener('click', () => {
      tacStopAlert();
      renderFiboAlertBadge(false, null);
      if (state.fibo?.alert2618) {
        state.fibo.alert2618.soundActive = false;
      }
      if (state.fibo2?.alert2618) {
        state.fibo2.alert2618.soundActive = false;
      }
    });

    if (!document.head.querySelector('#tac-fibo-alert-style')) {
      const style = document.createElement('style');
      style.id = 'tac-fibo-alert-style';
      style.textContent = `@keyframes tacFiboBlink { from { opacity:1; transform:translateX(-50%) scale(1); } to { opacity:0.65; transform:translateX(-50%) scale(0.98); } }`;
      document.head.appendChild(style);
    }
    document.body.appendChild(badge);
  }

  const fmtLevel = formatPrice(level);
  badge.innerHTML = `🔔 <strong>FIBO ${fiboNum} · ALVO 2.618 ATINGIDO!</strong> &nbsp;${state.baseAsset}/USDT @ ${fmtLevel} &nbsp;<span style="font-size:11px; background:rgba(0,0,0,0.25); padding:2px 8px; border-radius:4px; margin-left:6px;">Clique para silenciar</span>`;
}
