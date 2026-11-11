/**
 * js/tactical/state.js
 * Gerenciamento de estado, constantes de mercado e preferências do Gráfico Tático.
 */

export const API_URL = '/api/btc-history-tactical';

export const PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC', base: 'BTC' },
  { symbol: 'ETHUSDT', label: 'ETH', base: 'ETH' },
  { symbol: 'BCHUSDT', label: 'BCH', base: 'BCH' },
  { symbol: 'BNBUSDT', label: 'BNB', base: 'BNB' },
  { symbol: 'UNIUSDT', label: 'UNI', base: 'UNI' }
];

export const state = {
  currentSymbol: 'BTCUSDT',
  baseAsset: 'BTC',
  currentTimeframe: '1h',
  candles: [],
  oi: {},
  globalOi: null,
  meta: {
    shortLabel: 'MMA 8',
    longLabel: 'MMA 20',
    shortPeriod: 8,
    longPeriod: 20
  },
  charts: { main: null },
  series: {
    candles: null,
    mmaShort: null,
    mmaLong: null,
    // ── INDICADOR EMPIRE ─────────────────────────────────────────────────────
    // ATENÇÃO: 'vwapBuy/vwapSell/intraBuy/intraSell' são nomes técnicos legados. NÃO É VWAP.
    // Documentação completa: EMPIRE_INDICADOR.txt na raiz do projeto.
    // ─────────────────────────────────────────────────────────────────────────
    vwapBuy: null,   // EMPIRE 72h Piso de Acumulação (Verde)
    vwapSell: null,  // EMPIRE 72h Teto de Distribuição (Vermelho)
    intraBuy: null,  // EMPIRE 8h Piso de Acumulação (Ciano)
    intraSell: null  // EMPIRE 8h Teto de Distribuição (Laranja)
  },
  personalBasket: {
    avgDiff: 0,
    posCount: 0,
    negCount: 0,
    statusText: 'Sincronizando cesta...',
    statusColor: '#848e9c',
    scoreboard: 'Carregando cesta...',
    oracle: {
      pct: 0,
      pctText: '--%',
      verdict: 'Sincronizando...',
      color: '#848e9c'
    }
  },
  maVisible: true,
  indicatorsVisible: true,
  zonesVisible: true,
  empireTagsVisible: true,
  priceLineVisible: false, // Linha tracejada do preço atual (desativada por padrão)
  isHovering: false,
  fibo: {
    active: false,
    drawing: false,
    isDragging: false,
    dragAnchor: null, // 'p1' | 'p2' | 'line'
    dragStart: null,
    p1: null, // { time, price }
    p2: null, // { time, price }
    alert2618: {
      armed: false,       // true quando está monitorando o cruzamento
      triggered: false,   // true quando já disparou (evita re-disparo imediato)
      soundActive: false, // true enquanto o som está tocando
      approachDir: null   // 'up' (espera romper pra cima) ou 'down' (espera romper pra baixo)
    }
  },
  fibo2: {
    active: false,
    drawing: false,
    isDragging: false,
    dragAnchor: null,
    dragStart: null,
    p1: null,
    p2: null,
    alert2618: {
      armed: false,
      triggered: false,
      soundActive: false,
      approachDir: null
    }
  },
  dragTargetFibo: null, // 1 ou 2
  selectedFibo: null, // 1 ou 2 quando selecionado via duplo clique
  ws: null
};

export function getPrecisionForSymbol(symbol) {
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  if (sym === 'UNIUSDT') return 4;
  if (sym === 'BNBUSDT') return 3;
  return 2; // BTCUSDT, ETHUSDT, BCHUSDT
}

export function formatPrice(val, symbol) {
  if (val === null || val === undefined) return '--';
  const sym = symbol || state.currentSymbol || 'BTCUSDT';
  const prec = getPrecisionForSymbol(sym);
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: prec,
    maximumFractionDigits: prec
  });
}

export function formatVolume(val, asset) {
  if (val === null || val === undefined) return '--';
  const sign = val > 0 ? '+' : '';
  const abs = Math.abs(val);
  if (abs >= 1e6) return sign + (val / 1e6).toFixed(2) + 'M ' + asset;
  if (abs >= 1e3) return sign + (val / 1e3).toFixed(1) + 'K ' + asset;
  return sign + Math.round(val) + ' ' + asset;
}

export function loadUserPreferences() {
  try {
    const savedSym = localStorage.getItem('capich_tac_symbol');
    if (savedSym && PAIRS.some(p => p.symbol === savedSym)) {
      state.currentSymbol = savedSym;
      const pObj = PAIRS.find(p => p.symbol === savedSym);
      if (pObj) state.baseAsset = pObj.base;
    }

    const savedTf = localStorage.getItem('capich_tac_tf');
    if (savedTf && ['15m', '1h', '1d'].includes(savedTf)) {
      state.currentTimeframe = savedTf;
    }

    const savedMA = localStorage.getItem('capich_tac_ma');
    if (savedMA !== null) {
      state.maVisible = (savedMA === 'true');
    }

    const savedInd = localStorage.getItem('capich_tac_ind');
    if (savedInd !== null) {
      state.indicatorsVisible = (savedInd === 'true');
    }

    const savedZones = localStorage.getItem('capich_tac_zones');
    if (savedZones !== null) {
      state.zonesVisible = (savedZones === 'true');
    }

    const savedTags = localStorage.getItem('capich_tac_tags');
    if (savedTags !== null) {
      state.empireTagsVisible = (savedTags === 'true');
    }

    const savedPriceLine = localStorage.getItem('capich_tac_priceline');
    if (savedPriceLine !== null) {
      state.priceLineVisible = (savedPriceLine === 'true');
    }

    // Limpeza de chaves globais antigas que não tinham distinção de par
    try {
      localStorage.removeItem('capich_tac_fibo');
      localStorage.removeItem('capich_tac_fibo2');
    } catch (_) {}
  } catch (e) {
    console.warn('[BTC Tactical] Erro ao ler preferências do localStorage:', e);
  }
}
