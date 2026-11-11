// js/market_indicators.js — Fear & Greed · Dominância BTC · Open Interest

(function () {
  'use strict';

  // ── Utilitários ──────────────────────────────────────────────────────────────

  function fmtUsd(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + ' B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + ' M';
    return '$' + v.toFixed(0);
  }

  function fmtBtc(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' M BTC';
    if (v >= 1e3) return (v / 1e3).toFixed(2) + ' K BTC';
    return v.toFixed(2) + ' BTC';
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `há ${diff}s`;
    if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
    return `há ${Math.floor(diff / 3600)}h`;
  }

  // ── Fear & Greed ─────────────────────────────────────────────────────────────

  function fgZone(val) {
    const v = parseInt(val);
    if (v <= 24) return { label: 'MEDO EXTREMO', color: '#f6465d' };
    if (v <= 44) return { label: 'MEDO',         color: '#f0a500' };
    if (v <= 55) return { label: 'NEUTRO',        color: '#848e9c' };
    if (v <= 75) return { label: 'GANÂNCIA',      color: '#0ecb81' };
    return              { label: 'GANÂNCIA EXT.', color: '#00e5a0' };
  }

  function drawFgGauge(canvas, value) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H - 8, r = H - 18;
    const startAngle = Math.PI, endAngle = 0;

    // Arco de fundo em gradiente (vermelho → amarelo → verde)
    const zones = [
      [0,   0.25, '#f6465d'],
      [0.25,0.45, '#f0a500'],
      [0.45,0.55, '#848e9c'],
      [0.55,0.75, '#0ecb81'],
      [0.75,1.00, '#00e5a0'],
    ];
    zones.forEach(([s, e, color]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI + s * Math.PI, Math.PI + e * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.lineCap = 'butt';
      ctx.stroke();
    });

    // Ponteiro
    const angle = Math.PI + (value / 100) * Math.PI;
    const px = cx + (r - 14) * Math.cos(angle);
    const py = cy + (r - 14) * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = '#eaecef';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Centro
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#eaecef';
    ctx.fill();
  }

  async function loadFearGreed() {
    try {
      const r = await fetch('/api/fear-greed');
      if (!r.ok) throw new Error();
      const d = await r.json();
      const items = d.data || [];
      if (!items.length) return;

      const current = items[0];
      const val = parseInt(current.value);
      const zone = fgZone(val);

      document.getElementById('fg-value').textContent = val;
      document.getElementById('fg-value').style.color = zone.color;
      document.getElementById('fg-label').textContent = zone.label;
      document.getElementById('fg-label').style.color = zone.color;
      document.getElementById('fg-updated').textContent = `Atualizado ${timeAgo(Date.now())} · cache 1h`;

      const canvas = document.getElementById('fg-gauge-canvas');
      if (canvas) drawFgGauge(canvas, val);

      // Histórico últimos 7 dias
      const histEl = document.getElementById('fg-history');
      if (histEl && items.length > 1) {
        const days = items.slice(1, 8).reverse();
        histEl.innerHTML = days.map(item => {
          const z = fgZone(item.value);
          const dateStr = new Date(item.timestamp * 1000).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
          return `
            <div class="fg-hist-item">
              <div class="fg-hist-bar-wrap">
                <div class="fg-hist-bar" style="height:${item.value}%; background:${z.color};"></div>
              </div>
              <span class="fg-hist-val" style="color:${z.color}">${item.value}</span>
              <span class="fg-hist-date">${dateStr}</span>
            </div>`;
        }).join('');
      }
    } catch (e) {
      document.getElementById('fg-updated').textContent = '⚠️ Indisponível';
    }
  }

  // ── Dominância BTC ───────────────────────────────────────────────────────────

  let _prevDom = null;

  async function loadDominance() {
    try {
      const r = await fetch('/api/btc-dominance');
      if (!r.ok) throw new Error();
      const d = await r.json();
      const data = d.data;
      if (!data) return;

      const pct = data.market_cap_percentage?.btc || 0;
      const totalMcap = data.total_market_cap?.usd || 0;
      const arrow = _prevDom === null ? '──' : pct > _prevDom ? '▲' : pct < _prevDom ? '▼' : '──';
      const arrowColor = pct > (_prevDom || pct) ? '#0ecb81' : '#f6465d';
      _prevDom = pct;

      document.getElementById('dom-pct').textContent = pct.toFixed(1) + '%';
      const arrowEl = document.getElementById('dom-arrow');
      arrowEl.textContent = arrow;
      arrowEl.style.color = arrowColor;

      // Barra visual
      document.getElementById('dom-bar').style.width = pct.toFixed(1) + '%';

      // Interpretação contextual
      let desc = 'do market cap cripto global pertence ao BTC';
      if (pct >= 60) desc = '⚠️ Alta dominância — mercado em modo proteção (Bitcoin season)';
      else if (pct >= 52) desc = '📈 Dominância elevada — BTC liderando o mercado';
      else if (pct >= 44) desc = '⚖️ Dominância equilibrada — altcoins ganhando força';
      else desc = '🚀 Baixa dominância — mercado em Altseason';
      document.getElementById('dom-desc').textContent = desc;

      // Market cap total
      let mcStr = '--';
      if (totalMcap >= 1e12) mcStr = '$' + (totalMcap / 1e12).toFixed(2) + ' T';
      else if (totalMcap >= 1e9) mcStr = '$' + (totalMcap / 1e9).toFixed(0) + ' B';
      document.getElementById('dom-extra').textContent = `Market Cap Total Cripto: ${mcStr}`;
      document.getElementById('dom-updated').textContent = `Atualizado ${timeAgo(Date.now())} · cache 5min`;
    } catch (e) {
      document.getElementById('dom-updated').textContent = '⚠️ Indisponível';
    }
  }

  // ── Open Interest ────────────────────────────────────────────────────────────

  async function loadOpenInterest() {
    try {
      const r = await fetch('/api/open-interest');
      if (!r.ok) throw new Error();
      const d = await r.json();

      document.getElementById('oi-total').textContent = fmtUsd(d.totalOiUsd || 0);
      document.getElementById('oi-btc-price').textContent = `BTC: $${(d.btcPrice || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('oi-updated').textContent = `Atualizado ${timeAgo(d.updatedAt || Date.now())} · cache 2min`;

      // ── OI por exchange ────────────────────────────────────────────────────
      const exch = d.exchanges || [];
      const maxOi = exch.length ? Math.max(...exch.map(e => e.oiUsd)) : 1;
      const colors = { Binance: '#f0b90b', Bybit: '#ff7a00', OKX: '#0ecb81', Bitget: '#00bfff' };

      const lsMap = d.longShort || {};

      document.getElementById('oi-exchanges').innerHTML = exch.length ? exch.map(e => {
        const pct      = maxOi > 0 ? (e.oiUsd / maxOi * 100).toFixed(1) : 0;
        const sharePct = d.totalOiUsd > 0 ? (e.oiUsd / d.totalOiUsd * 100).toFixed(1) : 0;
        const color    = colors[e.name] || '#848e9c';
        const lsKey    = e.name.toLowerCase();
        const ls       = lsMap[lsKey];
        const lsHtml   = ls ? `
          <div class="oi-ls-bar-wrap" title="Long ${ls.longPct.toFixed(1)}% · Short ${ls.shortPct.toFixed(1)}%">
            <div class="oi-ls-bar-long"  style="width:${ls.longPct.toFixed(1)}%"></div>
            <div class="oi-ls-bar-short" style="width:${ls.shortPct.toFixed(1)}%"></div>
          </div>
          <span class="oi-ls-long-pct">🟢 ${ls.longPct.toFixed(1)}%</span>
          <span class="oi-ls-short-pct">🔴 ${ls.shortPct.toFixed(1)}%</span>` : `<span class="oi-no-data" style="grid-column:span 3">L/S indisponível</span>`;
        return `
          <div class="oi-exchange-row">
            <span class="oi-ex-name">${e.name}</span>
            <div class="oi-ex-bar-wrap">
              <div class="oi-ex-bar" style="width:${pct}%; background:${color};"></div>
            </div>
            <span class="oi-ex-usd" style="color:${color}">${fmtUsd(e.oiUsd)}</span>
            <span class="oi-ex-btc">${fmtBtc(e.oiBtc)}</span>
            <span class="oi-ex-share">${sharePct}%</span>
            ${lsHtml}
          </div>`;
      }).join('') : '<span class="oi-no-data">Sem dados disponíveis</span>';

      // ── Taker Buy/Sell Ratio (pressão real de mercado) ────────────────────
      const tk = d.taker;
      const takerEl = document.getElementById('oi-taker');
      if (takerEl && tk) {
        const buyColor  = tk.buyPct >= 50 ? '#0ecb81' : '#848e9c';
        const sellColor = tk.sellPct > 50  ? '#f6465d' : '#848e9c';
        const dominance = tk.buyPct >= 55 ? '🟢 Pressão Compradora' :
                          tk.sellPct >= 55 ? '🔴 Pressão Vendedora' : '⚖️ Equilíbrio de Forças';
        takerEl.innerHTML = `
          <div class="taker-title">TAKER BUY/SELL · BINANCE (5min)</div>
          <div class="taker-dominance">${dominance}</div>
          <div class="taker-bar-wrap">
            <div class="taker-bar-buy"  style="width:${tk.buyPct.toFixed(1)}%"></div>
            <div class="taker-bar-sell" style="width:${tk.sellPct.toFixed(1)}%"></div>
          </div>
          <div class="taker-labels">
            <span style="color:#0ecb81">▲ COMPRA ${tk.buyPct.toFixed(1)}%</span>
            <span style="color:#f6465d">▼ VENDA ${tk.sellPct.toFixed(1)}%</span>
          </div>`;
      } else if (takerEl) {
        takerEl.innerHTML = '<div class="oi-no-data">Taker data indisponível</div>';
      }
    } catch (e) {
      document.getElementById('oi-updated').textContent = '⚠️ Indisponível';
    }
  }

  // ── Init & Intervalos ────────────────────────────────────────────────────────

  function init() {
    loadFearGreed();
    loadDominance();
    loadOpenInterest();

    setInterval(loadFearGreed,    60 * 60 * 1000); // 1h
    setInterval(loadDominance,     5 * 60 * 1000); // 5min
    setInterval(loadOpenInterest,  2 * 60 * 1000); // 2min
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
