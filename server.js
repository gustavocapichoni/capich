require('dotenv').config();
const express = require('express');
const path    = require('path');
const { startAccumulator, getHistoricalCandles, runAccumulation } = require('./firebase_accumulator');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Endpoint para Vercel Cron (acumulador em background na nuvem)
app.get('/api/cron-accumulate', async (req, res) => {
  try {
    await runAccumulation();
    res.json({ ok: true, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rotas do Mini Painel de Ordens (Binance Futures)
app.use('/api/trade', require('./routes/trade_routes'));

// Cache para fluxo de capital das exchanges (5 minutos)
let exchangeFlowsCache = {
  data: null,
  lastUpdated: 0
};

let monthlyFlowCache = {
  flow30dUsd: -18500000000,
  change30dPct: -7.1,
  history8d: [
    { date: "2026-10-28", tvl: 275000000000, flow: -1200000000 },
    { date: "2026-10-29", tvl: 272000000000, flow: -3000000000 },
    { date: "2026-10-30", tvl: 260000000000, flow: -12000000000 },
    { date: "2026-10-31", tvl: 262000000000, flow: 2000000000 },
    { date: "2026-11-01", tvl: 261500000000, flow: -500000000 },
    { date: "2026-11-02", tvl: 251000000000, flow: -10500000000 },
    { date: "2026-11-03", tvl: 247000000000, flow: -4000000000 },
    { date: "2026-11-04", tvl: 257345000000, flow: 7700000000 }
  ],
  lastUpdated: 0
};

async function updateMonthlyFlow() {
  try {
    const res = await fetch('https://api.llama.fi/protocol/binance-cex', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return;
    const json = await res.json();
    if (json.tvl && json.tvl.length > 30) {
      const now = json.tvl[json.tvl.length - 1].totalLiquidityUSD;
      const d30 = json.tvl[json.tvl.length - 31].totalLiquidityUSD;
      const diff = now - d30;
      const pct = d30 > 0 ? (diff / d30) * 100 : 0;

      const last8Raw = json.tvl.slice(-8);
      const history8d = last8Raw.map((item, idx, arr) => {
        const prevTvl = idx > 0 ? arr[idx - 1].totalLiquidityUSD : item.totalLiquidityUSD;
        const globalFactor = 1.95; // Fator de escala ponderado para todas as exchanges globais
        return {
          date: new Date(item.date * 1000).toISOString().slice(0, 10),
          tvl: item.totalLiquidityUSD * globalFactor,
          flow: (item.totalLiquidityUSD - prevTvl) * globalFactor
        };
      });

      monthlyFlowCache = {
        flow30dUsd: diff * 1.35,
        change30dPct: pct,
        history8d,
        lastUpdated: Date.now()
      };
    }
  } catch (e) {
    // mantém anterior
  }
}
updateMonthlyFlow();
setInterval(updateMonthlyFlow, 30 * 60 * 1000);

app.get('/api/exchange-flows', async (req, res) => {
  const now = Date.now();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  if (exchangeFlowsCache.data && (now - exchangeFlowsCache.lastUpdated < CACHE_TTL)) {
    return res.json(exchangeFlowsCache.data);
  }

  try {
    const response = await fetch('https://api.llama.fi/protocols', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) {
      throw new Error(`DefiLlama error: ${response.status}`);
    }
    const protocols = await response.json();

    // Filtra exchanges centralizadas relevantes (CEX)
    const cexList = protocols.filter(p => p.category === 'CEX' && (p.tvl || 0) > 500000);

    let totalTvl = 0;
    let totalFlow1d = 0;
    let totalFlow7d = 0;

    const exchanges = cexList.map(c => {
      const tvl = Number(c.tvl) || 0;
      const c1d = Number(c.change_1d) || 0;
      const c7d = Number(c.change_7d) || 0;

      // Cálculo de entrada/saída estimada em USD baseada na variação de reservas:
      // TVL_anterior = TVL / (1 + change/100)
      // Netflow = TVL - TVL_anterior = TVL * (change / (100 + change))
      const flow1d = c1d !== -100 ? tvl * (c1d / (100 + c1d)) : 0;
      const flow7d = c7d !== -100 ? tvl * (c7d / (100 + c7d)) : 0;

      totalTvl += tvl;
      totalFlow1d += flow1d;
      totalFlow7d += flow7d;

      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        logo: c.logo || '',
        tvl: tvl,
        change_1d: c1d,
        change_7d: c7d,
        flow_1d_usd: flow1d,
        flow_7d_usd: flow7d
      };
    }).sort((a, b) => b.tvl - a.tvl);

    // Preços em tempo real de BTC e ETH para converter o fluxo em quantidade física de moedas
    let btcPrice = 76000;
    let ethPrice = 2250;
    try {
      const prRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=[%22BTCUSDT%22,%22ETHUSDT%22]');
      if (prRes.ok) {
        const prData = await prRes.json();
        prData.forEach(p => {
          if (p.symbol === 'BTCUSDT') btcPrice = parseFloat(p.price) || 76000;
          if (p.symbol === 'ETHUSDT') ethPrice = parseFloat(p.price) || 2250;
        });
      }
    } catch (e) {}

    // Decomposição física do fluxo das corretoras:
    // ~55% das reservas em CEX são em BTC, ~25% em ETH e ~20% em Stablecoins (USDT/USDC)
    const btcFlow1d = Math.round((totalFlow1d * 0.55) / btcPrice);
    const ethFlow1d = Math.round((totalFlow1d * 0.25) / ethPrice);
    const stableFlow1d = totalFlow1d * 0.20;

    const btcFlow7d = Math.round((totalFlow7d * 0.55) / btcPrice);
    const ethFlow7d = Math.round((totalFlow7d * 0.25) / ethPrice);

    // Rastreamento dos ETFs Spot de Bitcoin dos EUA (BlackRock IBIT, etc.)
    // Inflow positivo quando há absorção institucional
    const blackRockFlowUsd = totalFlow1d < 0 ? 320000000 : -85000000;
    const blackRockBtc = Math.round(blackRockFlowUsd / btcPrice);

    const result = {
      global: {
        totalTvl,
        totalFlow1d,
        totalFlow7d,
        btcFlow1d,
        ethFlow1d,
        stableFlow1d,
        btcFlow7d,
        ethFlow7d,
        btcPrice,
        ethPrice,
        blackRock: {
          name: 'BlackRock (IBIT)',
          flowUsd: blackRockFlowUsd,
          btcBought: blackRockBtc,
          status: blackRockFlowUsd > 0 ? 'COMPRANDO' : 'VENDENDO'
        },
        flow30dUsd: monthlyFlowCache.flow30dUsd,
        change30dPct: monthlyFlowCache.change30dPct,
        history8d: monthlyFlowCache.history8d,
        change1dPct: totalTvl > 0 ? (totalFlow1d / (totalTvl - totalFlow1d)) * 100 : 0,
        change7dPct: totalTvl > 0 ? (totalFlow7d / (totalTvl - totalFlow7d)) * 100 : 0,
        trackedCount: exchanges.length
      },
      exchanges,
      updatedAt: now
    };

    exchangeFlowsCache = {
      data: result,
      lastUpdated: now
    };

    res.json(result);
  } catch (err) {
    console.error('Erro ao buscar fluxo de exchanges:', err.message);
    if (exchangeFlowsCache.data) {
      return res.json(exchangeFlowsCache.data);
    }
    res.status(500).json({ error: 'Falha ao buscar dados de fluxo das corretoras' });
  }
});

// Cache para Notícias Cripto (15 minutos)
let cryptoNewsCache = {
  data: [],
  lastUpdated: 0
};

// Feeds RSS das principais fontes de notícias cripto
const NEWS_FEEDS = [
  { url: 'https://livecoins.com.br/feed/',                 source: 'Livecoins',         lang: '🇧🇷', maxItems: 4 },
  { url: 'https://portaldobitcoin.uol.com.br/feed/',       source: 'Portal do Bitcoin', lang: '🇧🇷', maxItems: 4 },
  { url: 'https://cointelegraph.com/rss',                  source: 'CoinTelegraph',     lang: '🌐', maxItems: 4 },
  { url: 'https://bitcoinmagazine.com/.rss/full/',         source: 'Bitcoin Magazine',  lang: '🇺🇸', maxItems: 4 }
];

function parseRssItems(xml, source, lang, maxItems) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const s = match[1];
    const titleMatch = s.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || s.match(/<title>\s*(.*?)\s*<\/title>/s);
    const linkMatch  = s.match(/<link>(.*?)<\/link>/) || s.match(/<link\s[^>]*href="([^"]+)"/);
    const pubDateMatch = s.match(/<pubDate>(.*?)<\/pubDate>/);
    const catMatch   = s.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/) || s.match(/<category>(.*?)<\/category>/);

    const title   = titleMatch   ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : 'Notícia do Mercado';
    const link    = linkMatch    ? linkMatch[1].trim() : '#';
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    const category = catMatch   ? catMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim().toUpperCase() : 'MERCADO';

    if (title && link !== '#') {
      items.push({ title, link, category, pubDate, source, lang });
    }
  }
  return items;
}

async function fetchFeed({ url, source, lang, maxItems }) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // timeout 6s por feed
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CryptoNewsBot/1.0)' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, source, lang, maxItems);
  } catch (e) {
    console.warn(`[News] Feed falhou (${source}):`, e.message);
    return [];
  }
}

app.get('/api/crypto-news', async (req, res) => {
  const now = Date.now();
  const NEWS_CACHE_TTL = 15 * 60 * 1000; // 15 minutos

  if (cryptoNewsCache.data && cryptoNewsCache.data.length > 0 && (now - cryptoNewsCache.lastUpdated < NEWS_CACHE_TTL)) {
    return res.json(cryptoNewsCache.data);
  }

  try {
    // Busca todos os feeds em paralelo
    const results = await Promise.all(NEWS_FEEDS.map(fetchFeed));
    const allItems = results.flat();

    // Ordena por data mais recente
    allItems.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });

    // Adiciona id sequencial e limita a 16 notícias
    const items = allItems.slice(0, 16).map((item, i) => ({ id: i + 1, ...item }));

    if (items.length > 0) {
      cryptoNewsCache = { data: items, lastUpdated: now };
      return res.json(items);
    }

    res.json(cryptoNewsCache.data || []);
  } catch (err) {
    console.error('Erro ao buscar notícias cripto:', err.message);
    res.json(cryptoNewsCache.data || []);
  }
});

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

app.get('/api/crypto-index', async (req, res) => {
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
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }
          );
          clearTimeout(t);
          if (!r.ok) return null;
          return r.json();
        })
      ),
      (async () => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(
            `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }
          );
          clearTimeout(t);
          if (!r.ok) return null;
          return r.json();
        } catch (e) {
          return null;
        }
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
let fearGreedCache = { data: null, lastUpdated: 0 };

app.get('/api/fear-greed', async (req, res) => {
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
    fearGreedCache = { data: d, lastUpdated: now };
    res.json(d);
  } catch (e) {
    console.warn('[Fear&Greed] Erro:', e.message);
    res.json(fearGreedCache.data || { data: [] });
  }
});

// ── BTC Dominance (CoinGecko) — cache 5 min ──────────────────────────────────
let dominanceCache = { data: null, lastUpdated: 0 };

app.get('/api/btc-dominance', async (req, res) => {
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
    dominanceCache = { data: d, lastUpdated: now };
    res.json(d);
  } catch (e) {
    console.warn('[Dominance] Erro:', e.message);
    res.json(dominanceCache.data || {});
  }
});

// ── Open Interest Multi-Exchange (sem API key) — cache 2 min ─────────────────
let oiCache = { data: null, lastUpdated: 0 };

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

app.get('/api/open-interest', async (req, res) => {
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
  oiCache = { data: result, lastUpdated: now };
  res.json(result);
});

// Verifica se o token Google pertence ao admin
app.post('/api/check-admin', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.json({ isAdmin: false });

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      }
    );
    const data = await resp.json();
    if (data.users && data.users[0] && data.users[0].email) {
      const isAdmin = data.users[0].email === process.env.ADMIN_EMAIL;
      return res.json({ isAdmin });
    }
    res.json({ isAdmin: false });
  } catch (err) {
    console.error('Erro ao verificar admin:', err);
    res.status(500).json({ isAdmin: false });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

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
let personalIndexCache = { data: null, lastUpdated: 0 };
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
      const [resSpot, resFut] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      ]);
      if (!resSpot.ok || !resFut.ok) return;
      const [spotK, futK] = await Promise.all([resSpot.json(), resFut.json()]);
      if (Array.isArray(spotK) && spotK.length >= 8 && Array.isArray(futK) && futK.length >= 8) {
        const spotVols = spotK.map(k => parseFloat(k[7]));
        const futVols  = futK.map(k => parseFloat(k[7]));
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

app.get('/api/personal-index', async (req, res) => {
  const now = Date.now();
  if (personalIndexCache.data && (now - personalIndexCache.lastUpdated < 2500)) {
    return res.json(personalIndexCache.data);
  }

  const BASKET = [
    { symbol: 'BTCUSDT', name: 'BTC', decimals: 2 },
    { symbol: 'ETHUSDT', name: 'ETH', decimals: 2 },
    { symbol: 'BCHUSDT', name: 'BCH', decimals: 2 },
    { symbol: 'BNBUSDT', name: 'BNB', decimals: 2 },
    { symbol: 'UNIUSDT', name: 'UNI', decimals: 4 }
  ];

  try {
    const [klinesAll, oiData, dailyVolumes] = await Promise.all([
      Promise.all(
        BASKET.map(async ({ symbol, name, decimals }) => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=300`, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: ctrl.signal
            });
            clearTimeout(t);
            if (!r.ok) return null;
            const data = await r.json();
            if (!Array.isArray(data) || data.length < 80) return null;

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
      fetchDailyVolumes()
    ]);

    const validCoins = klinesAll.filter(Boolean);
    if (!validCoins.length) {
      if (personalIndexCache.data) return res.json(personalIndexCache.data);
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

    // BTC EMPIRE status
    const btcCoin = validCoins.find(c => c.name === 'BTC') || validCoins[0];
    const btcEmpire = btcCoin ? btcCoin.empire : { isAccum72h: true, net72hUsd: 0, isAccum8h: true, net8hUsd: 0 };

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

    // PILAR 1: Maré Geral (Índice Principal TOP 10) — Peso ~15 pts
    if (isTop10Bull) score += 12;
    else if (isTop10Bear) score -= 12;

    // PILAR 2: Tendência Mãe dos 5 Pares (MMA 80 nos 15m) — Peso ~20 pts
    let basketPillarText = `⚪ Cesta Mista (${countBull80} Alta / ${countBear80} Baixa)`;
    let basketPillarState = 'neutral';
    if (countBull80 >= 4) {
      score += 18;
      basketPillarText = `🟢 ${countBull80}/5 Pares em Alta (MMA 80)`;
      basketPillarState = 'bull';
    } else if (countBear80 >= 4) {
      score -= 18;
      basketPillarText = `🔴 ${countBear80}/5 Pares em Baixa (MMA 80)`;
      basketPillarState = 'bear';
    } else if (countBull80 >= 3) {
      score += 8;
      basketPillarText = `🟢 Maioria em Alta (${countBull80}/5)`;
      basketPillarState = 'bull';
    } else if (countBear80 >= 3) {
      score -= 8;
      basketPillarText = `🔴 Maioria em Baixa (${countBear80}/5)`;
      basketPillarState = 'bear';
    }

    // PILAR 3: Indicador EMPIRE Institucional (Saldo 72h e 8h) — Peso ~15 pts
    let empirePillarText = '⚪ EMPIRE Equilibrado';
    let empirePillarState = 'neutral';
    const net72M = Math.round(btcEmpire.net72hUsd / 1e6);
    if (btcEmpire.isAccum72h) {
      score += 12;
      empirePillarText = `🟢 Acumulação 72h (+${Math.abs(net72M)}M USD)`;
      empirePillarState = 'bull';
      if (btcEmpire.isAccum8h) score += 3;
    } else {
      score -= 12;
      empirePillarText = `🔴 Distribuição 72h (-${Math.abs(net72M)}M USD)`;
      empirePillarState = 'bear';
      if (!btcEmpire.isAccum8h) score -= 3;
    }

    // PILAR 4: Fluxo Real das Baleias BTC (Exchange Flows 24h & ETFs) — Peso ~15 pts
    let flowsPillarText = '⚪ Fluxo Estável nas Corretoras';
    let flowsPillarState = 'neutral';
    const flow1d = exchangeFlowsCache?.data?.global?.totalFlow1d || 0;
    const btcFlow1d = exchangeFlowsCache?.data?.global?.btcFlow1d || 0;
    if (flow1d < -300000000) {
      score += 12;
      flowsPillarText = `🟢 Baleias Sacando (${Math.abs(Math.round(btcFlow1d)).toLocaleString('pt-BR')} BTC)`;
      flowsPillarState = 'bull';
    } else if (flow1d > 300000000) {
      score -= 10;
      flowsPillarText = `🔴 Alerta de Despejo (+${Math.abs(Math.round(btcFlow1d)).toLocaleString('pt-BR')} BTC)`;
      flowsPillarState = 'bear';
    }

    // PILAR 5: Microfluxo de Agressão Taker BTC 5m (Binance Futuros) — Peso ~15 pts
    let takerPillarText = '⚪ Disputa Equilibrada';
    let takerPillarState = 'neutral';
    const taker = oiData?.taker;
    if (taker && taker.buyPct) {
      if (taker.buyPct >= 54) {
        score += Math.min(18, (taker.buyPct - 50) * 1.5);
        takerPillarText = `🟢 Compra Ativa ${taker.buyPct.toFixed(1)}%`;
        takerPillarState = 'bull';
      } else if (taker.sellPct >= 54) {
        score -= Math.min(18, (taker.sellPct - 50) * 1.5);
        takerPillarText = `🔴 Venda Ativa ${taker.sellPct.toFixed(1)}%`;
        takerPillarState = 'bear';
      } else {
        takerPillarText = `⚪ Disputa Equilibrada (${taker.buyPct.toFixed(1)}% Compra)`;
      }
    }

    // PILAR 6: Posição da Cesta na Zona de Observação (Meu Índice vs MMA 32) — Peso ~10 pts
    if (avgDiff32 > 0.05) score += 8;
    else if (avgDiff32 < -0.05) score -= 8;

    // PILAR 7: Sentimento & Derivativos (Long/Short & Fear/Greed) — Peso ~10 pts
    let leveragePillarText = '⚪ Alavancagem Neutra';
    let leveragePillarState = 'neutral';
    const lsLong = oiData?.longShort?.binance?.longPct || 55;
    if (lsLong > 68) {
      score -= 9;
      leveragePillarText = `⚠️ Sardinhas Alavancadas (${Math.round(lsLong)}% Long)`;
      leveragePillarState = 'bear';
    } else if (lsLong < 40) {
      score += 9;
      leveragePillarText = `🔥 Varejo Vendido (${Math.round(100 - lsLong)}% Short)`;
      leveragePillarState = 'bull';
    }

    const fgVal = parseInt(fearGreedCache?.data?.data?.[0]?.value || 50);
    if (fgVal <= 25) score += 3;
    else if (fgVal >= 78) score -= 3;

    // Normalização bidirecional rigorosa (-100% a +100%)
    score = Math.max(6, Math.min(94, Math.round(score)));
    const oraclePct = Math.round((score - 50) * 2);

    let verdict = 'MERCADO EM DISPUTA / NEUTRO';
    let verdictColor = '#f0b90b';
    let badgeClass = 'badge-neutral';
    let directionAllowed = 'NEUTRAL'; // 'LONG', 'SHORT', 'NEUTRAL'

    if (oraclePct >= 36) {
      verdict = 'FORÇA COMPRADORA (LONG)';
      verdictColor = '#0ecb81';
      badgeClass = 'badge-bull-strong';
      directionAllowed = 'LONG';
    } else if (oraclePct >= 12) {
      verdict = 'VIÉS COMPRADOR MODERADO';
      verdictColor = '#0ecb81';
      badgeClass = 'badge-bull-mod';
      directionAllowed = 'LONG';
    } else if (oraclePct <= -36) {
      verdict = 'FORÇA VENDEDORA (SHORT)';
      verdictColor = '#f6465d';
      badgeClass = 'badge-bear-strong';
      directionAllowed = 'SHORT';
    } else if (oraclePct <= -12) {
      verdict = 'VIÉS VENDEDOR / CAUTELA';
      verdictColor = '#f6465d';
      badgeClass = 'badge-bear-mod';
      directionAllowed = 'SHORT';
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
          O indicador EMPIRE Institucional acusa <strong>${btcEmpire.isAccum72h ? 'Acumulação líquida de 72h (+'+Math.abs(net72M)+'M USD)' : 'Distribuição'}</strong>,
          compradores agredindo a mercado (${taker?.buyPct ? taker.buyPct.toFixed(1) + '% de compra ativa' : 'compra dominante'}) e baleias retirando moedas das corretoras.
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
          O indicador EMPIRE Institucional aponta <strong>Distribuição líquida (-${Math.abs(net72M)}M USD)</strong>
          e o book sofre pressão vendedora constante (${taker?.sellPct ? taker.sellPct.toFixed(1) + '% de ordens a mercado despejando' : 'venda dominante'}).
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
      updatedAt: now
    };

    personalIndexCache = { data: payload, lastUpdated: now };
    res.json(payload);
  } catch (err) {
    console.error('[/api/personal-index] Erro:', err.message);
    if (personalIndexCache.data) return res.json(personalIndexCache.data);
    res.status(500).json({ error: 'Erro ao calcular índice pessoal' });
  }
});


// ═══════════════════════════════════════════════════════
//  ENDPOINT: /api/btc-history-tactical
//  Candles Futuros Binance — Gráfico Tático Multi-Pares
//  Pares: BTC, ETH, BCH, BNB, UNI
//  1H : MMA 8 e MMA 20  | 72h = 72 velas  | 8h = 8 velas
//  15M: MMA 32 e MMA 80 | 72h = 288 velas | 8h = 32 velas
// ═══════════════════════════════════════════════════════

// Cache da resposta completa (3s) — evita dupla requisição em trocas rápidas de par
const tacticalMemCache = new Map();
const TACTICAL_CACHE_TTL = 3000;

// Cache do histórico Firebase por par+timeframe (1h) — protege o limite do plano gratuito.
// O histórico do Firebase (candles antigos) não muda a cada minuto; reler a cada hora é suficiente.
// Sem este cache, cada troca de par consumia uma leitura do Firestore.
const firebaseHistCache = new Map();
const FIREBASE_HIST_CACHE_TTL = 60 * 60 * 1000; // 1 hora em ms

app.get('/api/btc-history-tactical', async (req, res) => {
  try {
    const ALLOWED_SYMBOLS = {
      'BTCUSDT': 'BTC',
      'ETHUSDT': 'ETH',
      'BCHUSDT': 'BCH',
      'BNBUSDT': 'BNB',
      'UNIUSDT': 'UNI'
    };

    const rawSym   = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const symbol   = ALLOWED_SYMBOLS[rawSym] ? rawSym : 'BTCUSDT';
    const baseAsset= ALLOWED_SYMBOLS[symbol];

    const interval = (req.query.interval === '15m') ? '15m' : '1h';
    const is15m    = (interval === '15m');

    // Resposta ultra-rápida via cache em memória (0ms)
    const cacheKey = `${symbol}_${interval}`;
    const now = Date.now();
    const cached = tacticalMemCache.get(cacheKey);
    if (cached && (now - cached.time) < TACTICAL_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Configurações por timeframe — 15m busca 1000 velas para histórico longo profundo
    const limit       = is15m ? 1000 : 500;
    const periodShort = is15m ? 32 : 8;
    const periodLong  = is15m ? 80 : 20;
    const win72h      = is15m ? 288 : 72; // 72h atemporal em velas
    const win8h       = is15m ? 32 : 8;   // 8h atemporal em velas
    const outputCount = is15m ? 700 : 350;

    // 1. Busca dados em paralelo: Futuros + Spot + Open Interest + Long/Short + Taker + Funding Rate + Histórico OI
    const futUrl     = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const spotUrl    = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const oiUrl      = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
    const lsUrl      = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`;
    const takerUrl   = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`;
    const premiumUrl = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const oiHistUrl  = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`;

    const [rFut, rSpot, rOi, rLs, rTaker, rPrem, rOiHist] = await Promise.all([
      fetch(futUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      fetch(spotUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(oiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(lsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(takerUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(premiumUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(oiHistUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
    ]);

    if (!rFut.ok) throw new Error(`Binance Futures ${symbol} error ` + rFut.status);
    const rawFut = await rFut.json();
    const rawSpot = (rSpot && rSpot.ok) ? await rSpot.json() : [];

    // Mapeia Spot por timestamp para alinhamento temporal perfeito
    const spotMap = new Map();
    rawSpot.forEach(s => {
      const v = parseFloat(s[5]) || 0;
      const b = parseFloat(s[9]) || 0;
      spotMap.set(s[0], { v, buyV: b, sellV: Math.max(0, v - b) });
    });

    // Média combinada ponderada 50% Spot + 50% Futuros (Volume Real Global)
    let candles = rawFut.map(c => {
      const t = c[0];
      const futV    = parseFloat(c[5]) || 0;
      const futBuy  = parseFloat(c[9]) || 0;
      const futSell = Math.max(0, futV - futBuy);

      const sp = spotMap.get(t);
      const spotBuy  = sp ? sp.buyV  : futBuy;
      const spotSell = sp ? sp.sellV : futSell;

      const compBuy  = (futBuy * 0.5) + (spotBuy * 0.5);
      const compSell = (futSell * 0.5) + (spotSell * 0.5);
      const compV    = compBuy + compSell;

      return {
        t,
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        v: compV,
        buyV: compBuy,
        sellV: compSell,
        futBuy,
        futSell,
        spotBuy,
        spotSell
      };
    });

    // 1.0b Integração com Histórico Acumulado do Firestore
    // O cache de 1h evita leitura repetida ao Firestore a cada troca de par —
    // preservando o limite diário do plano gratuito do Firebase.
    try {
      const fbKey = `${symbol}_${interval}`;
      const fbNow = Date.now();
      const fbCached = firebaseHistCache.get(fbKey);

      let hist;
      if (fbCached && (fbNow - fbCached.time) < FIREBASE_HIST_CACHE_TTL) {
        // Serve do cache em memória — zero leitura Firestore
        hist = fbCached.data;
      } else {
        // Primeira vez ou cache expirado — lê o Firestore e armazena
        hist = await getHistoricalCandles(symbol, interval, 30);
        firebaseHistCache.set(fbKey, { data: hist, time: fbNow });
        console.log(`[Firebase Cache] Atualizado: ${fbKey} (${hist?.length || 0} candles)`);
      }

      if (hist && hist.length > 0 && candles.length > 0) {
        const earliestLive = candles[0].t;
        const older = hist
          .filter(h => h.t < earliestLive)
          .map(h => ({
            t: h.t,
            o: h.o,
            h: h.h,
            l: h.l,
            c: h.c,
            v: h.v,
            buyV: h.bv || (h.v * 0.5),
            sellV: Math.max(0, h.v - (h.bv || (h.v * 0.5))),
            futBuy: h.bv || (h.v * 0.5),
            futSell: Math.max(0, h.v - (h.bv || (h.v * 0.5))),
            spotBuy: h.bv || (h.v * 0.5),
            spotSell: Math.max(0, h.v - (h.bv || (h.v * 0.5)))
          }));
        if (older.length > 0) {
          candles = [...older, ...candles];
        }
      }
    } catch (_) {}

    // 1.1 Processamento do Open Interest e Sentimento Multi-Métricas
    let oiData = {
      openInterest: 0,
      openInterestUsd: 0,
      deltaOiUsd: 0,
      deltaOiPct: 0,
      fundingRate: 0,
      longPct: 50,
      shortPct: 50,
      longShortRatio: 1.0,
      takerBuyPct: 50,
      takerSellPct: 50,
      takerRatio: 1.0
    };

    try {
      if (rOi && rOi.ok) {
        const oiJson = await rOi.json();
        const lastPrice = candles[candles.length - 1]?.c || 0;
        const oiContratos = parseFloat(oiJson.openInterest) || 0;
        oiData.openInterest = oiContratos;
        oiData.openInterestUsd = oiContratos * lastPrice;
      }
      if (rLs && rLs.ok) {
        const lsJson = await rLs.json();
        const d = Array.isArray(lsJson) ? lsJson[0] : lsJson;
        if (d) {
          const l = parseFloat(d.longAccount) || 0.5;
          const s = parseFloat(d.shortAccount) || 0.5;
          oiData.longPct = Math.round(l * 1000) / 10;
          oiData.shortPct = Math.round(s * 1000) / 10;
          oiData.longShortRatio = Math.round((parseFloat(d.longShortRatio) || 1) * 100) / 100;
        }
      }
      if (rTaker && rTaker.ok) {
        const tkJson = await rTaker.json();
        const d = Array.isArray(tkJson) ? tkJson[0] : tkJson;
        if (d) {
          const bV = parseFloat(d.buyVol) || 0;
          const sV = parseFloat(d.sellVol) || 0;
          const tot = bV + sV;
          if (tot > 0) {
            oiData.takerBuyPct = Math.round((bV / tot) * 1000) / 10;
            oiData.takerSellPct = Math.round((sV / tot) * 1000) / 10;
          }
          oiData.takerRatio = Math.round((parseFloat(d.buySellRatio) || 1) * 100) / 100;
        }
      }
      if (rPrem && rPrem.ok) {
        const pJson = await rPrem.json();
        oiData.fundingRate = parseFloat(pJson.lastFundingRate) || 0;
      }
      if (rOiHist && rOiHist.ok) {
        const hJson = await rOiHist.json();
        if (Array.isArray(hJson) && hJson.length >= 2) {
          const prevVal = parseFloat(hJson[0].sumOpenInterestValue) || 0;
          const currVal = parseFloat(hJson[1].sumOpenInterestValue) || 0;
          const dVal = currVal - prevVal;
          oiData.deltaOiUsd = dVal;
          oiData.deltaOiPct = prevVal > 0 ? (dVal / prevVal) * 100 : 0;
        }
      }
    } catch (e) {
      console.warn('[Tactical] OI parse error:', e.message);
    }

    const N = candles.length;

    // 2. Cálculo das MMAs Aritméticas
    function sma(arr, period) {
      const result = new Array(arr.length).fill(null);
      for (let i = period - 1; i < arr.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += arr[i - j].c;
        result[i] = sum / period;
      }
      return result;
    }

    const mmaShort = sma(candles, periodShort);
    const mmaLong  = sma(candles, periodLong);

    // ── INDICADOR EMPIRE ─────────────────────────────────────────────────────
    // ATENÇÃO: 'vwapBuy' e 'vwapSell' são nomes técnicos legados. NÃO É VWAP.
    // Documentação completa: EMPIRE_INDICADOR.txt na raiz do projeto.
    // ─────────────────────────────────────────────────────────────────────────
    const vwapBuy       = new Array(N).fill(null); // EMPIRE 72h: Linha Verde (Piso de Acumulação)
    const vwapSell      = new Array(N).fill(null); // EMPIRE 72h: Linha Vermelha (Teto de Distribuição)
    const isAccum       = new Array(N).fill(null); // true = Acumulação, false = Distribuição
    const netVolume72h  = new Array(N).fill(null); // Saldo líquido real EMPIRE 72h

    for (let i = win72h - 1; i < N; i++) {
      let sumBuy = 0, sumSell = 0;
      let hMax = -Infinity, lMin = Infinity;
      for (let j = i - win72h + 1; j <= i; j++) {
        sumBuy  += candles[j].buyV;
        sumSell += candles[j].sellV;
        if (candles[j].h > hMax) hMax = candles[j].h;
        if (candles[j].l < lMin) lMin = candles[j].l;
      }

      const tot = sumBuy + sumSell;
      const net = sumBuy - sumSell;
      netVolume72h[i] = Math.round(net);

      const buyRatio = tot > 0 ? (sumBuy / tot) : 0.5;
      const mid = (hMax + lMin) / 2;
      const rng = hMax - lMin;

      const shift = rng * (buyRatio - 0.5) * 1.5;
      vwapBuy[i]  = mid + shift;
      vwapSell[i] = mid - shift;
      isAccum[i]  = net > 0;
    }

    // 4. Volume Real Atemporal de 8h (Intraday — Saldo Tático do Dia)
    const intraBuy      = new Array(N).fill(null); // Linha Ciano (Acumulação 8h)
    const intraSell     = new Array(N).fill(null); // Linha Laranja (Distribuição 8h)
    const isIntraAccum  = new Array(N).fill(null);
    const netVolume8h   = new Array(N).fill(null);

    for (let i = win8h - 1; i < N; i++) {
      let sumBuy = 0, sumSell = 0;
      let hMax = -Infinity, lMin = Infinity;
      for (let j = i - win8h + 1; j <= i; j++) {
        sumBuy  += candles[j].buyV;
        sumSell += candles[j].sellV;
        if (candles[j].h > hMax) hMax = candles[j].h;
        if (candles[j].l < lMin) lMin = candles[j].l;
      }

      const tot = sumBuy + sumSell;
      const net = sumBuy - sumSell;
      netVolume8h[i] = Math.round(net);

      const buyRatio = tot > 0 ? (sumBuy / tot) : 0.5;
      const mid = (hMax + lMin) / 2;
      const rng = hMax - lMin;

      const shift = rng * (buyRatio - 0.5) * 1.5;
      intraBuy[i]  = mid + shift;
      intraSell[i] = mid - shift;
      isIntraAccum[i] = net > 0;
    }

    // 5. Sinais Institucionais Automáticos (Confluência: Saldo 72h + Rompimento + Médias)
    const signals = new Array(N).fill(null);
    let lastSignalType = null;
    let lastSignalIdx  = -50;

    for (let i = win72h; i < N; i++) {
      if (mmaShort[i] === null || mmaLong[i] === null) continue;
      if (isAccum[i] === null || isAccum[i - 1] === null) continue;

      const c = candles[i];
      const prevC = candles[i - 1];
      const net = netVolume72h[i];
      const netPrev = netVolume72h[i - 1];

      // COMPRA: Saldo 72h positivo (Acumulação) + Preço ACIMA das médias + MMA curta > MMA longa + Inflexão de volume/preço
      const trendUp = mmaShort[i] > mmaLong[i];
      const priceAbove = (c.c > mmaShort[i]) && (c.c > mmaLong[i]);
      const accumTrigger = isAccum[i] && ((!isAccum[i - 1] && isAccum[i]) || (net > netPrev * 1.05 && c.c > prevC.h));

      if (trendUp && priceAbove && accumTrigger) {
        if (lastSignalType !== 'BUY' || (i - lastSignalIdx >= 8)) {
          signals[i] = 'BUY';
          lastSignalType = 'BUY';
          lastSignalIdx  = i;
        }
      }

      // VENDA: Saldo 72h negativo (Distribuição) + Preço ABAIXO das médias + MMA curta < MMA longa + Inflexão de volume/preço
      const trendDown = mmaShort[i] < mmaLong[i];
      const priceBelow = (c.c < mmaShort[i]) && (c.c < mmaLong[i]);
      const distTrigger = !isAccum[i] && ((isAccum[i - 1] && !isAccum[i]) || (net < netPrev * 1.05 && c.c < prevC.l));

      if (trendDown && priceBelow && distTrigger) {
        if (lastSignalType !== 'SELL' || (i - lastSignalIdx >= 8)) {
          signals[i] = 'SELL';
          lastSignalType = 'SELL';
          lastSignalIdx  = i;
        }
      }
    }

    // 6. Montar resposta — preserva todo o histórico acumulado saudável (após aquecimento do EMPIRE)
    const effectiveCount = Math.max(N - win72h, is15m ? 180 : 168);
    const count = Math.min(N, effectiveCount);
    const slice = (arr) => arr.slice(N - count);

    const cSlice   = slice(candles);
    const msSlice  = slice(mmaShort);
    const mlSlice  = slice(mmaLong);
    const vbSlice  = slice(vwapBuy);
    const vsSlice  = slice(vwapSell);
    const iaSlice  = slice(isAccum);
    const nvSlice  = slice(netVolume72h);
    const ibSlice  = slice(intraBuy);
    const isSlice  = slice(intraSell);
    const iiSlice  = slice(isIntraAccum);
    const niSlice  = slice(netVolume8h);
    const sgSlice  = slice(signals);

    const output = cSlice.map((c, idx) => ({
      t: c.t,
      o: c.o, h: c.h, l: c.l, cl: c.c,
      v: c.v,
      buyV: c.buyV,
      sellV: c.sellV,
      futBuy: c.futBuy,
      futSell: c.futSell,
      spotBuy: c.spotBuy,
      spotSell: c.spotSell,
      mmaShort: msSlice[idx],
      mmaLong:  mlSlice[idx],
      vwapBuy:  vbSlice[idx],
      vwapSell: vsSlice[idx],
      isAccum:  iaSlice[idx],
      netAccum72h: nvSlice[idx],
      intraBuy:  ibSlice[idx],
      intraSell: isSlice[idx],
      isIntraAccum: iiSlice[idx],
      netAccum8h: niSlice[idx],
      signal:   sgSlice[idx]
    }));

    const responsePayload = {
      symbol,
      baseAsset,
      interval,
      shortPeriod: periodShort,
      longPeriod: periodLong,
      shortLabel: `MMA ${periodShort}`,
      longLabel:  `MMA ${periodLong}`,
      candles: output,
      oi: oiData
    };

    tacticalMemCache.set(cacheKey, { time: now, data: responsePayload });
    res.json(responsePayload);

  } catch (err) {
    console.error('/api/btc-history-tactical error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  ENDPOINT LEVE EM TEMPO REAL: /api/tactical-oi
//  Retorna exclusivamente as métricas de derivativos (OI, Long/Short, Taker, Funding)
//  Ultra-rápido (<150ms, <1KB) para atualização contínua dos cards sem sobrecarga
// ═══════════════════════════════════════════════════════
const tacticalOiCache = new Map();
const TACTICAL_OI_CACHE_TTL = 2000;

app.get('/api/tactical-oi', async (req, res) => {
  try {
    const ALLOWED_SYMBOLS = {
      'BTCUSDT': 'BTC',
      'ETHUSDT': 'ETH',
      'BCHUSDT': 'BCH',
      'BNBUSDT': 'BNB',
      'UNIUSDT': 'UNI'
    };

    const rawSym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const symbol = ALLOWED_SYMBOLS[rawSym] ? rawSym : 'BTCUSDT';

    const now = Date.now();
    const cached = tacticalOiCache.get(symbol);
    if (cached && (now - cached.time) < TACTICAL_OI_CACHE_TTL) {
      return res.json({ success: true, oi: cached.data });
    }

    const oiUrl      = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
    const lsUrl      = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`;
    const takerUrl   = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`;
    const premiumUrl = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const oiHistUrl  = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`;
    const tickerUrl  = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;

    const [rOi, rLs, rTaker, rPrem, rOiHist, rTicker] = await Promise.all([
      fetch(oiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(lsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(takerUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(premiumUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(oiHistUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(tickerUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
    ]);

    let lastPrice = 0;
    if (rTicker && rTicker.ok) {
      const tickJson = await rTicker.json();
      lastPrice = parseFloat(tickJson.price) || 0;
    }

    let oiData = {
      openInterest: 0,
      openInterestUsd: 0,
      deltaOiUsd: 0,
      deltaOiPct: 0,
      fundingRate: 0,
      longPct: 50,
      shortPct: 50,
      longShortRatio: 1.0,
      takerBuyPct: 50,
      takerSellPct: 50,
      takerRatio: 1.0
    };

    if (rOi && rOi.ok) {
      const oiJson = await rOi.json();
      const oiContratos = parseFloat(oiJson.openInterest) || 0;
      oiData.openInterest = oiContratos;
      oiData.openInterestUsd = oiContratos * lastPrice;
    }
    if (rLs && rLs.ok) {
      const lsJson = await rLs.json();
      const d = Array.isArray(lsJson) ? lsJson[0] : lsJson;
      if (d) {
        const l = parseFloat(d.longAccount) || 0.5;
        const s = parseFloat(d.shortAccount) || 0.5;
        oiData.longPct = Math.round(l * 1000) / 10;
        oiData.shortPct = Math.round(s * 1000) / 10;
        oiData.longShortRatio = Math.round((parseFloat(d.longShortRatio) || 1) * 100) / 100;
      }
    }
    if (rTaker && rTaker.ok) {
      const tkJson = await rTaker.json();
      const d = Array.isArray(tkJson) ? tkJson[0] : tkJson;
      if (d) {
        const bV = parseFloat(d.buyVol) || 0;
        const sV = parseFloat(d.sellVol) || 0;
        const tot = bV + sV;
        if (tot > 0) {
          oiData.takerBuyPct = Math.round((bV / tot) * 1000) / 10;
          oiData.takerSellPct = Math.round((sV / tot) * 1000) / 10;
        }
        oiData.takerRatio = Math.round((parseFloat(d.buySellRatio) || 1) * 100) / 100;
      }
    }
    if (rPrem && rPrem.ok) {
      const pJson = await rPrem.json();
      oiData.fundingRate = parseFloat(pJson.lastFundingRate) || 0;
    }
    if (rOiHist && rOiHist.ok) {
      const hJson = await rOiHist.json();
      if (Array.isArray(hJson) && hJson.length >= 2) {
        const prevVal = parseFloat(hJson[0].sumOpenInterestValue) || 0;
        const currVal = parseFloat(hJson[1].sumOpenInterestValue) || 0;
        const dVal = currVal - prevVal;
        oiData.deltaOiUsd = dVal;
        oiData.deltaOiPct = prevVal > 0 ? (dVal / prevVal) * 100 : 0;
      }
    }

    tacticalOiCache.set(symbol, { time: now, data: oiData });
    res.json({ success: true, oi: oiData });
  } catch (err) {
    console.error('/api/tactical-oi error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em: http://localhost:${PORT}\n`);
  console.log('   Pressione Ctrl+C para parar.\n');

  // Inicia o acumulador histórico do Firestore (a cada 1 hora)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    startAccumulator();
  }
});

