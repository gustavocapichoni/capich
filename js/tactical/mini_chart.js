/**
 * js/tactical/mini_chart.js
 * Mini gráfico flutuante BTC/USDT (Lightweight Charts v4)
 * Ativado pelo botão no dropdown Ferramentas.
 * Suporta:
 *  - Troca de timeframe (15m / 1h / 4h)
 *  - Streaming de altíssima velocidade em tempo real (aggTrade + klines combinados)
 *  - Persistência total no localStorage (estado aberto/fechado, posição, tamanho e timeframe)
 *  - Drag & Drop e redimensionamento responsivo
 */

let _miniChartVisible = false;
let _miniChartInstance = null;
let _miniCandleSeries = null;
let _miniWs = null;
let _miniCurrentBar = null;
let _miniResizeObs = null;
let _miniWatchdogInterval = null;
let _miniLastTickTime = 0;

const MINI_SYMBOL    = 'BTCUSDT';
const MINI_INTERVALS = ['15m', '1h', '4h'];
let   _miniInterval  = '15m';
const MINI_LIMIT     = 120;

// Chaves de localStorage
const STORAGE_KEY_VISIBLE = 'capich_mini_chart_visible';
const STORAGE_KEY_TF      = 'capich_mini_chart_tf';
const STORAGE_KEY_POS     = 'capich_mini_chart_pos';

// ─── Carrega preferências salvas no localStorage ─────────────────────────────
function _loadStoragePrefs() {
  try {
    const savedTf = localStorage.getItem(STORAGE_KEY_TF);
    if (savedTf && MINI_INTERVALS.includes(savedTf)) {
      _miniInterval = savedTf;
    }
  } catch (_) {}
}

function _savePosToStorage(panel) {
  try {
    if (!panel) return;
    const data = {
      top: panel.style.top,
      left: panel.style.left,
      width: panel.style.width,
      height: panel.style.height
    };
    localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(data));
  } catch (_) {}
}

function _applyStoredPos(panel) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (pos.top)  panel.style.top  = pos.top;
    if (pos.left) panel.style.left = pos.left;
    if (pos.width)  panel.style.width  = pos.width;
    if (pos.height) panel.style.height = pos.height;
  } catch (_) {}
}

// ─── Toggle (chamado pelo botão no dropdown) ──────────────────────────────────
export function toggleMiniChart() {
  if (_miniChartVisible) {
    closeMiniChart();
  } else {
    openMiniChart();
  }
}

export function closeMiniChart() {
  _miniChartVisible = false;
  try { localStorage.setItem(STORAGE_KEY_VISIBLE, 'false'); } catch (_) {}
  const el = document.getElementById('tac-mini-chart-panel');
  if (el) el.style.display = 'none';
  _destroyMiniChart();
  _updateMiniChartBtn();
}

export function openMiniChart() {
  _loadStoragePrefs();
  _miniChartVisible = true;
  try { localStorage.setItem(STORAGE_KEY_VISIBLE, 'true'); } catch (_) {}

  let panel = document.getElementById('tac-mini-chart-panel');
  if (!panel) {
    _buildMiniChartDOM();
    panel = document.getElementById('tac-mini-chart-panel');
  }

  _applyStoredPos(panel);
  panel.style.display = 'flex';

  const header = document.getElementById('tac-mini-chart-header');
  if (panel && header) _makeDraggable(panel, header);

  _initMiniChart();
  _updateMiniChartBtn();
}

/**
 * Inicialização automática na carga da página caso o usuário tenha deixado aberto
 */
export function initMiniChartFromStorage() {
  _loadStoragePrefs();
  try {
    const wasOpen = localStorage.getItem(STORAGE_KEY_VISIBLE) === 'true';
    if (wasOpen) {
      setTimeout(() => {
        openMiniChart();
      }, 350);
    }
  } catch (_) {}
}

// ─── DOM do painel ────────────────────────────────────────────────────────────
function _buildMiniChartDOM() {
  const tpl = document.createElement('div');
  tpl.id = 'tac-mini-chart-panel';
  tpl.className = 'tac-mini-chart-panel';
  tpl.style.display = 'none';

  const tfBtns = MINI_INTERVALS.map(tf =>
    `<button class="tac-mini-tf-btn${tf === _miniInterval ? ' active' : ''}" data-tf="${tf}" onclick="window._setMiniChartInterval('${tf}')">${tf}</button>`
  ).join('');

  tpl.innerHTML = `
    <div class="tac-mini-chart-header" id="tac-mini-chart-header">
      <span class="tac-mini-chart-title">
        <span class="tac-mini-chart-dot" id="tac-mini-dot"></span>
        BTC / USDT
      </span>
      <div class="tac-mini-tf-group">${tfBtns}</div>
      <span id="tac-mini-chart-price" class="tac-mini-chart-price">--</span>
      <button class="tac-mini-chart-close" onclick="window._closeMiniChart()" title="Fechar mini gráfico">✕</button>
    </div>
    <div id="tac-mini-chart-canvas" class="tac-mini-chart-canvas"></div>
    <div class="tac-mini-chart-footer">
      <span id="tac-mini-chart-change" class="tac-mini-chart-change">--</span>
      <span style="color:#4a5568;font-size:9px;">CAPICH · Tempo Real (AggTrade)</span>
    </div>
  `;

  const wrapper = document.getElementById('btc-tactical-section') || document.body;
  wrapper.style.position = wrapper.style.position || 'relative';
  wrapper.appendChild(tpl);

  _makeDraggable(tpl, document.getElementById('tac-mini-chart-header') || tpl);
}

// ─── Drag (arrastar pelo header) ──────────────────────────────────────────────
function _makeDraggable(panel, handle) {
  let startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const parentRect = panel.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = rect.left - parentRect.left;
    startTop  = rect.top  - parentRect.top;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top  = `${startTop  + dy}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _savePosToStorage(panel);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── Inicializa o gráfico Lightweight Charts ──────────────────────────────────
function _initMiniChart() {
  const container = document.getElementById('tac-mini-chart-canvas');
  if (!container || !window.LightweightCharts) return;

  _destroyMiniChart();

  _miniChartInstance = window.LightweightCharts.createChart(container, {
    width: container.clientWidth || 300,
    height: container.clientHeight || 180,
    layout: {
      background: { color: '#0b0f17' },
      textColor: '#848e9c',
      fontSize: 9,
    },
    grid: {
      vertLines: { color: '#131a27', style: 1 },
      horzLines: { color: '#131a27', style: 1 },
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#1e2d40',
      scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    timeScale: {
      borderColor: '#1e2d40',
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => {
        const d = new Date(time * 1000);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      },
    },
    handleScroll: true,
    handleScale: true,
  });

  _miniCandleSeries = _miniChartInstance.addCandlestickSeries({
    upColor:        '#0ecb81',
    downColor:      '#f6465d',
    borderUpColor:  '#0ecb81',
    borderDownColor:'#f6465d',
    wickUpColor:    '#0ecb81',
    wickDownColor:  '#f6465d',
  });

  _miniResizeObs = new ResizeObserver(() => {
    if (_miniChartInstance && container) {
      _miniChartInstance.applyOptions({
        width:  container.clientWidth,
        height: container.clientHeight,
      });
      const panel = document.getElementById('tac-mini-chart-panel');
      if (panel) _savePosToStorage(panel);
    }
  });
  _miniResizeObs.observe(container);

  // Carrega histórico e inicia streaming
  _fetchMiniKlines().then(() => {
    _connectMiniWs();
    _startWatchdog();
  });
}

// ─── Histórico via REST ───────────────────────────────────────────────────────
async function _fetchMiniKlines() {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${MINI_SYMBOL}&interval=${_miniInterval}&limit=${MINI_LIMIT}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data) || !_miniCandleSeries) return;

    const candles = data.map(k => ({
      time:  Math.floor(k[0] / 1000),
      open:  parseFloat(k[1]),
      high:  parseFloat(k[2]),
      low:   parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    _miniCandleSeries.setData(candles);
    _miniChartInstance.timeScale().fitContent();

    if (candles.length > 0) {
      _miniCurrentBar = { ...candles[candles.length - 1] };
      _updateMiniPriceDisplay(_miniCurrentBar.close, candles[0].open);
      _miniLastTickTime = Date.now();
    }
  } catch (e) {
    console.warn('[MiniChart] Erro ao buscar klines:', e);
  }
}

// ─── WebSocket combinado de alta velocidade (Kline + AggTrade) ───────────────
function _connectMiniWs() {
  _closeMiniWs();
  const sym = MINI_SYMBOL.toLowerCase();
  // Combina klines com aggTrade para atualização trade-a-trade com zero delay
  const wsUrl = `wss://fstream.binance.com/stream?streams=${sym}@kline_${_miniInterval}/${sym}@aggTrade`;
  
  try {
    _miniWs = new WebSocket(wsUrl);

    _miniWs.onopen = () => {
      const dot = document.getElementById('tac-mini-dot');
      if (dot) dot.style.background = '#0ecb81';
      _miniLastTickTime = Date.now();
    };

    _miniWs.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const data = msg.data || msg;
        const stream = msg.stream || '';
        _miniLastTickTime = Date.now();

        // 1. Preço trade a trade instantâneo (aggTrade)
        if (stream.includes('@aggTrade') || data.e === 'aggTrade') {
          const tradePrice = parseFloat(data.p);
          if (tradePrice && _miniCurrentBar && _miniCandleSeries) {
            _miniCurrentBar.close = tradePrice;
            if (tradePrice > _miniCurrentBar.high) _miniCurrentBar.high = tradePrice;
            if (tradePrice < _miniCurrentBar.low)  _miniCurrentBar.low  = tradePrice;
            _miniCandleSeries.update(_miniCurrentBar);
            _updateMiniPriceDisplay(tradePrice, null);
          }
          return;
        }

        // 2. Atualização oficial da barra de tempo (Kline)
        const k = data.k;
        if (k && _miniCandleSeries) {
          const bar = {
            time:  Math.floor(k.t / 1000),
            open:  parseFloat(k.o),
            high:  parseFloat(k.h),
            low:   parseFloat(k.l),
            close: parseFloat(k.c),
          };

          _miniCandleSeries.update(bar);
          _miniCurrentBar = bar;
          _updateMiniPriceDisplay(bar.close, null);
        }
      } catch (_) {}
    };

    _miniWs.onerror = () => {
      const dot = document.getElementById('tac-mini-dot');
      if (dot) dot.style.background = '#f0b90b';
    };

    _miniWs.onclose = () => {
      const dot = document.getElementById('tac-mini-dot');
      if (dot) dot.style.background = '#848e9c';
      setTimeout(() => {
        if (_miniChartVisible) _connectMiniWs();
      }, 1500);
    };
  } catch (err) {
    console.warn('[MiniChart] Falha ao abrir WS:', err);
  }
}

function _closeMiniWs() {
  if (_miniWs) {
    try {
      _miniWs.onclose = null;
      _miniWs.onerror = null;
      _miniWs.close();
    } catch (_) {}
    _miniWs = null;
  }
}

// ─── Watchdog de Fallback (garante que nunca fique congelado) ──────────────────
function _startWatchdog() {
  _stopWatchdog();
  _miniWatchdogInterval = setInterval(async () => {
    if (!_miniChartVisible) return;
    const elapsed = Date.now() - _miniLastTickTime;
    // Se não receber tick há mais de 3.5 segundos, busca preço e reconecta WS
    if (elapsed > 3500) {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${MINI_SYMBOL}`);
        const pData = await res.json();
        const price = parseFloat(pData.price);
        if (price && _miniCurrentBar && _miniCandleSeries) {
          _miniCurrentBar.close = price;
          if (price > _miniCurrentBar.high) _miniCurrentBar.high = price;
          if (price < _miniCurrentBar.low)  _miniCurrentBar.low  = price;
          _miniCandleSeries.update(_miniCurrentBar);
          _updateMiniPriceDisplay(price, null);
        }
      } catch (_) {}

      if (!_miniWs || _miniWs.readyState !== WebSocket.OPEN) {
        _connectMiniWs();
      }
    }
  }, 2500);
}

function _stopWatchdog() {
  if (_miniWatchdogInterval) {
    clearInterval(_miniWatchdogInterval);
    _miniWatchdogInterval = null;
  }
}

// ─── Display de Preço e Variação ──────────────────────────────────────────────
let _miniOpenRef = null;

function _updateMiniPriceDisplay(currentPrice, openRef) {
  if (openRef !== null && openRef !== undefined) _miniOpenRef = openRef;

  const elPrice = document.getElementById('tac-mini-chart-price');
  const elChange = document.getElementById('tac-mini-chart-change');
  if (!elPrice) return;

  const fmt = (v) => v >= 1000
    ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$' + v.toFixed(4);

  elPrice.textContent = fmt(currentPrice);

  if (_miniOpenRef && elChange) {
    const pct = ((currentPrice - _miniOpenRef) / _miniOpenRef) * 100;
    const sign = pct >= 0 ? '+' : '';
    elChange.textContent = `${sign}${pct.toFixed(2)}% (período)`;
    elChange.style.color = pct >= 0 ? '#0ecb81' : '#f6465d';
  }
}

// ─── Destroy ──────────────────────────────────────────────────────────────────
function _destroyMiniChart() {
  _stopWatchdog();
  _closeMiniWs();
  if (_miniResizeObs) { _miniResizeObs.disconnect(); _miniResizeObs = null; }
  if (_miniChartInstance) {
    try { _miniChartInstance.remove(); } catch (_) {}
    _miniChartInstance = null;
    _miniCandleSeries = null;
  }
}

// ─── Atualiza estado visual do botão no dropdown ──────────────────────────────
function _updateMiniChartBtn() {
  const btn = document.getElementById('tac-status-mini-chart');
  if (btn) {
    btn.textContent = _miniChartVisible ? 'ON' : 'OFF';
    btn.closest?.('.tac-dropdown-item')?.classList?.toggle('active', _miniChartVisible);
  }
  const item = document.getElementById('tac-btn-mini-chart');
  if (item) item.classList.toggle('active', _miniChartVisible);
}

// ─── Troca de Timeframe ───────────────────────────────────────────────────────
export function setMiniChartInterval(tf) {
  if (!MINI_INTERVALS.includes(tf) || _miniInterval === tf) return;
  _miniInterval = tf;
  try { localStorage.setItem(STORAGE_KEY_TF, tf); } catch (_) {}

  document.querySelectorAll('.tac-mini-tf-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tf') === tf);
  });

  if (_miniChartVisible && _miniCandleSeries) {
    _closeMiniWs();
    _fetchMiniKlines().then(() => _connectMiniWs());
  }
}

// ─── Expõe globalmente ────────────────────────────────────────────────────────
window._toggleMiniChart = toggleMiniChart;
window._closeMiniChart  = closeMiniChart;
window._setMiniChartInterval = setMiniChartInterval;
