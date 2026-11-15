/**
 * js/tactical/mini_chart.js
 * Mini gráfico flutuante BTC/USDT (Lightweight Charts)
 * Ativado pelo botão no dropdown Ferramentas.
 * Suporta troca de timeframe (15m / 1h) via botões no header.
 */

let _miniChartVisible = false;
let _miniChartInstance = null;
let _miniCandleSeries = null;
let _miniWs = null;
let _miniCurrentBar = null;
let _miniResizeObs = null;

const MINI_SYMBOL   = 'BTCUSDT';
const MINI_INTERVALS = ['15m', '1h', '4h'];
let   _miniInterval  = '15m';  // padrão
const MINI_LIMIT    = 120;

// ─── Toggle (chamado pelo botão no dropdown) ──────────────────────────────────
export function toggleMiniChart() {
  if (_miniChartVisible) {
    closeMiniChart();
  } else {
    openMiniChart();
  }
  _updateMiniChartBtn();
}

export function closeMiniChart() {
  _miniChartVisible = false;
  const el = document.getElementById('tac-mini-chart-panel');
  if (el) el.style.display = 'none';
  _destroyMiniChart();
  _updateMiniChartBtn();
}

function openMiniChart() {
  _miniChartVisible = true;
  let panel = document.getElementById('tac-mini-chart-panel');
  if (!panel) {
    _buildMiniChartDOM();
    panel = document.getElementById('tac-mini-chart-panel');
  }
  panel.style.display = 'flex';
  // Garante drag no header após rebuild
  const header = document.getElementById('tac-mini-chart-header');
  if (panel && header) _makeDraggable(panel, header);
  _initMiniChart();
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
        <span class="tac-mini-chart-dot"></span>
        BTC / USDT
      </span>
      <div class="tac-mini-tf-group">${tfBtns}</div>
      <span id="tac-mini-chart-price" class="tac-mini-chart-price">--</span>
      <button class="tac-mini-chart-close" onclick="window._closeMiniChart()" title="Fechar mini gráfico">✕</button>
    </div>
    <div id="tac-mini-chart-canvas" class="tac-mini-chart-canvas"></div>
    <div class="tac-mini-chart-footer">
      <span id="tac-mini-chart-change" class="tac-mini-chart-change">--</span>
      <span style="color:#4a5568;font-size:9px;">CAPICH · BTC Referência</span>
    </div>
  `;
  // Insere logo após a wrapper principal do gráfico
  const wrapper = document.getElementById('btc-tactical-section') || document.body;
  wrapper.style.position = wrapper.style.position || 'relative';
  wrapper.appendChild(tpl);

  // Habilita drag pelo header
  _makeDraggable(tpl, document.getElementById('tac-mini-chart-header') || tpl);
}

// ─── Drag (arrastar pelo header) ──────────────────────────────────────────────
function _makeDraggable(panel, handle) {
  let startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return; // não draga se clicar no botão fechar
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
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── Inicializa o gráfico Lightweight Charts ──────────────────────────────────
function _initMiniChart() {
  const container = document.getElementById('tac-mini-chart-canvas');
  if (!container || !window.LightweightCharts) return;

  // Destrói instância anterior se existir
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

  // ResizeObserver para responsividade
  _miniResizeObs = new ResizeObserver(() => {
    if (_miniChartInstance && container) {
      _miniChartInstance.applyOptions({
        width:  container.clientWidth,
        height: container.clientHeight,
      });
    }
  });
  _miniResizeObs.observe(container);

  // Carrega velas históricas e conecta WebSocket
  _fetchMiniKlines().then(() => _connectMiniWs());
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

    // Guarda a vela corrente (a última, ainda aberta)
    if (candles.length > 0) {
      _miniCurrentBar = { ...candles[candles.length - 1] };
      _updateMiniPriceDisplay(_miniCurrentBar.close, candles[0].open);
    }
  } catch (e) {
    console.warn('[MiniChart] Erro ao buscar klines:', e);
  }
}

// ─── WebSocket tempo real ─────────────────────────────────────────────────────
function _connectMiniWs() {
  _closeMiniWs();
  const stream = `${MINI_SYMBOL.toLowerCase()}@kline_${_miniInterval}`;
  _miniWs = new WebSocket(`wss://fstream.binance.com/ws/${stream}`);

  _miniWs.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const k = msg.k;
      if (!k || !_miniCandleSeries) return;

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
    } catch (_) {}
  };

  _miniWs.onerror = () => {
    // Reconecta após 3s em caso de erro
    setTimeout(() => { if (_miniChartVisible) _connectMiniWs(); }, 3000);
  };

  _miniWs.onclose = () => {
    setTimeout(() => { if (_miniChartVisible) _connectMiniWs(); }, 3000);
  };
}

function _closeMiniWs() {
  if (_miniWs) {
    try { _miniWs.close(); } catch (_) {}
    _miniWs = null;
  }
}

// ─── Display de Preço e Variação ──────────────────────────────────────────────
let _miniOpenRef = null; // preço de abertura da primeira vela do histórico

function _updateMiniPriceDisplay(currentPrice, openRef) {
  if (openRef !== null) _miniOpenRef = openRef;

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

export function setMiniChartInterval(tf) {
  if (!MINI_INTERVALS.includes(tf) || _miniInterval === tf) return;
  _miniInterval = tf;

  // Atualiza classes ativas nos botões de timeframe
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
