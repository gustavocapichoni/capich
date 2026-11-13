/**
 * js/tactical/advisor.js
 * Guia Mestre de Leitura & Recomendações Dinâmicas (Advisory Engine)
 * Analisa a confluência em 3 camadas: Macro + Guerra de Derivativos + Ação do Preço nas Médias/EMPIRE.
 */

import { state, formatPrice } from './state.js';

let isDrawerOpen = false;

export function updateAdvisorIfOpen() {
  if (isDrawerOpen) {
    renderAdvisorContent();
  }
}

export function toggleAdvisor() {
  if (isDrawerOpen) {
    closeAdvisor();
  } else {
    openAdvisor();
  }
}

export function openAdvisor() {
  const drawer = document.getElementById('tac-advisor-drawer');
  const backdrop = document.getElementById('tac-advisor-backdrop');
  if (!drawer) return;

  renderAdvisorContent();

  drawer.style.transform = 'translateX(0)';
  if (backdrop) backdrop.style.display = 'block';
  isDrawerOpen = true;
}

export function closeAdvisor() {
  const drawer = document.getElementById('tac-advisor-drawer');
  const backdrop = document.getElementById('tac-advisor-backdrop');
  if (!drawer) return;

  drawer.style.transform = 'translateX(100%)';
  if (backdrop) backdrop.style.display = 'none';
  isDrawerOpen = false;
}

/**
 * Motor Quantitativo de Análise Diagnóstica em Tempo Real
 */
export function generateMarketDiagnosis() {
  const symbol = state.currentSymbol || 'BTCUSDT';
  const tf = state.currentTimeframe || '15m';
  const base = state.baseAsset || 'BTC';

  // Último candle e métricas
  const candles = state.candles || [];
  const lastC = candles.length ? candles[candles.length - 1] : null;
  const currentPrice = lastC ? lastC.close : 0;

  // Médias
  const mmaShort = lastC?.mmaShort || 0;
  const mmaLong = lastC?.mmaLong || 0;
  const shortLabel = tf === '15m' ? 'MMA 32' : 'MMA 8';
  const longLabel = tf === '15m' ? 'MMA 80' : 'MMA 20';

  const distShortPct = (mmaShort > 0 && currentPrice > 0) ? ((currentPrice - mmaShort) / mmaShort) * 100 : 0;
  const distLongPct = (mmaLong > 0 && currentPrice > 0) ? ((currentPrice - mmaLong) / mmaLong) * 100 : 0;
  const isAboveLong = currentPrice > mmaLong;
  const isAboveShort = currentPrice > mmaShort;
  const isNearShort = Math.abs(distShortPct) <= 0.85;

  // EMPIRE 72h e 8h
  const isEmpireAccum = lastC ? lastC.isAccum : false;
  const netAccum72h = lastC ? (lastC.netAccum72h || 0) : 0;
  const vwapBuy = lastC?.vwapBuy || 0;
  const vwapSell = lastC?.vwapSell || 0;

  // Derivativos: Tubarões, Manada e Taker
  const oi = state.oi || {};
  const topLong = oi.topLongPct || 50;
  const topShort = oi.topShortPct || 50;
  const crowdLong = oi.longPct || 50;
  const crowdShort = oi.shortPct || 50;
  const takerBuy = oi.takerBuyPct || 50;
  const takerSell = oi.takerSellPct || 50;
  const oiUsd = oi.openInterestUsd || 0;
  const deltaOi = oi.deltaOiUsd || 0;

  // CEX Netflow (Dólar e Bitcoin)
  const cexFlow = state.personalBasket?.cexFlow || {};
  const usdIn = cexFlow.usdIn || 0;
  const usdOut = cexFlow.usdOut || 0;
  const btcIn = cexFlow.btcIn || 0;
  const btcOut = cexFlow.btcOut || 0;
  const isUsdDraining = usdOut > usdIn * 1.2;
  const isBtcHoarding = btcOut > btcIn * 1.2;

  // Macro / Fear & Greed / Dominância
  const macro = state.personalBasket?.macro || {};
  const fgVal = macro.fearGreed !== undefined ? macro.fearGreed : 50;
  const fgLabel = macro.fearGreedLabel || 'Neutro';
  const btcDom = macro.btcDominance || 59.5;
  const top10Status = state.personalBasket?.top10?.statusText || 'TOP 10 Cripto Neutro';
  const myIndexStatus = state.personalBasket?.statusText || 'Índice Pessoal Neutro';

  // Oráculo Sintético
  const oracle = state.personalBasket?.oracle || {};
  const oracleScore = oracle.pct !== undefined ? oracle.pct : 0;

  // ─── ANÁLISE CONFLUENTE BASEADA NO MÉTODO CAPICH ───
  // REGRA MESTRE: A MMA 80 (15m) ou MMA 20 (1h) é a Linha da Vida que define a Tendência Mãe!
  // Preço ACIMA da MMA 80/20 = Território Comprador (BULL)
  // Preço ABAIXO da MMA 80/20 = Território Vendedor (BEAR)
  // Preço colado na MMA 80/20 (±0.35%) = Teste de Transição / Disputa
  const isTestingLong = Math.abs(distLongPct) <= 0.35;
  const isExtendedBull = distShortPct > 1.8;
  const isExtendedBear = distShortPct < -1.8;

  let scenarioType = 'NEUTRAL'; // 'TREND_BULL' | 'TREND_BEAR' | 'BULL_EXHAUSTION' | 'BEAR_EXHAUSTION' | 'CONSOLIDATION'
  let headline = '';
  let headlineColor = '#f0b90b';
  let badgeText = '';
  let riskLevel = 'MODERADO';
  let riskColor = '#f0b90b';
  let riskReason = '';

  if (isTestingLong) {
    scenarioType = 'CONSOLIDATION';
    headline = `⚖️ TESTE DA ${longLabel}: Preço disputando exatamente a Tendência Mãe ($${formatPrice(mmaLong, symbol)}). Aguarde o candle fechar confirmando se vai romper ou rejeitar.`;
    headlineColor = '#f0b90b';
    badgeText = 'TESTE DE TENDÊNCIA';
    riskLevel = 'ELEVADO / INDEFINIDO';
    riskColor = '#f0b90b';
    riskReason = `Briga decisiva na ${longLabel}. Não abra operações no meio da média antes do rompimento confirmado.`;
  } else if (isAboveLong) {
    // ─── TERRITÓRIO COMPRADOR (ACIMA DA MMA 80 / MMA 20) ───
    if (takerSell >= 58 && crowdLong >= 62) {
      scenarioType = 'BULL_EXHAUSTION';
      headline = `⚠️ ALTA COM EXAUSTÃO / RISCO DE PULLBACK: Preço acima da ${longLabel} (+${distLongPct.toFixed(2)}%), mas a agressão taker é vendedora (${takerSell}%) e a manada está comprada.`;
      headlineColor = '#f0b90b';
      badgeText = 'EXAUSTÃO DE ALTA';
      riskLevel = 'ELEVADO PARA COMPRA';
      riskColor = '#ff7a45';
      riskReason = `Embora a tendência mãe seja de alta, o topo está sofrendo rejeição. Risco de correção até a ${shortLabel} ou ${longLabel}.`;
    } else {
      scenarioType = 'TREND_BULL';
      headline = `🟢 TENDÊNCIA DE ALTA CONFIRMADA: Preço trabalhando acima da ${longLabel} (+${distLongPct.toFixed(2)}%) com estrutura compradora.`;
      headlineColor = '#0ecb81';
      badgeText = 'TENDÊNCIA DE ALTA';
      riskLevel = 'A FAVOR DA TENDÊNCIA';
      riskColor = '#0ecb81';
      riskReason = `A Linha da Vida (${longLabel}) está sob domínio comprador. Operações a favor da alta têm respaldo técnico.`;
    }
  } else {
    // ─── TERRITÓRIO VENDEDOR (ABAIXO DA MMA 80 / MMA 20) ───
    if (takerBuy >= 58 && crowdShort >= 60) {
      scenarioType = 'BEAR_EXHAUSTION';
      headline = `⚠️ BAIXA COM ABSORÇÃO / RISCO DE REPIQUE: Preço abaixo da ${longLabel} (${distLongPct.toFixed(2)}%), mas compradores agridem no fundo (${takerBuy}%) com manada vendida.`;
      headlineColor = '#f0b90b';
      badgeText = 'REPIQUE / ABSORÇÃO';
      riskLevel = 'ELEVADO PARA SHORT';
      riskColor = '#ff7a45';
      riskReason = `Risco de Short Squeeze ou repique corretivo até a ${shortLabel} ou ${longLabel}.`;
    } else {
      scenarioType = 'TREND_BEAR';
      headline = `🔴 TENDÊNCIA DE BAIXA CONFIRMADA: Preço operando abaixo da ${longLabel} (${distLongPct.toFixed(2)}%) em território dominado por vendedores.`;
      headlineColor = '#f6465d';
      badgeText = 'TENDÊNCIA DE BAIXA';
      riskLevel = 'A FAVOR DA TENDÊNCIA';
      riskColor = '#38bdf8';
      riskReason = `A maré principal da ${longLabel} está virada para queda. Operações de venda têm maior probabilidade.`;
    }
  }

  // ─── RECOMENDAÇÕES PRÁTICAS & PLANO DE AÇÃO ───
  let recShort = '';
  let recLong = '';
  let recFlat = '';

  const stopLossLong = mmaLong > 0 ? `$${formatPrice(mmaLong * 0.99, symbol)}` : '--';
  const stopLossShort = mmaLong > 0 ? `$${formatPrice(mmaLong * 1.01, symbol)}` : '--';

  if (isAboveLong) {
    // PREÇO EM ALTA
    recShort = `⚠️ <strong>ALERTA CONTRA-TENDÊNCIA:</strong> O preço está <strong>ACIMA DA ${longLabel}</strong> (+${distLongPct.toFixed(2)}%), que é a sua tendência mãe. Operar vendido aqui é contra o fluxo principal. Se estiver posicionado, proteja no breakeven ou saia na perda de momentum.`;
    recLong = `✅ <strong>A FAVOR DO FLUXO:</strong> A estrutura é compradora acima da <strong>${longLabel}</strong>. Mantenha seu Stop Técnico protegido abaixo da ${longLabel} (${stopLossLong}). ${isExtendedBull ? '⚠️ Preço esticado da média: considere realizar lucro parcial.' : 'Deixe a posição andar.'}`;
    recFlat = isNearShort
      ? `🎯 <strong>GATILHO DE COMPRA (PULLBACK):</strong> O preço está testando a <strong>${shortLabel}</strong> (${formatPrice(mmaShort, symbol)}) na zona de observação. Excelente ponto de entrada para Long com Stop curto abaixo da ${longLabel}.`
      : (isExtendedBull
          ? `⏳ <strong>AGUARDE RECÚO:</strong> O preço está esticado (+${distShortPct.toFixed(2)}% da ${shortLabel}). Não compre topo. Aguarde recuo técnico na ${shortLabel} (${formatPrice(mmaShort, symbol)}) para entrar com menor risco.`
          : `🔍 <strong>AGUARDE TESTE:</strong> Aguarde o preço testar a ${shortLabel} ou confirmar continuidade de volume comprador.`);
  } else if (!isAboveLong && !isTestingLong) {
    // PREÇO EM BAIXA
    recShort = `✅ <strong>A FAVOR DO FLUXO:</strong> A estrutura é vendedora abaixo da <strong>${longLabel}</strong> (${distLongPct.toFixed(2)}%). Mantenha seu Stop Técnico protegido acima da ${longLabel} (${stopLossShort}). ${isExtendedBear ? '⚠️ Preço esticado da média: considere realizar parcial no suporte.' : 'Conduza o trade a favor da queda.'}`;
    recLong = `⛔ <strong>CUIDADO COM COMPRAS:</strong> O preço opera <strong>ABAIXO DA ${longLabel}</strong> em território vendedor. Evite tentar adivinhar fundo antes do preço recuperar e firmar acima das médias.`;
    recFlat = isNearShort
      ? `🎯 <strong>GATILHO DE SHORT (PULLBACK):</strong> O preço está repicando na <strong>${shortLabel}</strong> (${formatPrice(mmaShort, symbol)}) abaixo da ${longLabel}. Ponto clássico de venda com menor risco e Stop técnico protegido acima da ${longLabel}.`
      : (isExtendedBear
          ? `⏳ <strong>AGUARDE REPIQUE:</strong> O preço já caiu bastante e está distante da ${shortLabel} (${distShortPct.toFixed(2)}%). Evite vender fundo; espere repique na ${shortLabel} (${formatPrice(mmaShort, symbol)}) para vender mais caro.`
          : `🔍 <strong>AGUARDE PULLBACK:</strong> Aguarde teste de rejeição na ${shortLabel} para buscar novas entradas de venda.`);
  } else {
    // DISPUTA / TESTE DA MMA 80
    recShort = `⚖️ <strong>POSIÇÃO EM SHORT:</strong> Preço colado na ${longLabel}. Se o preço romper acima da média, zere para não tomar stop cheio.`;
    recLong = `⚖️ <strong>POSIÇÃO EM LONG:</strong> Aguarde candle fechar acima da ${longLabel} confirmando defesa. Se rejeitar, proteja o capital.`;
    recFlat = `☕ <strong>PACIÊNCIA:</strong> Mercado testando o divisor de águas (${longLabel}). Não faça nada até a vela confirmar se rompe ou rejeita.`;
  }

  return {
    symbol,
    tf,
    base,
    currentPrice,
    mmaShort,
    mmaLong,
    shortLabel,
    longLabel,
    distShortPct,
    distLongPct,
    scenarioType,
    headline,
    headlineColor,
    badgeText,
    riskLevel,
    riskColor,
    riskReason,
    topLong,
    topShort,
    crowdLong,
    crowdShort,
    takerBuy,
    takerSell,
    isEmpireAccum,
    netAccum72h,
    isUsdDraining,
    isBtcHoarding,
    fgVal,
    fgLabel,
    btcDom,
    top10Status,
    myIndexStatus,
    usdIn,
    usdOut,
    btcIn,
    btcOut,
    oracleScore,
    recShort,
    recLong,
    recFlat,
    updatedAt: new Date().toLocaleTimeString('pt-BR')
  };
}

function formatFlowUSD(val) {
  if (!val || isNaN(val)) return '$0';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`;
  return `$${Math.round(abs)}`;
}

function formatFlowBTC(val) {
  if (!val || isNaN(val)) return '0 BTC';
  const abs = Math.abs(val);
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(1)}K BTC`;
  return `${Math.round(abs)} BTC`;
}

/**
 * Renderiza o conteúdo dentro da Gaveta Lateral
 */
export function renderAdvisorContent() {
  const container = document.getElementById('tac-advisor-body');
  if (!container) return;

  const d = generateMarketDiagnosis();
  const fgColor = d.fgVal <= 25 ? '#f6465d' : (d.fgVal <= 45 ? '#ff7a45' : (d.fgVal <= 55 ? '#f0b90b' : (d.fgVal <= 75 ? '#0ecb81' : '#00f0ff')));

  container.innerHTML = `
    <!-- Topo do Diagnóstico -->
    <div style="background:rgba(255,255,255,0.03);border:1px solid #282d38;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:11px;font-weight:800;color:#f0b90b;letter-spacing:0.5px;text-transform:uppercase;">
          🧭 Diagnóstico em Tempo Real · ${d.symbol} (${d.tf})
        </span>
        <span style="font-size:9.5px;padding:2px 7px;border-radius:4px;font-weight:700;background:rgba(255,255,255,0.06);color:${d.headlineColor};border:1px solid ${d.headlineColor};">
          ${d.badgeText}
        </span>
      </div>
      <div style="font-size:12px;font-weight:600;line-height:1.45;color:#eaecef;">
        ${d.headline}
      </div>
      <div style="font-size:9px;color:#848e9c;margin-top:6px;text-align:right;">
        Última leitura: ${d.updatedAt}
      </div>
    </div>

    <!-- 1. Clima Macro & Sentimento Global -->
    <div style="background:rgba(255,255,255,0.02);border:1px solid #232833;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="font-size:10px;font-weight:700;color:#848e9c;text-transform:uppercase;margin-bottom:8px;letter-spacing:0.5px;">
        🌐 Clima Macro & Sentimento Global
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div style="background:#161922;border:1px solid #282d38;border-radius:6px;padding:8px;">
          <div style="font-size:9px;color:#848e9c;font-weight:600;">FEAR & GREED</div>
          <div style="font-size:13px;font-weight:800;color:${fgColor};margin-top:2px;">
            ${d.fgVal} <span style="font-size:10px;font-weight:600;color:#eaecef;">(${d.fgLabel})</span>
          </div>
        </div>
        <div style="background:#161922;border:1px solid #282d38;border-radius:6px;padding:8px;">
          <div style="font-size:9px;color:#848e9c;font-weight:600;">DOMINÂNCIA BTC</div>
          <div style="font-size:13px;font-weight:800;color:#f0b90b;margin-top:2px;">
            ${d.btcDom}%
          </div>
        </div>
      </div>
      <div style="background:#161922;border:1px solid #282d38;border-radius:6px;padding:8px;display:flex;justify-content:space-between;align-items:center;font-size:9.5px;">
        <div>
          <span style="color:#848e9c;">Fluxo USD CEX:</span>
          <span style="color:#0ecb81;font-weight:700;margin-left:3px;">+${formatFlowUSD(d.usdIn)}</span> /
          <span style="color:#f6465d;font-weight:700;">-${formatFlowUSD(d.usdOut)}</span>
        </div>
        <div>
          <span style="color:#848e9c;">BTC Sacado:</span>
          <span style="color:#f0b90b;font-weight:700;margin-left:3px;">${formatFlowBTC(d.btcOut)}</span>
        </div>
      </div>
    </div>

    <!-- 2. Batalha dos Players (Raio-X Rápido) -->
    <div style="background:rgba(255,255,255,0.02);border:1px solid #232833;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="font-size:10px;font-weight:700;color:#848e9c;text-transform:uppercase;margin-bottom:8px;letter-spacing:0.5px;">
        ⚔️ A Batalha dos Players na Binance
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="background:#161922;border:1px solid #282d38;border-radius:6px;padding:8px;">
          <div style="font-size:9px;color:#848e9c;font-weight:600;">🦈 TUBARÕES (TOP TRADERS)</div>
          <div style="font-size:13px;font-weight:800;color:${d.topLong >= 50 ? '#0ecb81' : '#f6465d'};margin-top:2px;">
            ${d.topLong}% Long
          </div>
          <div style="font-size:8.5px;color:#848e9c;margin-top:1px;">${d.topShort}% Short no volume real</div>
        </div>
        <div style="background:#161922;border:1px solid #282d38;border-radius:6px;padding:8px;">
          <div style="font-size:9px;color:#848e9c;font-weight:600;">🐟 MANADA (VAREJO)</div>
          <div style="font-size:13px;font-weight:800;color:${d.crowdLong >= 50 ? '#0ecb81' : '#f6465d'};margin-top:2px;">
            ${d.crowdLong}% Alta
          </div>
          <div style="font-size:8.5px;color:#848e9c;margin-top:1px;">${d.crowdShort}% Baixa em contas</div>
        </div>
      </div>
      <div style="margin-top:8px;background:#161922;border:1px solid #282d38;border-radius:6px;padding:8px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span style="font-size:9px;color:#848e9c;font-weight:600;">⚡ AGRESSÃO TAKER (5M):</span>
          <span style="font-size:10px;font-weight:800;color:${d.takerBuy >= d.takerSell ? '#0ecb81' : '#f6465d'};margin-left:4px;">
            ${d.takerBuy >= d.takerSell ? `Compradores ${d.takerBuy}%` : `Vendedores ${d.takerSell}%`}
          </span>
        </div>
        <div>
          <span style="font-size:9px;color:#848e9c;font-weight:600;">EMPIRE 72H:</span>
          <span style="font-size:10px;font-weight:800;color:${d.isEmpireAccum ? '#0ecb81' : '#f6465d'};margin-left:4px;">
            ${d.isEmpireAccum ? '🟢 Acúmulo' : '🔴 Despejo'}
          </span>
        </div>
      </div>
    </div>

    <!-- 3. Recomendações Práticas para Operar Agora -->
    <div style="background:rgba(255,255,255,0.02);border:1px solid #232833;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="font-size:10px;font-weight:700;color:#f0b90b;text-transform:uppercase;margin-bottom:10px;letter-spacing:0.5px;display:flex;align-items:center;gap:5px;">
        <span>🎯 O Que Fazer Agora? (Plano de Ação)</span>
      </div>

      <!-- Se você está Vendido -->
      <div style="margin-bottom:10px;padding-left:8px;border-left:3px solid #f6465d;">
        <div style="font-size:10px;font-weight:800;color:#f6465d;text-transform:uppercase;margin-bottom:2px;">
          📉 Se você está Vendido (Short):
        </div>
        <div style="font-size:11px;color:#cfd6e4;line-height:1.4;">
          ${d.recShort}
        </div>
      </div>

      <!-- Se você está Comprado -->
      <div style="margin-bottom:10px;padding-left:8px;border-left:3px solid #0ecb81;">
        <div style="font-size:10px;font-weight:800;color:#0ecb81;text-transform:uppercase;margin-bottom:2px;">
          📈 Se você está Comprado (Long):
        </div>
        <div style="font-size:11px;color:#cfd6e4;line-height:1.4;">
          ${d.recLong}
        </div>
      </div>

      <!-- Se você está de fora -->
      <div style="padding-left:8px;border-left:3px solid #f0b90b;">
        <div style="font-size:10px;font-weight:800;color:#f0b90b;text-transform:uppercase;margin-bottom:2px;">
          ⚪ Se você está Líquido (De Fora):
        </div>
        <div style="font-size:11px;color:#cfd6e4;line-height:1.4;">
          ${d.recFlat}
        </div>
      </div>
    </div>

    <!-- 4. Termômetro de Risco & Alerta Institucional -->
    <div style="background:#141720;border:1px solid #282d38;border-radius:8px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:10px;font-weight:700;color:#848e9c;text-transform:uppercase;">Nível de Risco do Momento</span>
        <span style="font-size:10px;font-weight:800;color:${d.riskColor};">${d.riskLevel}</span>
      </div>
      <div style="font-size:10.5px;color:#848e9c;line-height:1.4;">
        ${d.riskReason}
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;font-size:9.5px;color:#848e9c;">
        <span>Posição vs ${d.shortLabel}: <strong style="color:#eaecef;">${d.distShortPct >= 0 ? '+' : ''}${d.distShortPct.toFixed(2)}%</strong></span>
        <span>Posição vs ${d.longLabel}: <strong style="color:#eaecef;">${d.distLongPct >= 0 ? '+' : ''}${d.distLongPct.toFixed(2)}%</strong></span>
      </div>
    </div>
  `;
}
