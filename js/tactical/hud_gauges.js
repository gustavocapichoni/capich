/**
 * js/tactical/hud_gauges.js
 * Painel HUD Inferior: Medidores de Sentimento, Gauges em Canvas (Top 10, Cesta, Fluxo)
 * e Oráculo Quantitativo Institucional.
 */

import { state } from './state.js';

function formatFlowUSD(val) {
  if (!val || isNaN(val)) return '$0';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)} K`;
  return `$${Math.round(abs)}`;
}

function formatFlowBTC(val) {
  if (!val || isNaN(val)) return '0 BTC';
  const abs = Math.abs(val);
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(1)}K BTC`;
  return `${Math.round(abs)} BTC`;
}

export function updateHUD() {
  // ─── 1. ÍNDICES DE MERCADO (TOP 10 GERAL + MEU ÍNDICE PESSOAL) ───
  const t10ValEl = document.getElementById('tac-top10-val');
  const t10ChgEl = document.getElementById('tac-top10-change');
  const t10StEl  = document.getElementById('tac-top10-status');
  if (state.personalBasket && state.personalBasket.top10) {
    const t10 = state.personalBasket.top10;
    if (t10ValEl && t10.val !== null && t10.val !== undefined) {
      t10ValEl.textContent = t10.val.toFixed(2);
    }
    if (t10ChgEl && t10.changePct !== undefined) {
      const sign = t10.changePct > 0 ? '+' : '';
      const color = t10.changePct > 0 ? '#0ecb81' : (t10.changePct < 0 ? '#f6465d' : '#848e9c');
      t10ChgEl.innerHTML = `<span style="color:${color};">${sign}${t10.changePct.toFixed(2)}%</span>`;
    }
    if (t10StEl && t10.statusText) {
      const color = t10.status === 'bull' ? '#0ecb81' : (t10.status === 'bear' ? '#f6465d' : '#eaecef');
      t10StEl.innerHTML = `<span style="color:${color};">${t10.statusText}</span>`;
    }
  }

  // ─── 1.B OI GLOBAL MULTI-EXCHANGE (BTC FUTUROS CONSOLIDADO) ───
  const globalOiValEl   = document.getElementById('tac-global-oi-val');
  const globalOiLongBar = document.getElementById('tac-global-oi-bar-long');
  const globalOiShortBar= document.getElementById('tac-global-oi-bar-short');
  const globalOiLongPct = document.getElementById('tac-global-oi-long-pct');
  const globalOiShortPct= document.getElementById('tac-global-oi-short-pct');

  if (state.globalOi) {
    const totalOiUsd = state.globalOi.totalOiUsd || 0;
    if (globalOiValEl && totalOiUsd > 0) {
      if (totalOiUsd >= 1e9) {
        globalOiValEl.textContent = `$${(totalOiUsd / 1e9).toFixed(2)} B`;
      } else if (totalOiUsd >= 1e6) {
        globalOiValEl.textContent = `$${(totalOiUsd / 1e6).toFixed(2)} M`;
      } else {
        globalOiValEl.textContent = `$${Math.round(totalOiUsd).toLocaleString()}`;
      }
    }

    let longPct = 71.7;
    let shortPct = 28.3;
    if (state.globalOi.longShort) {
      const ls = state.globalOi.longShort;
      const vals = [];
      if (ls.binance && typeof ls.binance.longPct === 'number') vals.push(ls.binance.longPct);
      if (ls.bybit && typeof ls.bybit.longPct === 'number') vals.push(ls.bybit.longPct);
      if (vals.length > 0) {
        longPct = vals.reduce((a, b) => a + b, 0) / vals.length;
        shortPct = 100 - longPct;
      }
    }

    if (globalOiLongBar)  globalOiLongBar.style.width = `${longPct.toFixed(1)}%`;
    if (globalOiShortBar) globalOiShortBar.style.width = `${shortPct.toFixed(1)}%`;
    if (globalOiLongPct)  globalOiLongPct.textContent = `${longPct.toFixed(1)}% Long`;
    if (globalOiShortPct) globalOiShortPct.textContent = `${shortPct.toFixed(1)}% Short`;
  }

  // ─── 2. ORÁCULO QUANTITATIVO: PROBABILIDADE SINTÉTICA + PAR RECOMENDADO ───
  const probPctEl   = document.getElementById('tac-oracle-prob-pct');
  const probBadgeEl = document.getElementById('tac-oracle-badge');
  const probBarEl   = document.getElementById('tac-oracle-bar-fill');
  const probNeedleEl= document.getElementById('tac-oracle-bar-needle');

  if (state.personalBasket && state.personalBasket.oracle) {
    const o = state.personalBasket.oracle;
    const dirScore = (o.pct !== undefined) ? o.pct : ((o.score - 50) * 2);

    if (probPctEl) {
      probPctEl.textContent = `${dirScore > 0 ? '+' : ''}${dirScore}%`;
      probPctEl.style.color = o.color || (dirScore > 0 ? '#0ecb81' : (dirScore < 0 ? '#f6465d' : '#eaecef'));
    }
    if (probBadgeEl) {
      probBadgeEl.textContent = o.verdict || 'NEUTRO';
      probBadgeEl.className = 'tac-oracle-badge ' + (o.badgeClass || 'badge-neutral');
    }

    if (probBarEl && probNeedleEl) {
      const halfWidth = Math.abs(dirScore) / 2;
      if (dirScore >= 0) {
        probBarEl.style.left  = '50%';
        probBarEl.style.width = `${halfWidth}%`;
      } else {
        probBarEl.style.left  = `${50 - halfWidth}%`;
        probBarEl.style.width = `${halfWidth}%`;
      }
      const needlePos = 50 + (dirScore / 2);
      probNeedleEl.style.left = `${needlePos}%`;

      if (dirScore >= 36) {
        probBarEl.style.background = 'linear-gradient(90deg, #107048, #0ecb81)';
      } else if (dirScore >= 12) {
        probBarEl.style.background = 'linear-gradient(90deg, #1f6448, #2ebd85)';
      } else if (dirScore <= -36) {
        probBarEl.style.background = 'linear-gradient(270deg, #f6465d, #b32638)';
      } else if (dirScore <= -12) {
        probBarEl.style.background = 'linear-gradient(270deg, #e05365, #882230)';
      } else {
        probBarEl.style.background = 'rgba(132, 142, 156, 0.4)';
      }
    }

    const bp = o.bestPair;
    const symEl    = document.getElementById('tac-oracle-lead-symbol');
    const setupEl  = document.getElementById('tac-oracle-lead-setup');
    const metricsEl= document.getElementById('tac-oracle-lead-metrics');
    const actionEl = document.getElementById('tac-oracle-lead-action');

    if (bp && symEl) {
      symEl.textContent = `${bp.symbol} / USDT`;
      const isBull = bp.setupName && (bp.setupName.includes('ALTA') || bp.setupName.includes('Long') || bp.setupName.includes('LONG'));
      if (setupEl) {
        setupEl.textContent = bp.setupName || 'Sem setup ativo';
        if (bp.isWaitingSetup) {
          setupEl.className = 'tac-lead-setup-badge badge-neutral';
          setupEl.style.cssText = 'background:rgba(240,185,11,0.15);color:#f0b90b;border:1px solid rgba(240,185,11,0.3);';
        } else if (isBull) {
          setupEl.className = 'tac-lead-setup-badge badge-bull';
          setupEl.style.cssText = '';
        } else {
          setupEl.className = 'tac-lead-setup-badge badge-bear';
          setupEl.style.cssText = '';
        }
      }
      if (metricsEl) {
        const volSignFut = (bp.futBonus || 0) >= 0 ? '+' : '';
        const volSignSpot = (bp.spotBonus || 0) >= 0 ? '+' : '';
        const volColorF = (bp.futBonus || 0) >= 0 ? '#0ecb81' : ((bp.futBonus || 0) < -40 ? '#f6465d' : '#848e9c');
        const volColorS = (bp.spotBonus || 0) >= 0 ? '#0ecb81' : ((bp.spotBonus || 0) < -40 ? '#f6465d' : '#848e9c');
        const distPct = bp.distMma32Pct || 0;
        const distColor = Math.abs(distPct) <= 0.85 ? '#0ecb81' : (Math.abs(distPct) > 2 ? '#f6465d' : '#38bdf8');

        metricsEl.innerHTML = `
          Distância MMA 32: <span style="color:${distColor};font-weight:700;">${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}%</span> · 
          Vol. Spot: <span style="color:${volColorS};font-weight:700;">${volSignSpot}${bp.spotBonus || 0}%</span> · 
          Vol. Futuros: <span style="color:${volColorF};font-weight:700;">${volSignFut}${bp.futBonus || 0}%</span> · 
          Stop Técnico (MMA 80): <span style="color:#eaecef;font-weight:700;">${bp.stopLossPrice || '--'}</span>
        `;
      }
      if (actionEl) {
        actionEl.textContent = bp.actionMsg || '';
      }
    }

    if (o.pillars) {
      const setPillar = (id, val) => {
        const el = document.querySelector(`#${id} .tac-pillar-val`);
        if (el && val) el.textContent = val;
      };
      setPillar('tac-pillar-empire', o.pillars.empire);
      setPillar('tac-pillar-whales', o.pillars.whales);
      setPillar('tac-pillar-taker', o.pillars.taker);
      setPillar('tac-pillar-basket', o.pillars.basket);
      setPillar('tac-pillar-leverage', o.pillars.leverage);
      setPillar('tac-pillar-sentiment', o.pillars.sentiment);
    }
  }

  // ─── 3. DINHEIRO DOS TUBARÕES / INSTITUCIONAL (OPEN INTEREST) ───
  const oiValEl = document.getElementById('tac-oi-val');
  const oiDeltaEl = document.getElementById('tac-oi-delta-desc');
  const oiBarFill = document.getElementById('tac-oi-bar-fill');
  const oiDeltaPctEl = document.getElementById('tac-oi-delta-pct');

  if (oiValEl && state.oi) {
    const oiUsd = state.oi.openInterestUsd || 0;
    let usdStr = '$0';
    if (oiUsd >= 1e9) usdStr = '$' + (oiUsd / 1e9).toFixed(2) + ' B';
    else if (oiUsd >= 1e6) usdStr = '$' + (oiUsd / 1e6).toFixed(1) + ' M';
    else usdStr = '$' + Math.round(oiUsd).toLocaleString();

    oiValEl.innerHTML = `<span>${usdStr}</span> <span style="font-size:10px;color:var(--tac-text-muted);font-weight:500;">em jogo</span>`;

    const deltaUsd = state.oi.deltaOiUsd || 0;
    const deltaPct = oiUsd > 0 ? (deltaUsd / oiUsd) * 100 : 0;

    // Barra de medição bidirecional do Delta do OI (Saída 🔴 | Neutro ⚪ | Entrada 🟢)
    if (oiBarFill) {
      if (deltaUsd === 0) {
        oiBarFill.style.left = '50%';
        oiBarFill.style.width = '0%';
      } else {
        // Sensibilidade tática: 2.0% de variação no OI preenche toda a metade (50%)
        const ratio = Math.min(1, Math.abs(deltaPct) / 2.0);
        const fillWidth = Math.max(3.5, ratio * 50);

        if (deltaUsd > 0) {
          oiBarFill.style.left = '50%';
          oiBarFill.style.width = `${fillWidth}%`;
          oiBarFill.style.background = 'linear-gradient(90deg, #107048, #0ecb81)';
        } else {
          oiBarFill.style.left = `${50 - fillWidth}%`;
          oiBarFill.style.width = `${fillWidth}%`;
          oiBarFill.style.background = 'linear-gradient(270deg, #f6465d, #b32638)';
        }
      }
    }

    if (oiDeltaPctEl) {
      if (deltaUsd !== 0) {
        const sign = deltaPct > 0 ? '+' : '';
        oiDeltaPctEl.textContent = `${sign}${deltaPct.toFixed(2)}% OI`;
        oiDeltaPctEl.style.color = deltaUsd > 0 ? '#0ecb81' : '#f6465d';
      } else {
        oiDeltaPctEl.textContent = '0.00% OI';
        oiDeltaPctEl.style.color = '#848e9c';
      }
    }

    if (oiDeltaEl) {
      let deltaFmt = '';
      if (Math.abs(deltaUsd) >= 1e6) deltaFmt = '$' + (Math.abs(deltaUsd) / 1e6).toFixed(2) + 'M';
      else if (Math.abs(deltaUsd) >= 1e3) deltaFmt = '$' + (Math.abs(deltaUsd) / 1e3).toFixed(1) + 'K';
      else deltaFmt = '$' + Math.round(Math.abs(deltaUsd));

      const lastC = state.candles.length ? state.candles[state.candles.length - 1] : null;
      const isPriceFalling = lastC ? (lastC.close < lastC.open) : false;

      if (deltaUsd > 0) {
        if (isPriceFalling) {
          oiDeltaEl.innerHTML = `<span style="color:#f6465d;">▲ +${deltaFmt} entrando (Venda pesada)</span>`;
        } else {
          oiDeltaEl.innerHTML = `<span style="color:#0ecb81;">▲ +${deltaFmt} entrando (Compra com força)</span>`;
        }
      } else if (deltaUsd < 0) {
        if (isPriceFalling) {
          oiDeltaEl.innerHTML = `<span style="color:#0ecb81;">▼ -${deltaFmt} saindo (Sardinhas estopadas / Repique)</span>`;
        } else {
          oiDeltaEl.innerHTML = `<span style="color:#f6465d;">▼ -${deltaFmt} saindo (Subida oca / Short squeeze)</span>`;
        }
      } else {
        oiDeltaEl.innerHTML = `<span style="color:#848e9c;">• Volume em posição estável</span>`;
      }
    }
  }

  // ─── 3.B FLUXO CEX: 4 BARRAS INDIVIDUAIS (DÓLAR & BITCOIN 24H) ───
  const barUsdIn   = document.getElementById('tac-bar-usd-in');
  const barUsdOut  = document.getElementById('tac-bar-usd-out');
  const valUsdIn   = document.getElementById('tac-val-usd-in');
  const valUsdOut  = document.getElementById('tac-val-usd-out');

  const barBtcIn   = document.getElementById('tac-bar-btc-in');
  const barBtcOut  = document.getElementById('tac-bar-btc-out');
  const valBtcIn   = document.getElementById('tac-val-btc-in');
  const valBtcOut  = document.getElementById('tac-val-btc-out');

  if (barUsdIn && barUsdOut && state.personalBasket && state.personalBasket.cexFlow) {
    const cf = state.personalBasket.cexFlow;
    const uIn  = Math.max(0, cf.usdIn || 0);
    const uOut = Math.max(0, cf.usdOut || 0);

    // Escala dinâmica calibrada pela régua: base de $5B com headroom se ultrapassar
    const maxUsd = Math.max(5e9, uIn, uOut);
    if (maxUsd > 0) {
      const uInPct  = Math.min(100, Math.round((uIn / maxUsd) * 100));
      const uOutPct = Math.min(100, Math.round((uOut / maxUsd) * 100));
      barUsdIn.style.width  = `${Math.max(uIn > 0 ? 3 : 0, uInPct)}%`;
      barUsdOut.style.width = `${Math.max(uOut > 0 ? 3 : 0, uOutPct)}%`;
      if (valUsdIn)  valUsdIn.textContent  = `+${formatFlowUSD(uIn)}`;
      if (valUsdOut) valUsdOut.textContent = `-${formatFlowUSD(uOut)}`;
    }

    const bIn  = Math.max(0, cf.btcIn || 0);
    const bOut = Math.max(0, cf.btcOut || 0);

    // Escala dinâmica calibrada pela régua: base de 50.000 BTC com headroom se ultrapassar
    const maxBtc = Math.max(50000, bIn, bOut);
    if (maxBtc > 0) {
      const bInPct  = Math.min(100, Math.round((bIn / maxBtc) * 100));
      const bOutPct = Math.min(100, Math.round((bOut / maxBtc) * 100));
      barBtcIn.style.width  = `${Math.max(bIn > 0 ? 3 : 0, bInPct)}%`;
      barBtcOut.style.width = `${Math.max(bOut > 0 ? 3 : 0, bOutPct)}%`;
      if (valBtcIn)  valBtcIn.textContent  = `+${formatFlowBTC(bIn)}`;
      if (valBtcOut) valBtcOut.textContent = `-${formatFlowBTC(bOut)}`;
    }
  }

  // ─── 4. POSIÇÃO DOS TUBARÕES (TOP TRADERS) ───
  const topLongEl   = document.getElementById('tac-top-long');
  const topShortEl  = document.getElementById('tac-top-short');
  const topLongText = document.getElementById('tac-top-long-text');
  const topShortText= document.getElementById('tac-top-short-text');
  const topDescEl   = document.getElementById('tac-top-desc');
  if (topLongEl && topShortEl && state.oi) {
    const tl = state.oi.topLongPct || 50;
    const ts = state.oi.topShortPct || 50;
    topLongEl.style.width  = tl + '%';
    topShortEl.style.width = ts + '%';
    if (topLongText) topLongText.textContent = `${tl}% Volume Long`;
    if (topShortText) topShortText.textContent = `${ts}% Volume Short`;

    if (topDescEl) {
      const ml = state.oi.longPct || 50;
      const ms = state.oi.shortPct || 50;
      if (ml >= 62 && ts >= 52) {
        topDescEl.innerHTML = '<span style="color:#f6465d;">🚨 DIVERGÊNCIA: Tubarões em Short vs Manada eufórica em Alta!</span>';
      } else if (ms >= 60 && tl >= 55) {
        topDescEl.innerHTML = '<span style="color:#0ecb81;">🔥 ABSORÇÃO: Tubarões em Long absorvendo o pânico da manada!</span>';
      } else if (tl >= 65) {
        topDescEl.innerHTML = '<span style="color:#0ecb81;">🦈 Tubarões fortemente posicionados em Alta (Long)</span>';
      } else if (ts >= 65) {
        topDescEl.innerHTML = '<span style="color:#f6465d;">🦈 Tubarões fortemente posicionados em Baixa (Short)</span>';
      } else {
        topDescEl.innerHTML = '<span style="color:#848e9c;">⚖️ Tubarões com exposição equilibrada</span>';
      }
    }
  }

  // ─── 5. ONDE ESTÁ A MANADA? (SARDINHAS LONG/SHORT) ───
  const lsLongEl   = document.getElementById('tac-ls-long');
  const lsShortEl  = document.getElementById('tac-ls-short');
  const lsLongText = document.getElementById('tac-ls-long-text');
  const lsShortText= document.getElementById('tac-ls-short-text');
  const lsTrapEl   = document.getElementById('tac-ls-trap-desc');
  if (lsLongEl && lsShortEl && state.oi) {
    const l = state.oi.longPct || 50;
    const s = state.oi.shortPct || 50;
    lsLongEl.style.width  = l + '%';
    lsShortEl.style.width = s + '%';
    if (lsLongText) lsLongText.textContent = `${l}% Apostando Alta`;
    if (lsShortText) lsShortText.textContent = `${s}% Apostando Baixa`;

    if (lsTrapEl) {
      const fr = (state.oi.fundingRate || 0) * 100;
      let frTag = '';
      if (fr > 0.02) frTag = ' <span style="color:#f0b90b;">(🔥 Taxa cara)</span>';
      else if (fr < -0.01) frTag = ' <span style="color:#38b6ff;">(❄️ Taxa negativa)</span>';

      if (l >= 62) {
        lsTrapEl.innerHTML = `<span style="color:#f6465d;">⚠️ Manada comprada! Cuidado com despejo.${frTag}</span>`;
      } else if (s >= 62) {
        lsTrapEl.innerHTML = `<span style="color:#0ecb81;">🔥 Pânico! Sardinhas vendendo no fundo.${frTag}</span>`;
      } else {
        lsTrapEl.innerHTML = `<span style="color:#848e9c;">⚖️ Manada dividida meio a meio.${frTag}</span>`;
      }
    }
  }

  // ─── 5. QUEM ESTÁ AGREDINDO AGORA? (TAKER 5M) ───
  const tkLongEl   = document.getElementById('tac-taker-long');
  const tkShortEl  = document.getElementById('tac-taker-short');
  const tkBuyText  = document.getElementById('tac-taker-buy-text');
  const tkSellText = document.getElementById('tac-taker-sell-text');
  const tkDescEl   = document.getElementById('tac-taker-desc');
  if (tkLongEl && tkShortEl && state.oi) {
    const b = state.oi.takerBuyPct || 50;
    const s = state.oi.takerSellPct || 50;
    tkLongEl.style.width  = b + '%';
    tkShortEl.style.width = s + '%';
    if (tkBuyText) tkBuyText.textContent = `Compradores ${b}%`;
    if (tkSellText) tkSellText.textContent = `Vendedores ${s}%`;

    if (tkDescEl) {
      if (s >= 56) {
        tkDescEl.innerHTML = '<span style="color:#f6465d;">🔴 Vendedores agredindo mais forte</span>';
      } else if (b >= 56) {
        tkDescEl.innerHTML = '<span style="color:#0ecb81;">🟢 Compradores engolindo a mercado</span>';
      } else {
        tkDescEl.innerHTML = '<span style="color:#848e9c;">⚖️ Agressão momentânea equilibrada</span>';
      }
    }
  }

  // ─── 6. GAUGES EM CANVAS: TOP 10 + MEU ÍNDICE PESSOAL + O FLUXO INSTITUCIONAL ───
  drawTop10Gauge();
  drawBasketGauge();
  drawTruckGauge();

  // ─── 7. ATUALIZAÇÃO REATIVA DO GUIA MESTRE (SE ESTIVER ABERTO) ───
  if (typeof window._updateAdvisorIfOpen === 'function') {
    window._updateAdvisorIfOpen();
  }
}

// 6a. Índice Top 10 (Maré Geral vs MMA 80)
export function drawTop10Gauge() {
  const canvas = document.getElementById('tac-top10-canvas');
  if (!canvas) return;

  const t10 = (state.personalBasket && state.personalBasket.top10) || {};
  let diff = (typeof t10.diffMma80 === 'number') ? t10.diffMma80 : 0;
  if (diff === 0 && t10.val && t10.sma80) {
    diff = ((t10.val - t10.sma80) / t10.sma80) * 100;
  }

  const dpr  = window.devicePixelRatio || 1;
  const w    = canvas.clientWidth || 230;
  const h    = 34;

  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const cx       = w / 2.0;
  const barTop   = 16;
  const barH     = 8;
  const maxScale = 4.0;
  const clamped  = Math.max(-maxScale, Math.min(maxScale, diff));
  const barLen   = (clamped / maxScale) * (w / 2.0);
  const tipX     = cx + barLen;

  for (let val = -4; val <= 4; val++) {
    const tickX   = cx + (val / maxScale) * (w / 2.0);
    const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
    ctx.fillStyle = val === 0 ? '#eaecef' : isMajor ? '#4a5568' : '#283245';
    ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);
  }

  if (barLen > 0) {
    ctx.fillStyle = 'rgba(14, 203, 129, 0.75)';
    ctx.fillRect(cx, barTop, barLen, barH);
    ctx.fillStyle = '#0ecb81';
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  } else if (barLen < 0) {
    ctx.fillStyle = 'rgba(246, 70, 93, 0.75)';
    ctx.fillRect(cx + barLen, barTop, -barLen, barH);
    ctx.fillStyle = '#f6465d';
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

  ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#f6465d';
  ctx.textAlign = 'left';
  ctx.fillText('-4%', 4, h - 1);

  ctx.fillStyle = '#0ecb81';
  ctx.textAlign = 'right';
  ctx.fillText('+4%', w - 4, h - 1);

  ctx.fillStyle = '#848e9c';
  ctx.textAlign = 'center';
  ctx.fillText('MMA 80', cx, h - 1);

  const badgeValStr = (diff > 0 ? "+" : "") + diff.toFixed(2) + "%";
  const badgeColor  = diff > 0.05 ? "#0ecb81" : (diff < -0.05 ? "#f6465d" : "#848e9c");
  ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
  const textW = ctx.measureText(badgeValStr).width;
  const badgeW = Math.max(textW + 8, 44);
  const badgeH = 12;
  const badgeY = 1;
  const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

  ctx.fillStyle = '#0c1017';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
  else ctx.rect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
  ctx.fill();

  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

  ctx.restore();
}

// 6b. Meu Índice Pessoal (Cesta 5 Pares)
export function drawBasketGauge() {
  const canvas  = document.getElementById('tac-basket-canvas');
  const labelEl = document.getElementById('tac-basket-label');
  const scoreEl = document.getElementById('tac-basket-score');
  if (!canvas) return;

  const basket = state.personalBasket || {};
  const avgDiff = typeof basket.avgDiff === 'number' ? basket.avgDiff : 0;

  if (labelEl) {
    const color = basket.statusColor || '#848e9c';
    const text = basket.statusText || `${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(2)}%`;
    labelEl.innerHTML = `<span style="color:${color};font-weight:700;">${text}</span>`;
  }

  if (scoreEl) {
    scoreEl.innerHTML = basket.scoreboard || 'Calculando cesta...';
  }

  const dpr  = window.devicePixelRatio || 1;
  const w    = canvas.clientWidth || 230;
  const h    = 34;

  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const cx       = w / 2.0;
  const barTop   = 16;
  const barH     = 8;
  const maxScale = 4.0;
  const clamped  = Math.max(-maxScale, Math.min(maxScale, avgDiff));
  const barLen   = (clamped / maxScale) * (w / 2.0);
  const tipX     = cx + barLen;

  for (let val = -4; val <= 4; val++) {
    const tickX   = cx + (val / maxScale) * (w / 2.0);
    const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
    ctx.fillStyle = val === 0 ? '#eaecef' : isMajor ? '#4a5568' : '#283245';
    ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);
  }

  if (barLen > 0) {
    ctx.fillStyle = 'rgba(14, 203, 129, 0.75)';
    ctx.fillRect(cx, barTop, barLen, barH);
    ctx.fillStyle = '#0ecb81';
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  } else if (barLen < 0) {
    ctx.fillStyle = 'rgba(246, 70, 93, 0.75)';
    ctx.fillRect(cx + barLen, barTop, -barLen, barH);
    ctx.fillStyle = '#f6465d';
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

  ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#f6465d';
  ctx.textAlign = 'left';
  ctx.fillText('-4%', 4, h - 1);

  ctx.fillStyle = '#0ecb81';
  ctx.textAlign = 'right';
  ctx.fillText('+4%', w - 4, h - 1);

  ctx.fillStyle = '#848e9c';
  ctx.textAlign = 'center';
  ctx.fillText('MMA 32', cx, h - 1);

  const badgeValStr = (avgDiff > 0 ? "+" : "") + avgDiff.toFixed(2) + "%";
  const badgeColor  = avgDiff > 0.05 ? "#0ecb81" : (avgDiff < -0.05 ? "#f6465d" : "#848e9c");
  ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
  const textW = ctx.measureText(badgeValStr).width;
  const badgeW = Math.max(textW + 8, 44);
  const badgeH = 12;
  const badgeY = 1;
  const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

  ctx.fillStyle = '#0c1017';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
  else ctx.rect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
  ctx.fill();

  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

  ctx.restore();
}

// 6c. O Fluxo (Dinheiro Pesado Institucional)
export function drawTruckGauge() {
  const canvas  = document.getElementById('tac-truck-canvas');
  const labelEl = document.getElementById('tac-truck-label');
  if (!canvas) return;

  const lastCandle  = state.candles.length ? state.candles[state.candles.length - 1] : null;
  const isFalling   = lastCandle ? (lastCandle.close < lastCandle.open) : false;
  const isRising    = lastCandle ? (lastCandle.close > lastCandle.open) : false;
  const isEmpireBuy = lastCandle ? !!lastCandle.isAccum : false;
  const deltaUsd    = (state.oi && state.oi.deltaOiUsd) || 0;

  if (labelEl) {
    if (isFalling && isEmpireBuy) {
      labelEl.innerHTML = `<span style="color:#0ecb81;">🌊🚨 ACÚMULO FORTE: Preço caindo, mas Tubarão enchendo a mão no fundo!</span>`;
    } else if (isRising && !isEmpireBuy) {
      labelEl.innerHTML = `<span style="color:#f6465d;">🌊⚠️ DESPEJO FORTE: Preço subindo, mas tão descarregando na cabeça da manada!</span>`;
    } else if (isEmpireBuy) {
      labelEl.innerHTML = `<span style="color:#0ecb81;">🌊🟢 FLUXO INSTITUCIONAL: Tubarões acumulando a favor da alta!</span>`;
    } else {
      labelEl.innerHTML = `<span style="color:#f6465d;">🌊🔴 FLUXO INSTITUCIONAL: Tubarões desovando contratos na baixa!</span>`;
    }
  }

  const dpr  = window.devicePixelRatio || 1;
  const w    = canvas.clientWidth || 260;
  const h    = 34;

  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2.0;
  const barTop = 16;
  const barH = 8;

  let flowScore = 0;
  if (isEmpireBuy) flowScore += 2.0; else flowScore -= 2.0;
  if (deltaUsd > 0) {
    flowScore += (isFalling ? -1.5 : 1.5);
  } else if (deltaUsd < 0) {
    flowScore += (isFalling ? 1.5 : -1.5);
  }
  const maxScore = 4.0;
  const clamped = Math.max(-maxScore, Math.min(maxScore, flowScore));
  const barLen = (clamped / maxScore) * (w / 2.0);
  const tipX = cx + barLen;

  for (let val = -4; val <= 4; val++) {
    const tickX   = cx + (val / maxScore) * (w / 2.0);
    const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
    ctx.fillStyle = val === 0 ? '#eaecef' : isMajor ? '#4a5568' : '#283245';
    ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);
  }

  if (barLen > 0) {
    ctx.fillStyle = 'rgba(14, 203, 129, 0.70)';
    ctx.fillRect(cx, barTop, barLen, barH);
    ctx.fillStyle = '#0ecb81';
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  } else if (barLen < 0) {
    ctx.fillStyle = 'rgba(246, 70, 93, 0.70)';
    ctx.fillRect(cx + barLen, barTop, -barLen, barH);
    ctx.fillStyle = '#f6465d';
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

  ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#f6465d';
  ctx.textAlign = 'left';
  ctx.fillText('◄ DESPEJO', 6, h - 1);

  ctx.fillStyle = '#0ecb81';
  ctx.textAlign = 'right';
  ctx.fillText('ACÚMULO ►', w - 6, h - 1);

  ctx.fillStyle = '#848e9c';
  ctx.textAlign = 'center';
  ctx.fillText('0 (NEUTRO)', cx, h - 1);

  const flowPct = clamped;
  const badgeValStr = (flowPct > 0 ? "+" : "") + flowPct.toFixed(2) + "%";
  const badgeColor  = flowPct > 0.05 ? "#0ecb81" : (flowPct < -0.05 ? "#f6465d" : "#848e9c");
  ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
  const textW = ctx.measureText(badgeValStr).width;
  const badgeW = Math.max(textW + 8, 44);
  const badgeH = 12;
  const badgeY = 1;
  const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

  ctx.fillStyle = '#0c1017';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
  else ctx.rect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
  ctx.fill();

  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

  ctx.restore();
}
