/**
 * personal_index_routes.js
 * Rota do Oráculo Quantitativo e Índice Pessoal (/api/personal-index)
 * Motor Unificado de Confluência Capich (Single Source of Truth)
 */

const express = require('express');

function createPersonalIndexRouter({ marketIndex, getExchangeFlows }) {
  const router = express.Router();

// ─── ENDPOINT: /api/personal-index ───────────────────────────────────────────
// MOTOR UNIFICADO DO ORÁCULO QUANTITATIVO DE CONFLUÊNCIA CAPICH (SINGLE SOURCE OF TRUTH)
// Integra:
// 1. Maré Geral: Índice TOP 10 Cripto (MMA 80)
// 2. Tendência Mãe dos 5 Pares: BTC, ETH, BCH, BNB, UNI (MMA 80 nos 15m = MMA 20 no 1h)
// 3. Zona de Observação & Reteste: MMA 32 nos 15m = MMA 8 no 1h
// 4. Indicador EMPIRE Institucional: Saldo Líquido Real (72h Institucional e 8h Intraday)
// 5. Volumes Diários: Spot e Futuros vs suas respectivas MMA 8
// 6. Fluxo de Baleias CEX (24h) + Compras BlackRock ETF
// 7. Microfluxo Taker (5m) & Sentimento/Alavancagem Varejo (Long/Short)
const ALLOWED_BASKET_SYMBOLS = {
  'BTCUSDT': 'BTC',
  'ETHUSDT': 'ETH',
  'BCHUSDT': 'BCH',
  'BNBUSDT': 'BNB',
  'UNIUSDT': 'UNI'
};
const personalIndexCacheMap = new Map();
const oracleScoreSmoothingMap = new Map();
let dailyVolCache = { data: {}, lastUpdated: 0 };

async function fetchDailyVolumes() {
  const now = Date.now();
  if (now - dailyVolCache.lastUpdated < 60000 && Object.keys(dailyVolCache.data).length >= 5) {
    return dailyVolCache.data;
  }
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BCHUSDT', 'BNBUSDT', 'UNIUSDT'];
  const results = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      let resSpot = null;
      for (const host of ['data-api.binance.vision', 'api.binance.com', 'api1.binance.com']) {
        try {
          const r = await fetch(`https://${host}/api/v3/klines?symbol=${sym}&interval=1d&limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (r.ok) { resSpot = r; break; }
        } catch (_) {}
      }
      let resFut = null;
      for (const host of ['fapi.binance.com', 'fapi1.binance.com']) {
        try {
          const r = await fetch(`https://${host}/fapi/v1/klines?symbol=${sym}&interval=1d&limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (r.ok) { resFut = r; break; }
        } catch (_) {}
      }
      if (!resSpot && !resFut) return;
      const spotK = resSpot ? await resSpot.json() : null;
      const futK = resFut ? await resFut.json() : spotK;
      if (Array.isArray(spotK || futK) && (spotK || futK).length >= 8) {
        const spotVols = (spotK || futK).map(k => parseFloat(k[7]));
        const futVols  = (futK || spotK).map(k => parseFloat(k[7]));
        const todaySpot = spotVols[spotVols.length - 1];
        const todayFut  = futVols[futVols.length - 1];
        const spotMma8 = spotVols.slice(-8).reduce((a, b) => a + b, 0) / 8.0;
        const futMma8  = futVols.slice(-8).reduce((a, b) => a + b, 0) / 8.0;
        const spotBonus = spotMma8 > 0 ? ((todaySpot - spotMma8) / spotMma8) * 100 : 0;
        const futBonus  = futMma8 > 0 ? ((todayFut - futMma8) / futMma8) * 100 : 0;
        results[sym] = {
          todaySpot, todayFut, spotMma8, futMma8,
          spotBonus: Math.round(spotBonus),
          futBonus: Math.round(futBonus)
        };
      }
    } catch (_) {}
  }));
  if (Object.keys(results).length >= 3) {
    dailyVolCache = { data: results, lastUpdated: now };
  }
  return dailyVolCache.data;
}

router.get('/api/personal-index', async (req, res) => {
  const indexCache = marketIndex?.indexCache || {};
  const fearGreedCache = marketIndex?.fearGreedCache || {};
  const dominanceCache = marketIndex?.dominanceCache || {};
  const oiCache = marketIndex?.oiCache || {};
  const exchangeFlowsCache = typeof getExchangeFlows === 'function' ? getExchangeFlows() : (getExchangeFlows || null);
  const now = Date.now();
  const rawSym = (req.query.symbol || 'BTCUSDT').toUpperCase();
  const activeSymbol = ALLOWED_BASKET_SYMBOLS[rawSym] ? rawSym : 'BTCUSDT';

  const cached = personalIndexCacheMap.get(activeSymbol);
  if (cached && (now - cached.time < 2500)) {
    return res.json(cached.data);
  }

  const BASKET = [
    { symbol: 'BTCUSDT', name: 'BTC', decimals: 2 },
    { symbol: 'ETHUSDT', name: 'ETH', decimals: 2 },
    { symbol: 'BCHUSDT', name: 'BCH', decimals: 2 },
    { symbol: 'BNBUSDT', name: 'BNB', decimals: 2 },
    { symbol: 'UNIUSDT', name: 'UNI', decimals: 4 }
  ];

  try {
    const [klinesAll, oiData, dailyVolumes, pairDerivatives] = await Promise.all([
      Promise.all(
        BASKET.map(async ({ symbol, name, decimals }) => {
          try {
            let data = null;
            for (const url of [
              `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=300`,
              `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=15m&limit=300`,
              `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=300`
            ]) {
              try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 6000);
                const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
                clearTimeout(t);
                if (r.ok) {
                  const json = await r.json();
                  if (Array.isArray(json) && json.length >= 80) { data = json; break; }
                }
              } catch (_) {}
            }
            if (!data) return null;

            const N = data.length;
            const closes = data.map(k => parseFloat(k[4]));
            const close = closes[N - 1];

            // 1. MMA 80 nos 15m (= MMA 20 no 1h) — BÚSSOLA DE TENDÊNCIA
            const p80 = Math.min(N, 80);
            const sma80 = closes.slice(-p80).reduce((a, b) => a + b, 0) / p80;

            // 2. MMA 32 nos 15m (= MMA 8 no 1h) — LINHA DE ENTRADA NA ZONA DE OBSERVAÇÃO
            const p32 = Math.min(N, 32);
            const sma32 = closes.slice(-p32).reduce((a, b) => a + b, 0) / p32;

            // Distâncias percentuais
            const distMma80 = sma80 > 0 ? ((close - sma80) / sma80) * 100.0 : 0;
            const distMma32 = sma32 > 0 ? ((close - sma32) / sma32) * 100.0 : 0;

            // Tendência Mãe pela MMA 80
            const isBull80 = close > sma80;
            const isBear80 = close < sma80;

            // 3. Indicador EMPIRE (Saldo Líquido Real de Agressão: Buy Vol - Sell Vol em USD)
            // Janela de 72h em 15m = 288 velas
            const win72 = Math.min(N, 288);
            let sumBuy72 = 0, sumTotal72 = 0;
            for (let i = N - win72; i < N; i++) {
              const quoteV = parseFloat(data[i][7]) || 0;
              const buyV = parseFloat(data[i][10]) || (quoteV * 0.5);
              sumTotal72 += quoteV;
              sumBuy72 += buyV;
            }
            const sumSell72 = sumTotal72 - sumBuy72;
            const netAccum72h = sumBuy72 - sumSell72;
            const isEmpireAccum72h = netAccum72h > 0; // true = Acumulação (Verde), false = Distribuição (Vermelho)

            // Janela de 8h em 15m = 32 velas (Intraday)
            const win8 = Math.min(N, 32);
            let sumBuy8 = 0, sumTotal8 = 0;
            for (let i = N - win8; i < N; i++) {
              const quoteV = parseFloat(data[i][7]) || 0;
              const buyV = parseFloat(data[i][10]) || (quoteV * 0.5);
              sumTotal8 += quoteV;
              sumBuy8 += buyV;
            }
            const sumSell8 = sumTotal8 - sumBuy8;
            const netAccum8h = sumBuy8 - sumSell8;
            const isEmpireAccum8h = netAccum8h > 0;

            return {
              symbol,
              name,
              decimals,
              close,
              sma32,
              sma80,
              distMma32,
              distMma80,
              isBull80,
              isBear80,
              diff15m: distMma32,
              empire: {
                isAccum72h: isEmpireAccum72h,
                net72hUsd: netAccum72h,
                isAccum8h: isEmpireAccum8h,
                net8hUsd: netAccum8h
              }
            };
          } catch (e) {
            return null;
          }
        })
      ),
      (async () => {
        try {
          if (oiCache.data && (now - oiCache.lastUpdated < 60000)) return oiCache.data;
          const r = await fetch('http://localhost:3000/api/open-interest').catch(() => null);
          return r && r.ok ? await r.json() : null;
        } catch (_) {
          return null;
        }
      })(),
      fetchDailyVolumes(),
      (async () => {
        try {
          const [rTop, rLs, rTaker, rOiHist] = await Promise.all([
            fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${activeSymbol}&period=5m&limit=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
            fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${activeSymbol}&period=5m&limit=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
            fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${activeSymbol}&period=5m&limit=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
            fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${activeSymbol}&period=15m&limit=2`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
          ]);
          let topLongPct = 50, lsLongPct = 50, takerBuyPct = 50, takerSellPct = 50, deltaOiUsd = 0;
          if (rTop && rTop.ok) {
            const j = await rTop.json();
            const d = Array.isArray(j) ? j[0] : j;
            if (d && d.longAccount) topLongPct = (parseFloat(d.longAccount) || 0.5) * 100;
          }
          if (rLs && rLs.ok) {
            const j = await rLs.json();
            const d = Array.isArray(j) ? j[0] : j;
            if (d && d.longAccount) lsLongPct = (parseFloat(d.longAccount) || 0.5) * 100;
          }
          if (rTaker && rTaker.ok) {
            const j = await rTaker.json();
            const d = Array.isArray(j) ? j[0] : j;
            if (d) {
              const bV = parseFloat(d.buyVol) || 0;
              const sV = parseFloat(d.sellVol) || 0;
              const tot = bV + sV;
              if (tot > 0) {
                takerBuyPct = (bV / tot) * 100;
                takerSellPct = (sV / tot) * 100;
              }
            }
          }
          if (rOiHist && rOiHist.ok) {
            const j = await rOiHist.json();
            if (Array.isArray(j) && j.length >= 2) {
              const v0 = parseFloat(j[0].sumOpenInterestValue) || 0;
              const v1 = parseFloat(j[1].sumOpenInterestValue) || 0;
              deltaOiUsd = v1 - v0;
            }
          }
          return { topLongPct, lsLongPct, takerBuyPct, takerSellPct, deltaOiUsd };
        } catch (_) {
          return null;
        }
      })()
    ]);

    const validCoins = klinesAll.filter(Boolean);
    if (!validCoins.length) {
      if (cached?.data) return res.json(cached.data);
      throw new Error('Falha ao coletar dados da cesta');
    }

    // Mescla dados de volume diário Spot e Futuros
    validCoins.forEach(coin => {
      const vData = dailyVolumes[coin.symbol] || { spotBonus: 0, futBonus: 0 };
      coin.spotBonus = vData.spotBonus || 0;
      coin.futBonus  = vData.futBonus  || 0;
    });

    const diffs32 = validCoins.map(c => c.distMma32);
    const avgDiff32 = diffs32.reduce((a, b) => a + b, 0) / diffs32.length;
    const posCount32 = validCoins.filter(c => c.distMma32 > 0).length;
    const negCount32 = validCoins.filter(c => c.distMma32 < 0).length;

    // Contagem da Tendência Mãe (MMA 80)
    const countBull80 = validCoins.filter(c => c.isBull80).length;
    const countBear80 = validCoins.filter(c => c.isBear80).length;

    // BTC e Moeda Ativa
    const btcCoin = validCoins.find(c => c.name === 'BTC') || validCoins[0];
    const btcEmpire = btcCoin ? btcCoin.empire : { isAccum72h: true, net72hUsd: 0, isAccum8h: true, net8hUsd: 0 };
    const activeCoin = validCoins.find(c => c.symbol === activeSymbol) || btcCoin;

    // ─── LEITURA DA MARÉ GERAL: ÍNDICE PRINCIPAL TOP 10 ───
    let top10Status = 'neutral';
    let top10Text = '⚪ Maré Geral Neutra';
    let isTop10Bull = false;
    let isTop10Bear = false;
    let top10Info = {
      statusText: '⚪ Sintonizando TOP 10...',
      status: 'neutral',
      isBull80: false,
      isBear80: false,
      val: null,
      changePct: 0,
      sma32: null,
      sma80: null
    };

    if (indexCache['15m']?.data?.candles?.length) {
      const candles10 = indexCache['15m'].data.candles;
      const last10 = candles10[candles10.length - 1];
      const prev10 = candles10[candles10.length - 2] || last10;
      if (last10 && last10.sma80) {
        if (last10.c > last10.sma80) {
          isTop10Bull = true;
          top10Status = 'bull';
          top10Text = '🟢 TOP 10 em Alta (> MMA 80)';
        } else if (last10.c < last10.sma80) {
          isTop10Bear = true;
          top10Status = 'bear';
          top10Text = '🔴 TOP 10 em Queda (< MMA 80)';
        }
      }
      if (last10) {
        const change = prev10 ? ((last10.c - prev10.c) / prev10.c) * 100 : 0;
        const diff80 = last10.sma80 ? (((last10.c - last10.sma80) / last10.sma80) * 100) : 0;
        top10Info = {
          statusText: top10Text,
          status: top10Status,
          isBull80: isTop10Bull,
          isBear80: isTop10Bear,
          val: parseFloat(last10.c.toFixed(2)),
          changePct: parseFloat(change.toFixed(2)),
          diffMma80: parseFloat(diff80.toFixed(2)),
          sma32: last10.sma32 ? parseFloat(last10.sma32.toFixed(2)) : null,
          sma80: last10.sma80 ? parseFloat(last10.sma80.toFixed(2)) : null
        };
      }
    }

    // ─── CÁLCULO UNIFICADO DO ORÁCULO QUANTITATIVO (SCORE 0 A 100) ───
    let score = 50; // Base Neutra

    // PILAR 1: Maré Geral (Índice Principal TOP 10 vs MMA 80) — Peso ~10 pts (Com Zona Neutra de Tolerância)
    const t10Diff = top10Info.diffMma80 || 0;
    if (t10Diff > 0.15) {
      score += 10;
    } else if (t10Diff < -0.15) {
      score -= 10;
    }
    // Obs: Se -0.15% <= t10Diff <= 0.15%, fica neutro (evita pulos por ruído na média).

    // PILAR 2: Tendência Mãe dos 5 Pares (MMA 80 nos 15m) — Peso ~16 pts
    let basketPillarText = `⚪ Cesta Mista (${countBull80} Alta / ${countBear80} Baixa)`;
    let basketPillarState = 'neutral';
    if (countBull80 >= 4) {
      score += 15;
      basketPillarText = `🟢 ${countBull80}/5 Pares em Alta (MMA 80)`;
      basketPillarState = 'bull';
    } else if (countBear80 >= 4) {
      score -= 15;
      basketPillarText = `🔴 ${countBear80}/5 Pares em Baixa (MMA 80)`;
      basketPillarState = 'bear';
    } else if (countBull80 >= 3) {
      score += 6;
      basketPillarText = `🟢 Maioria em Alta (${countBull80}/5)`;
      basketPillarState = 'bull';
    } else if (countBear80 >= 3) {
      score -= 6;
      basketPillarText = `🔴 Maioria em Baixa (${countBear80}/5)`;
      basketPillarState = 'bear';
    }

    // PILAR 3: Indicador EMPIRE Institucional (Soberano — 72h e 8h do Par Ativo) — Peso ~22 pts
    let empirePillarText = '⚪ EMPIRE Equilibrado';
    let empirePillarState = 'neutral';
    const targetEmpire = activeCoin.empire || btcEmpire;
    const net72Val = targetEmpire.net72hUsd || 0;
    const net72Abs = Math.abs(net72Val);
    const net72Str = (net72Abs >= 1e6)
      ? `${(net72Val / 1e6).toFixed(1)}M`
      : `${Math.round(net72Val / 1e3)}K`;

    if (targetEmpire.isAccum72h) {
      score += 14;
      if (targetEmpire.isAccum8h) {
        score += 6; // Alinhamento total 72h + 8h em Acumulação
        empirePillarText = `🟢 Acúmulo Total (+${net72Str} ${activeCoin.name})`;
        empirePillarState = 'bull';
      } else {
        score -= 5; // Divergência de topo (72h verde mas 8h realizando)
        empirePillarText = `⚠️ Alerta de Topo (8h Despejo)`;
        empirePillarState = 'neutral';
      }
    } else {
      score -= 14;
      if (!targetEmpire.isAccum8h) {
        score -= 6; // Despejo total 72h + 8h
        empirePillarText = `🔴 Despejo Total (${net72Str} ${activeCoin.name})`;
        empirePillarState = 'bear';
      } else {
        score += 5; // Divergência de fundo (72h vermelha mas 8h recomprando)
        empirePillarText = `👀 Alerta de Fundo (8h Acúmulo)`;
        empirePillarState = 'neutral';
      }
    }

    // PILAR 4: Posição dos Tubarões (Top Traders Binance do Par Ativo) — Peso ~10 pts
    const topTLong = pairDerivatives?.topLongPct ?? 50;
    if (topTLong >= 58) {
      score += Math.min(10, (topTLong - 50) * 0.7);
    } else if (topTLong <= 42) {
      score -= Math.min(10, (50 - topTLong) * 0.7);
    }

    // PILAR 5: Dinheiro dos Tubarões (Delta OI — Filtro de Subida Oca) — Peso ~10 pts
    const deltaOi = pairDerivatives?.deltaOiUsd || 0;
    const isPriceUp = (activeCoin.distMma32 > 0);
    if (isPriceUp && deltaOi < -50000) {
      // Preço subiu mas contratos saíram = Subida Oca (Short Squeeze). Não dar compra forte!
      score -= 8;
    } else if (isPriceUp && deltaOi > 100000) {
      score += 6;
    } else if (!isPriceUp && deltaOi > 100000) {
      // Preço caindo com novos contratos = Despejo institucional pesado
      score -= 6;
    }

    // PILAR 6: Microfluxo Taker 5m (Agressão no Book) — Peso REDUZIDO para máx 7 pts (estabilidade)
    let takerPillarText = '⚪ Disputa Equilibrada';
    let takerPillarState = 'neutral';
    const takerBuy = pairDerivatives?.takerBuyPct ?? (oiData?.taker?.buyPct || 50);
    const takerSell = pairDerivatives?.takerSellPct ?? (oiData?.taker?.sellPct || 50);
    if (takerBuy >= 55) {
      score += Math.min(7, (takerBuy - 50) * 0.7);
      takerPillarText = `🟢 Compra Ativa ${takerBuy.toFixed(1)}%`;
      takerPillarState = 'bull';
    } else if (takerSell >= 55) {
      score -= Math.min(7, (takerSell - 50) * 0.7);
      takerPillarText = `🔴 Venda Ativa ${takerSell.toFixed(1)}%`;
      takerPillarState = 'bear';
    } else {
      takerPillarText = `⚪ Disputa Equilibrada (${takerBuy.toFixed(1)}% Compra)`;
    }

    // PILAR 7: Fluxo Real das Baleias BTC CEX (24h) & ETFs — Peso ~8 pts
    let flowsPillarText = '⚪ Fluxo Estável nas Corretoras';
    let flowsPillarState = 'neutral';
    const flow1d = exchangeFlowsCache?.data?.global?.totalFlow1d || 0;
    const btcFlow1d = exchangeFlowsCache?.data?.global?.btcFlow1d || 0;
    if (flow1d < -300000000) {
      score += 8;
      flowsPillarText = `🟢 Baleias Sacando (${Math.abs(Math.round(btcFlow1d)).toLocaleString('pt-BR')} BTC)`;
      flowsPillarState = 'bull';
    } else if (flow1d > 300000000) {
      score -= 8;
      flowsPillarText = `🔴 Alerta de Despejo (+${Math.abs(Math.round(btcFlow1d)).toLocaleString('pt-BR')} BTC)`;
      flowsPillarState = 'bear';
    }

    // PILAR 8: Sentimento & Derivativos Varejo (Long/Short) — Peso ~7 pts
    let leveragePillarText = '⚪ Alavancagem Neutra';
    let leveragePillarState = 'neutral';
    const lsLong = pairDerivatives?.lsLongPct ?? (oiData?.longShort?.binance?.longPct || 50);
    if (lsLong > 66) {
      score -= 7;
      leveragePillarText = `⚠️ Varejo Alavancado (${Math.round(lsLong)}% Long)`;
      leveragePillarState = 'bear';
    } else if (lsLong < 38) {
      score += 7;
      leveragePillarText = `🔥 Varejo Vendido (${Math.round(100 - lsLong)}% Short)`;
      leveragePillarState = 'bull';
    }

    const fgVal = parseInt(fearGreedCache?.data?.data?.[0]?.value || 50);
    if (fgVal <= 25) score += 2;
    else if (fgVal >= 78) score -= 2;

    // ─── TRAVA DA LINHA DA VIDA (MMA 80) & COERÊNCIA INSTITUCIONAL ───
    // Se o par ativo opera ABAIXO da MMA 80 e o EMPIRE 72h é DISTRIBUIÇÃO:
    // Fica terminantemente bloqueado de emitir compra forte. Score travado no teto neutro/cautela.
    const isBelowLifeLine = activeCoin.close < activeCoin.sma80;
    const isAboveLifeLine = activeCoin.close > activeCoin.sma80;
    if (isBelowLifeLine && !targetEmpire.isAccum72h) {
      if (score > 56) score = 56;
    }
    // Se opera ACIMA da MMA 80 e o EMPIRE 72h é ACUMULAÇÃO:
    // Fica terminantemente bloqueado de emitir venda forte. Score travado no piso neutro/cautela.
    if (isAboveLifeLine && targetEmpire.isAccum72h) {
      if (score < 44) score = 44;
    }

    // ─── AMORTECIMENTO SUAVE (EMA CONTRA OSCILAÇÃO DE TICK A TICK) ───
    const prevSmoothed = oracleScoreSmoothingMap.get(activeSymbol) ?? score;
    const finalSmoothedScore = Math.round((score * 0.4) + (prevSmoothed * 0.6));
    oracleScoreSmoothingMap.set(activeSymbol, finalSmoothedScore);

    score = Math.max(6, Math.min(94, finalSmoothedScore));
    const oraclePct = Math.round((score - 50) * 2);

    let verdict = 'MERCADO EM DISPUTA / NEUTRO';
    let verdictColor = '#f0b90b';
    let badgeClass = 'badge-neutral';
    let directionAllowed = 'NEUTRAL'; // 'LONG', 'SHORT', 'NEUTRAL'

    if (oraclePct >= 36) {
      if (isBelowLifeLine && !targetEmpire.isAccum72h) {
        verdict = 'REPIQUE EM TENDÊNCIA DE BAIXA (CUIDADO)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'SHORT';
      } else {
        verdict = 'FORÇA COMPRADORA (LONG)';
        verdictColor = '#0ecb81';
        badgeClass = 'badge-bull-strong';
        directionAllowed = 'LONG';
      }
    } else if (oraclePct >= 12) {
      if (isBelowLifeLine && !targetEmpire.isAccum72h) {
        verdict = 'REPIQUE NA MMA 32 (AGUARDE SETUP DE VENDA)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'SHORT';
      } else {
        verdict = 'VIÉS COMPRADOR MODERADO';
        verdictColor = '#0ecb81';
        badgeClass = 'badge-bull-mod';
        directionAllowed = 'LONG';
      }
    } else if (oraclePct <= -36) {
      if (isAboveLifeLine && targetEmpire.isAccum72h) {
        verdict = 'PULLBACK EM TENDÊNCIA DE ALTA (AGUARDE SUPORTE)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'LONG';
      } else {
        verdict = 'FORÇA VENDEDORA (SHORT)';
        verdictColor = '#f6465d';
        badgeClass = 'badge-bear-strong';
        directionAllowed = 'SHORT';
      }
    } else if (oraclePct <= -12) {
      if (isAboveLifeLine && targetEmpire.isAccum72h) {
        verdict = 'PULLBACK NA MMA 32 (AGUARDE GATILHO COMPRADOR)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'LONG';
      } else {
        verdict = 'VIÉS VENDEDOR / CAUTELA';
        verdictColor = '#f6465d';
        badgeClass = 'badge-bear-mod';
        directionAllowed = 'SHORT';
      }
    } else {
      verdict = 'MERCADO EM DISPUTA / NEUTRO';
      verdictColor = '#f0b90b';
      badgeClass = 'badge-neutral';
      directionAllowed = 'NEUTRAL';
    }

    // ─── SELETOR DO PAR RECOMENDADO (MÉTODO CAPICH) ───
    // REGRA 1: Filtro Direcional Obrigatório — Só avalia pares a favor da tendência mãe (MMA 80)
    // REGRA 2: Zona de Observação — Prioriza teste da MMA 32 com stop técnico na MMA 80
    // REGRA 3: Validação de Volume — Checa se Spot e Futuros não estão mortos
    let bestPair = null;

    if (directionAllowed === 'LONG') {
      // Filtra apenas pares em tendência de ALTA (Preço > MMA 80)
      const bullPairs = validCoins.filter(c => c.close >= (c.sma80 * 0.998));
      
      const scoredPairs = bullPairs.map(c => {
        let setupScore = 0;
        let setupName = '▲ TENDÊNCIA DE ALTA (Em Andamento)';
        let isObservation = false;
        let isExtended = false;

        // Análise da Zona de Observação vs Preço Esticado
        if (Math.abs(c.distMma32) <= 0.85) {
          // Preço recuando na MMA 32 = ZONA DE OBSERVAÇÃO / PULLBACK IDEAL
          setupName = '🟢 PULLBACK NA MMA 32 (Zona de Observação / Gatilho de Compra)';
          setupScore = 100;
          isObservation = true;
        } else if (c.distMma32 > 2.0) {
          // Esticado da MMA 32 = Risco de comprar no topo
          setupName = '⚠️ ESTICADO DA MMA 32 (Aguarde Pullback — Risco de Correção)';
          setupScore = 10;
          isExtended = true;
        } else {
          setupName = '▲ TENDÊNCIA DE ALTA (Em Andamento)';
          setupScore = 40;
        }

        // Bônus/Penalidade de Volume Diário (Spot e Futuros)
        if (c.futBonus < -50 || c.spotBonus < -50) setupScore -= 35; // Volume seco!
        if (c.futBonus > 0) setupScore += 12;
        if (c.spotBonus > 0) setupScore += 10;

        return { ...c, setupScore, setupName, isObservation, isExtended };
      });

      scoredPairs.sort((a, b) => b.setupScore - a.setupScore);
      const topPick = scoredPairs[0];

      if (topPick && topPick.isObservation) {
        bestPair = {
          symbol: topPick.name,
          fullSymbol: topPick.symbol,
          isWaitingSetup: false,
          setupName: topPick.setupName,
          price: topPick.close,
          sma32: topPick.sma32,
          sma80: topPick.sma80,
          decimals: topPick.decimals,
          distMma32Pct: topPick.distMma32,
          distMma80Pct: topPick.distMma80,
          spotBonus: topPick.spotBonus,
          futBonus: topPick.futBonus,
          stopLossPrice: `$${topPick.sma80.toFixed(topPick.decimals)}`,
          actionMsg: `Preço testando a MMA 32 na zona de observação. Tendência mãe (MMA 80) e fluxo institucional alinhados na ALTA.`
        };
      } else {
        // Pares em alta mas nenhum em pullback ideal (esticados ou em andamento)
        const refCoin = topPick || validCoins[0];
        bestPair = {
          symbol: refCoin.name,
          fullSymbol: refCoin.symbol,
          isWaitingSetup: true,
          setupName: '⏳ AGUARDANDO RECÚO NA MMA 32 (Pares Esticados / Em Andamento)',
          price: refCoin.close,
          sma32: refCoin.sma32,
          sma80: refCoin.sma80,
          decimals: refCoin.decimals,
          distMma32Pct: refCoin.distMma32,
          distMma80Pct: refCoin.distMma80,
          spotBonus: refCoin.spotBonus,
          futBonus: refCoin.futBonus,
          stopLossPrice: `$${refCoin.sma80.toFixed(refCoin.decimals)}`,
          actionMsg: `A tendência macro é de ALTA, mas os pares estão esticados ou em andamento. NÃO compre no topo! Espere o recuo na MMA 32 para uma entrada com stop curto na MMA 80.`
        };
      }
    } else if (directionAllowed === 'SHORT') {
      // Filtra apenas pares em tendência de BAIXA (Preço < MMA 80)
      const bearPairs = validCoins.filter(c => c.close <= (c.sma80 * 1.002));

      const scoredPairs = bearPairs.map(c => {
        let setupScore = 0;
        let setupName = '▼ TENDÊNCIA DE BAIXA (Em Andamento)';
        let isObservation = false;
        let isExtended = false;

        if (Math.abs(c.distMma32) <= 0.85) {
          setupName = '🔴 PULLBACK NA MMA 32 (Zona de Observação / Gatilho de Short)';
          setupScore = 100;
          isObservation = true;
        } else if (c.distMma32 < -2.0) {
          setupName = '⚠️ ESTICADO DA MMA 32 (Aguarde Repique — Risco de Vender Fundo)';
          setupScore = 10;
          isExtended = true;
        } else {
          setupName = '▼ TENDÊNCIA DE BAIXA (Em Andamento)';
          setupScore = 40;
        }

        if (c.futBonus < -50 || c.spotBonus < -50) setupScore -= 35;
        if (c.futBonus > 0) setupScore += 12;

        return { ...c, setupScore, setupName, isObservation, isExtended };
      });

      scoredPairs.sort((a, b) => b.setupScore - a.setupScore);
      const topPick = scoredPairs[0];

      if (topPick && topPick.isObservation) {
        bestPair = {
          symbol: topPick.name,
          fullSymbol: topPick.symbol,
          isWaitingSetup: false,
          setupName: topPick.setupName,
          price: topPick.close,
          sma32: topPick.sma32,
          sma80: topPick.sma80,
          decimals: topPick.decimals,
          distMma32Pct: topPick.distMma32,
          distMma80Pct: topPick.distMma80,
          spotBonus: topPick.spotBonus,
          futBonus: topPick.futBonus,
          stopLossPrice: `$${topPick.sma80.toFixed(topPick.decimals)}`,
          actionMsg: `Preço repicando na MMA 32 abaixo da MMA 80. Tendência mãe de BAIXA confirmada.`
        };
      } else {
        const refCoin = topPick || validCoins[0];
        bestPair = {
          symbol: refCoin.name,
          fullSymbol: refCoin.symbol,
          isWaitingSetup: true,
          setupName: '⏳ AGUARDANDO REPIQUE NA MMA 32 (Pares Esticados / Em Andamento)',
          price: refCoin.close,
          sma32: refCoin.sma32,
          sma80: refCoin.sma80,
          decimals: refCoin.decimals,
          distMma32Pct: refCoin.distMma32,
          distMma80Pct: refCoin.distMma80,
          spotBonus: refCoin.spotBonus,
          futBonus: refCoin.futBonus,
          stopLossPrice: `$${refCoin.sma80.toFixed(refCoin.decimals)}`,
          actionMsg: `A tendência macro é de BAIXA, mas os pares estão distantes da MMA 32. Evite vender no fundo. Aguarde repique na MMA 32.`
        };
      }
    } else {
      // Mercado Neutro / Em Disputa
      const refCoin = validCoins[0];
      bestPair = {
        symbol: refCoin.name,
        fullSymbol: refCoin.symbol,
        isWaitingSetup: true,
        setupName: '⚖️ MERCADO EM DISPUTA / AGUARDE DEFINIÇÃO',
        price: refCoin.close,
        sma32: refCoin.sma32,
        sma80: refCoin.sma80,
        decimals: refCoin.decimals,
        distMma32Pct: refCoin.distMma32,
        distMma80Pct: refCoin.distMma80,
        spotBonus: refCoin.spotBonus,
        futBonus: refCoin.futBonus,
        stopLossPrice: `$${refCoin.sma80.toFixed(refCoin.decimals)}`,
        actionMsg: `Forças compradoras e vendedoras empatadas. Aguarde rompimento com volume das médias MMA 32 e MMA 80.`
      };
    }

    // ─── DIAGNÓSTICO EM LINGUAGEM DE TRADER ("ATÉ UMA CRIANÇA ENTENDE") ───
    const btcPriceStr = oiData?.btcPrice ? `$${Number(oiData.btcPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : `$${Math.round(btcCoin.close).toLocaleString('pt-BR')}`;
    const blackRock = exchangeFlowsCache?.data?.global?.blackRock;
    const net72M = (Math.abs(targetEmpire.net72hUsd || 0) / 1e6).toFixed(1);
    let headline = '';
    let narrative = '';

    if (directionAllowed === 'LONG') {
      headline = '🚀 CENÁRIO AGORA: FORTE TENDÊNCIA DE ALTA (COMPRADORES NO DOMÍNIO)';
      narrative = `
        <div style="font-size: 1.05rem; font-weight: 800; color: #0ecb81; margin-bottom: 6px;">
          🚀 CENÁRIO AGORA: FORTE TENDÊNCIA DE ALTA (COMPRADORES NO DOMÍNIO)
        </div>
        <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
          O Bitcoin negocia em <strong>${btcPriceStr}</strong> com probabilidade quantitativa em <strong>+${oraclePct}%</strong> a favor da alta.
          A Maré Geral (Índice TOP 10) e a maioria dos seus 5 pares estão operando <strong>acima da MMA 80</strong> (tendência mãe de alta confirmada).
          O indicador EMPIRE Institucional acusa <strong>${btcEmpire.isAccum72h ? 'Acumulação líquida de 72h (+'+net72M+'M USD)' : 'Distribuição'}</strong>,
          compradores agredindo a mercado (${takerBuy ? takerBuy.toFixed(1) + '% de compra ativa' : 'compra dominante'}) e baleias retirando moedas das corretoras.
          ${blackRock && blackRock.btcBought ? `<br><span style="color: #38bdf8;">🏛️ Rastreamento Institucional: BlackRock e ETFs Spot injetando capital (+${blackRock.btcBought.toLocaleString('pt-BR')} BTC comprados).</span>` : ''}
        </p>
        <div class="narrative-verdict-highlight green">
          👉 O QUE FAZER: <strong>${bestPair.isWaitingSetup ? 'VENTO A FAVOR PARA COMPRA, MAS AGUARDE RECÚO.' : 'VENTO TOTALMENTE A FAVOR PARA COMPRA.'}</strong> 
          ${bestPair.actionMsg}
        </div>
      `;
    } else if (directionAllowed === 'SHORT') {
      headline = '📉 CENÁRIO AGORA: FORTE TENDÊNCIA DE BAIXA (VENDEDORES NO COMANDO)';
      narrative = `
        <div style="font-size: 1.05rem; font-weight: 800; color: #f6465d; margin-bottom: 6px;">
          📉 CENÁRIO AGORA: FORTE TENDÊNCIA DE BAIXA (VENDEDORES NO COMANDO)
        </div>
        <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
          O Bitcoin negocia em <strong>${btcPriceStr}</strong> com pressão vendedora em <strong>${oraclePct}%</strong>.
          Os pares perderam a MMA 80 (tendência mãe virada para queda).
          O indicador EMPIRE Institucional aponta <strong>Distribuição líquida (-${net72M}M USD)</strong>
          e o book sofre pressão vendedora constante (${takerSell ? takerSell.toFixed(1) + '% de ordens a mercado despejando' : 'venda dominante'}).
        </p>
        <div class="narrative-verdict-highlight red">
          👉 O QUE FAZER: <strong>NÃO COMPRE AGORA!</strong> ${bestPair.actionMsg}
        </div>
      `;
    } else {
      headline = '⚖️ CENÁRIO AGORA: MERCADO EM DISPUTA / EQUILÍBRIO (SEM LADO DOMINANTE)';
      narrative = `
        <div style="font-size: 1.05rem; font-weight: 800; color: #f0b90b; margin-bottom: 6px;">
          ⚖️ CENÁRIO AGORA: MERCADO EM DISPUTA / EQUILÍBRIO (SEM LADO DOMINANTE)
        </div>
        <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
          O Bitcoin está na faixa de <strong>${btcPriceStr}</strong> com confluência neutra em <strong>${oraclePct >= 0 ? '+' : ''}${oraclePct}%</strong>.
          Compradores e vendedores estão empatados. Não tente adivinhar topo ou fundo sem confirmação de volume.
        </p>
        <div class="narrative-verdict-highlight gray">
          👉 O QUE FAZER: <strong>PACIÊNCIA E CAUTELA.</strong> Aguarde o mercado definir lado e confirmar o teste da MMA 32 nos 15m antes de abrir novas posições.
        </div>
      `;
    }

    const sign32 = avgDiff32 > 0 ? '+' : '';
    let statusText = '';
    let statusColor = '#848e9c';
    if (avgDiff32 > 0.05) {
      statusText = `▲ ${sign32}${avgDiff32.toFixed(2)}% · MERCADO COMPRADOR`;
      statusColor = '#0ecb81';
    } else if (avgDiff32 < -0.05) {
      statusText = `▼ ${sign32}${avgDiff32.toFixed(2)}% · MERCADO VENDEDOR`;
      statusColor = '#f6465d';
    } else {
      statusText = `— ${sign32}${avgDiff32.toFixed(2)}% · MERCADO NEUTRO`;
      statusColor = '#eaecef';
    }

    const payload = {
      top10: top10Info,
      avgDiff: parseFloat(avgDiff32.toFixed(2)),
      posCount: posCount32,
      negCount: negCount32,
      statusText,
      statusColor,
      scoreboard: `🟢 ${posCount32} Acima | 🔴 ${negCount32} Abaixo da MMA 32`,
      oracle: {
        pct: oraclePct,
        pctText: `${oraclePct > 0 ? '+' : ''}${oraclePct}%`,
        score,
        verdict,
        color: verdictColor,
        badgeClass,
        headline,
        narrative,
        bestPair,
        // Pilares compatíveis com o popover do Histórico (texto compacto)
        pillars: {
          whales: flowsPillarText,
          taker: takerPillarText,
          basket: basketPillarText,
          empire: empirePillarText,
          leverage: leveragePillarText,
          sentiment: `🧭 Fear & Greed: ${fgVal}/100`
        },
        // Pilares detalhados para o semáforo de index.html
        pillarsDetailed: {
          flows: { text: flowsPillarText, state: flowsPillarState },
          taker: { text: takerPillarText, state: takerPillarState },
          technical: { text: basketPillarText, state: basketPillarState },
          indices: { text: top10Text, state: top10Status },
          derivatives: { text: leveragePillarText, state: leveragePillarState },
          sentiment: { text: empirePillarText, state: empirePillarState }
        }
      },
      coins: validCoins.map(c => ({
        symbol: c.symbol,
        name: c.name,
        close: c.close,
        sma32: c.sma32,
        sma80: c.sma80,
        diff: parseFloat(c.distMma32.toFixed(2)),
        distMma80: parseFloat(c.distMma80.toFixed(2)),
        isBull80: c.isBull80,
        spotBonus: c.spotBonus,
        futBonus: c.futBonus
      })),
      cexFlow: {
        usdIn: exchangeFlowsCache?.data?.global?.inflow1dUsd || 0,
        usdOut: exchangeFlowsCache?.data?.global?.outflow1dUsd || 0,
        btcIn: exchangeFlowsCache?.data?.global?.btcInflow1d || 0,
        btcOut: exchangeFlowsCache?.data?.global?.btcOutflow1d || 0,
        btcPrice: exchangeFlowsCache?.data?.global?.btcPrice || 76000
      },
      macro: {
        fearGreed: parseInt(fearGreedCache?.data?.data?.[0]?.value || 50),
        fearGreedLabel: fearGreedCache?.data?.data?.[0]?.value_classification || 'Neutro',
        btcDominance: dominanceCache?.data?.data?.market_cap_percentage?.btc ? parseFloat(dominanceCache.data.data.market_cap_percentage.btc.toFixed(1)) : 59.5
      },
      updatedAt: now
    };

    personalIndexCacheMap.set(activeSymbol, { data: payload, time: now });
    res.json(payload);
  } catch (err) {
    console.error('[/api/personal-index] Erro:', err.message);
    const fallback = personalIndexCacheMap.get(activeSymbol);
    if (fallback?.data) return res.json(fallback.data);
    res.status(500).json({ error: 'Erro ao calcular índice pessoal' });
  }
});

  return router;
}

module.exports = createPersonalIndexRouter;
