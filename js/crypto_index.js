// js/crypto_index.js — Índice de Mercado Cripto TOP 10 · TradingView Lightweight Charts
// Renderização vetorial de alta definição, fluidez nativa, zoom, crosshair e dados em tempo real

(function () {
  'use strict';

  const BASKET_WEIGHTS = {
    BTC: 40, ETH: 20, SOL: 7, BNB: 6, XRP: 6,
    DOGE: 5, ADA: 4, AVAX: 4, LINK: 4, UNI: 4
  };
  const BASKET_COLORS = {
    BTC: '#f0b90b', ETH: '#627eea', SOL: '#9945ff', BNB: '#f0b90b',
    XRP: '#38bdf8', DOGE: '#c2a633', ADA: '#0033ad', AVAX: '#e84142',
    LINK: '#2a5ada', UNI: '#ff007a'
  };

  let currentTf     = '15m';
  try {
    const savedTf = localStorage.getItem('capich_index_tf');
    if (savedTf && ['15m', '1h', '4h', '1d'].includes(savedTf)) {
      currentTf = savedTf;
    }
  } catch (_) {}

  let chart         = null;
  let candleSeries  = null;
  let mma32Series   = null;
  let mma80Series   = null;
  let volumeSeries  = null;
  let flowSeries    = null;

  let currentData   = null;
  let binanceWs     = null;
  let latestPrices  = {};
  let rafId         = null;
  let wsReconnectId = null;

  // ─── Utilitários de Formatação ────────────────────────────────────────────────
  function fmtVal(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return Number(v).toFixed(2);
  }

  function fmtUSD(num) {
    if (num === null || num === undefined || isNaN(num)) return '$0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : (num > 0 ? '+' : '');
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  // ─── Inicialização do Gráfico Lightweight Charts ──────────────────────────────
  function initTradingViewChart() {
    const container = document.getElementById('ci-chart-container');
    if (!container || typeof LightweightCharts === 'undefined') return;

    if (chart) {
      try { chart.remove(); } catch (e) {}
      chart = null;
    }

    container.innerHTML = '';

    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth || 900,
      height: 500,
      layout: {
        background: { type: 'solid', color: '#0b0e14' },
        textColor: '#848e9c',
        fontFamily: "'JetBrains Mono', -apple-system, BlinkMacSystemFont, monospace",
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.25)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.25)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed
        }
      },
      rightPriceScale: {
        borderColor: '#1c2230',
        visible: true,
        scaleMargins: { top: 0.08, bottom: 0.22 }
      },
      timeScale: {
        borderColor: '#1c2230',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 1
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });

    // 1. Série de Velas do Índice TOP 10 (Cores vibrantes TradingView)
    candleSeries = chart.addCandlestickSeries({
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderUpColor: '#0ecb81',
      borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01
      }
    });

    // 2. Linha MMA 32 (Dourada / Amarela)
    mma32Series = chart.addLineSeries({
      color: '#f0b90b',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: true
    });

    // 3. Linha MMA 80 (Roxa / Lilás)
    mma80Series = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: true
    });

    // 4. Histograma de Fluxo CEX On-Chain (USD)
    flowSeries = chart.addLineSeries({
      priceScaleId: 'flow',
      color: '#38bdf8',
      lineWidth: 1.5,
      priceFormat: {
        type: 'custom',
        formatter: (v) => fmtUSD(v)
      }
    });
    chart.priceScale('flow').applyOptions({
      scaleMargins: { top: 0.70, bottom: 0.16 },
      visible: false
    });

    // 5. Histograma de Volume (Futuros / Spot)
    volumeSeries = chart.addHistogramSeries({
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' }
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
      visible: false
    });

    // Assina evento da mira / crosshair para atualizar o overlay OHLC em tempo real
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        renderDefaultOverlay();
        return;
      }
      const candle = param.seriesData.get(candleSeries);
      const mma32  = param.seriesData.get(mma32Series);
      const mma80  = param.seriesData.get(mma80Series);
      const flow   = param.seriesData.get(flowSeries);
      const vol    = param.seriesData.get(volumeSeries);

      if (candle) {
        updateOverlay(candle, mma32 ? mma32.value : null, mma80 ? mma80.value : null, flow ? flow.value : null, vol ? vol.value : null);
      }
    });

    // Observer para redimensionamento responsivo
    const ro = new ResizeObserver((entries) => {
      if (!entries || !entries.length || !chart) return;
      const { width } = entries[0].contentRect;
      if (width > 0) {
        chart.applyOptions({ width });
      }
    });
    ro.observe(container);
  }

  // ─── Overlay OHLC Dinâmico (Top Left do Gráfico) ──────────────────────────────
  function updateOverlay(c, mma32, mma80, flow, vol) {
    const el = document.getElementById('ci-ohlc-overlay');
    if (!el || !c) return;

    const diff = c.close - c.open;
    const pct  = c.open > 0 ? ((diff / c.open) * 100).toFixed(2) : '0.00';
    const isUp = diff >= 0;
    const color = isUp ? '#0ecb81' : '#f6465d';
    const sign = isUp ? '+' : '';

    const mma32Str = mma32 ? `<span class="ci-ohlc-item"><span class="ci-ohlc-lbl" style="color:#f0b90b;">MMA32:</span><span class="ci-ohlc-val" style="color:#f0b90b;">${fmtVal(mma32)}</span></span>` : '';
    const mma80Str = mma80 ? `<span class="ci-ohlc-item"><span class="ci-ohlc-lbl" style="color:#a855f7;">MMA80:</span><span class="ci-ohlc-val" style="color:#a855f7;">${fmtVal(mma80)}</span></span>` : '';
    const flowStr  = flow  !== null && flow !== undefined ? `<span class="ci-ohlc-item"><span class="ci-ohlc-lbl" style="color:#38bdf8;">Fluxo CEX:</span><span class="ci-ohlc-val" style="color:#38bdf8;">${fmtUSD(flow)}</span></span>` : '';

    el.innerHTML = `
      <span class="ci-ohlc-item"><span class="ci-ohlc-lbl">O:</span><span class="ci-ohlc-val">${fmtVal(c.open)}</span></span>
      <span class="ci-ohlc-item"><span class="ci-ohlc-lbl">H:</span><span class="ci-ohlc-val">${fmtVal(c.high)}</span></span>
      <span class="ci-ohlc-item"><span class="ci-ohlc-lbl">L:</span><span class="ci-ohlc-val">${fmtVal(c.low)}</span></span>
      <span class="ci-ohlc-item"><span class="ci-ohlc-lbl">C:</span><span class="ci-ohlc-val" style="color:${color};">${fmtVal(c.close)}</span></span>
      <span class="ci-ohlc-item"><span class="ci-ohlc-val" style="color:${color};font-weight:700;">${sign}${fmtVal(diff)} (${sign}${pct}%)</span></span>
      ${mma32Str}
      ${mma80Str}
      ${flowStr}
    `;
  }

  function renderDefaultOverlay() {
    if (!currentData || !currentData.candles || !currentData.candles.length) return;
    const last = currentData.candles[currentData.candles.length - 1];
    updateOverlay(
      { open: last.o, high: last.h, low: last.l, close: last.c },
      last.sma32,
      last.sma80,
      last.flowUsd,
      last.vFut || last.vSpot
    );
  }

  // ─── Popula as Séries do Gráfico ──────────────────────────────────────────────
  function setChartData(candles) {
    if (!chart || !candleSeries || !candles || !candles.length) return;

    // Converte timestamp em segundos para o Lightweight Charts
    const candleData = candles.map(c => ({
      time: Math.floor(c.t / 1000),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c
    }));

    const mma32Data = candles
      .filter(c => c.sma32 !== undefined && !isNaN(c.sma32))
      .map(c => ({ time: Math.floor(c.t / 1000), value: c.sma32 }));

    const mma80Data = candles
      .filter(c => c.sma80 !== undefined && !isNaN(c.sma80))
      .map(c => ({ time: Math.floor(c.t / 1000), value: c.sma80 }));

    const flowData = candles
      .filter(c => c.flowUsd !== undefined && !isNaN(c.flowUsd))
      .map(c => ({ time: Math.floor(c.t / 1000), value: c.flowUsd }));

    const volumeData = candles.map(c => {
      const vol = c.vFut || c.vSpot || 0;
      const isUp = c.c >= c.o;
      return {
        time: Math.floor(c.t / 1000),
        value: vol,
        color: isUp ? 'rgba(14, 203, 129, 0.40)' : 'rgba(246, 70, 93, 0.40)'
      };
    });

    candleSeries.setData(candleData);
    mma32Series.setData(mma32Data);
    mma80Series.setData(mma80Data);
    flowSeries.setData(flowData);
    volumeSeries.setData(volumeData);

    renderDefaultOverlay();
  }

  // ─── Atualiza Stats no Header ─────────────────────────────────────────────────
  function updateStats(candles) {
    if (!candles || !candles.length) return;
    const first = candles[0].o;
    const last  = candles[candles.length - 1].c;
    const chg   = ((last - first) / first * 100);
    const chgEl = document.getElementById('ci-change');
    const isPos = chg >= 0;

    const elOpen = document.getElementById('ci-open');
    const elCurr = document.getElementById('ci-current');

    if (elOpen) elOpen.textContent = fmtVal(first);
    if (elCurr) elCurr.textContent = fmtVal(last);
    if (chgEl) {
      chgEl.textContent = (isPos ? '+' : '') + chg.toFixed(2) + '%';
      chgEl.style.color = isPos ? '#0ecb81' : '#f6465d';
    }
  }

  // ─── WebSocket ao Vivo Binance (Tick a Tick em Tempo Real) ────────────────────
  function initWebSocket(basketDetails) {
    if (binanceWs) {
      try { binanceWs.close(); } catch (e) {}
      binanceWs = null;
    }
    clearTimeout(wsReconnectId);

    if (!basketDetails || !basketDetails.length) return;

    const streams = basketDetails.map(b => `${b.symbol.toLowerCase()}@miniTicker`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      binanceWs = new WebSocket(wsUrl);

      binanceWs.onopen = () => {
        const updated = document.getElementById('ci-updated');
        if (updated) {
          updated.innerHTML = `<span style="color:#0ecb81;font-weight:700;">● Ao Vivo</span>`;
        }
      };

      binanceWs.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (payload && payload.data && payload.data.s && payload.data.c) {
            latestPrices[payload.data.s] = parseFloat(payload.data.c);
            scheduleTickUpdate();
          }
        } catch (e) {}
      };

      binanceWs.onerror = () => {
        wsReconnectId = setTimeout(() => {
          if (currentData && currentData.basketDetails) initWebSocket(currentData.basketDetails);
        }, 5000);
      };

      binanceWs.onclose = () => {
        wsReconnectId = setTimeout(() => {
          if (currentData && currentData.basketDetails) initWebSocket(currentData.basketDetails);
        }, 5000);
      };
    } catch (err) {
      console.warn('[CryptoIndex WS] Erro ao conectar:', err);
    }
  }

  function scheduleTickUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      onLiveTick();
    });
  }

  function onLiveTick() {
    if (!currentData || !currentData.candles || !currentData.candles.length || !currentData.basketDetails) return;

    let liveIdx = 0;
    currentData.basketDetails.forEach(b => {
      const p = latestPrices[b.symbol] || b.lastPrice || b.basePrice;
      liveIdx += b.weight * (p / b.basePrice) * 100;
    });

    // Expondo globalmente para uso pelo Oráculo Quantitativo
    window._liveCryptoIndexVal = liveIdx;

    const tfMs = {
      '15m': 15 * 60 * 1000,
      '1h':  60 * 60 * 1000,
      '4h':  4 * 60 * 60 * 1000,
      '1d':  24 * 60 * 60 * 1000
    }[currentTf] || (15 * 60 * 1000);

    const candles = currentData.candles;
    const lastCandle = candles[candles.length - 1];
    const now = Date.now();

    if (now - lastCandle.t >= tfMs) {
      const newT = lastCandle.t + tfMs;
      const newC = {
        t: newT,
        o: liveIdx,
        h: liveIdx,
        l: liveIdx,
        c: liveIdx,
        sma32: liveIdx,
        sma80: liveIdx,
        flowUsd: lastCandle.flowUsd || 0,
        vSpot: lastCandle.vSpot || 0,
        vFut: lastCandle.vFut || 0
      };
      candles.push(newC);
      if (candles.length > 1000) candles.shift();

      if (candleSeries) {
        candleSeries.update({
          time: Math.floor(newT / 1000),
          open: liveIdx,
          high: liveIdx,
          low: liveIdx,
          close: liveIdx
        });
      }
    } else {
      lastCandle.c = liveIdx;
      if (liveIdx > lastCandle.h) lastCandle.h = liveIdx;
      if (liveIdx < lastCandle.l) lastCandle.l = liveIdx;

      if (candleSeries) {
        candleSeries.update({
          time: Math.floor(lastCandle.t / 1000),
          open: lastCandle.o,
          high: lastCandle.h,
          low: lastCandle.l,
          close: lastCandle.c
        });
      }
    }

    // Recalcula MMAs do último candle
    const idx = candles.length - 1;
    const p32 = Math.min(idx + 1, 32);
    let s32 = 0;
    for (let j = idx - p32 + 1; j <= idx; j++) s32 += candles[j].c;
    lastCandle.sma32 = s32 / p32;

    const p80 = Math.min(idx + 1, 80);
    let s80 = 0;
    for (let j = idx - p80 + 1; j <= idx; j++) s80 += candles[j].c;
    lastCandle.sma80 = s80 / p80;

    if (mma32Series) {
      mma32Series.update({ time: Math.floor(lastCandle.t / 1000), value: lastCandle.sma32 });
    }
    if (mma80Series) {
      mma80Series.update({ time: Math.floor(lastCandle.t / 1000), value: lastCandle.sma80 });
    }

    renderDefaultOverlay();
    updateStats(candles);
  }

  // ─── Carregamento de Dados da API ─────────────────────────────────────────────
  async function loadIndex(interval) {
    const loading = document.getElementById('ci-loading');
    const updated = document.getElementById('ci-updated');

    if (loading) loading.style.display = 'flex';

    try {
      const r = await fetch(`/api/crypto-index?interval=${interval}&limit=500`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();

      if (!d.candles || !d.candles.length) throw new Error('Sem dados');

      currentData = d;

      // Inicializa preços em cache para o WebSocket
      if (d.basketDetails) {
        d.basketDetails.forEach(b => {
          latestPrices[b.symbol] = b.lastPrice || b.basePrice;
        });
        initWebSocket(d.basketDetails);
      }

      setChartData(d.candles);
      updateStats(d.candles);

      if (loading) loading.style.display = 'none';
      if (updated) {
        updated.innerHTML = `<span style="color:#0ecb81;font-weight:700;">● Ao Vivo</span>`;
      }

      // Chips da cesta
      const chips = document.getElementById('ci-basket-chips');
      if (chips && d.basket) {
        chips.innerHTML = d.basket.map(name => {
          const color = BASKET_COLORS[name] || '#848e9c';
          const w     = BASKET_WEIGHTS[name] || 0;
          return `<span class="ci-chip" style="border-color:${color};color:${color};">${name} <em>${w}%</em></span>`;
        }).join('');
      }
    } catch (err) {
      console.error('[CryptoIndex]', err.message);
      if (loading) { loading.textContent = '⚠️ Falha ao carregar o índice. Tentando novamente...'; }
    }
  }

  // ─── Inicialização Geral ──────────────────────────────────────────────────────
  function init() {
    initTradingViewChart();

    // Botões de timeframe
    document.querySelectorAll('.ci-tf-btn').forEach(btn => {
      if (btn.dataset.tf === currentTf) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ci-tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTf = btn.dataset.tf;
        try {
          localStorage.setItem('capich_index_tf', currentTf);
        } catch (_) {}
        loadIndex(currentTf);
      });
    });

    // Carga inicial
    loadIndex(currentTf);

    // Recarga periódica a cada 2 minutos como fallback de sincronização
    setInterval(() => loadIndex(currentTf), 2 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
