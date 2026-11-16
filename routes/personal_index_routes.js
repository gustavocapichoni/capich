/**
 * personal_index_routes.js
 * Rota do Oráculo Quantitativo e Índice Pessoal (/api/personal-index)
 * Motor Unificado de Confluência Capich (Single Source of Truth)
 *
 * REFORMULAÇÃO ESTRUTURAL 1H (INSTITUCIONAL & SWING/DAY TRADE):
 * 1. Timeframe Operacional: 1H Nativo (MMA 8 e MMA 20)
 * 2. Janelas Institucionais Estáveis: 8H (Sessão Intraday) e 72H (Macro 3 Dias)
 * 3. Tendência Definida: Preço > MMA 8 > MMA 20 (Alta) | Preço < MMA 8 < MMA 20 (Baixa)
 * 4. Posição dos Tubarões e Varejo: Variação Semanal com Marco Zero no Domingo 19:00 BRT
 * 5. Seletor do Par Mais Vantajoso: Eleito por Amplitude de Movimento e Volume Real das 8h
 * 6. Eliminação de Bipolaridade: Histerese e Filtro Anti-Ruído
 */

const express = require('express');

function createPersonalIndexRouter({ marketIndex, getExchangeFlows, getWeeklyBaseline: externalWeeklyBaseline }) {
  const router = express.Router();

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
  let lastKnownTop10Info = null;

  // ─── MARCO ZERO DOMINGO 19:00 BRT (SEMANAL TUBARÕES & VAREJO) ───
  function getLastSunday19hBrtTimestamp() {
    const now = new Date();
    const nowBrt = new Date(now.getTime() - 3 * 3600 * 1000);
    const brtDay = nowBrt.getUTCDay();
    const brtHour = nowBrt.getUTCHours();
    const daysBack = (brtDay === 0 && brtHour < 19) ? 7 : brtDay;
    const targetBrt = new Date(nowBrt);
    targetBrt.setUTCDate(nowBrt.getUTCDate() - daysBack);
    targetBrt.setUTCHours(19, 0, 0, 0);
    targetBrt.setUTCMinutes(0, 0, 0);
    targetBrt.setUTCSeconds(0, 0);
    targetBrt.setUTCMilliseconds(0);
    return targetBrt.getTime() + 3 * 3600 * 1000;
  }

  const weeklyBaselineCacheInternal = new Map();

  async function resolveWeeklyBaseline(symbol) {
    if (typeof externalWeeklyBaseline === 'function') {
      try {
        const b = await externalWeeklyBaseline(symbol);
        if (b) return b;
      } catch (_) {}
    }

    const sundayTimestamp = getLastSunday19hBrtTimestamp();
    const cached = weeklyBaselineCacheInternal.get(symbol);
    if (cached && cached.sundayTimestamp === sundayTimestamp) {
      return cached;
    }

    const start = sundayTimestamp;
    const end = sundayTimestamp + 3600000;
    let baseTopLongPct = 50;
    let baseTopShortPct = 50;
    let baseRetailLongPct = 50;
    let baseRetailShortPct = 50;

    try {
      const [rBaseTop, rBaseLs] = await Promise.all([
        fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=15m&startTime=${start}&endTime=${end}&limit=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&startTime=${start}&endTime=${end}&limit=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
      ]);

      if (rBaseTop && rBaseTop.ok) {
        const topJson = await rBaseTop.json();
        const item = Array.isArray(topJson) ? topJson[0] : topJson;
        if (item) {
          const l = parseFloat(item.longAccount) || 0.5;
          const s = parseFloat(item.shortAccount) || 0.5;
          baseTopLongPct = Math.round(l * 1000) / 10;
          baseTopShortPct = Math.round(s * 1000) / 10;
        }
      }

      if (rBaseLs && rBaseLs.ok) {
        const lsJson = await rBaseLs.json();
        const item = Array.isArray(lsJson) ? lsJson[0] : lsJson;
        if (item) {
          const l = parseFloat(item.longAccount) || 0.5;
          const s = parseFloat(item.shortAccount) || 0.5;
          baseRetailLongPct = Math.round(l * 1000) / 10;
          baseRetailShortPct = Math.round(s * 1000) / 10;
        }
      }
    } catch (e) {
      console.warn(`[PersonalIndex:WeeklyBaseline] Error fetching for ${symbol}:`, e.message);
    }

    const result = {
      sundayTimestamp,
      baseTopLongPct,
      baseTopShortPct,
      baseRetailLongPct,
      baseRetailShortPct
    };

    if (baseTopLongPct !== 50 || baseRetailLongPct !== 50) {
      weeklyBaselineCacheInternal.set(symbol, result);
    }
    return result;
  }

  // ─── VOLUMES DIÁRIOS SPOT E FUTUROS VS MMA 8 (1D) ───
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

  // ─── ENDPOINT: /api/personal-index ───────────────────────────────────────────
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
    if (cached && (now - cached.time < 2200)) {
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
      // 1. Coleta nativa em 1H para os 5 pares + volumes + derivativos + baseline semanal
      const [klines1hAll, oiData, dailyVolumes, pairDerivatives, weeklyBaseline] = await Promise.all([
        Promise.all(
          BASKET.map(async ({ symbol, name, decimals }) => {
            try {
              let data = null;
              for (const url of [
                `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=100`,
                `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`,
                `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`
              ]) {
                try {
                  const ctrl = new AbortController();
                  const t = setTimeout(() => ctrl.abort(), 6000);
                  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
                  clearTimeout(t);
                  if (r.ok) {
                    const json = await r.json();
                    if (Array.isArray(json) && json.length >= 72) { data = json; break; }
                  }
                } catch (_) {}
              }
              if (!data) return null;

              const N = data.length;
              const closes = data.map(k => parseFloat(k[4]));
              const opens  = data.map(k => parseFloat(k[1]));
              const highs  = data.map(k => parseFloat(k[2]));
              const lows   = data.map(k => parseFloat(k[3]));
              const quoteVols = data.map(k => parseFloat(k[7]) || 0);
              const takerBuyQuoteVols = data.map(k => parseFloat(k[10]) || ((parseFloat(k[7]) || 0) * 0.5));
              const close = closes[N - 1];

              // ── A. Médias Móveis Operacionais de 1H: MMA 8 e MMA 20 ──
              const p8 = Math.min(N, 8);
              const sma8 = closes.slice(-p8).reduce((a, b) => a + b, 0) / p8;

              const p20 = Math.min(N, 20);
              const sma20 = closes.slice(-p20).reduce((a, b) => a + b, 0) / p20;

              // Distâncias percentuais em relação às médias de 1H
              const distMma8 = sma8 > 0 ? ((close - sma8) / sma8) * 100.0 : 0;
              const distMma20 = sma20 > 0 ? ((close - sma20) / sma20) * 100.0 : 0;

              // ── B. Definição Rígida da Tendência de 1H ──
              // Alta: Preço > MMA 8 E Preço > MMA 20 E MMA 8 > MMA 20
              // Baixa: Preço < MMA 8 E Preço < MMA 20 E MMA 8 < MMA 20
              const isBull1h = (close > sma8) && (close > sma20) && (sma8 > sma20);
              const isBear1h = (close < sma8) && (close < sma20) && (sma8 < sma20);
              const isNeutral1h = !isBull1h && !isBear1h;

              // ── C. EMPIRE 72H (72 velas de 1H = 3 Dias) ──
              const win72 = Math.min(N, 72);
              let sumBuy72 = 0, sumTotal72 = 0;
              for (let i = N - win72; i < N; i++) {
                sumTotal72 += quoteVols[i];
                sumBuy72 += takerBuyQuoteVols[i];
              }
              const sumSell72 = sumTotal72 - sumBuy72;
              const netAccum72h = sumBuy72 - sumSell72;
              const isAccum72h = netAccum72h > 0;

              // ── D. EMPIRE 8H (8 velas de 1H = Sessão Recente) ──
              const win8 = Math.min(N, 8);
              let sumBuy8 = 0, sumTotal8 = 0;
              for (let i = N - win8; i < N; i++) {
                sumTotal8 += quoteVols[i];
                sumBuy8 += takerBuyQuoteVols[i];
              }
              const sumSell8 = sumTotal8 - sumBuy8;
              const netAccum8h = sumBuy8 - sumSell8;
              const isAccum8h = netAccum8h > 0;

              // ── E. Amplitude e Deslocamento Direcional das últimas 8h ──
              const highs8h = highs.slice(-win8);
              const lows8h  = lows.slice(-win8);
              const max8h   = Math.max(...highs8h);
              const min8h   = Math.min(...lows8h);
              const open8h  = opens[N - win8];

              const amplitude8hPct = min8h > 0 ? ((max8h - min8h) / min8h) * 100 : 0;
              const change8hPct    = open8h > 0 ? ((close - open8h) / open8h) * 100 : 0;

              // ── F. Volume das últimas 8h vs 8h anteriores ──
              const vol8h = quoteVols.slice(-win8).reduce((a, b) => a + b, 0);
              const prevWin = Math.min(win8, Math.max(1, N - win8));
              const prevVol8h = quoteVols.slice(-win8 - prevWin, -win8).reduce((a, b) => a + b, 0);
              const volGrowth8hPct = prevVol8h > 0 ? ((vol8h - prevVol8h) / prevVol8h) * 100 : 0;
              const volRatio8h = prevVol8h > 0 ? (vol8h / prevVol8h) : 1;

              return {
                symbol,
                name,
                decimals,
                close,
                // Médias nativas de 1H
                sma8_1h: sma8,
                sma20_1h: sma20,
                distMma8,
                distMma20,
                isBull1h,
                isBear1h,
                isNeutral1h,
                // Janela de 8h
                amplitude8h: parseFloat(amplitude8hPct.toFixed(2)),
                change8h: parseFloat(change8hPct.toFixed(2)),
                volGrowth8h: Math.round(volGrowth8hPct),
                volRatio8h: parseFloat(volRatio8h.toFixed(2)),
                // Compatibilidade retroativa perfeita com frontends e rotas existentes
                sma32: sma8,
                sma80: sma20,
                distMma32: distMma8,
                distMma80: distMma20,
                diff15m: distMma8,
                isBull80: isBull1h,
                isBear80: isBear1h,
                empire: {
                  isAccum72h,
                  net72hUsd: netAccum72h,
                  isAccum8h,
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
        })(),
        resolveWeeklyBaseline(activeSymbol)
      ]);

      const validCoins = klines1hAll.filter(Boolean);
      if (!validCoins.length) {
        if (cached?.data) return res.json(cached.data);
        throw new Error('Falha ao coletar dados em 1H da cesta');
      }

      // Mescla volumes diários Spot e Futuros
      validCoins.forEach(coin => {
        const vData = dailyVolumes[coin.symbol] || { spotBonus: 0, futBonus: 0 };
        coin.spotBonus = vData.spotBonus || 0;
        coin.futBonus  = vData.futBonus  || 0;
      });

      // ── CONTAGEM E ALINHAMENTO DE 1H DA CESTA (5 PARES) ──
      const countBull1h = validCoins.filter(c => c.isBull1h).length;
      const countBear1h = validCoins.filter(c => c.isBear1h).length;
      const countNeutral1h = validCoins.length - countBull1h - countBear1h;

      const diffsMma8 = validCoins.map(c => c.distMma8);
      const avgDiff8 = diffsMma8.reduce((a, b) => a + b, 0) / diffsMma8.length;
      const posCount8 = validCoins.filter(c => c.distMma8 > 0).length;
      const negCount8 = validCoins.filter(c => c.distMma8 < 0).length;

      // Par Ativo e BTC
      const btcCoin = validCoins.find(c => c.name === 'BTC') || validCoins[0];
      const activeCoin = validCoins.find(c => c.symbol === activeSymbol) || btcCoin;
      const targetEmpire = activeCoin.empire || btcCoin.empire;

      // ── LEITURA DA MARÉ GERAL: ÍNDICE TOP 10 EM 1H ──
      let isTop10Bull1h = false;
      let isTop10Bear1h = false;
      let top10Status = 'neutral';
      let top10Text = '⚪ TOP 10 Neutro (1H)';
      let top10Info = lastKnownTop10Info || {
        statusText: '⚪ Sintonizando TOP 10 (1H)...',
        status: 'neutral',
        isBull80: false,
        isBear80: false,
        isBull1h: false,
        isBear1h: false,
        val: null,
        changePct: 0,
        sma32: null,
        sma80: null,
        sma8_1h: null,
        sma20_1h: null
      };

      // Cálculo ou recuperação do TOP 10 em 1H
      try {
        let candles10_1h = indexCache['1h']?.data?.candles;
        if ((!candles10_1h || !candles10_1h.length) && typeof marketIndex?.computeIndexCandles === 'function') {
          const top10Res1h = await marketIndex.computeIndexCandles('1h', 50);
          if (top10Res1h?.candles?.length) {
            indexCache['1h'] = { data: top10Res1h, lastUpdated: now };
            candles10_1h = top10Res1h.candles;
          }
        }

        if (candles10_1h && candles10_1h.length >= 20) {
          const N10 = candles10_1h.length;
          const closes10 = candles10_1h.map(c => c.c);
          const lastC = closes10[N10 - 1];
          const prevC = closes10[N10 - 2] || lastC;
          const sma8_10 = closes10.slice(-8).reduce((a, b) => a + b, 0) / 8;
          const sma20_10 = closes10.slice(-20).reduce((a, b) => a + b, 0) / 20;

          if (lastC > sma8_10 && lastC > sma20_10 && sma8_10 > sma20_10) {
            isTop10Bull1h = true;
            top10Status = 'bull';
            top10Text = '🟢 TOP 10 em Alta (1H > MMA 8/20)';
          } else if (lastC < sma8_10 && lastC < sma20_10 && sma8_10 < sma20_10) {
            isTop10Bear1h = true;
            top10Status = 'bear';
            top10Text = '🔴 TOP 10 em Baixa (1H < MMA 8/20)';
          } else {
            top10Status = 'neutral';
            top10Text = '⚪ TOP 10 Consolidando / Misto (1H)';
          }

          const change10 = prevC > 0 ? ((lastC - prevC) / prevC) * 100 : 0;
          const diff20_10 = sma20_10 > 0 ? ((lastC - sma20_10) / sma20_10) * 100 : 0;

          top10Info = {
            statusText: top10Text,
            status: top10Status,
            isBull80: isTop10Bull1h,
            isBear80: isTop10Bear1h,
            isBull1h: isTop10Bull1h,
            isBear1h: isTop10Bear1h,
            val: parseFloat(lastC.toFixed(2)),
            changePct: parseFloat(change10.toFixed(2)),
            diffMma80: parseFloat(diff20_10.toFixed(2)),
            sma32: parseFloat(sma8_10.toFixed(2)),
            sma80: parseFloat(sma20_10.toFixed(2)),
            sma8_1h: parseFloat(sma8_10.toFixed(2)),
            sma20_1h: parseFloat(sma20_10.toFixed(2))
          };
          lastKnownTop10Info = top10Info;
        }
      } catch (errT10) {
        console.warn('[PersonalIndex] Aviso TOP 10 1H:', errT10.message);
      }

      // ── METRICAS SEMANAIS: TUBARÕES E VAREJO (MARCO DOMINGO 19H) ──
      const topCurrent = pairDerivatives?.topLongPct ?? 50;
      const lsCurrent  = pairDerivatives?.lsLongPct  ?? 50;
      const baselineTop = weeklyBaseline?.baseTopLongPct ?? 50;
      const baselineRetail = weeklyBaseline?.baseRetailLongPct ?? 50;

      const topDeltaPct = Math.round((topCurrent - baselineTop) * 10) / 10;
      const retailDeltaPct = Math.round((lsCurrent - baselineRetail) * 10) / 10;

      // ═════════════════════════════════════════════════════════════════════
      //  CÁLCULO DO ORÁCULO DE CONFLUÊNCIA DE 1H (SCORE BASE = 50)
      // ═════════════════════════════════════════════════════════════════════
      let score = 50; // Base neutra de equilíbrio

      // ── PILAR 1: Tendência Mãe dos 5 Pares no 1H (MMA 8 e MMA 20) — Peso: ±18 pts ──
      let basketPillarText = `⚪ Cesta Mista (${countBull1h} Alta / ${countBear1h} Baixa 1H)`;
      let basketPillarState = 'neutral';
      if (countBull1h >= 4) {
        score += 18;
        basketPillarText = `🟢 ${countBull1h}/5 Pares em Alta Forte (1H)`;
        basketPillarState = 'bull';
      } else if (countBear1h >= 4) {
        score -= 18;
        basketPillarText = `🔴 ${countBear1h}/5 Pares em Baixa Forte (1H)`;
        basketPillarState = 'bear';
      } else if (countBull1h === 3) {
        score += 8;
        basketPillarText = `🟢 Maioria em Alta (3/5 no 1H)`;
        basketPillarState = 'bull';
      } else if (countBear1h === 3) {
        score -= 8;
        basketPillarText = `🔴 Maioria em Baixa (3/5 no 1H)`;
        basketPillarState = 'bear';
      }

      // ── PILAR 2: Maré Geral TOP 10 Cripto no 1H — Peso: ±12 pts ──
      if (isTop10Bull1h) {
        score += 12;
      } else if (isTop10Bear1h) {
        score -= 12;
      }

      // ── PILAR 3: Indicador EMPIRE Institucional (72h Macro e 8h Sessão) — Peso: ±22 pts ──
      let empirePillarText = '⚪ EMPIRE Equilibrado';
      let empirePillarState = 'neutral';
      const net72Val = targetEmpire.net72hUsd || 0;
      const net72Abs = Math.abs(net72Val);
      const net72Str = (net72Abs >= 1e6)
        ? `${(net72Val / 1e6).toFixed(1)}M USD`
        : `${Math.round(net72Val / 1e3)}K USD`;

      if (targetEmpire.isAccum72h) {
        score += 14;
        if (targetEmpire.isAccum8h) {
          score += 8; // Alinhamento total 72h + 8h em Acumulação
          empirePillarText = `🟢 Acúmulo Institucional (+${net72Str})`;
          empirePillarState = 'bull';
        } else {
          score -= 6; // Divergência de topo (72h verde mas 8h realizando)
          empirePillarText = `⚠️ Alerta de Topo (8h Despejo)`;
          empirePillarState = 'neutral';
        }
      } else {
        score -= 14;
        if (!targetEmpire.isAccum8h) {
          score -= 8; // Despejo total 72h + 8h
          empirePillarText = `🔴 Despejo Institucional (${net72Str})`;
          empirePillarState = 'bear';
        } else {
          score += 6; // Divergência de fundo (72h vermelha mas 8h recomprando)
          empirePillarText = `👀 Alerta de Fundo (8h Acúmulo)`;
          empirePillarState = 'neutral';
        }
      }

      // ── PILAR 4: Posição dos Tubarões Semanal (Delta Domingo 19h) — Peso: ±10 pts ──
      let sharksPillarText = `⚪ Tubarões Estáveis (${topDeltaPct >= 0 ? '+' : ''}${topDeltaPct}% sem.)`;
      let sharksPillarState = 'neutral';
      if (topDeltaPct >= 1.5) {
        score += 10;
        sharksPillarText = `🟢 Tubarões Comprando (+${topDeltaPct}% na semana)`;
        sharksPillarState = 'bull';
      } else if (topDeltaPct >= 0.5) {
        score += 5;
        sharksPillarText = `🟢 Tubarões Positivos (+${topDeltaPct}%)`;
        sharksPillarState = 'bull';
      } else if (topDeltaPct <= -1.5) {
        score -= 10;
        sharksPillarText = `🔴 Tubarões Vendendo (${topDeltaPct}% na semana)`;
        sharksPillarState = 'bear';
      } else if (topDeltaPct <= -0.5) {
        score -= 5;
        sharksPillarText = `🔴 Tubarões Negativos (${topDeltaPct}%)`;
        sharksPillarState = 'bear';
      }

      // ── PILAR 5: Dinheiro Institucional (Delta OI — Filtro de Subida Oca) — Peso: ±10 pts ──
      const deltaOi = pairDerivatives?.deltaOiUsd || 0;
      const isPriceUp1h = activeCoin.distMma8 > 0;
      if (isPriceUp1h && deltaOi < -100000) {
        // Preço subindo mas contratos sendo fechados massivamente: Subida Oca / Short Squeeze
        score -= 10;
      } else if (isPriceUp1h && deltaOi > 100000) {
        score += 8;
      } else if (!isPriceUp1h && deltaOi > 100000) {
        // Preço caindo com abertura massiva de contratos novos: Despejo institucional
        score -= 8;
      } else if (!isPriceUp1h && deltaOi < -100000) {
        // Queda com fechamento de contratos: Realização / Cobertura de venda
        score += 4;
      }

      // ── PILAR 6: Fluxo Real das Baleias CEX (24h) e Dólar/BTC — Peso: ±8 pts ──
      let flowsPillarText = '⚪ Fluxo CEX Estável';
      let flowsPillarState = 'neutral';
      const flow1d = exchangeFlowsCache?.data?.global?.totalFlow1d || 0;
      const btcFlow1d = exchangeFlowsCache?.data?.global?.btcFlow1d || 0;
      if (flow1d < -250000000 || btcFlow1d < -3000) {
        score += 8;
        flowsPillarText = `🟢 Baleias Sacando (${Math.abs(Math.round(btcFlow1d)).toLocaleString('pt-BR')} BTC)`;
        flowsPillarState = 'bull';
      } else if (flow1d > 250000000 || btcFlow1d > 3000) {
        score -= 8;
        flowsPillarText = `🔴 Alerta de Despejo (+${Math.abs(Math.round(btcFlow1d)).toLocaleString('pt-BR')} BTC)`;
        flowsPillarState = 'bear';
      }

      // ── PILAR 7: Sentimento & Alavancagem Varejo Semanal (Long/Short) — Peso: ±8 pts ──
      let leveragePillarText = `⚪ Varejo Neutro (${retailDeltaPct >= 0 ? '+' : ''}${retailDeltaPct}% sem.)`;
      let leveragePillarState = 'neutral';
      const lsLong = pairDerivatives?.lsLongPct ?? (oiData?.longShort?.binance?.longPct || 50);
      if (retailDeltaPct >= 2.0 || lsLong > 68) {
        score -= 8;
        leveragePillarText = `⚠️ Varejo Alavancado em Long (${Math.round(lsLong)}%)`;
        leveragePillarState = 'bear';
      } else if (retailDeltaPct <= -2.0 || lsLong < 36) {
        score += 8;
        leveragePillarText = `🔥 Manada Vendida (${Math.round(100 - lsLong)}% Short)`;
        leveragePillarState = 'bull';
      }

      // Fear & Greed Macro
      const fgVal = parseInt(fearGreedCache?.data?.data?.[0]?.value || 50);
      if (fgVal <= 24) score += 2;
      else if (fgVal >= 78) score -= 2;

      // ── PILAR 8: Volume vs Preço nas últimas 8h do Par Ativo — Peso: ±6 pts ──
      if (activeCoin.change8h > 0 && activeCoin.volGrowth8h > 15) {
        score += 6;
      } else if (activeCoin.change8h > 0 && activeCoin.volGrowth8h < -25) {
        score -= 6; // Subida sem volume nas 8h (Divergência)
      } else if (activeCoin.change8h < 0 && activeCoin.volGrowth8h > 15) {
        score -= 6; // Queda com volume nas 8h
      } else if (activeCoin.change8h < 0 && activeCoin.volGrowth8h < -25) {
        score += 4; // Queda sem volume nas 8h (Perda de pressão vendedora)
      }

      // ─── TRAVA DA LINHA DA VIDA (MMA 20 DO 1H) & COERÊNCIA INSTITUCIONAL ───
      const isBullWithDump = (countBull1h >= 3 && !targetEmpire.isAccum72h);
      const isBearWithAccum = (countBear1h >= 3 && targetEmpire.isAccum72h);

      if (isBullWithDump) {
        // Preço em alta mas instituições despejando: trava em zona neutra / cautela
        if (score > 56) score = 56;
        if (score < 44) score = 44;
      } else if (isBearWithAccum) {
        // Preço em baixa mas instituições acumulando: trava em zona neutra / cautela
        if (score > 56) score = 56;
        if (score < 44) score = 44;
      } else if (countBear1h >= 3 && !targetEmpire.isAccum72h) {
        // Alinhamento total de baixa
        if (score > 52) score = 52;
      } else if (countBull1h >= 3 && targetEmpire.isAccum72h) {
        // Alinhamento total de alta
        if (score < 48) score = 48;
      }

      // ─── AMORTECIMENTO SUAVE (EMA CONTRA OSCILAÇÃO DE TICK) ───
      const prevSmoothed = oracleScoreSmoothingMap.get(activeSymbol) ?? score;
      const finalSmoothedScore = Math.round((score * 0.35) + (prevSmoothed * 0.65));
      oracleScoreSmoothingMap.set(activeSymbol, finalSmoothedScore);

      score = Math.max(8, Math.min(92, finalSmoothedScore));
      const oraclePct = Math.round((score - 50) * 2);

      // ─── VEREDITO E DIREÇÃO PERMITIDA (COM HISTERESE SÓLIDA DE 1H) ───
      let verdict = 'MERCADO EM DISPUTA / NEUTRO (1H)';
      let verdictColor = '#f0b90b';
      let badgeClass = 'badge-neutral';
      let directionAllowed = 'NEUTRAL'; // 'LONG', 'SHORT', 'NEUTRAL'

      if (isBullWithDump) {
        verdict = 'DIVERGÊNCIA: PREÇO EM ALTA COM DESPEJO (CAUTELA)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'NEUTRAL';
      } else if (isBearWithAccum) {
        verdict = 'DIVERGÊNCIA: PREÇO EM BAIXA COM ACÚMULO (CAUTELA)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'NEUTRAL';
      } else if (oraclePct >= 25 && countBull1h >= 3 && targetEmpire.isAccum72h) {
        verdict = 'FORÇA COMPRADORA INSTITUCIONAL (1H)';
        verdictColor = '#0ecb81';
        badgeClass = 'badge-bull-strong';
        directionAllowed = 'LONG';
      } else if (oraclePct >= 12 && countBull1h >= 3) {
        verdict = 'VIÉS COMPRADOR MODERADO (1H)';
        verdictColor = '#0ecb81';
        badgeClass = 'badge-bull-mod';
        directionAllowed = 'LONG';
      } else if (oraclePct <= -25 && countBear1h >= 3 && !targetEmpire.isAccum72h) {
        verdict = 'FORÇA VENDEDORA INSTITUCIONAL (1H)';
        verdictColor = '#f6465d';
        badgeClass = 'badge-bear-strong';
        directionAllowed = 'SHORT';
      } else if (oraclePct <= -12 && countBear1h >= 3) {
        verdict = 'VIÉS VENDEDOR / CAUTELA (1H)';
        verdictColor = '#f6465d';
        badgeClass = 'badge-bear-mod';
        directionAllowed = 'SHORT';
      } else {
        verdict = 'MERCADO EM DISPUTA / NEUTRO (1H)';
        verdictColor = '#f0b90b';
        badgeClass = 'badge-neutral';
        directionAllowed = 'NEUTRAL';
      }

      // ═════════════════════════════════════════════════════════════════════
      //  SELEÇÃO DO PAR MAIS VANTAJOSO (AMPLITUDE + VOLUME DAS 8H NO 1H)
      // ═════════════════════════════════════════════════════════════════════
      let bestPair = null;

      // Classifica os 5 pares calculando o Ranking de Tração (Amplitude 8h + Variação 8h + Volume 8h)
      const rankedCoins = validCoins.map(c => {
        // Pontuação de Tração Operacional das últimas 8h
        const tractionScore = (c.amplitude8h * 35) + (Math.abs(c.change8h) * 45) + (Math.min(3, Math.max(0.2, c.volRatio8h)) * 20);
        return { ...c, tractionScore };
      });

      if (directionAllowed === 'LONG') {
        // Filtra pares que respeitam a tendência de ALTA no 1H (Preço >= MMA 20)
        let candidates = rankedCoins.filter(c => c.close >= (c.sma20_1h * 0.998) && c.sma8_1h >= (c.sma20_1h * 0.997));
        if (!candidates.length) candidates = rankedCoins.filter(c => c.close >= (c.sma20_1h * 0.995));
        if (!candidates.length) candidates = rankedCoins;

        // Ordena pelo par com maior tração direcional (maior amplitude útil e volume nas 8h)
        candidates.sort((a, b) => b.tractionScore - a.tractionScore);
        const topPick = candidates[0];

        // Avaliação do ponto de entrada em relação à MMA 8 de 1H
        let setupName = '';
        let isWaitingSetup = false;
        let actionMsg = '';

        if (Math.abs(topPick.distMma8) <= 0.85) {
          setupName = '🟢 PULLBACK NA MMA 8 (1H) — Reteste de Suporte / Zona de Observação';
          isWaitingSetup = false;
          actionMsg = `O par lidera em tração nas últimas 8h (Amplitude: ${topPick.amplitude8h}%, Vol: ${topPick.volGrowth8h >= 0 ? '+' : ''}${topPick.volGrowth8h}%) e está testando o suporte da MMA 8 no 1H. Stop técnico na MMA 20 ($${topPick.sma20_1h.toFixed(topPick.decimals)}).`;
        } else if (topPick.distMma8 > 2.0) {
          setupName = '⚠️ ESTICADO DA MMA 8 (1H) — Aguarde Reteste (Risco de Comprar Topo)';
          isWaitingSetup = true;
          actionMsg = `O par é o mais forte da cesta nas últimas 8h (+${topPick.change8h}%), mas está afastado +${topPick.distMma8.toFixed(2)}% da MMA 8. Não compre no topo! Aguarde recuo na média para operar com stop curto.`;
        } else {
          setupName = '▲ TENDÊNCIA DE ALTA (1H) — Em Andamento';
          isWaitingSetup = true;
          actionMsg = `Tendência mãe alinhada para alta no 1H (+${topPick.change8h}% em 8h). Aguarde aproximação da MMA 8 para validação de entrada com stop técnico na MMA 20 ($${topPick.sma20_1h.toFixed(topPick.decimals)}).`;
        }

        bestPair = {
          symbol: topPick.name,
          fullSymbol: topPick.symbol,
          isWaitingSetup,
          setupName,
          price: topPick.close,
          sma32: topPick.sma8_1h,
          sma80: topPick.sma20_1h,
          sma8_1h: topPick.sma8_1h,
          sma20_1h: topPick.sma20_1h,
          decimals: topPick.decimals,
          distMma32Pct: topPick.distMma8,
          distMma80Pct: topPick.distMma20,
          amplitude8h: topPick.amplitude8h,
          change8h: topPick.change8h,
          volRatio8h: topPick.volGrowth8h,
          spotBonus: topPick.spotBonus,
          futBonus: topPick.volGrowth8h,
          stopLossPrice: `$${topPick.sma20_1h.toFixed(topPick.decimals)}`,
          actionMsg
        };

      } else if (directionAllowed === 'SHORT') {
        // Filtra pares que respeitam a tendência de BAIXA no 1H (Preço <= MMA 20)
        let candidates = rankedCoins.filter(c => c.close <= (c.sma20_1h * 1.002) && c.sma8_1h <= (c.sma20_1h * 1.003));
        if (!candidates.length) candidates = rankedCoins.filter(c => c.close <= (c.sma20_1h * 1.005));
        if (!candidates.length) candidates = rankedCoins;

        candidates.sort((a, b) => b.tractionScore - a.tractionScore);
        const topPick = candidates[0];

        let setupName = '';
        let isWaitingSetup = false;
        let actionMsg = '';

        if (Math.abs(topPick.distMma8) <= 0.85) {
          setupName = '🔴 PULLBACK NA MMA 8 (1H) — Reteste de Resistência / Gatilho de Venda';
          isWaitingSetup = false;
          actionMsg = `O par lidera em amplitude e pressão vendedora nas últimas 8h (Amplitude: ${topPick.amplitude8h}%) e está repicando na MMA 8 do 1H. Stop técnico na MMA 20 ($${topPick.sma20_1h.toFixed(topPick.decimals)}).`;
        } else if (topPick.distMma8 < -2.0) {
          setupName = '⚠️ ESTICADO DA MMA 8 (1H) — Aguarde Repique (Risco de Vender Fundo)';
          isWaitingSetup = true;
          actionMsg = `O par sofre forte pressão (-${Math.abs(topPick.change8h)}% em 8h), mas está afastado da MMA 8. Evite vender o fundo. Aguarde repique na média para operar com stop técnico na MMA 20.`;
        } else {
          setupName = '▼ TENDÊNCIA DE BAIXA (1H) — Em Andamento';
          isWaitingSetup = true;
          actionMsg = `Tendência mãe alinhada para baixa no 1H. Aguarde repique na MMA 8 para validação de entrada com stop técnico na MMA 20 ($${topPick.sma20_1h.toFixed(topPick.decimals)}).`;
        }

        bestPair = {
          symbol: topPick.name,
          fullSymbol: topPick.symbol,
          isWaitingSetup,
          setupName,
          price: topPick.close,
          sma32: topPick.sma8_1h,
          sma80: topPick.sma20_1h,
          sma8_1h: topPick.sma8_1h,
          sma20_1h: topPick.sma20_1h,
          decimals: topPick.decimals,
          distMma32Pct: topPick.distMma8,
          distMma80Pct: topPick.distMma20,
          amplitude8h: topPick.amplitude8h,
          change8h: topPick.change8h,
          volRatio8h: topPick.volGrowth8h,
          spotBonus: topPick.spotBonus,
          futBonus: topPick.volGrowth8h,
          stopLossPrice: `$${topPick.sma20_1h.toFixed(topPick.decimals)}`,
          actionMsg
        };

      } else {
        // Mercado Neutro / Em Disputa no 1H ou Divergência
        rankedCoins.sort((a, b) => b.tractionScore - a.tractionScore);
        const topPick = rankedCoins[0] || validCoins[0];

        let setupName = '⚖️ MERCADO EM DISPUTA NO 1H / AGUARDE DEFINIÇÃO';
        let actionMsg = `Forças compradoras e vendedoras empatadas no gráfico de 1H. O par ${topPick.name} tem maior amplitude da sessão (${topPick.amplitude8h}%), mas aguarde rompimento das médias MMA 8 e MMA 20 para posicionamento.`;

        if (isBullWithDump) {
          setupName = '⚠️ DIVERGÊNCIA: PREÇO EM ALTA MAS FLUXO DESPEJANDO';
          actionMsg = `Cuidado! Os pares operam em alta no 1H, mas o EMPIRE de 72h acusa despejo institucional (${net72Str}). Não compre no topo! Aguarde teste com volume na MMA 8 do 1H.`;
        } else if (isBearWithAccum) {
          setupName = '👀 DIVERGÊNCIA: PREÇO EM BAIXA MAS FLUXO RECOMPRANDO';
          actionMsg = `Cuidado! Os pares operam em baixa no 1H, mas o EMPIRE de 72h acusa recompras institucionais (${net72Str}). Não venda no fundo! Aguarde confirmação na MMA 8 do 1H.`;
        }

        bestPair = {
          symbol: topPick.name,
          fullSymbol: topPick.symbol,
          isWaitingSetup: true,
          setupName,
          price: topPick.close,
          sma32: topPick.sma8_1h,
          sma80: topPick.sma20_1h,
          sma8_1h: topPick.sma8_1h,
          sma20_1h: topPick.sma20_1h,
          decimals: topPick.decimals,
          distMma32Pct: topPick.distMma8,
          distMma80Pct: topPick.distMma20,
          amplitude8h: topPick.amplitude8h,
          change8h: topPick.change8h,
          volRatio8h: topPick.volGrowth8h,
          spotBonus: topPick.spotBonus,
          futBonus: topPick.volGrowth8h,
          stopLossPrice: `$${topPick.sma20_1h.toFixed(topPick.decimals)}`,
          actionMsg
        };
      }

      // ─── DIAGNÓSTICO NARRATIVO INSTITUCIONAL (COPILOTO DE APOIO) ───
      const btcPriceStr = oiData?.btcPrice ? `$${Number(oiData.btcPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : `$${Math.round(btcCoin.close).toLocaleString('pt-BR')}`;
      const blackRock = exchangeFlowsCache?.data?.global?.blackRock;
      const net72M = (Math.abs(targetEmpire.net72hUsd || 0) / 1e6).toFixed(1);
      let headline = '';
      let narrative = '';

      if (isBullWithDump) {
        headline = '⚠️ CONTEXTO 1H: DIVERGÊNCIA INSTITUCIONAL (PREÇO EM ALTA MAS FLUXO DESPEJANDO)';
        narrative = `
          <div style="font-size: 1.05rem; font-weight: 800; color: #f0b90b; margin-bottom: 6px;">
            ⚠️ CONTEXTO 1H: DIVERGÊNCIA INSTITUCIONAL (PREÇO EM ALTA MAS FLUXO DESPEJANDO)
          </div>
          <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
            O Bitcoin negocia em <strong>${btcPriceStr}</strong> com <strong>${countBull1h}/5 pares da cesta</strong> acima das médias no 1H.
            Porém, o indicador <strong>EMPIRE Institucional acusa Distribuição de 72h (-${net72M}M USD)</strong>.
            Esse padrão caracteriza <em>venda passiva institucional</em> na alta (tubarões desovando na cabeça da manada).
          </p>
          <div class="narrative-verdict-highlight gray">
            👉 VISÃO DE APOIO: <strong>CAUTELA MÁXIMA. NÃO COMPRE TOPO.</strong> Par com maior tração útil: <strong>${bestPair.symbol}/USDT</strong>. 
            ${bestPair.actionMsg}
          </div>
        `;
      } else if (isBearWithAccum) {
        headline = '👀 CONTEXTO 1H: DIVERGÊNCIA INSTITUCIONAL (PREÇO EM QUEDA MAS FLUXO RECOMPRANDO)';
        narrative = `
          <div style="font-size: 1.05rem; font-weight: 800; color: #f0b90b; margin-bottom: 6px;">
            👀 CONTEXTO 1H: DIVERGÊNCIA INSTITUCIONAL (PREÇO EM QUEDA MAS FLUXO RECOMPRANDO)
          </div>
          <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
            O Bitcoin negocia em <strong>${btcPriceStr}</strong> e <strong>${countBear1h}/5 pares</strong> estão abaixo das médias no 1H.
            No entanto, o indicador <strong>EMPIRE Institucional acusa Acumulação líquida (+${net72M}M USD)</strong>.
            Esse padrão é um alerta de possível fundo ou exaustão de venda (recompra institucional).
          </p>
          <div class="narrative-verdict-highlight gray">
            👉 VISÃO DE APOIO: <strong>NÃO VENDA NO FUNDO.</strong> Aguarde o mercado confirmar rompimento da MMA 8 de 1H para validar reversão.
          </div>
        `;
      } else if (directionAllowed === 'LONG') {
        headline = '🚀 CONTEXTO 1H: TENDÊNCIA DE ALTA INSTITUCIONAL (FLUXO COMPRADOR DOMINANTE)';
        narrative = `
          <div style="font-size: 1.05rem; font-weight: 800; color: #0ecb81; margin-bottom: 6px;">
            🚀 CONTEXTO 1H: TENDÊNCIA DE ALTA INSTITUCIONAL (FLUXO COMPRADOR DOMINANTE)
          </div>
          <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
            O Bitcoin negocia em <strong>${btcPriceStr}</strong> com confluência quantitativa de 1H em <strong>+${oraclePct}%</strong>.
            A Maré Geral (TOP 10) e <strong>${countBull1h}/5 pares da cesta</strong> estão alinhados em tendência de alta no 1H (Preço > MMA 8 > MMA 20).
            O indicador EMPIRE Institucional confirma <strong>${targetEmpire.isAccum72h ? 'Acumulação líquida de 72h (+'+net72M+'M USD)' : 'Acumulação Recente'}</strong>,
            com tubarões adicionando posições na semana (${topDeltaPct >= 0 ? '+' : ''}${topDeltaPct}% desde domingo 19h).
            ${blackRock && blackRock.btcBought ? `<br><span style="color: #38bdf8;">🏛️ Rastreamento Institucional: BlackRock e ETFs Spot injetando capital (+${blackRock.btcBought.toLocaleString('pt-BR')} BTC).</span>` : ''}
          </p>
          <div class="narrative-verdict-highlight green">
            👉 VISÃO DE APOIO: <strong>VENTO A FAVOR PARA COMPRA NO 1H.</strong> Par com maior tração da sessão: <strong>${bestPair.symbol}/USDT</strong>. 
            ${bestPair.actionMsg}
          </div>
        `;
      } else if (directionAllowed === 'SHORT') {
        headline = '📉 CONTEXTO 1H: TENDÊNCIA DE BAIXA INSTITUCIONAL (FLUXO VENDEDOR NO COMANDO)';
        narrative = `
          <div style="font-size: 1.05rem; font-weight: 800; color: #f6465d; margin-bottom: 6px;">
            📉 CONTEXTO 1H: TENDÊNCIA DE BAIXA INSTITUCIONAL (FLUXO VENDEDOR NO COMANDO)
          </div>
          <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
            O Bitcoin negocia em <strong>${btcPriceStr}</strong> com pressão vendedora de 1H em <strong>${oraclePct}%</strong>.
            <strong>${countBear1h}/5 pares da cesta</strong> perderam as médias no 1H (Preço < MMA 8 < MMA 20).
            O indicador EMPIRE Institucional aponta <strong>Distribuição líquida (-${net72M}M USD nas 72h)</strong>,
            com os tubarões reduzindo exposição compradora (${topDeltaPct}% na semana).
          </p>
          <div class="narrative-verdict-highlight red">
            👉 VISÃO DE APOIO: <strong>NÃO PROCURE COMPRAS CONTRA A TENDÊNCIA DE 1H!</strong> Par com maior pressão: <strong>${bestPair.symbol}/USDT</strong>. 
            ${bestPair.actionMsg}
          </div>
        `;
      } else {
        headline = '⚖️ CONTEXTO 1H: MERCADO EM DISPUTA / EQUILÍBRIO (SEM LADO DOMINANTE)';
        narrative = `
          <div style="font-size: 1.05rem; font-weight: 800; color: #f0b90b; margin-bottom: 6px;">
            ⚖️ CONTEXTO 1H: MERCADO EM DISPUTA / EQUILÍBRIO (SEM LADO DOMINANTE)
          </div>
          <p style="margin: 0 0 8px 0; color: #c9d1d9; line-height: 1.55;">
            O Bitcoin negocia em <strong>${btcPriceStr}</strong> com índice de confluência neutro em <strong>${oraclePct >= 0 ? '+' : ''}${oraclePct}%</strong>.
            As forças de compra e venda estão equilibradas no gráfico de 1H, com médias emboladas ou sem confirmação de volume institucional.
          </p>
          <div class="narrative-verdict-highlight gray">
            👉 VISÃO DE APOIO: <strong>PACIÊNCIA E CAUTELA.</strong> Aguarde o mercado romper as médias de 1H com volume para validar uma direção clara.
          </div>
        `;
      }

      // Status text simplificado para o topo
      const sign8 = avgDiff8 > 0 ? '+' : '';
      let statusText = '';
      let statusColor = '#848e9c';
      if (avgDiff8 > 0.08) {
        statusText = `▲ ${sign8}${avgDiff8.toFixed(2)}% · MERCADO COMPRADOR (1H > MMA 8)`;
        statusColor = '#0ecb81';
      } else if (avgDiff8 < -0.08) {
        statusText = `▼ ${sign8}${avgDiff8.toFixed(2)}% · MERCADO VENDEDOR (1H < MMA 8)`;
        statusColor = '#f6465d';
      } else {
        statusText = `— ${sign8}${avgDiff8.toFixed(2)}% · MERCADO EM DISPUTA (1H)`;
        statusColor = '#eaecef';
      }

      const payload = {
        top10: top10Info,
        avgDiff: parseFloat(avgDiff8.toFixed(2)),
        posCount: posCount8,
        negCount: negCount8,
        statusText,
        statusColor,
        scoreboard: `🟢 ${countBull1h} Alta | 🔴 ${countBear1h} Baixa (1H MMA 8/20)`,
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
          timeframe: '1H',
          // Pilares com métricas macro e semanais estáveis
          pillars: {
            whales: flowsPillarText,
            taker: `📊 Vol 8h: ${activeCoin.volGrowth8h >= 0 ? '+' : ''}${activeCoin.volGrowth8h}% vs média`,
            basket: basketPillarText,
            empire: empirePillarText,
            leverage: sharksPillarText,
            sentiment: `🧭 Fear & Greed: ${fgVal}/100`
          },
          // Semáforo detalhado para index.html
          pillarsDetailed: {
            flows: { text: flowsPillarText, state: flowsPillarState },
            taker: { text: `Vol 8h: ${activeCoin.volGrowth8h >= 0 ? '+' : ''}${activeCoin.volGrowth8h}% (Amp: ${activeCoin.amplitude8h}%)`, state: activeCoin.volGrowth8h >= 0 ? 'bull' : 'bear' },
            technical: { text: basketPillarText, state: basketPillarState },
            indices: { text: top10Text, state: top10Status },
            derivatives: { text: sharksPillarText, state: sharksPillarState },
            sentiment: { text: empirePillarText, state: empirePillarState }
          }
        },
        coins: validCoins.map(c => ({
          symbol: c.symbol,
          name: c.name,
          close: c.close,
          sma8_1h: c.sma8_1h,
          sma20_1h: c.sma20_1h,
          sma32: c.sma8_1h,
          sma80: c.sma20_1h,
          diff: parseFloat(c.distMma8.toFixed(2)),
          distMma80: parseFloat(c.distMma20.toFixed(2)),
          isBull80: c.isBull1h,
          isBull1h: c.isBull1h,
          isBear1h: c.isBear1h,
          amplitude8h: c.amplitude8h,
          change8h: c.change8h,
          volGrowth8h: c.volGrowth8h,
          spotBonus: c.spotBonus,
          futBonus: c.futBonus
        })),
        cexFlow: {
          usdIn: exchangeFlowsCache?.data?.global?.inflow1dUsd || 0,
          usdOut: exchangeFlowsCache?.data?.global?.outflow1dUsd || 0,
          btcIn: exchangeFlowsCache?.data?.global?.btcInflow1d || 0,
          btcOut: exchangeFlowsCache?.data?.global?.btcOutflow1d || 0,
          btcPrice: exchangeFlowsCache?.data?.global?.btcPrice || 76000,
          treasuries: exchangeFlowsCache?.data?.global?.treasuries || null
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
      res.status(500).json({ error: 'Erro ao calcular índice pessoal de 1H' });
    }
  });

  return router;
}

module.exports = createPersonalIndexRouter;
