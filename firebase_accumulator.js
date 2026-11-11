/**
 * firebase_accumulator.js
 * Acumulador histórico de candles OHLCV — Firestore (CAPICH)
 *
 * Estratégia: 1 documento Firestore por par+timeframe+dia
 *   Exemplo: "BTCUSDT_15m_2026-11-06" → { candles: [ {t,o,h,l,c,v,bv}, ... ] }
 *
 * Custo estimado:
 *   Escritas: ~240/dia  (1.2% do limite gratuito de 20.000)
 *   Leituras: ~300/acesso histórico (< 1% do limite de 50.000/dia)
 *   Storage:  ~30MB/ano (3% do limite de 1GB)
 *
 * Rotação automática: documentos com mais de 365 dias são deletados automaticamente
 */

const admin = require('firebase-admin');

// ─── Inicialização do Firebase Admin (singleton) ──────────────────────────────
let _db = null;

function getDb() {
  if (_db) return _db;

  if (!admin.apps.length) {
    let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      })
    });
  }

  _db = admin.firestore();
  return _db;
}

// ─── Configurações ─────────────────────────────────────────────────────────────
const PAIRS      = ['BTCUSDT', 'ETHUSDT', 'BCHUSDT', 'BNBUSDT', 'UNIUSDT'];
const TIMEFRAMES = ['15m', '1h', '1d'];
const COLLECTION = 'candle_history';
const MAX_DAYS   = 365; // Rotação automática: apaga documentos mais antigos

// ─── Utilitários ───────────────────────────────────────────────────────────────

/** Retorna a chave do documento: "BTCUSDT_15m_2026-11-06" */
function docKey(symbol, interval, dateStr) {
  return `${symbol}_${interval}_${dateStr}`;
}

/** Converte timestamp Unix (ms) para string de data UTC "YYYY-MM-DD" */
function toDateStr(tsMs) {
  return new Date(tsMs).toISOString().slice(0, 10);
}

/** Retorna a data UTC de N dias atrás como string "YYYY-MM-DD" */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Busca candles da Binance Futures ─────────────────────────────────────────

async function fetchBinanceCandles(symbol, interval, limit = 500) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${symbol} ${interval}: HTTP ${res.status}`);
  const raw = await res.json();

  return raw.map(k => ({
    t:  k[0],                    // timestamp Unix em milissegundos
    o:  parseFloat(k[1]),
    h:  parseFloat(k[2]),
    l:  parseFloat(k[3]),
    c:  parseFloat(k[4]),
    v:  parseFloat(k[5]),
    bv: parseFloat(k[9])          // taker buy base asset volume (volume de compra)
  }));
}

// ─── Salva candles no Firestore (agrupados por dia) ───────────────────────────

async function saveCandles(symbol, interval, candles) {
  const db = getDb();

  // Agrupa candles por dia (UTC)
  const byDay = {};
  for (const c of candles) {
    const ms = c.t < 10000000000 ? c.t * 1000 : c.t;
    c.t = ms;
    const dateStr = toDateStr(ms);
    if (!byDay[dateStr]) byDay[dateStr] = [];
    byDay[dateStr].push(c);
  }

  const batch = db.batch();
  let ops = 0;

  for (const [dateStr, dayCandls] of Object.entries(byDay)) {
    // Ordena por timestamp
    dayCandls.sort((a, b) => a.t - b.t);

    const ref = db.collection(COLLECTION).doc(docKey(symbol, interval, dateStr));
    batch.set(ref, {
      symbol,
      interval,
      date: dateStr,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      candles: dayCandls
    }, { merge: true });
    ops++;
  }

  if (ops > 0) {
    await batch.commit();
    console.log(`[Accumulator] ✅ ${symbol} ${interval}: ${candles.length} candles salvos em ${ops} docs`);
  }
}

// ─── Rotação automática: deleta documentos com mais de 365 dias ───────────────

async function pruneOldDocuments() {
  const db = getDb();
  // Gera chaves para dias antigos (de 365 até 380 dias atrás)
  const refsToDelete = [];

  for (let i = MAX_DAYS; i <= MAX_DAYS + 15; i++) {
    const oldDate = daysAgo(i);
    for (const symbol of PAIRS) {
      for (const interval of TIMEFRAMES) {
        refsToDelete.push(db.collection(COLLECTION).doc(docKey(symbol, interval, oldDate)));
      }
    }
  }

  // Deleta em batches de 400
  while (refsToDelete.length > 0) {
    const batch = db.batch();
    const chunk = refsToDelete.splice(0, 400);
    chunk.forEach(ref => batch.delete(ref));
    try {
      await batch.commit();
    } catch (_) {}
  }
}

// ─── Ciclo principal de acumulação ────────────────────────────────────────────

async function runAccumulation() {
  console.log('[Accumulator] 🔄 Iniciando ciclo de acumulação...');

  for (const symbol of PAIRS) {
    for (const interval of TIMEFRAMES) {
      try {
        // 15m: busca últimas 500 velas (~5,2 dias)
        // 1h:  busca últimas 500 velas (~20,8 dias)
        const candles = await fetchBinanceCandles(symbol, interval, 500);
        await saveCandles(symbol, interval, candles);

        // Aguarda 300ms entre requests para não sobrecarregar a API da Binance
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.warn(`[Accumulator] ⚠️ Erro ${symbol} ${interval}:`, err.message);
      }
    }
  }

  // Roda a limpeza de documentos antigos uma vez por dia (aleatório para não causar spike)
  const hour = new Date().getUTCHours();
  if (hour === 3) {
    await pruneOldDocuments();
  }

  console.log('[Accumulator] ✅ Ciclo concluído.');
}

// ─── Leitura do histórico do Firestore ────────────────────────────────────────

// Flag para circuit breaker quando a cota do Firestore esgotar
let firestoreQuotaExhaustedUntil = 0;

/**
 * Retorna candles históricos do Firestore para um par/timeframe
 * Busca diretamente pelas chaves dos documentos dos últimos N dias (sem necessidade de índices compostos!)
 * @param {string} symbol   - Ex: "BTCUSDT"
 * @param {string} interval - Ex: "15m" | "1h"
 * @param {number} daysBack - Quantos dias de histórico retornar (padrão: 30)
 * @returns {Array} candles ordenados por timestamp crescente
 */
async function getHistoricalCandles(symbol, interval, daysBack = 30) {
  // Se a cota estiver esgotada, pula a tentativa para não gerar lag de rede
  if (Date.now() < firestoreQuotaExhaustedUntil) {
    return [];
  }

  const db = getDb();

  try {
    // Gera as referências dos documentos para cada dia solicitado
    const docRefs = [];
    for (let i = daysBack; i >= 0; i--) {
      const dateStr = daysAgo(i);
      docRefs.push(db.collection(COLLECTION).doc(docKey(symbol, interval, dateStr)));
    }

    if (!docRefs.length) return [];

    // Busca todos os documentos em paralelo diretamente por ID
    const snaps = await db.getAll(...docRefs);

    const allCandles = [];
    snaps.forEach(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data && data.candles && Array.isArray(data.candles)) {
        data.candles.forEach(c => {
          if (c.t < 10000000000) c.t = c.t * 1000;
          allCandles.push(c);
        });
      }
    });

    // Ordena por timestamp crescente e remove sobreposições
    allCandles.sort((a, b) => a.t - b.t);
    const seen = new Set();
    return allCandles.filter(c => {
      if (seen.has(c.t)) return false;
      seen.add(c.t);
      return true;
    });

  } catch (err) {
    if (err.message && (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('Quota exceeded') || err.code === 8)) {
      firestoreQuotaExhaustedUntil = Date.now() + (30 * 60 * 1000); // Pausa por 30 minutos
      console.warn(`[Accumulator] ⚠️ Cota do Firestore esgotada. Pausando tentativas por 30min para evitar atraso nas requisições.`);
    } else {
      console.warn(`[Accumulator] Erro ao ler histórico ${symbol} ${interval}:`, err.message);
    }
    return [];
  }
}

// ─── Inicializa o acumulador com intervalo de 1 hora ─────────────────────────

function startAccumulator() {
  // Primeira execução imediata (para popular o banco na inicialização do servidor)
  runAccumulation().catch(err => console.warn('[Accumulator] Erro inicial:', err.message));

  // Repete a cada 1 hora
  const INTERVAL_MS = 60 * 60 * 1000;
  setInterval(() => {
    runAccumulation().catch(err => console.warn('[Accumulator] Erro no ciclo:', err.message));
  }, INTERVAL_MS);

  console.log('[Accumulator] 🚀 Acumulador Firebase iniciado (ciclo a cada 1h)');
}

module.exports = { startAccumulator, getHistoricalCandles, runAccumulation, getDb, admin };
