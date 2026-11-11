// js/daily_analysis.js - Análise Diária (Volume Spot vs Futuros com MMA 8 & Fechamento 8 Dias) com Tooltip Interativo

(function () {
  'use strict';

  const DAILY_COINS = [
    { symbol: "BTCUSDT", name: "BTC", iconImg: "assets/icons/btc.png", title: "BTC / USDT", accent: "#F0B90B", dec: 2 },
    { symbol: "ETHUSDT", name: "ETH", iconImg: "assets/icons/eth.png", title: "ETH / USDT", accent: "#627EEA", dec: 2 },
    { symbol: "BNBUSDT", name: "BNB", iconImg: "assets/icons/bnb.png", title: "BNB / USDT", accent: "#F3BA2F", dec: 2 },
    { symbol: "BCHUSDT", name: "BCH", iconImg: "assets/icons/bch.png", title: "BCH / USDT", accent: "#8DC351", dec: 2 },
    { symbol: "UNIUSDT", name: "UNI", iconImg: "assets/icons/uni.png", title: "UNI / USDT", accent: "#FF007A", dec: 4 }
  ];

  const chartStateMap = {};

  function fmtDailyPrice(val, dec = 2) {
    if (val === null || val === undefined || isNaN(val) || val === 0) return "--";
    return "$" + Number(val).toLocaleString("en-US", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec
    });
  }

  function fmtVolumeCompact(val) {
    if (!val || isNaN(val)) return "--";
    if (val >= 1e9) return "$" + (val / 1e9).toFixed(2) + "B";
    if (val >= 1e6) return "$" + (val / 1e6).toFixed(1) + "M";
    if (val >= 1e3) return "$" + (val / 1e3).toFixed(0) + "K";
    return "$" + val.toFixed(0);
  }

  function showTooltip(html, x, y) {
    let el = document.getElementById("daily-chart-tooltip");
    if (!el) {
      el = document.createElement("div");
      el.id = "daily-chart-tooltip";
      el.className = "daily-chart-tooltip";
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    el.style.display = "block";
  }

  function hideTooltip() {
    const el = document.getElementById("daily-chart-tooltip");
    if (el) el.style.display = "none";
  }

  // ─── Criação da Estrutura Inicial no DOM ──────────────────────────────────────
  function buildDailyTableDOM() {
    const container = document.getElementById("daily-rows-container");
    if (!container) return;
    container.innerHTML = "";

    DAILY_COINS.forEach((coin, idx) => {
      const row = document.createElement("div");
      row.className = "daily-card-row";
      row.id = `daily-row-${idx}`;

      row.innerHTML = `
        <!-- Coluna 1: Identificação da Moeda -->
        <div class="daily-col-coin">
          <img src="${coin.iconImg}" alt="${coin.name}" class="daily-coin-icon">
          <div class="daily-coin-text">
            <div class="daily-coin-title" style="color: ${coin.accent};">${coin.title}</div>
            <div class="daily-coin-sub">Diário (1D)</div>
          </div>
        </div>

        <!-- Coluna 2: Histogramas de Volume (Spot & Futuros com MMA 8) -->
        <div class="daily-col-volumes">
          <!-- Volume Spot -->
          <div class="vol-box-row">
            <div class="vol-meta">
              <span class="vol-label">Volume Spot (8D)</span>
              <span class="vol-val" id="spot-vol-text-${idx}">Carregando...</span>
            </div>
            <div class="vol-canvas-wrap">
              <canvas id="canvas-spot-vol-${idx}"></canvas>
            </div>
          </div>

          <!-- Volume Futuros -->
          <div class="vol-box-row">
            <div class="vol-meta">
              <span class="vol-label">Volume Futuro (8D)</span>
              <span class="vol-val" id="fut-vol-text-${idx}">Carregando...</span>
            </div>
            <div class="vol-canvas-wrap">
              <canvas id="canvas-fut-vol-${idx}"></canvas>
            </div>
          </div>
        </div>

        <!-- Coluna 3: Candle Diário vs Média de 8 Dias (MMA 8D) -->
        <div class="daily-col-candle">
          <div class="candle-box-label">CANDLE DIÁRIO VS MMA 8D</div>
          <div class="candle-badge" id="candle-badge-${idx}">Calculando...</div>
          <div class="candle-data-grid">
            <div>
              <span class="c-sublabel">Preço:</span>
              <strong class="c-value" id="candle-price-${idx}">--</strong>
            </div>
            <div>
              <span class="c-sublabel">MMA 8D:</span>
              <strong class="c-value" id="candle-mma8-${idx}">--</strong>
            </div>
            <div>
              <span class="c-sublabel">Var. Dia:</span>
              <strong class="c-value" id="candle-day-var-${idx}">--</strong>
            </div>
            <div>
              <span class="c-sublabel">Dist. MMA8:</span>
              <strong class="c-value" id="candle-dist-${idx}">--</strong>
            </div>
          </div>
        </div>

        <!-- Coluna 4: Gráfico de Fechamento Diário (8 Dias) -->
        <div class="daily-col-chart">
          <div class="chart-header-row">
            <span class="chart-box-label">FECHAMENTO DIÁRIO (8 DIAS)</span>
            <span class="chart-range-label" id="chart-range-${idx}">--</span>
          </div>
          <div class="chart-canvas-wrap">
            <canvas id="canvas-price-chart-${idx}"></canvas>
          </div>
        </div>
      `;

      container.appendChild(row);
    });
  }

  // ─── Busca de Dados Diários (Spot e Futuros) ──────────────────────────────────
  async function fetchDailyDataForCoin(idx) {
    const coin = DAILY_COINS[idx];
    try {
      const urlSpot = `https://api.binance.com/api/v3/klines?symbol=${coin.symbol}&interval=1d&limit=16`;
      const urlFut  = `https://fapi.binance.com/fapi/v1/klines?symbol=${coin.symbol}&interval=1d&limit=16`;

      const [resSpot, resFut] = await Promise.all([
        fetch(urlSpot).then(r => r.json()),
        fetch(urlFut).then(r => r.json())
      ]);

      if (!Array.isArray(resSpot) || resSpot.length < 15 || !Array.isArray(resFut) || resFut.length < 15) {
        return;
      }

      processDailyData(idx, resSpot, resFut);
    } catch (err) {
      console.warn(`Erro ao buscar dados diários para ${coin.symbol}:`, err);
    }
  }

  // ─── Processamento dos Dados e Desenho dos Gráficos ───────────────────────────
  function processDailyData(idx, spotKlines, futKlines) {
    const coin = DAILY_COINS[idx];

    // Extração dos últimos 8 candles
    const spotLast8 = spotKlines.slice(-8);
    const futLast8  = futKlines.slice(-8);

    const closesAllSpot = spotKlines.map(k => parseFloat(k[4]));
    const opensLast8    = spotLast8.map(k => parseFloat(k[1]));
    const closesLast8   = spotLast8.map(k => parseFloat(k[4]));

    const spotVolsAll   = spotKlines.map(k => parseFloat(k[7]));
    const futVolsAll    = futKlines.map(k => parseFloat(k[7]));

    const spotVolsLast8 = spotLast8.map(k => parseFloat(k[7]));
    const futVolsLast8  = futLast8.map(k => parseFloat(k[7]));

    // Labels formatadas de datas para os 8 dias (ex: 04/11 (Hoje))
    const dateLabels = spotLast8.map((k, i) => {
      const dt = new Date(k[0]);
      const day = String(dt.getDate()).padStart(2, '0');
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      if (i === 7) return `${day}/${month} (Hoje)`;
      if (i === 6) return `${day}/${month} (Ontem)`;
      return `${day}/${month} (Dia ${i + 1})`;
    });

    // Cálculo da MMA 8 de Volume para cada um dos 8 dias exibidos
    const spotVolSma8 = [];
    const futVolSma8  = [];
    for (let i = 0; i < 8; i++) {
      const endIdx = spotKlines.length - 8 + i + 1;
      const spotSlice = spotVolsAll.slice(Math.max(0, endIdx - 8), endIdx);
      const futSlice  = futVolsAll.slice(Math.max(0, endIdx - 8), endIdx);
      spotVolSma8.push(spotSlice.reduce((a, b) => a + b, 0) / spotSlice.length);
      futVolSma8.push(futSlice.reduce((a, b) => a + b, 0) / futSlice.length);
    }

    // Cálculo da MMA 8D de Preço atual
    const mma8Price = closesAllSpot.slice(-8).reduce((a, b) => a + b, 0) / 8.0;
    const currentPrice = closesLast8[closesLast8.length - 1];
    const currentOpen  = opensLast8[opensLast8.length - 1];

    const priceDiffPct = ((currentPrice - mma8Price) / mma8Price) * 100.0;
    const dayChangePct = ((currentPrice - currentOpen) / currentOpen) * 100.0;

    // ── Atualização dos textos da Coluna 3 (Candle vs MMA 8D) ──
    const elBadge   = document.getElementById(`candle-badge-${idx}`);
    const elPrice   = document.getElementById(`candle-price-${idx}`);
    const elMma8    = document.getElementById(`candle-mma8-${idx}`);
    const elDayVar  = document.getElementById(`candle-day-var-${idx}`);
    const elDist    = document.getElementById(`candle-dist-${idx}`);

    if (elPrice)  elPrice.textContent = fmtDailyPrice(currentPrice, coin.dec);
    if (elMma8)   elMma8.textContent  = fmtDailyPrice(mma8Price, coin.dec);

    if (elDayVar) {
      const s = dayChangePct > 0 ? "+" : "";
      elDayVar.textContent = `${s}${dayChangePct.toFixed(2)}%`;
      elDayVar.style.color = dayChangePct >= 0 ? "#0ECB81" : "#F6465D";
    }

    if (elDist) {
      const s = priceDiffPct > 0 ? "+" : "";
      elDist.textContent = `${s}${priceDiffPct.toFixed(2)}%`;
      elDist.style.color = priceDiffPct >= 0 ? "#0ECB81" : "#F6465D";
    }

    if (elBadge) {
      const s = priceDiffPct > 0 ? "+" : "";
      if (priceDiffPct > 0.05) {
        elBadge.innerHTML = `▲ ACIMA DA MÉDIA 8D (${s}${priceDiffPct.toFixed(2)}%)`;
        elBadge.className = "candle-badge acima";
      } else if (priceDiffPct < -0.05) {
        elBadge.innerHTML = `▼ ABAIXO DA MÉDIA 8D (${s}${priceDiffPct.toFixed(2)}%)`;
        elBadge.className = "candle-badge abaixo";
      } else {
        elBadge.innerHTML = `— NA MÉDIA 8D (0.00%)`;
        elBadge.className = "candle-badge neutro";
      }
    }

    // ── Atualização dos textos de Volume ──
    const curSpotVol = spotVolsLast8[spotVolsLast8.length - 1];
    const curSpotSma = spotVolSma8[spotVolSma8.length - 1];
    const spotDiff   = ((curSpotVol - curSpotSma) / curSpotSma) * 100;

    const curFutVol = futVolsLast8[futVolsLast8.length - 1];
    const curFutSma = futVolSma8[futVolSma8.length - 1];
    const futDiff   = ((curFutVol - curFutSma) / curFutSma) * 100;

    const elSpotText = document.getElementById(`spot-vol-text-${idx}`);
    if (elSpotText) {
      const s = spotDiff > 0 ? "+" : "";
      elSpotText.innerHTML = `${fmtVolumeCompact(curSpotVol)} <span class="vol-mma-info">(MMA8: ${fmtVolumeCompact(curSpotSma)} · ${s}${spotDiff.toFixed(0)}%)</span>`;
    }

    const elFutText = document.getElementById(`fut-vol-text-${idx}`);
    if (elFutText) {
      const s = futDiff > 0 ? "+" : "";
      elFutText.innerHTML = `${fmtVolumeCompact(curFutVol)} <span class="vol-mma-info">(MMA8: ${fmtVolumeCompact(curFutSma)} · ${s}${futDiff.toFixed(0)}%)</span>`;
    }

    // Direção de cada dia (verde para alta, vermelho para baixa)
    const isBullishDay = spotLast8.map(k => parseFloat(k[4]) >= parseFloat(k[1]));

    // Armazenar no estado global dos gráficos para hover interativo
    chartStateMap[`canvas-spot-vol-${idx}`] = {
      type: 'vol',
      title: `${coin.title} · Volume Spot`,
      vols: spotVolsLast8,
      sma8Vols: spotVolSma8,
      isBullish: isBullishDay,
      dateLabels,
      opens: opensLast8,
      closes: closesLast8,
      dec: coin.dec
    };

    chartStateMap[`canvas-fut-vol-${idx}`] = {
      type: 'vol',
      title: `${coin.title} · Volume Futuro`,
      vols: futVolsLast8,
      sma8Vols: futVolSma8,
      isBullish: isBullishDay,
      dateLabels,
      opens: opensLast8,
      closes: closesLast8,
      dec: coin.dec
    };

    chartStateMap[`canvas-price-chart-${idx}`] = {
      type: 'price',
      title: `${coin.title} · Fechamento Diário`,
      closes: closesLast8,
      mma8Price,
      rangeLabelId: `chart-range-${idx}`,
      dec: coin.dec,
      accentColor: coin.accent,
      dateLabels
    };

    // Desenhar gráficos
    drawVolumeHistogram(`canvas-spot-vol-${idx}`);
    drawVolumeHistogram(`canvas-fut-vol-${idx}`);
    drawPriceLineChart(`canvas-price-chart-${idx}`);

    // Configurar listeners de hover uma única vez por canvas
    setupCanvasHover(`canvas-spot-vol-${idx}`);
    setupCanvasHover(`canvas-fut-vol-${idx}`);
    setupCanvasHover(`canvas-price-chart-${idx}`);
  }

  // ─── Desenho do Histograma de Volume com Suporte a Hover ──────────────────────
  function drawVolumeHistogram(canvasId, hoveredBarIdx = -1) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const state = chartStateMap[canvasId];
    if (!state) return;

    const { vols, sma8Vols, isBullish } = state;

    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const w    = rect.width || 220;
    const h    = rect.height || 36;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const maxVal = Math.max(...vols, ...sma8Vols) * 1.12 || 1;
    const count  = vols.length; // 8 dias
    const gap    = 4;
    const barW   = (w - (count - 1) * gap) / count;

    // 1. Barras de Volume
    for (let i = 0; i < count; i++) {
      const v    = vols[i];
      const barH = Math.max(3, (v / maxVal) * (h - 6));
      const x    = i * (barW + gap);
      const y    = h - barH - 1;

      const isHovered = (hoveredBarIdx === i);
      const isAnyHovered = (hoveredBarIdx !== -1);

      let alpha = isBullish[i] ? 0.75 : 0.75;
      if (isAnyHovered) {
        alpha = isHovered ? 1.0 : 0.35;
      }

      ctx.fillStyle = isBullish[i] ? `rgba(14, 203, 129, ${alpha})` : `rgba(246, 70, 93, ${alpha})`;
      ctx.fillRect(x, y, barW, barH);

      // Borda
      ctx.strokeStyle = isHovered ? "#FFFFFF" : (isBullish[i] ? "#0ECB81" : "#F6465D");
      ctx.lineWidth   = isHovered ? 1.5 : 1;
      ctx.strokeRect(x, y, barW, barH);

      // Glow extra na barra sob o mouse
      if (isHovered) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
        ctx.fillRect(x, y, barW, barH);
      }
    }

    // 2. Linha da Média Móvel de 8 Dias (MMA 8 de Volume) em Dourado/Amarelo
    ctx.beginPath();
    ctx.strokeStyle = hoveredBarIdx !== -1 ? "rgba(240, 185, 11, 0.6)" : "#F0B90B";
    ctx.lineWidth   = 2;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";

    for (let i = 0; i < count; i++) {
      const smaVal = sma8Vols[i];
      const ptY    = h - Math.max(2, (smaVal / maxVal) * (h - 6)) - 1;
      const ptX    = i * (barW + gap) + barW / 2;

      if (i === 0) ctx.moveTo(ptX, ptY);
      else ctx.lineTo(ptX, ptY);
    }
    ctx.stroke();

    // Pequenos pontos na linha da MMA
    for (let i = 0; i < count; i++) {
      const smaVal = sma8Vols[i];
      const ptY    = h - Math.max(2, (smaVal / maxVal) * (h - 6)) - 1;
      const ptX    = i * (barW + gap) + barW / 2;
      const isHovered = (hoveredBarIdx === i);

      ctx.fillStyle = isHovered ? "#FFFFFF" : "#F0B90B";
      ctx.beginPath();
      ctx.arc(ptX, ptY, isHovered ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ─── Desenho do Gráfico de Linha com Suporte a Hover e Crosshair ───────────────
  function drawPriceLineChart(canvasId, hoveredPtIdx = -1) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const state = chartStateMap[canvasId];
    if (!state) return;

    const { closes, mma8Price, rangeLabelId, dec } = state;

    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const w    = rect.width || 340;
    const h    = rect.height || 64;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const minP = Math.min(...closes, mma8Price);
    const maxP = Math.max(...closes, mma8Price);
    const pad  = (maxP - minP) * 0.14 || 1;
    const low  = minP - pad;
    const high = maxP + pad;
    const count = closes.length; // 8

    // Atualiza label de mínima e máxima dos 8 dias
    const rangeEl = document.getElementById(rangeLabelId);
    if (rangeEl) {
      rangeEl.textContent = `Mín: ${fmtDailyPrice(Math.min(...closes), dec)} | Máx: ${fmtDailyPrice(Math.max(...closes), dec)}`;
    }

    function getX(i) {
      return 10 + (i / (count - 1)) * (w - 20);
    }
    function getY(p) {
      return h - 6 - ((p - low) / (high - low)) * (h - 14);
    }

    // 1. Linha da MMA 8D (Tracejada em Amarelo Dourado para Referência)
    const mmaY = getY(mma8Price);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(240, 185, 11, 0.65)";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, mmaY);
    ctx.lineTo(w - 10, mmaY);
    ctx.stroke();
    ctx.restore();

    // 2. Área com Gradiente abaixo da Linha de Fechamento
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(56, 189, 248, 0.35)");
    grad.addColorStop(1, "rgba(56, 189, 248, 0.0)");

    ctx.beginPath();
    ctx.moveTo(getX(0), h - 2);
    for (let i = 0; i < count; i++) {
      ctx.lineTo(getX(i), getY(closes[i]));
    }
    ctx.lineTo(getX(count - 1), h - 2);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 3. Linha Principal dos 8 Fechamentos Diários
    ctx.beginPath();
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";

    for (let i = 0; i < count; i++) {
      const x = getX(i);
      const y = getY(closes[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 4. Marcadores de Pontos nos 8 Dias
    for (let i = 0; i < count; i++) {
      const x = getX(i);
      const y = getY(closes[i]);
      const isLast = (i === count - 1);
      const isHovered = (hoveredPtIdx === i);

      ctx.fillStyle = isHovered ? "#38BDF8" : (isLast ? "#0ECB81" : "#FFFFFF");
      ctx.beginPath();
      ctx.arc(x, y, isHovered ? 5 : (isLast ? 4 : 2.5), 0, Math.PI * 2);
      ctx.fill();

      if (isLast && !isHovered) {
        ctx.strokeStyle = "#0ECB81";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isHovered) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Linha vertical guia (Crosshair) no ponto ativo
    if (hoveredPtIdx !== -1) {
      const hx = getX(hoveredPtIdx);
      ctx.save();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, 2);
      ctx.lineTo(hx, h - 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // ─── Interatividade de Hover nos Gráficos (Tooltips) ──────────────────────────
  function setupCanvasHover(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || canvas._hoverAttached) return;
    canvas._hoverAttached = true;

    canvas.addEventListener("mousemove", (e) => {
      const state = chartStateMap[canvasId];
      if (!state) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const count = 8;

      if (state.type === 'vol') {
        const gap = 4;
        const barW = (rect.width - (count - 1) * gap) / count;
        const i = Math.min(count - 1, Math.max(0, Math.floor(mouseX / (barW + gap))));

        // Redesenhar histograma com barra em destaque
        drawVolumeHistogram(canvasId, i);

        // Montar conteúdo do pop-up
        const v = state.vols[i];
        const sma = state.sma8Vols[i];
        const diff = sma > 0 ? ((v - sma) / sma) * 100 : 0;
        const isBull = state.isBullish[i];
        const diffSign = diff > 0 ? "+" : "";

        const html = `
          <div class="tt-title">
            <span>${state.title}</span>
            <span class="${isBull ? 'green' : 'red'}">${isBull ? '▲ ALTA' : '▼ BAIXA'}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Data:</span>
            <span class="tt-val">${state.dateLabels[i]}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Volume:</span>
            <span class="tt-val cyan">${fmtVolumeCompact(v)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">MMA 8D:</span>
            <span class="tt-val yellow">${fmtVolumeCompact(sma)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">vs Média 8D:</span>
            <span class="tt-val ${diff >= 0 ? 'green' : 'red'}">${diffSign}${diff.toFixed(1)}%</span>
          </div>
        `;
        showTooltip(html, e.pageX, e.pageY);

      } else if (state.type === 'price') {
        const i = Math.min(count - 1, Math.max(0, Math.round(((mouseX - 10) / (rect.width - 20)) * (count - 1))));

        // Redesenhar gráfico de fechamento com crosshair
        drawPriceLineChart(canvasId, i);

        // Montar conteúdo do pop-up
        const p = state.closes[i];
        const mma = state.mma8Price;
        const dist = mma > 0 ? ((p - mma) / mma) * 100 : 0;
        const distSign = dist > 0 ? "+" : "";

        const html = `
          <div class="tt-title">
            <span>${state.title}</span>
            <span class="${dist >= 0 ? 'green' : 'red'}">${dist >= 0 ? '▲ ACIMA MMA' : '▼ ABAIXO MMA'}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Data:</span>
            <span class="tt-val">${state.dateLabels[i]}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Fechamento:</span>
            <span class="tt-val cyan">${fmtDailyPrice(p, state.dec)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">MMA 8D:</span>
            <span class="tt-val yellow">${fmtDailyPrice(mma, state.dec)}</span>
          </div>
          <div class="tt-row">
            <span class="tt-label">Distância MMA8:</span>
            <span class="tt-val ${dist >= 0 ? 'green' : 'red'}">${distSign}${dist.toFixed(2)}%</span>
          </div>
        `;
        showTooltip(html, e.pageX, e.pageY);
      }
    });

    canvas.addEventListener("mouseleave", () => {
      hideTooltip();
      const state = chartStateMap[canvasId];
      if (!state) return;
      if (state.type === 'vol') {
        drawVolumeHistogram(canvasId, -1);
      } else if (state.type === 'price') {
        drawPriceLineChart(canvasId, -1);
      }
    });
  }

  // ─── Inicialização e Loop Periódico ───────────────────────────────────────────
  function initDailyAnalysis() {
    buildDailyTableDOM();

    // Dispara a busca inicial escalonada para as 5 moedas
    DAILY_COINS.forEach((_, idx) => {
      setTimeout(() => {
        fetchDailyDataForCoin(idx);
      }, idx * 180);
    });

    // Atualiza os dados a cada 60 segundos
    setInterval(() => {
      DAILY_COINS.forEach((_, idx) => {
        setTimeout(() => fetchDailyDataForCoin(idx), idx * 180);
      });
    }, 60000);
  }

  window.addEventListener("DOMContentLoaded", () => {
    initDailyAnalysis();
  });

  window.addEventListener("resize", () => {
    DAILY_COINS.forEach((_, idx) => fetchDailyDataForCoin(idx));
  });

})();
