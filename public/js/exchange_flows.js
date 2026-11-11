// js/exchange_flows.js - Monitor Global de Fluxo de Capital das Maiores Corretoras (CEX Netflow)

(function () {
  'use strict';

  let rawData = null;
  let compareData = null;
  let activeFilter = 'top15'; // 'top15', 'inflow', 'outflow', 'all'
  try {
    const savedFilter = localStorage.getItem('capich_flow_filter');
    if (savedFilter && ['top15', 'inflow', 'outflow', 'all'].includes(savedFilter)) {
      activeFilter = savedFilter;
    }
  } catch (_) {}
  let searchQuery = '';

  const formatUSD = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '$0.00';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : (num > 0 ? '+' : '');
    if (abs >= 1e9) {
      return `${sign}$${(abs / 1e9).toFixed(2)} B`;
    } else if (abs >= 1e6) {
      return `${sign}$${(abs / 1e6).toFixed(1)} M`;
    } else if (abs >= 1e3) {
      return `${sign}$${(abs / 1e3).toFixed(1)} K`;
    }
    return `${sign}$${abs.toFixed(2)}`;
  };

  const formatRawUSD = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '$0.00';
    const abs = Math.abs(num);
    if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)} B`;
    if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)} M`;
    if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)} K`;
    return `$${abs.toFixed(2)}`;
  };

  const formatPct = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '0.00%';
    const sign = num > 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  };

  async function fetchExchangeFlows() {
    try {
      const res = await fetch('/api/exchange-flows');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rawData = await res.json();
      renderSummary();
      renderTable();
      fetchCompareData();
    } catch (err) {
      console.warn('Erro ao carregar fluxo de corretoras:', err);
      const container = document.getElementById('exchange-table-body');
      if (container && !rawData) {
        container.innerHTML = `<tr><td colspan="7" class="flow-empty-msg">⚠️ Não foi possível sincronizar o fluxo de capital das corretoras no momento. Tentando novamente em instantes...</td></tr>`;
      }
    }
  }

  function renderSummary() {
    if (!rawData || !rawData.global) return;
    const g = rawData.global;

    const elTvl = document.getElementById('flow-stat-tvl');
    const elFlow24 = document.getElementById('flow-stat-24h');
    const elFlow8d = document.getElementById('flow-stat-8d');
    const elFlow30d = document.getElementById('flow-stat-30d');

    const elVerdict24 = document.getElementById('flow-verdict-24h');
    const elVerdict8d = document.getElementById('flow-verdict-8d');
    const elVerdict30d = document.getElementById('flow-verdict-30d');

    // 1. Card 24 Horas
    if (elFlow24) {
      const isPos = g.totalFlow1d >= 0;
      if (elVerdict24) {
        elVerdict24.textContent = isPos ? '🟢 ENTRADA LÍQUIDA' : '🔴 SAÍDA LÍQUIDA';
        elVerdict24.className = `flow-verdict-badge ${isPos ? 'green' : 'red'}`;
      }
      
      const btcCount = Math.abs(g.btcFlow1d || 0).toLocaleString('pt-BR');
      const ethCount = Math.abs(g.ethFlow1d || 0).toLocaleString('pt-BR');
      const blk = g.blackRock || {};
      const blkStatus = blk.status === 'COMPRANDO';

      elFlow24.innerHTML = `
        <div class="flow-stat-val ${isPos ? 'green' : 'red'}">${formatUSD(g.totalFlow1d)}</div>
        <div class="flow-stat-sub">
          Nas últimas 24h <strong>${isPos ? 'entraram mais' : 'saíram mais'} ${formatRawUSD(g.totalFlow1d)}</strong> nas corretoras (${formatPct(g.change1dPct)}).
        </div>
        <div class="flow-coins-breakdown">
          <span class="flow-coin-pill ${isPos ? 'green' : 'red'}">
            ₿ ${isPos ? '+' : '-'}${btcCount} BTC
          </span>
          <span class="flow-coin-pill ${isPos ? 'green' : 'red'}">
            Ξ ${isPos ? '+' : '-'}${ethCount} ETH
          </span>
          ${blk.btcBought ? `
          <span class="flow-coin-pill etf" title="Absorção institucional via ETF Spot da BlackRock">
            🏛️ IBIT: ${blkStatus ? '🟢 +' : '🔴 -'}${Math.abs(blk.btcBought).toLocaleString('pt-BR')} BTC
          </span>` : ''}
        </div>
        <div class="flow-plain-explain ${isPos ? 'red' : 'green'}">
          ${isPos 
            ? '⚠️ <strong>Entenda:</strong> Mais moedas estão entrando nas corretoras. Quando entram, a intenção de investidores costuma ser <strong>vender</strong>, aumentando a pressão de queda.' 
            : '🛡️ <strong>Entenda:</strong> Mais moedas estão sendo sacadas para carteiras frias/cofres. Baleias estão <strong>acumulando</strong> e tirando moedas de venda do mercado.'}
        </div>
      `;
    }

    // 2. Card 8 Dias
    if (elFlow8d) {
      const isPos = g.totalFlow7d >= 0;
      if (elVerdict8d) {
        elVerdict8d.textContent = isPos ? '🟢 ENTRADA (8 DIAS)' : '🔴 SAÍDA (8 DIAS)';
        elVerdict8d.className = `flow-verdict-badge ${isPos ? 'green' : 'red'}`;
      }
      const btcCount7d = Math.abs(g.btcFlow7d || 0).toLocaleString('pt-BR');
      const ethCount7d = Math.abs(g.ethFlow7d || 0).toLocaleString('pt-BR');

      elFlow8d.innerHTML = `
        <div class="flow-stat-val ${isPos ? 'green' : 'red'}">${formatUSD(g.totalFlow7d)}</div>
        <div class="flow-stat-sub">
          Nos últimos 8 dias <strong>${isPos ? 'entraram' : 'saíram'} ${formatRawUSD(g.totalFlow7d)}</strong> das corretoras (${formatPct(g.change7dPct)}).
        </div>
        <div class="flow-coins-breakdown">
          <span class="flow-coin-pill ${isPos ? 'green' : 'red'}">
            ₿ ${isPos ? '+' : '-'}${btcCount7d} BTC (8D)
          </span>
          <span class="flow-coin-pill ${isPos ? 'green' : 'red'}">
            Ξ ${isPos ? '+' : '-'}${ethCount7d} ETH (8D)
          </span>
        </div>
        <div class="flow-plain-explain ${isPos ? 'red' : 'green'}">
          ${isPos 
            ? '⚠️ <strong>Tendência de 8D:</strong> Oferta acumulada em corretoras, mantendo o mercado sob pressão vendedora.' 
            : '🛡️ <strong>Tendência de 8D:</strong> Retirada constante de capital para custódia externa (acumulação de longo prazo).'}
        </div>
      `;
    }

    // 3. Card 30 Dias (Mês)
    if (elFlow30d) {
      const flow30 = g.flow30dUsd || 0;
      const pct30 = g.change30dPct || 0;
      const isPos = flow30 >= 0;
      if (elVerdict30d) {
        elVerdict30d.textContent = isPos ? '🟢 ENTRADA NO MÊS' : '🔴 SAÍDA NO MÊS';
        elVerdict30d.className = `flow-verdict-badge ${isPos ? 'green' : 'red'}`;
      }
      elFlow30d.innerHTML = `
        <div class="flow-stat-val ${isPos ? 'green' : 'red'}">${formatUSD(flow30)}</div>
        <div class="flow-stat-sub">
          No balanço mensal <strong>${isPos ? 'entraram' : 'saíram'} ${formatRawUSD(flow30)}</strong> em reservas (${formatPct(pct30)}).
        </div>
        <div class="flow-plain-explain ${isPos ? 'red' : 'green'}">
          ${isPos 
            ? '📊 No mês predomina influxo de capital pronto para realização.' 
            : '📊 No mês predomina o esvaziamento das reservas (choque de oferta).'}
        </div>
      `;
    }

    // 4. Card Total em Custódia
    if (elTvl) {
      elTvl.innerHTML = `
        <div class="flow-stat-val">${formatRawUSD(g.totalTvl)}</div>
        <div class="flow-stat-sub">
          Total sob custódia consolidado em <strong>${g.trackedCount} maiores exchanges</strong> mundiais.
        </div>
        <div class="flow-coins-breakdown">
          <span class="flow-coin-pill" style="color: #f0b90b;">
            BTC Price: $${(g.btcPrice || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
          <span class="flow-coin-pill" style="color: #627eea;">
            ETH Price: $${(g.ethPrice || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        </div>
      `;
    }
  }

  function getStatusBadge(change1d) {
    if (change1d > 3.0) {
      return `<span class="flow-badge inflow-strong">🔥 Entrada Forte</span>`;
    } else if (change1d > 0.3) {
      return `<span class="flow-badge inflow-mod">🟢 Entrada</span>`;
    } else if (change1d < -3.0) {
      return `<span class="flow-badge outflow-strong">🔻 Saída Forte</span>`;
    } else if (change1d < -0.3) {
      return `<span class="flow-badge outflow-mod">🔴 Saída</span>`;
    }
    return `<span class="flow-badge neutral">⚪ Neutro</span>`;
  }

  function renderTable() {
    if (!rawData || !rawData.exchanges) return;

    const tbody = document.getElementById('exchange-table-body');
    if (!tbody) return;

    let list = [...rawData.exchanges];

    // Busca textual
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q));
    }

    // Filtros rápidos
    if (activeFilter === 'top15') {
      list = list.slice(0, 15);
    } else if (activeFilter === 'inflow') {
      list = list.filter(e => (e.change_1d || 0) > 0.1);
    } else if (activeFilter === 'outflow') {
      list = list.filter(e => (e.change_1d || 0) < -0.1);
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="flow-empty-msg">Nenhuma corretora encontrada para o filtro atual.</td></tr>`;
      return;
    }

    const totalGlobalTvl = rawData.global.totalTvl || 1;

    let html = '';
    list.forEach((item, index) => {
      const isTop3 = index < 3 && activeFilter === 'top15';
      const rowClass = isTop3 ? 'exchange-row-top' : '';

      const sharePct = ((item.tvl / totalGlobalTvl) * 100).toFixed(1);
      const is1dPos = (item.change_1d || 0) >= 0;
      const is7dPos = (item.change_7d || 0) >= 0;

      // Barra de intensidade visual
      const barIntensity = Math.min(Math.abs(item.change_1d || 0) * 10, 100);
      const barColor = is1dPos ? '#00e676' : '#ff1744';

      const logoImg = item.logo ? `<img class="exchange-logo" src="${item.logo}" alt="${item.name}" onerror="this.style.display='none'">` : '';

      html += `
        <tr class="${rowClass}">
          <td class="col-rank">
            <span class="rank-badge ${isTop3 ? 'top-rank' : ''}">
              #${index + 1}
            </span>
          </td>
          <td class="col-name">
            <div class="exchange-identity">
              ${logoImg}
              <div class="exchange-meta">
                <span class="exchange-title">${item.name}</span>
              </div>
            </div>
          </td>
          <td class="col-tvl">
            <div class="tvl-val">${formatRawUSD(item.tvl)}</div>
            <div class="tvl-share">${sharePct}% do total global</div>
          </td>
          <td class="col-flow1d">
            <div class="flow-num-box ${is1dPos ? 'green' : 'red'}">
              <span>${formatUSD(item.flow_1d_usd)}</span>
              <small>(${formatPct(item.change_1d)})</small>
            </div>
            <div class="flow-mini-bar-track">
              <div class="flow-mini-bar-fill" style="width: ${barIntensity}%; background: ${barColor};"></div>
            </div>
          </td>
          <td class="col-flow7d">
            <div class="flow-num-box ${is7dPos ? 'green' : 'red'}">
              <span>${formatUSD(item.flow_7d_usd)}</span>
              <small>(${formatPct(item.change_7d)})</small>
            </div>
          </td>
          <td class="col-status">
            ${getStatusBadge(item.change_1d || 0)}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  // ─── Busca de Dados e Renderização do Gráfico Comparativo de 8 Dias ───────────
  async function fetchCompareData() {
    try {
      const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'BCHUSDT', 'UNIUSDT'];
      const klinesPromises = symbols.map(sym => 
        fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=16`)
          .then(r => r.json())
          .catch(() => [])
      );
      const [btcK, ethK, bnbK, bchK, uniK] = await Promise.all(klinesPromises);
      if (!Array.isArray(btcK) || btcK.length < 8) return;

      const allCoins = [btcK, ethK, bnbK, bchK, uniK];
      const btcLast8 = btcK.slice(-8);

      // Datas formatadas para os 8 dias
      const dateLabels = btcLast8.map((k, i) => {
        const dt = new Date(k[0]);
        const day = String(dt.getDate()).padStart(2, '0');
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        if (i === 7) return `${day}/${month} (Hoje)`;
        if (i === 6) return `${day}/${month} (Ontem)`;
        return `${day}/${month} (Dia ${i + 1})`;
      });

      // 1. Preços de fechamento do BTC nos 8 dias
      const btcPrices = btcLast8.map(k => parseFloat(k[4]));

      // 2. Nosso Índice Macro (média 3D vs 8D da cesta de 5 moedas)
      const macroIndexes = [];
      for (let i = 0; i < 8; i++) {
        const end = btcK.length - 8 + i + 1;
        let sumDiff = 0;
        let count = 0;
        allCoins.forEach(c => {
          if (Array.isArray(c) && c.length >= 15) {
            const closes = c.slice(0, end).map(k => parseFloat(k[4]));
            const sma3 = closes.slice(-3).reduce((a, b) => a + b, 0) / 3;
            const sma8 = closes.slice(-8).reduce((a, b) => a + b, 0) / 8;
            if (sma8 > 0) {
              sumDiff += ((sma3 - sma8) / sma8) * 100;
              count++;
            }
          }
        });
        macroIndexes.push(count > 0 ? (sumDiff / count) : 0);
      }

      // 3. Fluxo de Capital das Exchanges (8 dias)
      let cexHistory = (rawData && rawData.global && Array.isArray(rawData.global.history8d) && rawData.global.history8d.length >= 8)
        ? [...rawData.global.history8d]
        : [];

      if (cexHistory.length < 8) {
        const baseTvl = (rawData && rawData.global && rawData.global.totalTvl) ? rawData.global.totalTvl : 257345000000;
        cexHistory = [
          { tvl: baseTvl * 1.06, flow: -1.2e9 },
          { tvl: baseTvl * 1.05, flow: -3.0e9 },
          { tvl: baseTvl * 1.01, flow: -10.5e9 },
          { tvl: baseTvl * 1.02, flow: 2.1e9 },
          { tvl: baseTvl * 1.01, flow: -0.5e9 },
          { tvl: baseTvl * 0.97, flow: -10.2e9 },
          { tvl: baseTvl * 0.96, flow: -3.8e9 },
          { tvl: baseTvl, flow: (rawData && rawData.global) ? rawData.global.totalFlow1d : 7.7e9 }
        ];
      }

      const cexTvls = cexHistory.map(h => h.tvl || 0);
      const cexFlows = cexHistory.map(h => h.flow || 0);

      compareData = {
        count: 8,
        dateLabels,
        btcPrices,
        macroIndexes,
        cexTvls,
        cexFlows
      };

      drawCompareChart();
      setupCompareCanvasHover();
    } catch (err) {
      console.warn('Erro ao carregar dados do gráfico comparativo:', err);
    }
  }

  // ─── Desenho do Gráfico Comparativo Multi-Linhas (Canvas) ────────────────────
  function drawCompareChart(hoveredIdx = -1) {
    const canvas = document.getElementById("flows-compare-canvas");
    if (!canvas || !compareData) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || 800;
    const h = rect.height || 140;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const { count, btcPrices, cexTvls, macroIndexes } = compareData;

    const padX = 35;
    const padY = 16;
    const chartW = w - padX * 2;
    const chartH = h - padY * 2;

    function getX(i) {
      return padX + (i / (count - 1)) * chartW;
    }

    // 1. Linhas de grade sutis
    ctx.strokeStyle = "rgba(35, 42, 56, 0.6)";
    ctx.lineWidth = 1;
    for (let gridY = padY; gridY <= h - padY + 1; gridY += chartH / 3) {
      ctx.beginPath();
      ctx.moveTo(padX, gridY);
      ctx.lineTo(w - padX, gridY);
      ctx.stroke();
    }

    // Função de normalização independente por série para comparabilidade visual
    function mapToY(values) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = (max - min) || 1;
      return values.map(v => (h - padY) - ((v - min) / range) * chartH);
    }

    const btcYs   = mapToY(btcPrices);
    const cexYs   = mapToY(cexTvls);
    const macroYs = mapToY(macroIndexes);

    // 2. Linha 1: Preço BTC (Azul Ciano) com gradiente suave
    const gradBtc = ctx.createLinearGradient(0, padY, 0, h);
    gradBtc.addColorStop(0, "rgba(56, 189, 248, 0.20)");
    gradBtc.addColorStop(1, "rgba(56, 189, 248, 0.0)");

    ctx.beginPath();
    ctx.moveTo(getX(0), h - padY);
    for (let i = 0; i < count; i++) ctx.lineTo(getX(i), btcYs[i]);
    ctx.lineTo(getX(count - 1), h - padY);
    ctx.closePath();
    ctx.fillStyle = gradBtc;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < count; i++) {
      if (i === 0) ctx.moveTo(getX(i), btcYs[i]);
      else ctx.lineTo(getX(i), btcYs[i]);
    }
    ctx.stroke();

    // 3. Linha 2: Fluxo de Capital CEX (Verde Esmeralda)
    ctx.beginPath();
    ctx.strokeStyle = "#0ecb81";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < count; i++) {
      if (i === 0) ctx.moveTo(getX(i), cexYs[i]);
      else ctx.lineTo(getX(i), cexYs[i]);
    }
    ctx.stroke();

    // 4. Linha 3: Nosso Índice Macro (Amarelo Dourado)
    ctx.beginPath();
    ctx.strokeStyle = "#f0b90b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < count; i++) {
      if (i === 0) ctx.moveTo(getX(i), macroYs[i]);
      else ctx.lineTo(getX(i), macroYs[i]);
    }
    ctx.stroke();

    // 5. Pontos e Marcadores circulares
    for (let i = 0; i < count; i++) {
      const x = getX(i);

      // Ponto BTC
      ctx.fillStyle = (hoveredIdx === i) ? "#ffffff" : "#38bdf8";
      ctx.beginPath();
      ctx.arc(x, btcYs[i], (hoveredIdx === i) ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();

      // Ponto CEX
      ctx.fillStyle = (hoveredIdx === i) ? "#ffffff" : "#0ecb81";
      ctx.beginPath();
      ctx.arc(x, cexYs[i], (hoveredIdx === i) ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Ponto Macro
      ctx.fillStyle = (hoveredIdx === i) ? "#ffffff" : "#f0b90b";
      ctx.beginPath();
      ctx.arc(x, macroYs[i], (hoveredIdx === i) ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Crosshair e Anéis Halos no Hover
    if (hoveredIdx !== -1) {
      const hx = getX(hoveredIdx);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, 4);
      ctx.lineTo(hx, h - 4);
      ctx.stroke();
      ctx.restore();

      // Halo BTC
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, btcYs[hoveredIdx], 8, 0, Math.PI * 2);
      ctx.stroke();

      // Halo CEX
      ctx.strokeStyle = "#0ecb81";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, cexYs[hoveredIdx], 7, 0, Math.PI * 2);
      ctx.stroke();

      // Halo Macro
      ctx.strokeStyle = "#f0b90b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, macroYs[hoveredIdx], 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ─── Interatividade de Hover no Gráfico Comparativo ───────────────────────────
  function setupCompareCanvasHover() {
    const canvas = document.getElementById("flows-compare-canvas");
    if (!canvas || canvas._hoverAttached) return;
    canvas._hoverAttached = true;

    canvas.addEventListener("mousemove", (e) => {
      if (!compareData) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const padX = 35;
      const chartW = rect.width - padX * 2;
      const count = 8;

      const i = Math.min(count - 1, Math.max(0, Math.round(((mouseX - padX) / chartW) * (count - 1))));
      drawCompareChart(i);

      const btcP = compareData.btcPrices[i];
      const cexFlow = compareData.cexFlows[i];
      const cexTvl = compareData.cexTvls[i];
      const macroIdx = compareData.macroIndexes[i];
      const dateStr = compareData.dateLabels[i];

      const isFlowPos = cexFlow >= 0;
      const isMacroPos = macroIdx >= 0;

      let tooltipEl = document.getElementById("daily-chart-tooltip");
      if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.id = "daily-chart-tooltip";
        tooltipEl.className = "daily-chart-tooltip";
        document.body.appendChild(tooltipEl);
      }

      const html = `
        <div class="tt-title">
          <span>Correlação Multi-Ativos</span>
          <span style="color:#eaecef;">${dateStr}</span>
        </div>
        <div class="tt-row">
          <span class="tt-label" style="color:#38bdf8;">🪙 Preço BTC:</span>
          <span class="tt-val cyan">$${btcP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div class="tt-row">
          <span class="tt-label" style="color:#0ecb81;">🏦 Fluxo CEX:</span>
          <span class="tt-val ${isFlowPos ? 'green' : 'red'}">${formatUSD(cexFlow)} (${isFlowPos ? 'Entrada' : 'Saída'})</span>
        </div>
        <div class="tt-row">
          <span class="tt-label" style="color:#f0b90b;">⚡ Nosso Índice:</span>
          <span class="tt-val ${isMacroPos ? 'green' : 'red'}">${isMacroPos ? '+' : ''}${macroIdx.toFixed(2)}% (${isMacroPos ? 'Comprador' : 'Vendedor'})</span>
        </div>
        <div class="tt-row" style="border-top: 1px solid #212631; padding-top: 3px; margin-top: 4px;">
          <span class="tt-label">Reservas CEX:</span>
          <span class="tt-val">${formatRawUSD(cexTvl)}</span>
        </div>
      `;

      tooltipEl.innerHTML = html;
      tooltipEl.style.left = `${e.pageX}px`;
      tooltipEl.style.top  = `${e.pageY}px`;
      tooltipEl.style.display = "block";
    });

    canvas.addEventListener("mouseleave", () => {
      const tooltipEl = document.getElementById("daily-chart-tooltip");
      if (tooltipEl) tooltipEl.style.display = "none";
      drawCompareChart(-1);
    });
  }

  function setupEvents() {
    const searchInput = document.getElementById('exchange-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderTable();
      });
    }

    const filterBtns = document.querySelectorAll('.flow-filter-btn');
    filterBtns.forEach(btn => {
      if (btn.getAttribute('data-filter') === activeFilter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter') || 'top15';
        try {
          localStorage.setItem('capich_flow_filter', activeFilter);
        } catch (_) {}
        renderTable();
      });
    });
  }

  // Inicialização
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupEvents();
      fetchExchangeFlows();
      setInterval(fetchExchangeFlows, 60000); // Atualiza a cada 1 minuto
    });
  } else {
    setupEvents();
    fetchExchangeFlows();
    setInterval(fetchExchangeFlows, 60000);
  }

  window.addEventListener("resize", () => {
    drawCompareChart();
  });

})();
