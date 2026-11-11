/**
 * market_index_routes.js
 * Rotas e serviços para Índice de Mercado Cripto TOP 10 e Sentimento Macro:
 * - /api/crypto-index (Índice ponderado TOP 10 Klines da Binance)
 * - /api/fear-greed (Alternative.me Fear & Greed)
 * - /api/btc-dominance (CoinGecko BTC Dominance)
 * - /api/open-interest (Open Interest Multi-Exchange)
 */

const express = require('express');
const router = express.Router();

// ── Índice de Mercado Cripto TOP 10 (Binance Klines) ─────────────────────────
const INDEX_BASKET = [
  { symbol: 'BTCUSDT',  weight: 0.40, name: 'BTC'  },
  { symbol: 'ETHUSDT',  weight: 0.20, name: 'ETH'  },
  { symbol: 'SOLUSDT',  weight: 0.07, name: 'SOL'  },
  { symbol: 'BNBUSDT',  weight: 0.06, name: 'BNB'  },
  { symbol: 'XRPUSDT',  weight: 0.06, name: 'XRP'  },
  { symbol: 'DOGEUSDT', weight: 0.05, name: 'DOGE' },
  { symbol: 'ADAUSDT',  weight: 0.04, name: 'ADA'  },
  { symbol: 'AVAXUSDT', weight: 0.04, name: 'AVAX' },
  { symbol: 'LINKUSDT', weight: 0.04, name: 'LINK' },
  { symbol: 'UNIUSDT',  weight: 0.04, name: 'UNI'  },
];

const indexCache = {}; // keyed by interval

router.get('/api/crypto-index', async (req, res) => {
  const interval = ['15m', '1h', '4h', '1d'].includes(req.query.interval) ? req.query.interval : '15m';
  const limitMap  = { '15m': 96, '1h': 72, '4h': 60, '1d': 60 };
  const cacheTtl  = { '15m': 30 * 1000, '1h': 2 * 60 * 1000, '4h': 5 * 60 * 1000, '1d': 10 * 60 * 1000 };
  const limit = limitMap[interval];
  const now   = Date.now();

  if (indexCache[interval] && (now - indexCache[interval].lastUpdated < cacheTtl[interval])) {
    return res.json(indexCache[interval].data);
  }

  try {
    const [klinesAll, futKlines] = await Promise.all([
      Promise.all(
        INDEX_BASKET.map(async ({ symbol }) => {
          for (const host of ['api.binance.com', 'data-api.binance.vision', 'api1.binance.com']) {
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 6000);
              const r = await fetch(
                `https://${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
                { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }
              );
              clearTimeout(t);
              if (r.ok) return await r.json();
            } catch (_) {}
          }
          return null;
        })
      ),
      (async () => {
        for (const host of ['fapi.binance.com', 'fapi1.binance.com']) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            const r = await fetch(
              `https://${host}/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
              { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }
            );
            clearTimeout(t);
            if (r.ok) return await r.json();
          } catch (_) {}
        }
        return null;
      })()
    ]);

    // Se algum símbolo falhou, usa cache ou erro
    if (klinesAll.some(d => !d || !d.length)) throw new Error('Falha em um ou mais símbolos');

    const minLen     = Math.min(...klinesAll.map(d => d.length));
    // Base = primeiro close do período para normalização (índice = 100 no início)
    const basePrices = klinesAll.map(d => parseFloat(d[d.length - minLen][4]));

    const candles = [];
    for (let i = 0; i < minLen; i++) {
      let o = 0, h = 0, l = 0, c = 0;
      let totalSpotVolUsd = 0;
      let netTakerSpotUsd = 0;

      INDEX_BASKET.forEach(({ weight }, si) => {
        const k    = klinesAll[si][klinesAll[si].length - minLen + i];
        const base = basePrices[si];
        o += weight * (parseFloat(k[1]) / base) * 100;
        h += weight * (parseFloat(k[2]) / base) * 100;
        l += weight * (parseFloat(k[3]) / base) * 100;
        c += weight * (parseFloat(k[4]) / base) * 100;

        const quoteVol = parseFloat(k[7]) || 0;
        const takerBuyVol = parseFloat(k[10]) || (quoteVol * 0.5);
        totalSpotVolUsd += quoteVol;
        netTakerSpotUsd += (takerBuyVol - (quoteVol - takerBuyVol));
      });

      // Volume Futuros
      let futVolUsd = totalSpotVolUsd * 2.8; // Proporção média de mercado futuros/spot se FAPI falhar
      if (futKlines && futKlines.length) {
        const fk = futKlines[Math.max(0, futKlines.length - minLen + i)];
        if (fk) futVolUsd = (parseFloat(fk[7]) || 0) * 2.2; // Escalado para o mercado multi-ativo
      }

      candles.push({
        t: klinesAll[0][klinesAll[0].length - minLen + i][0],
        o, h, l, c,
        vSpot: totalSpotVolUsd,
        vFut: futVolUsd,
        netTakerSpotUsd
      });
    }

    // Preço atual do BTC para converter fluxos em unidades físicas
    const btcLastPrice = parseFloat(klinesAll[0][klinesAll[0].length - 1][4]) || 76000;

    // Cálculo das MMAs (32 e 80) e Fluxo CEX acumulado/suavizado
    let cumFlowUsd = 0;
    let flowHistory = [];

    candles.forEach((cd, idx) => {
      // 1. Médias Móveis Aritméticas (MMA 32 e MMA 80)
      const p32 = Math.min(idx + 1, 32);
      let sum32 = 0;
      for (let j = idx - p32 + 1; j <= idx; j++) sum32 += candles[j].c;
      cd.sma32 = sum32 / p32;

      const p80 = Math.min(idx + 1, 80);
      let sum80 = 0;
      for (let j = idx - p80 + 1; j <= idx; j++) sum80 += candles[j].c;
      cd.sma80 = sum80 / p80;

      // 2. Fluxo de Capital CEX (USD e BTC) baseado 100% no saldo líquido real Taker (Buy - Sell)
      const candleFlowDelta = cd.netTakerSpotUsd;
      cumFlowUsd = (cumFlowUsd * 0.90) + candleFlowDelta; // decaimento suave mantendo fidelidade ao fluxo real
      flowHistory.push(cumFlowUsd);

      // Linha de referência (linha de média/equilíbrio de 12 períodos)
      const pRef = Math.min(idx + 1, 14);
      let sumRef = 0;
      for (let j = idx - pRef + 1; j <= idx; j++) sumRef += flowHistory[j];
      const usdRef = sumRef / pRef;

      cd.flowUsd    = cumFlowUsd;
      cd.flowUsdRef = usdRef;
      cd.flowBtc    = Math.round(cumFlowUsd / btcLastPrice);
      cd.flowBtcRef = Math.round(usdRef / btcLastPrice);
    });

    const basketDetails = INDEX_BASKET.map(({ symbol, weight, name }, si) => ({
      symbol,
      weight,
      name,
      basePrice: basePrices[si],
      lastPrice: parseFloat(klinesAll[si][klinesAll[si].length - 1][4])
    }));
    const result = { interval, candles, basket: INDEX_BASKET.map(b => b.name), basketDetails, updatedAt: now };
    indexCache[interval] = { data: result, lastUpdated: now };
    res.json(result);
  } catch (err) {
    console.error('[CryptoIndex] Erro:', err.message);
    if (indexCache[interval]) return res.json(indexCache[interval].data);
    res.status(500).json({ error: 'Falha ao calcular índice cripto' });
  }
});

// ── Fear & Greed Index (Alternative.me) — cache 1h ──────────────────────────
const fearGreedCache = { data: null, lastUpdated: 0 };

router.get('/api/fear-greed', async (req, res) => {
  const now = Date.now();
  if (fearGreedCache.data && (now - fearGreedCache.lastUpdated < 60 * 60 * 1000)) {
    return res.json(fearGreedCache.data);
  }
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=8', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    fearGreedCache.data = d;
    fearGreedCache.lastUpdated = now;
    res.json(d);
  } catch (e) {
    console.warn('[Fear&Greed] Erro:', e.message);
    res.json(fearGreedCache.data || { data: [] });
  }
});

// ── BTC Dominance (CoinGecko) — cache 5 min ──────────────────────────────────
const dominanceCache = { data: null, lastUpdated: 0 };

router.get('/api/btc-dominance', async (req, res) => {
  const now = Date.now();
  if (dominanceCache.data && (now - dominanceCache.lastUpdated < 5 * 60 * 1000)) {
    return res.json(dominanceCache.data);
  }
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    dominanceCache.data = d;
    dominanceCache.lastUpdated = now;
    res.json(d);
  } catch (e) {
    console.warn('[Dominance] Erro:', e.message);
    res.json(dominanceCache.data || {});
  }
});

// ── Open Interest Multi-Exchange (sem API key) — cache 2 min ─────────────────
const oiCache = { data: null, lastUpdated: 0 };

async function fetchOISafe(url, name) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return { name, json: await r.json() };
  } catch (e) {
    console.warn(`[OI] ${name} falhou:`, e.message);
    return null;
  }
}

router.get('/api/open-interest', async (req, res) => {
  const now = Date.now();
  if (oiCache.data && (now - oiCache.lastUpdated < 2 * 60 * 1000)) {
    return res.json(oiCache.data);
  }

  // Preço BTC para converter OI de BTC → USD
  let btcPrice = 80000;
  try {
    const pr = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const pd = await pr.json();
    btcPrice = parseFloat(pd.price) || 80000;
  } catch (e) {}

  const [binance, bybit, okx, bitget, binanceLs, binanceTaker, bybitLs] = await Promise.all([
    fetchOISafe('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', 'Binance'),
    fetchOISafe('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=1', 'Bybit'),
    fetchOISafe('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', 'OKX'),
    fetchOISafe('https://api.bitget.com/api/v2/mix/market/open-interest?symbol=BTCUSDT&productType=USDT-FUTURES', 'Bitget'),
    // Long/Short Ratio por contas (% traders long vs short)
    fetchOISafe('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', 'BinanceLongShort'),
    // Taker Buy/Sell Ratio (pressão compradora vs vendedora)
    fetchOISafe('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1', 'BinanceTaker'),
    // Long/Short Ratio Bybit
    fetchOISafe('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 'BybitLongShort'),
  ]);

  const exchanges = [];

  if (binance) {
    const oiBtc = parseFloat(binance.json.openInterest) || 0;
    if (oiBtc > 0) exchanges.push({ name: 'Binance', oiBtc, oiUsd: oiBtc * btcPrice });
  }
  if (bybit) {
    const oiBtc = parseFloat(bybit.json.result?.list?.[0]?.openInterest) || 0;
    if (oiBtc > 0) exchanges.push({ name: 'Bybit', oiBtc, oiUsd: oiBtc * btcPrice });
  }
  if (okx) {
    const oiBtc = parseFloat(okx.json.data?.[0]?.oiCcy) || 0;
    if (oiBtc > 0) exchanges.push({ name: 'OKX', oiBtc, oiUsd: oiBtc * btcPrice });
  }
  if (bitget) {
    const list = bitget.json?.data?.openInterestList;
    const sizeStr = list && list.length ? list[0].size : bitget.json?.data?.amount;
    const oiBtc = parseFloat(sizeStr) || 0;
    if (oiBtc > 0) exchanges.push({ name: 'Bitget', oiBtc, oiUsd: oiBtc * btcPrice });
  }

  const totalOiUsd = exchanges.reduce((s, e) => s + e.oiUsd, 0);

  // ── Long/Short Ratio ─────────────────────────────────────────────────────────
  const longShort = {};
  if (binanceLs) {
    const d = Array.isArray(binanceLs.json) ? binanceLs.json[0] : binanceLs.json;
    if (d && d.longAccount) {
      longShort.binance = {
        longPct:  parseFloat(d.longAccount)  * 100,
        shortPct: parseFloat(d.shortAccount) * 100,
        ratio:    parseFloat(d.longShortRatio)
      };
    }
  }
  if (bybitLs) {
    const d = bybitLs.json.result?.list?.[0];
    if (d && d.buyRatio) {
      const lp = parseFloat(d.buyRatio) * 100;
      longShort.bybit = { longPct: lp, shortPct: 100 - lp, ratio: lp / (100 - lp) };
    }
  }

  // ── Taker Buy/Sell (pressão real de mercado) ─────────────────────────────────
  let taker = null;
  if (binanceTaker) {
    const d = Array.isArray(binanceTaker.json) ? binanceTaker.json[0] : binanceTaker.json;
    if (d && d.buySellRatio) {
      const ratio = parseFloat(d.buySellRatio);
      const buyPct = (ratio / (1 + ratio)) * 100;
      taker = {
        buySellRatio: ratio,
        buyVol:  parseFloat(d.buyVol)  || 0,
        sellVol: parseFloat(d.sellVol) || 0,
        buyPct,
        sellPct: 100 - buyPct
      };
    }
  }

  const result = { btcPrice, totalOiUsd, exchanges, longShort, taker, updatedAt: now };
  oiCache.data = result;
  oiCache.lastUpdated = now;
  res.json(result);
});

module.exports = {
  router,
  indexCache,
  fearGreedCache,
  dominanceCache,
  oiCache
};
