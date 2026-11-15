/**
 * js/dashboard.js
 * Lógica do Dashboard Operacional (CAPICH)
 * Medição estrita de expectativa matemática, win rate e curva de capital a partir de 20 USDT.
 */

(function () {
  'use strict';

  const STORAGE_KEY_TRADES = 'capich_custom_trades_history';
  const INITIAL_CAPITAL = 20.00; // Saldo de partida definido pelo trader

  let equityChart = null;

  /**
   * Retorna o histórico de trades registrados
   */
  function getTradesHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TRADES);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Salva o histórico de trades
   */
  function saveTradesHistory(trades) {
    try {
      localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(trades));
    } catch (_) {}
  }

  /**
   * Registra um novo trade concluído
   * @param {Object} trade { symbol, side, entryPrice, closePrice, pnl, pnlPct, closedAt }
   */
  function recordTrade(trade) {
    const trades = getTradesHistory();
    const newTrade = {
      id: `trade_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      symbol: trade.symbol || 'BTCUSDT',
      side: trade.side || 'LONG',
      entryPrice: parseFloat(trade.entryPrice) || 0,
      closePrice: parseFloat(trade.closePrice) || 0,
      pnl: parseFloat(trade.pnl) || 0,
      pnlPct: parseFloat(trade.pnlPct) || 0,
      closedAt: trade.closedAt || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    };
    trades.push(newTrade);
    saveTradesHistory(trades);
    renderDashboard();
  }

  // Exporta globalmente para o order_panel.js chamar quando zerar/stopar
  window.DashboardTracker = {
    recordTrade,
    getTradesHistory
  };

  /**
   * Calcula as métricas de desempenho
   */
  function calculateMetrics(trades) {
    let currentCapital = INITIAL_CAPITAL;
    let totalWins = 0;
    let totalLosses = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    const curveData = [{ tradeNum: 0, capital: INITIAL_CAPITAL, date: 'Início' }];

    trades.forEach((t, idx) => {
      currentCapital += t.pnl;
      curveData.push({
        tradeNum: idx + 1,
        capital: parseFloat(currentCapital.toFixed(2)),
        date: t.closedAt
      });

      if (t.pnl > 0) {
        totalWins++;
        grossProfit += t.pnl;
      } else if (t.pnl < 0) {
        totalLosses++;
        grossLoss += Math.abs(t.pnl);
      }
    });

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const netPnl = currentCapital - INITIAL_CAPITAL;
    const netPnlPct = (netPnl / INITIAL_CAPITAL) * 100;

    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99.99 : 0);

    const avgWin = totalWins > 0 ? (grossProfit / totalWins) : 0;
    const avgLoss = totalLosses > 0 ? (grossLoss / totalLosses) : 0;
    const payoff = avgLoss > 0 ? (avgWin / avgLoss) : (avgWin > 0 ? 99.99 : 0);

    return {
      currentCapital,
      netPnl,
      netPnlPct,
      totalTrades,
      totalWins,
      totalLosses,
      winRate,
      profitFactor,
      payoff,
      curveData
    };
  }

  /**
   * Renderiza os cards de KPI na tela
   */
  function renderKPIs(metrics) {
    const elCapital = document.getElementById('kpi-capital');
    const elCapitalPct = document.getElementById('kpi-capital-pct');
    const elPnl = document.getElementById('kpi-pnl');
    const elPnlPct = document.getElementById('kpi-pnl-pct');
    const elWinrate = document.getElementById('kpi-winrate');
    const elWinCount = document.getElementById('kpi-win-count');
    const elPf = document.getElementById('kpi-pf');
    const elPayoff = document.getElementById('kpi-payoff');
    const elTotal = document.getElementById('kpi-total-trades');
    const cardLucro = document.getElementById('card-lucro');

    if (!elCapital) return;

    elCapital.textContent = `$${metrics.currentCapital.toFixed(2)}`;
    const diffCapital = metrics.currentCapital - INITIAL_CAPITAL;
    elCapitalPct.textContent = `${diffCapital >= 0 ? '+' : ''}$${diffCapital.toFixed(2)} (${metrics.netPnlPct.toFixed(2)}%)`;

    elPnl.textContent = `${metrics.netPnl >= 0 ? '+' : ''}$${metrics.netPnl.toFixed(2)}`;
    elPnl.className = `dash-kpi-val ${metrics.netPnl > 0 ? 'pos' : (metrics.netPnl < 0 ? 'neg' : '')}`;
    elPnlPct.textContent = `${metrics.netPnlPct >= 0 ? '+' : ''}${metrics.netPnlPct.toFixed(2)}% sobre $${INITIAL_CAPITAL.toFixed(2)}`;

    if (cardLucro) {
      cardLucro.className = `dash-kpi-card ${metrics.netPnl > 0 ? 'win' : (metrics.netPnl < 0 ? 'loss' : '')}`;
    }

    elWinrate.textContent = `${metrics.winRate.toFixed(1)}%`;
    elWinCount.textContent = `${metrics.totalWins} Vitórias / ${metrics.totalLosses} Derrotas`;

    elPf.textContent = metrics.profitFactor > 90 ? '∞' : metrics.profitFactor.toFixed(2);
    elPayoff.textContent = metrics.payoff > 90 ? '∞' : metrics.payoff.toFixed(2);
    elTotal.textContent = metrics.totalTrades;
  }

  /**
   * Renderiza o gráfico da Curva de Capital (Chart.js)
   */
  function renderChart(curveData) {
    const ctx = document.getElementById('equityChart');
    if (!ctx) return;

    const labels = curveData.map(d => d.tradeNum === 0 ? 'Partida' : `Trade #${d.tradeNum}`);
    const values = curveData.map(d => d.capital);

    const isProfitable = values[values.length - 1] >= INITIAL_CAPITAL;
    const lineColor = isProfitable ? '#0ecb81' : '#f6465d';
    const fillColor = isProfitable ? 'rgba(14, 203, 129, 0.08)' : 'rgba(246, 70, 93, 0.08)';

    if (equityChart) {
      equityChart.destroy();
    }

    equityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Capital (USDT)',
          data: values,
          borderColor: lineColor,
          backgroundColor: fillColor,
          borderWidth: 2.5,
          fill: true,
          tension: 0.2,
          pointBackgroundColor: lineColor,
          pointBorderColor: '#181a20',
          pointBorderWidth: 1.5,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#181a20',
            borderColor: '#2b313a',
            borderWidth: 1,
            titleColor: '#848e9c',
            bodyColor: '#eaecef',
            callbacks: {
              label: (context) => ` Capital: $${context.parsed.y.toFixed(2)} USDT`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#848e9c', font: { size: 10 } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#848e9c',
              font: { size: 10 },
              callback: (val) => `$${val.toFixed(2)}`
            }
          }
        }
      }
    });
  }

  /**
   * Renderiza a tabela com o histórico das operações
   */
  function renderTable(trades) {
    const tbody = document.getElementById('dash-trades-tbody');
    if (!tbody) return;

    if (!trades.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="dash-empty">
            Nenhuma operação encerrada registrada ainda. Suas operações finalizadas pelo painel aparecerão aqui automaticamente.
          </td>
        </tr>
      `;
      return;
    }

    // Exibe em ordem decrescente (mais recente no topo)
    const reversed = [...trades].reverse();
    tbody.innerHTML = reversed.map(t => {
      const isWin = t.pnl > 0;
      const statusBadge = isWin
        ? '<span class="badge-win">WIN</span>'
        : (t.pnl < 0 ? '<span class="badge-loss">LOSS</span>' : '<span style="color:#848e9c">0.00</span>');
      
      const sideBadge = t.side === 'BUY' || t.side === 'LONG'
        ? '<span class="badge-long">LONG</span>'
        : '<span class="badge-short">SHORT</span>';

      const pnlColor = isWin ? '#0ecb81' : (t.pnl < 0 ? '#f6465d' : '#848e9c');
      const pnlSign = t.pnl > 0 ? '+' : '';

      return `
        <tr>
          <td style="color:#848e9c; font-size:0.8rem;">${t.closedAt}</td>
          <td><strong>${t.symbol}</strong></td>
          <td>${sideBadge}</td>
          <td>$${t.entryPrice > 0 ? t.entryPrice.toFixed(2) : '--'}</td>
          <td>$${t.closePrice > 0 ? t.closePrice.toFixed(2) : '--'}</td>
          <td style="color:${pnlColor}; font-weight:700;">${pnlSign}$${t.pnl.toFixed(2)}</td>
          <td style="color:${pnlColor}; font-weight:700;">${pnlSign}${t.pnlPct.toFixed(2)}%</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Função principal de renderização
   */
  function renderDashboard() {
    const trades = getTradesHistory();
    const metrics = calculateMetrics(trades);
    renderKPIs(metrics);
    renderChart(metrics.curveData);
    renderTable(trades);
  }

  /**
   * Resetar histórico (apenas para administrador autenticado)
   */
  window.resetarHistoricoDashboard = function () {
    if (!document.body.classList.contains('admin-mode')) {
      alert('Ação bloqueada: Apenas o administrador autenticado pode resetar os dados do Dashboard.');
      return;
    }
    if (confirm('Deseja realmente resetar todas as operações do Dashboard e reiniciar com $20.00 USDT?')) {
      localStorage.removeItem(STORAGE_KEY_TRADES);
      renderDashboard();
    }
  };

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderDashboard);
  } else {
    renderDashboard();
  }
})();
