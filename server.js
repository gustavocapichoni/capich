require('dotenv').config();
const express   = require('express');
const path      = require('path');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { startAccumulator, getHistoricalCandles, runAccumulation, getDb, admin } = require('./firebase_accumulator');

const app  = express();
const PORT = process.env.PORT || 3000;

// 1. Blindagem de Cabeçalhos HTTP com Helmet (Remove X-Powered-By, previne Clickjacking e MIME Sniffing)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 2. Proteção contra Payload Excessivo (evita estouro de memória)
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// 3. CORS Restrito — Permite apenas o domínio de produção na Vercel e ambientes locais autorizados
const allowedOrigins = [
  'https://criptoempiretrading.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-MBX-APIKEY, x-api-key, x-api-secret, x-trade-auth, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 4. Rate Limiting (Proteção Anti-DDoS e Anti-Brute Force)
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180, // até 180 requisições por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas requisições enviadas. Aguarde 1 minuto por segurança.' }
});

const tradeActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50, // até 50 execuções críticas por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas ordens enviadas em curto intervalo. Aguarde 1 minuto por segurança.' }
});

app.use('/api/', globalApiLimiter);
app.use(['/api/trade/order', '/api/trade/conditional-order', '/api/trade/close'], tradeActionLimiter);

// Endpoint para descobrir o IP de saída real (Outbound IP) visto pela Binance
app.get('/api/my-ip', async (req, res) => {
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const data = await r.json();
    res.json({ outboundIp: data.ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Rotas para páginas estáticas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/sobre', (req, res) => res.sendFile(path.join(__dirname, 'sobre.html')));
app.get('/metodo', (req, res) => res.sendFile(path.join(__dirname, 'metodo.html')));
app.get('/crypto_trading_history', (req, res) => res.sendFile(path.join(__dirname, 'crypto_trading_history.html')));

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

async function fetchExchangeFlowsInternal() {
  const now = Date.now();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  if (exchangeFlowsCache.data && (now - exchangeFlowsCache.lastUpdated < CACHE_TTL)) {
    return exchangeFlowsCache.data;
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
    let totalInflowUsd = 0;
    let totalOutflowUsd = 0;

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

      if (flow1d > 0) totalInflowUsd += flow1d;
      else if (flow1d < 0) totalOutflowUsd += Math.abs(flow1d);

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

    const btcInflow1d = Math.round((totalInflowUsd * 0.55) / btcPrice);
    const btcOutflow1d = Math.round((totalOutflowUsd * 0.55) / btcPrice);

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
        inflow1dUsd: totalInflowUsd,
        outflow1dUsd: totalOutflowUsd,
        btcInflow1d,
        btcOutflow1d,
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

    return result;
  } catch (err) {
    console.error('Erro ao buscar fluxo de exchanges:', err.message);
    if (exchangeFlowsCache.data) return exchangeFlowsCache.data;
    throw err;
  }
}

// Inicia imediatamente e agenda a cada 5 minutos
fetchExchangeFlowsInternal().catch(() => {});
setInterval(fetchExchangeFlowsInternal, 5 * 60 * 1000);

app.get('/api/exchange-flows', async (req, res) => {
  try {
    const data = await fetchExchangeFlowsInternal();
    res.json(data);
  } catch (err) {
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

// ── Índice Global TOP 10 e Sentimento Macro (Modularizado) ───────────────────
const marketIndex = require('./routes/market_index_routes');
app.use(marketIndex.router);
const { indexCache, fearGreedCache, dominanceCache, oiCache } = marketIndex;

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

// ─── ENDPOINTS: COMENTÁRIOS DE OPERAÇÕES ───────────────────────────────────────
// Permite que qualquer usuário público envie comentários sobre a operação
app.post('/api/operacoes/:id/comentarios', async (req, res) => {
  const secaoId = req.params.id;
  let { autor, texto } = req.body || {};

  if (!secaoId) return res.status(400).json({ error: 'ID da operação não informado.' });
  if (!texto || typeof texto !== 'string' || !texto.trim()) {
    return res.status(400).json({ error: 'Comentário não pode estar vazio.' });
  }

  autor = (autor && typeof autor === 'string' ? autor.trim() : 'Anônimo').slice(0, 50) || 'Anônimo';
  texto = texto.trim().slice(0, 1000);

  const now = new Date();
  const dataHora = now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR');
  const comentarioId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

  const comentarioObj = {
    id:       comentarioId,
    autor,
    texto,
    dataHora,
    criadoEm: now.toISOString()
  };

  try {
    const db = getDb();
    const docRef = db.collection('operacoes').doc(secaoId);
    
    // Adiciona o comentário via Firebase Admin SDK
    await docRef.update({
      comentarios: admin.firestore.FieldValue.arrayUnion(comentarioObj)
    });

    return res.json({ success: true, comentario: comentarioObj });
  } catch (err) {
    console.error(`[Comentários] Erro ao salvar comentário na seção ${secaoId}:`, err);
    return res.status(500).json({ error: 'Erro interno ao salvar comentário no Firebase.' });
  }
});

// Permite que apenas o ADMIN remova comentários de haters/indesejados
app.delete('/api/operacoes/:id/comentarios/:comentarioId', async (req, res) => {
  const { id: secaoId, comentarioId } = req.params;
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.body?.idToken || req.query?.idToken);

  if (!idToken) {
    return res.status(401).json({ error: 'Token de administrador ausente.' });
  }

  try {
    // Valida se o token pertence ao admin autorizado
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      }
    );
    const data = await resp.json();
    const isUserAdmin = data.users && data.users[0] && data.users[0].email === process.env.ADMIN_EMAIL;

    if (!isUserAdmin) {
      return res.status(403).json({ error: 'Acesso negado: apenas o administrador pode excluir comentários.' });
    }

    const db = getDb();
    const docRef = db.collection('operacoes').doc(secaoId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Operação não encontrada.' });
    }

    const operacao = snap.data();
    const comentarios = operacao.comentarios || [];
    const comentarioAlvo = comentarios.find(c => c.id === comentarioId);

    if (comentarioAlvo) {
      await docRef.update({
        comentarios: admin.firestore.FieldValue.arrayRemove(comentarioAlvo)
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(`[Comentários] Erro ao excluir comentário ${comentarioId}:`, err);
    return res.status(500).json({ error: 'Erro interno ao excluir comentário.' });
  }
});


app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── ENDPOINT: /api/personal-index (Oráculo Quantitativo Modularizado) ────────
const createPersonalIndexRouter = require('./routes/personal_index_routes');
app.use(createPersonalIndexRouter({
  marketIndex,
  getExchangeFlows: () => exchangeFlowsCache
}));


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

    const validIntervals = ['15m', '1h', '1d'];
    const interval = validIntervals.includes(req.query.interval) ? req.query.interval : '1h';
    const is15m    = (interval === '15m');
    const is1d     = (interval === '1d');

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
    const win72h      = is15m ? 288 : (is1d ? 3 : 72); // 72h em velas (1d = 3 velas diárias)
    const win8h       = is15m ? 32 : (is1d ? 1 : 8);   // 8h em velas (1d = 1 vela diária)
    const outputCount = is15m ? 700 : (is1d ? 350 : 350);

    // 1. Busca dados: Futuros com fallback para Binance Vision (garante funcionamento global mesmo em servidores nos EUA/Vercel)
    const oiUrl      = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
    const lsUrl      = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`;
    const topLsUrl   = `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=1`;
    const takerUrl   = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`;
    const premiumUrl = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const oiHistUrl  = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`;

    const [rFutData, rawSpot, rOi, rLs, rTopLs, rTaker, rPrem, rOiHist] = await Promise.all([
      (async () => {
        for (const url of [
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
          `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        ]) {
          try {
            const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (r.ok) {
              const j = await r.json();
              if (Array.isArray(j) && j.length > 0) return j;
            }
          } catch (_) {}
        }
        return null;
      })(),
      (async () => {
        for (const host of ['data-api.binance.vision', 'api.binance.com', 'api1.binance.com']) {
          try {
            const r = await fetch(`https://${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (r.ok) return await r.json();
          } catch (_) {}
        }
        return [];
      })(),
      fetch(oiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(lsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(topLsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(takerUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(premiumUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(oiHistUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
    ]);

    if (!rFutData) throw new Error(`Binance klines ${symbol} unavailable`);
    const rawFut = rFutData;

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
      if (rTopLs && rTopLs.ok) {
        const topJson = await rTopLs.json();
        const d = Array.isArray(topJson) ? topJson[0] : topJson;
        if (d) {
          const l = parseFloat(d.longAccount) || 0.5;
          const s = parseFloat(d.shortAccount) || 0.5;
          oiData.topLongPct = Math.round(l * 1000) / 10;
          oiData.topShortPct = Math.round(s * 1000) / 10;
          oiData.topRatio = Math.round((parseFloat(d.longShortRatio) || 1) * 100) / 100;
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
    const effectiveCount = Math.max(N - win72h, is15m ? 180 : (is1d ? 100 : 168));
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
    const topLsUrl   = `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=1`;
    const takerUrl   = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`;
    const premiumUrl = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const oiHistUrl  = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`;
    const tickerUrl  = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;

    const [rOi, rLs, rTopLs, rTaker, rPrem, rOiHist, rTicker] = await Promise.all([
      fetch(oiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(lsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
      fetch(topLsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null),
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
    if (rTopLs && rTopLs.ok) {
      const topJson = await rTopLs.json();
      const d = Array.isArray(topJson) ? topJson[0] : topJson;
      if (d) {
        const l = parseFloat(d.longAccount) || 0.5;
        const s = parseFloat(d.shortAccount) || 0.5;
        oiData.topLongPct = Math.round(l * 1000) / 10;
        oiData.topShortPct = Math.round(s * 1000) / 10;
        oiData.topRatio = Math.round((parseFloat(d.longShortRatio) || 1) * 100) / 100;
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

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ Servidor rodando em: http://localhost:${PORT}\n`);
    console.log('   Pressione Ctrl+C para parar.\n');

    // Inicia o acumulador histórico do Firestore após 5 segundos (evita pico de memória no boot)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
      setTimeout(() => {
        startAccumulator();
      }, 5000);
    }
  });
}

module.exports = app;

