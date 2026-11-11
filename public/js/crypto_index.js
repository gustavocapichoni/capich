// js/crypto_index.js — Índice de Mercado Cripto TOP 10 · Gráfico de Velas

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
  let currentData   = null;
  let hoveredIdx    = null;
  let resizeTimer   = null;
  let binanceWs     = null;
  let latestPrices  = {};
  let rafId         = null;
  let wsReconnectId = null;

  // ── Utilitários ──────────────────────────────────────────────────────────────

  function fmtDate(ts, interval) {
    const d = new Date(ts);
    if (interval === '1d') return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    if (interval === '15m') {
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      return `${hh}:${mm}`;
    }
    return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}h`;
  }

  function fmtVal(v) { return (v || 0).toFixed(2); }

  function fmtUSD(val) {
    if (val === null || val === undefined || isNaN(val)) return '$0';
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : (val > 0 ? '+' : '');
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  function fmtBTC(val) {
    if (val === null || val === undefined || isNaN(val)) return '0 BTC';
    const sign = val > 0 ? '+' : (val < 0 ? '-' : '');
    return `${sign}${Math.abs(Math.round(val)).toLocaleString('pt-BR')} BTC`;
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `há ${diff}s`;
    if (diff < 3600) return `há ${Math.floor(diff/60)}min`;
    return `há ${Math.floor(diff/3600)}h`;
  }

  // ── Renderizador Multi-Painel Ultra-Nítido (Estilo TradingView) ───────────────

  function renderChart(canvas, candles, interval) {
    if (!candles || !candles.length) return;
    const wrap  = canvas.parentElement;
    const DPR   = window.devicePixelRatio || 1;
    const W_CSS = wrap.clientWidth || 900;
    const H_CSS = 540;

    canvas.style.width  = W_CSS + 'px';
    canvas.style.height = H_CSS + 'px';
    canvas.width  = Math.floor(W_CSS * DPR);
    canvas.height = Math.floor(H_CSS * DPR);

    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const PAD_L = 58, PAD_R = 75, PAD_T = 20, PAD_B = 26;
    const cW = W_CSS - PAD_L - PAD_R;

    // Viewports verticais dos 3 painéis
    const H_MAIN = 265;                         // Painel 1: Velas + MMAs (Y: 20 a 285)
    const Y_DIV1 = PAD_T + H_MAIN + 8;           // Divisor 1 (Y: 293)
    const Y_FLOW = Y_DIV1 + 16;                  // Painel 2: Fluxo CEX (Y: 309 a 414)
    const H_FLOW = 105;
    const Y_DIV2 = Y_FLOW + H_FLOW + 8;          // Divisor 2 (Y: 427)
    const Y_VOL  = Y_DIV2 + 16;                  // Painel 3: Volume (Y: 443 a 513)
    const H_VOL  = 70;

    // Fundo geral escuro de alto contraste
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, W_CSS, H_CSS);

    const toX = i => PAD_L + (i + 0.5) * (cW / candles.length);
    const spacing = cW / candles.length;
    const bodyW = Math.max(2, Math.round(spacing * 0.72));

    // =========================================================================
    // PAINEL 1: VELAS DO ÍNDICE + MMAs (32 / 80) — ULTRA NÍTIDO
    // =========================================================================
    const rawMin = Math.min(...candles.map(c => c.l));
    const rawMax = Math.max(...candles.map(c => c.h));
    const range  = rawMax - rawMin || 1;
    const pMin   = rawMin - range * 0.05;
    const pMax   = rawMax + range * 0.05;
    const pRange = pMax - pMin;

    const toY = v => PAD_T + ((pMax - v) / pRange) * H_MAIN;

    // Grid horizontal do Painel 1 (Linhas pontilhadas ultra sutis)
    const gridN = 4;
    for (let i = 0; i <= gridN; i++) {
      const y = Math.floor(PAD_T + (i / gridN) * H_MAIN) + 0.5;
      const val = pMax - (i / gridN) * pRange;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + cW, y); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle  = '#788293';
      ctx.font       = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace';
      ctx.textAlign  = 'right';
      ctx.fillText(fmtVal(val), PAD_L - 6, y + 3.5);
    }

    // Grid vertical leve abrangendo todos os 3 painéis
    const nthV = Math.ceil(candles.length / 8);
    candles.forEach((c, i) => {
      if (i % nthV === 0) {
        const x = Math.floor(toX(i)) + 0.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, Y_VOL + H_VOL); ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Velas com Pixel Snapping Exato (Zero Embaçado)
    candles.forEach((c, i) => {
      const cx = toX(i);
      const isGreen = c.c >= c.o;
      const color = isGreen ? '#0ecb81' : '#f6465d';
      const yO = toY(c.o), yC = toY(c.c);
      const yH = toY(c.h), yL = toY(c.l);

      // Pavio (Wick) de 1px reto centrado no meio do pixel
      const wickX = Math.floor(cx) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(wickX, Math.round(yH));
      ctx.lineTo(wickX, Math.round(yL));
      ctx.stroke();

      // Corpo (Body) com coordenadas inteiras para corte reto
      const bodyTop = Math.min(yO, yC);
      const bodyH   = Math.max(1, Math.abs(yC - yO));
      const bodyLeft = Math.round(cx - bodyW / 2);

      ctx.fillStyle = color;
      ctx.fillRect(bodyLeft, Math.round(bodyTop), bodyW, Math.max(1, Math.round(bodyH)));
    });

    // Curvas das MMAs sobrepostas (MMA 32 & MMA 80)
    // 1. MMA 32 (Amarela/Dourada)
    ctx.strokeStyle = '#f0b90b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let hasMma32 = false;
    candles.forEach((c, i) => {
      if (c.sma32 !== undefined) {
        const x = toX(i);
        const y = toY(c.sma32);
        if (!hasMma32) { ctx.moveTo(x, y); hasMma32 = true; }
        else { ctx.lineTo(x, y); }
      }
    });
    ctx.stroke();

    // 2. MMA 80 (Lilás/Roxa)
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let hasMma80 = false;
    candles.forEach((c, i) => {
      if (c.sma80 !== undefined) {
        const x = toX(i);
        const y = toY(c.sma80);
        if (!hasMma80) { ctx.moveTo(x, y); hasMma80 = true; }
        else { ctx.lineTo(x, y); }
      }
    });
    ctx.stroke();

    // Linha e Badge do Preço Atual (Direita)
    const lastClose = candles[candles.length - 1].c;
    const yLast = toY(lastClose);
    const lastColor = candles[candles.length - 1].c >= candles[candles.length - 1].o ? '#0ecb81' : '#f6465d';

    ctx.strokeStyle = lastColor;
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD_L, yLast); ctx.lineTo(PAD_L + cW, yLast); ctx.stroke();
    ctx.setLineDash([]);

    const badgeW = 64, badgeH = 18;
    ctx.fillStyle = lastColor;
    ctx.beginPath();
    ctx.roundRect(PAD_L + cW + 4, yLast - badgeH / 2, badgeW, badgeH, 3);
    ctx.fill();
    ctx.fillStyle = '#0b0e14';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fmtVal(lastClose), PAD_L + cW + 4 + badgeW / 2, yLast + 4);

    // =========================================================================
    // DIVISOR 1 & PAINEL 2: FLUXO DE CAPITAL CEX (DÓLARES & BITCOINS)
    // =========================================================================
    // Linha divisória
    ctx.strokeStyle = '#1c2230';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, Y_DIV1); ctx.lineTo(PAD_L + cW, Y_DIV1); ctx.stroke();

    // Título do Painel 2
    ctx.fillStyle = '#848e9c';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('FLUXO CEX · DÓLAR (VERDE/VERMELHO) & BTC (DOURADO/ROSA)', PAD_L + 6, Y_FLOW - 4);

    // Escala Painel 2
    const usdVals = candles.flatMap(c => [c.flowUsd || 0, c.flowUsdRef || 0]);
    const maxUsd = Math.max(...usdVals);
    const minUsd = Math.min(...usdVals);
    const usdSpan = Math.max(Math.abs(maxUsd), Math.abs(minUsd)) * 1.15 || 1000000;
    const toYFlow = v => Y_FLOW + (H_FLOW / 2) - (v / usdSpan) * (H_FLOW / 2);

    // Linha de equilíbrio zero
    const yZeroFlow = Math.floor(Y_FLOW + H_FLOW / 2) + 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(PAD_L, yZeroFlow); ctx.lineTo(PAD_L + cW, yZeroFlow); ctx.stroke();
    ctx.setLineDash([]);

    // Preenchimento dinâmico entre linha Verde e linha Vermelha
    candles.forEach((c, i) => {
      if (i === 0) return;
      const prev = candles[i - 1];
      const x1 = toX(i - 1), x2 = toX(i);
      const yGreen1 = toYFlow(prev.flowUsd || 0), yGreen2 = toYFlow(c.flowUsd || 0);
      const yRed1   = toYFlow(prev.flowUsdRef || 0), yRed2 = toYFlow(c.flowUsdRef || 0);

      const isPos = (c.flowUsd || 0) >= (c.flowUsdRef || 0);
      ctx.beginPath();
      ctx.moveTo(x1, yGreen1);
      ctx.lineTo(x2, yGreen2);
      ctx.lineTo(x2, yRed2);
      ctx.lineTo(x1, yRed1);
      ctx.closePath();
      ctx.fillStyle = isPos ? 'rgba(14, 203, 129, 0.12)' : 'rgba(246, 70, 93, 0.12)';
      ctx.fill();
    });

    // 1. Linha Vermelha de Referência de USD (Saída/Média)
    ctx.strokeStyle = '#f6465d';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = toX(i);
      const y = toYFlow(c.flowUsdRef || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Linha Verde de Fluxo de USD (Entrada Real)
    ctx.strokeStyle = '#0ecb81';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = toX(i);
      const y = toYFlow(c.flowUsd || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 3. Linha Rosa de Referência de BTC
    const btcSpan = usdSpan / 76000;
    const toYFlowBtc = v => Y_FLOW + (H_FLOW / 2) - (v / btcSpan) * (H_FLOW / 2);

    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = toX(i);
      const y = toYFlowBtc(c.flowBtcRef || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Linha Dourada de Fluxo de BTC
    ctx.strokeStyle = '#f0b90b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = toX(i);
      const y = toYFlowBtc(c.flowBtc || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Rótulos do Eixo Y do Fluxo (Direita)
    ctx.fillStyle = '#788293';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtUSD(usdSpan), PAD_L + cW + 4, Y_FLOW + 10);
    ctx.fillText('$0', PAD_L + cW + 4, yZeroFlow + 3);
    ctx.fillText(fmtUSD(-usdSpan), PAD_L + cW + 4, Y_FLOW + H_FLOW - 2);

    // =========================================================================
    // DIVISOR 2 & PAINEL 3: VOLUME SPOT vs FUTUROS
    // =========================================================================
    ctx.strokeStyle = '#1c2230';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, Y_DIV2); ctx.lineTo(PAD_L + cW, Y_DIV2); ctx.stroke();

    // Título do Painel 3
    ctx.fillStyle = '#848e9c';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VOLUME 15M · FUTUROS (PRATA) vs SPOT (AZUL)', PAD_L + 6, Y_VOL - 4);

    const maxVol = Math.max(...candles.map(c => Math.max(c.vFut || 0, c.vSpot || 0))) * 1.15 || 1000000;
    const toYVol = v => Y_VOL + H_VOL - (v / maxVol) * H_VOL;

    // Linha Prata (Futuros) com área sombreada
    ctx.beginPath();
    ctx.moveTo(toX(0), toYVol(candles[0].vFut || 0));
    candles.forEach((c, i) => ctx.lineTo(toX(i), toYVol(c.vFut || 0)));
    ctx.lineTo(toX(candles.length - 1), Y_VOL + H_VOL);
    ctx.lineTo(toX(0), Y_VOL + H_VOL);
    ctx.closePath();
    const gradFut = ctx.createLinearGradient(0, Y_VOL, 0, Y_VOL + H_VOL);
    gradFut.addColorStop(0, 'rgba(203, 213, 225, 0.15)');
    gradFut.addColorStop(1, 'rgba(203, 213, 225, 0.01)');
    ctx.fillStyle = gradFut;
    ctx.fill();

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = toX(i);
      const y = toYVol(c.vFut || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Linha Azul (Spot) com área sombreada
    ctx.beginPath();
    ctx.moveTo(toX(0), toYVol(candles[0].vSpot || 0));
    candles.forEach((c, i) => ctx.lineTo(toX(i), toYVol(c.vSpot || 0)));
    ctx.lineTo(toX(candles.length - 1), Y_VOL + H_VOL);
    ctx.lineTo(toX(0), Y_VOL + H_VOL);
    ctx.closePath();
    const gradSpot = ctx.createLinearGradient(0, Y_VOL, 0, Y_VOL + H_VOL);
    gradSpot.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
    gradSpot.addColorStop(1, 'rgba(56, 189, 248, 0.01)');
    ctx.fillStyle = gradSpot;
    ctx.fill();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = toX(i);
      const y = toYVol(c.vSpot || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Rótulos do Eixo Y do Volume (Direita)
    ctx.fillStyle = '#788293';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtUSD(maxVol), PAD_L + cW + 4, Y_VOL + 10);
    ctx.fillText(fmtUSD(maxVol / 2), PAD_L + cW + 4, Y_VOL + H_VOL / 2 + 3);

    // =========================================================================
    // EIXO TEMPORAL (BASE)
    // =========================================================================
    ctx.fillStyle = '#788293';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    candles.forEach((c, i) => {
      if (i % nthV === 0) {
        ctx.fillText(fmtDate(c.t, interval), toX(i), H_CSS - 8);
      }
    });

    // =========================================================================
    // CROSSHAIR UNIFICADO QUANDO EM HOVER
    // =========================================================================
    if (hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < candles.length) {
      const hx = Math.floor(toX(hoveredIdx)) + 0.5;
      const hc = candles[hoveredIdx];

      // Linha vertical pontilhada contínua cobrindo todos os 3 painéis
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, PAD_T);
      ctx.lineTo(hx, Y_VOL + H_VOL);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pontos destacados nas curvas
      const drawPoint = (y, color) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(hx, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 1.5; ctx.stroke();
      };

      if (hc.sma32 !== undefined) drawPoint(toY(hc.sma32), '#f0b90b');
      if (hc.sma80 !== undefined) drawPoint(toY(hc.sma80), '#a855f7');
      drawPoint(toYFlow(hc.flowUsd || 0), '#0ecb81');
      drawPoint(toYFlow(hc.flowUsdRef || 0), '#f6465d');
      drawPoint(toYFlowBtc(hc.flowBtc || 0), '#f0b90b');
      drawPoint(toYFlowBtc(hc.flowBtcRef || 0), '#ec4899');
      drawPoint(toYVol(hc.vFut || 0), '#cbd5e1');
      drawPoint(toYVol(hc.vSpot || 0), '#38bdf8');
    }

    // Armazena metadados para interação
    canvas._chartMeta = {
      PAD_L, PAD_R, PAD_T, cW, H_MAIN, Y_FLOW, H_FLOW, Y_VOL, H_VOL,
      candles, interval, toX, toY, toYFlow, toYFlowBtc, toYVol, spacing
    };
  }

  // ── Hover / Tooltip Multi-Métricas ───────────────────────────────────────────

  function attachHover(canvas, tooltip) {
    canvas.addEventListener('mousemove', e => {
      const meta = canvas._chartMeta;
      if (!meta) return;
      const rect  = canvas.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const my    = e.clientY - rect.top;
      const { PAD_L, PAD_R, PAD_T, cW, candles, interval, Y_VOL, H_VOL } = meta;

      if (mx < PAD_L || mx > PAD_L + cW || my < PAD_T || my > (Y_VOL + H_VOL)) {
        tooltip.style.display = 'none';
        if (hoveredIdx !== null) { hoveredIdx = null; renderChart(canvas, candles, interval); }
        return;
      }

      const idx = Math.floor((mx - PAD_L) / (cW / candles.length));
      if (idx < 0 || idx >= candles.length) return;

      if (hoveredIdx !== idx) {
        hoveredIdx = idx;
        renderChart(canvas, candles, interval);
      }

      const c = candles[idx];
      const isGreen  = c.c >= c.o;
      const change   = ((c.c - c.o) / c.o * 100).toFixed(2);
      const chColor  = isGreen ? '#0ecb81' : '#f6465d';
      const chSign   = isGreen ? '+' : '';

      const usdInflow = (c.flowUsd || 0) >= (c.flowUsdRef || 0);
      const btcInflow = (c.flowBtc || 0) >= (c.flowBtcRef || 0);

      tooltip.innerHTML = `
        <div class="ci-tt-date">${fmtDate(c.t, interval)}</div>
        
        <div class="ci-tt-section">Velas do Índice TOP 10</div>
        <div class="ci-tt-row"><span>Abertura</span><span>${fmtVal(c.o)}</span></div>
        <div class="ci-tt-row"><span>Máx / Mín</span><span>${fmtVal(c.h)} / ${fmtVal(c.l)}</span></div>
        <div class="ci-tt-row"><span>Fechamento</span><span style="color:${chColor}">${fmtVal(c.c)} (${chSign}${change}%)</span></div>
        ${c.sma32 !== undefined ? `<div class="ci-tt-row"><span style="color:#f0b90b">MMA 32</span><span style="color:#f0b90b">${fmtVal(c.sma32)}</span></div>` : ''}
        ${c.sma80 !== undefined ? `<div class="ci-tt-row"><span style="color:#a855f7">MMA 80</span><span style="color:#a855f7">${fmtVal(c.sma80)}</span></div>` : ''}

        <div class="ci-tt-section">Fluxo de Capital CEX</div>
        <div class="ci-tt-row">
          <span>Dólar (USD)</span>
          <span style="color:${usdInflow ? '#0ecb81' : '#f6465d'}">${fmtUSD(c.flowUsd || 0)} ${usdInflow ? '🟢 Inflow' : '🔴 Outflow'}</span>
        </div>
        <div class="ci-tt-row">
          <span>Bitcoin (BTC)</span>
          <span style="color:${btcInflow ? '#f0b90b' : '#ec4899'}">${fmtBTC(c.flowBtc || 0)} ${btcInflow ? '🟢 Inflow' : '🛡️ Outflow'}</span>
        </div>

        <div class="ci-tt-section">Volume de Negociação</div>
        <div class="ci-tt-row"><span style="color:#cbd5e1">Futuros</span><span>${fmtUSD(c.vFut || 0)}</span></div>
        <div class="ci-tt-row"><span style="color:#38bdf8">Spot (À Vista)</span><span>${fmtUSD(c.vSpot || 0)}</span></div>
      `;
      tooltip.style.display = 'block';

      // Posicionamento do tooltip inteligente
      const tw = 220, th = 260;
      let tx = e.clientX - rect.left + 16;
      let ty = e.clientY - rect.top  - 10;
      if (tx + tw > rect.width)  tx = e.clientX - rect.left - tw - 16;
      if (ty + th > rect.height) ty = Math.max(10, rect.height - th - 10);
      tooltip.style.left = tx + 'px';
      tooltip.style.top  = ty + 'px';
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
      hoveredIdx = null;
      if (currentData) renderChart(canvas, currentData.candles, currentData.interval);
    });
  }

  // ── Atualiza Stats (header) ──────────────────────────────────────────────────

  function updateStats(candles) {
    const first = candles[0].o;
    const last  = candles[candles.length - 1].c;
    const chg   = ((last - first) / first * 100);
    const chgEl = document.getElementById('ci-change');
    const isPos = chg >= 0;
    document.getElementById('ci-open').textContent    = fmtVal(first);
    document.getElementById('ci-current').textContent = fmtVal(last);
    if (chgEl) {
      chgEl.textContent  = (isPos ? '+' : '') + chg.toFixed(2) + '%';
      chgEl.style.color  = isPos ? '#0ecb81' : '#f6465d';
    }
  }

  // ── WebSocket ao Vivo Binance (Tick a Tick em Tempo Real) ────────────────────

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
          updated.innerHTML = `<span style="color:#0ecb81;font-weight:700;">● Ao Vivo (Tick a Tick)</span>`;
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
      candles.push({
        t: newT,
        o: liveIdx,
        h: liveIdx,
        l: liveIdx,
        c: liveIdx,
        sma32: liveIdx,
        sma80: liveIdx,
        flowUsd: lastCandle.flowUsd || 0,
        flowUsdRef: lastCandle.flowUsdRef || 0,
        flowBtc: lastCandle.flowBtc || 0,
        flowBtcRef: lastCandle.flowBtcRef || 0,
        vSpot: lastCandle.vSpot || 0,
        vFut: lastCandle.vFut || 0
      });
      if (candles.length > 96) candles.shift();
    } else {
      lastCandle.c = liveIdx;
      if (liveIdx > lastCandle.h) lastCandle.h = liveIdx;
      if (liveIdx < lastCandle.l) lastCandle.l = liveIdx;
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

    const canvas = document.getElementById('crypto-index-canvas');
    if (canvas && hoveredIdx === null) {
      renderChart(canvas, candles, currentTf);
    }
    updateStats(candles);
  }

  // ── Carregamento de Dados ────────────────────────────────────────────────────

  async function loadIndex(interval) {
    const canvas  = document.getElementById('crypto-index-canvas');
    const loading = document.getElementById('ci-loading');
    const updated = document.getElementById('ci-updated');
    if (!canvas) return;

    if (loading) loading.style.display = 'flex';

    try {
      const r = await fetch(`/api/crypto-index?interval=${interval}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();

      if (!d.candles || !d.candles.length) throw new Error('Sem dados');

      currentData = d;
      hoveredIdx  = null;

      // Inicializa preços em cache para o WebSocket
      if (d.basketDetails) {
        d.basketDetails.forEach(b => {
          latestPrices[b.symbol] = b.lastPrice || b.basePrice;
        });
        initWebSocket(d.basketDetails);
      }

      renderChart(canvas, d.candles, interval);
      updateStats(d.candles);

      if (loading) loading.style.display = 'none';
      if (updated) {
        updated.innerHTML = `<span style="color:#0ecb81;font-weight:700;">● Ao Vivo (Tick a Tick)</span>`;
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

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    const canvas  = document.getElementById('crypto-index-canvas');
    const tooltip = document.getElementById('ci-tooltip');
    if (!canvas || !tooltip) return;

    attachHover(canvas, tooltip);

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

    // Redimensionamento responsivo
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (currentData) renderChart(canvas, currentData.candles, currentData.interval);
      }, 200);
    });

    // Carga inicial (15m padrão)
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
