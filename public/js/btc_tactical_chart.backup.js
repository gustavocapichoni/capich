/**
 * btc_tactical_chart.js
 * Gráfico Tático Multi-Pares — TradingView Lightweight Charts v4.1.1
 *  - 5 Pares: BTCUSDT, ETHUSDT, BCHUSDT, BNBUSDT, UNIUSDT
 *  - Volume Real Institucional de 72h (3 Dias Macro)
 *  - Volume Real Atemporal de 8h (Intraday Tático)
 *  - Linhas de Acumulação e Distribuição no Preço (Sem poluição de linhas tracejadas)
 *  - Sinais institucionais a favor das médias e do volume real
 *  - Volume Bicolor empilhado sincronizado
 *  - Timeframe dinâmico: 1H (MMA 8/20) e 15M (MMA 32/80)
 */

(function () {
  'use strict';

  const API_URL = '/api/btc-history-tactical';

  const PAIRS = [
    { symbol: 'BTCUSDT', label: 'BTC', base: 'BTC' },
    { symbol: 'ETHUSDT', label: 'ETH', base: 'ETH' },
    { symbol: 'BCHUSDT', label: 'BCH', base: 'BCH' },
    { symbol: 'BNBUSDT', label: 'BNB', base: 'BNB' },
    { symbol: 'UNIUSDT', label: 'UNI', base: 'UNI' }
  ];

  const state = {
    currentSymbol: 'BTCUSDT',
    baseAsset: 'BTC',
    currentTimeframe: '1h',
    candles: [],
    oi: {},
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
      p2: null
    },
    dragTargetFibo: null, // 1 ou 2
    ws: null
  };

  let lastPriceUpdateTimestamp = 0;
  let wsReconnectTimeout = null;

  // ─── ÁUDIO LOCAL DA PÁGINA TÁTICA (reutiliza o mesmo mp3 do monitor) ──────────
  const _tacAlertAudio = new Audio('assets/audio/notificacao.mp3');
  _tacAlertAudio.loop = true;
  _tacAlertAudio.preload = 'auto';

  function _tacPlayAlert() {
    if (_tacAlertAudio.paused) {
      _tacAlertAudio.currentTime = 0;
      _tacAlertAudio.play().catch(() => {});
    }
  }

  function _tacStopAlert() {
    _tacAlertAudio.pause();
    _tacAlertAudio.currentTime = 0;
  }

  // Verifica se o preço cruzou o nível 2.618 do Fibonacci ativo (detecção direcional correta)
  function checkFiboAlert(currentPrice) {
    const f = state.fibo;
    if (!f.active || !f.p1 || !f.p2 || f.drawing) return;

    // Proteção de sanidade: impede disparo caso o Fibonacci pertença a outro ativo com preço divergente (ex: BTC x UNI)
    if (!currentPrice || currentPrice <= 0 || !f.p1.price || !f.p2.price) return;
    const ratio1 = f.p1.price / currentPrice;
    const ratio2 = f.p2.price / currentPrice;
    if (ratio1 > 3 || ratio1 < 0.33 || ratio2 > 3 || ratio2 < 0.33) {
      return;
    }

    const level2618 = f.p1.price + (f.p2.price - f.p1.price) * 2.618;
    const a = f.alert2618;

    // ── 1. Alerta já disparou: verifica se o preço recuou o suficiente para rearmar
    if (a.triggered) {
      const retracedEnough = a.approachDir === 'up'
        ? currentPrice < level2618 * 0.995   // vinha de baixo → preço voltou 0.5% abaixo = rearma
        : currentPrice > level2618 * 1.005;  // vinha de cima → preço voltou 0.5% acima = rearma
      if (retracedEnough) {
        a.triggered = false;
        a.armed = false; // força re-detecção do lado na próxima chamada
        a.approachDir = null;
        a.soundActive = false;
        _tacStopAlert();
        _renderFiboAlertBadge(false, null);
      }
      return;
    }

    // ── 2. Detecta de qual lado o preço está e arma o alerta na primeira chamada após traçar
    if (!a.armed) {
      if (currentPrice < level2618) {
        a.approachDir = 'up';   // preço está ABAIXO → espera subir e cruzar
        a.armed = true;
      } else if (currentPrice > level2618) {
        a.approachDir = 'down'; // preço está ACIMA → espera cair e cruzar
        a.armed = true;
      }
      // Se o preço já está exatamente no nível (improvável), não arma ainda
      return;
    }

    // ── 3. Verifica o cruzamento direcional
    if (a.armed && !a.triggered) {
      const crossed = a.approachDir === 'up'
        ? currentPrice >= level2618   // estava abaixo, agora tocou/ultrapassou o 2.618 → DISPARA
        : currentPrice <= level2618;  // estava acima, agora tocou/caiu até o 2.618 → DISPARA

      if (crossed) {
        a.triggered = true;
        a.soundActive = true;
        a.armed = false;
        _tacPlayAlert();
        _renderFiboAlertBadge(true, level2618, a.approachDir);
      }
    }
  }

  // Badge visual de alerta 2.618 no toolbar do gráfico
  function _renderFiboAlertBadge(active, level) {
    let badge = document.getElementById('tac-fibo-alert-badge');
    if (!active) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'tac-fibo-alert-badge';
      badge.style.cssText = `
        position:fixed; top:14px; left:50%; transform:translateX(-50%);
        background:linear-gradient(135deg,#f0b90b,#ff9800);
        color:#0b0e11; font-weight:800; font-size:13px;
        padding:7px 20px; border-radius:8px; z-index:99999;
        box-shadow:0 0 24px rgba(240,185,11,0.7);
        display:flex; align-items:center; gap:10px; cursor:pointer;
        animation: tacFiboBlink 0.6s infinite alternate;
      `;
      // Fecha ao clicar
      badge.addEventListener('click', () => {
        state.fibo.alert2618.soundActive = false;
        state.fibo.alert2618.triggered = true;
        _tacStopAlert();
        _renderFiboAlertBadge(false, null);
      });
      // Animação de piscar
      if (!document.getElementById('tac-fibo-alert-style')) {
        const style = document.createElement('style');
        style.id = 'tac-fibo-alert-style';
        style.textContent = `@keyframes tacFiboBlink { from { opacity:1; } to { opacity:0.55; } }`;
        document.head.appendChild(style);
      }
      document.body.appendChild(badge);
    }
    const fmtLevel = formatPrice(level);
    badge.innerHTML = `🎯 FIBO 2.618 ATINGIDO — ${state.baseAsset}/USDT @ ${fmtLevel} &nbsp;<span style="font-size:10px;opacity:0.8;">(clique para silenciar)</span>`;
  }

  document.addEventListener('DOMContentLoaded', init);

  // ─── PERSISTÊNCIA EM LOCALSTORAGE DAS PREFERÊNCIAS DO USUÁRIO ───
  function loadUserPreferences() {
    try {
      const savedSym = localStorage.getItem('capich_tac_symbol');
      if (savedSym && PAIRS.some(p => p.symbol === savedSym)) {
        state.currentSymbol = savedSym;
        const pObj = PAIRS.find(p => p.symbol === savedSym);
        if (pObj) state.baseAsset = pObj.base;
      }

      const savedTf = localStorage.getItem('capich_tac_tf');
      if (savedTf && (savedTf === '15m' || savedTf === '1h')) {
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

      // Carrega os Fibonaccis do par ativo
      loadFiboForSymbol(state.currentSymbol);
    } catch (e) {
      console.warn('[BTC Tactical] Erro ao ler preferências do localStorage:', e);
    }
  }

  function getFiboStorageKey(which, symbol) {
    const sym = symbol || state.currentSymbol || 'BTCUSDT';
    return which === 2 ? `capich_tac_fibo2_${sym}` : `capich_tac_fibo_${sym}`;
  }

  function loadFiboForSymbol(symbol) {
    const sym = symbol || state.currentSymbol || 'BTCUSDT';
    if (state.fibo.alert2618) {
      state.fibo.alert2618.armed = false;
      state.fibo.alert2618.triggered = false;
      state.fibo.alert2618.soundActive = false;
      state.fibo.alert2618.approachDir = null;
    }
    _tacStopAlert();
    _renderFiboAlertBadge(false, null);

    try {
      // Fibo 1
      const key1 = getFiboStorageKey(1, sym);
      const savedFibo = localStorage.getItem(key1);
      if (savedFibo) {
        const fiboData = JSON.parse(savedFibo);
        if (fiboData.p1 && fiboData.p2) {
          state.fibo.p1 = fiboData.p1;
          state.fibo.p2 = fiboData.p2;
          state.fibo.active = true;
          state.fibo.drawing = false;
        } else {
          state.fibo.active = false;
          state.fibo.p1 = null;
          state.fibo.p2 = null;
        }
      } else {
        state.fibo.active = false;
        state.fibo.p1 = null;
        state.fibo.p2 = null;
      }

      // Fibo 2
      const key2 = getFiboStorageKey(2, sym);
      const savedFibo2 = localStorage.getItem(key2);
      if (savedFibo2) {
        const fiboData2 = JSON.parse(savedFibo2);
        if (fiboData2.p1 && fiboData2.p2) {
          state.fibo2.p1 = fiboData2.p1;
          state.fibo2.p2 = fiboData2.p2;
          state.fibo2.active = true;
          state.fibo2.drawing = false;
        } else {
          state.fibo2.active = false;
          state.fibo2.p1 = null;
          state.fibo2.p2 = null;
        }
      } else {
        state.fibo2.active = false;
        state.fibo2.p1 = null;
        state.fibo2.p2 = null;
      }

      updateFiboButtonUI(state.fibo.active ? 'placed' : 'idle', 1);
      updateFiboButtonUI(state.fibo2.active ? 'placed' : 'idle', 2);
    } catch (e) {
      console.warn('[BTC Tactical] Erro ao carregar Fibo do par:', sym, e);
    }
  }

  function init() {
    loadUserPreferences();
    buildHTML();
    loadFiboForSymbol(state.currentSymbol);
    if (window.OrderPanel && typeof window.OrderPanel.init === 'function') {
      window.OrderPanel.init();
    }
    initCharts();
    fetchAndRender();
    fetchPersonalIndexLive();
    setInterval(fetchPersonalIndexLive, 2200);
    setInterval(fetchOiLive, 4000);
    setInterval(updateOracleHUD, 2500);
    setInterval(syncLivePriceFallback, 2500);
    updateCandleCountdown();
    setInterval(updateCandleCountdown, 1000);

    // Restaura o estado visual dos botões Fibo caso tenham sido carregados do localStorage
    if (state.fibo.active && state.fibo.p1 && state.fibo.p2) {
      requestAnimationFrame(() => updateFiboButtonUI('placed', 1));
    }
    if (state.fibo2.active && state.fibo2.p1 && state.fibo2.p2) {
      requestAnimationFrame(() => updateFiboButtonUI('placed', 2));
    }
  }

  /* ─────────────────────────────────────────────────────────────
     1. CONSTRUÇÃO DO DOM — Colado no Menu com Seletor dos 5 Pares
  ───────────────────────────────────────────────────────────── */
  function buildHTML() {
    const container = document.getElementById('btc-tactical-section');
    if (!container) return;

    const pairButtonsHtml = PAIRS.map(p => 
      `<button class="tac-pair-btn ${p.symbol === state.currentSymbol ? 'active' : ''}" id="tac-pair-${p.symbol}" onclick="window._setTacPair('${p.symbol}')">${p.label}</button>`
    ).join('');

    container.innerHTML = `
      <div class="tac-wrapper">
        <!-- Titlebar -->
        <div class="tac-titlebar">
          <div class="tac-titlebar-left">
            <span class="tac-live-dot" id="tac-live-dot">&#9679; AO VIVO</span>
          </div>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
            <!-- Seletor dos 5 Pares -->
            <div class="tac-pair-group">
              ${pairButtonsHtml}
            </div>
            <!-- Timeframe -->
            <div class="tac-tf-group">
              <button class="tac-tf-btn ${state.currentTimeframe === '15m' ? 'active' : ''}" id="tac-tf-15m" onclick="window._setTacTF('15m')">15m</button>
              <button class="tac-tf-btn ${state.currentTimeframe === '1h' ? 'active' : ''}" id="tac-tf-1h" onclick="window._setTacTF('1h')">1h</button>
            </div>
            <!-- Cronômetro Fechamento Candle (15m / 1h) -->
            <div class="tac-candle-timer-badge" id="tac-candle-timer" title="Tempo restante para o fechamento do candle de ${state.currentTimeframe}">
              <span class="tac-timer-icon">⏳</span>
              <span class="tac-timer-val" id="tac-timer-val">--:--</span>
            </div>
            <!-- Toggle Médias -->
            <button class="tac-btn-toggle-ma ${state.maVisible ? 'active' : ''}" id="tac-btn-ma" onclick="window._toggleTacMA()">
              Médias: ${state.maVisible ? 'ON' : 'OFF'}
            </button>
            <!-- Toggle Indicadores -->
            <button class="tac-btn-toggle-ind ${state.indicatorsVisible ? 'active' : ''}" id="tac-btn-ind" onclick="window._toggleTacInd()">
              Indicadores: ${state.indicatorsVisible ? 'ON' : 'OFF'}
            </button>
            <!-- Toggle Nuvens de Zonas -->
            <button class="tac-btn-toggle-zones ${state.zonesVisible ? 'active' : ''}" id="tac-btn-zones" onclick="window._toggleTacZones()">
              Nuvens: ${state.zonesVisible ? 'ON' : 'OFF'}
            </button>
            <!-- Toggle Tags do Indicador EMPIRE (Escala e Valores) -->
            <button class="tac-btn-toggle-tags ${state.empireTagsVisible ? 'active' : ''}" id="tac-btn-tags" onclick="window._toggleTacEmpireTags()" title="Ocultar/Exibir as tags e cotações do indicador EMPIRE na escala de preços">
              Tags: ${state.empireTagsVisible ? 'ON' : 'OFF'}
            </button>
            <!-- Toggle Linha de Preço Tracejada -->
            <button class="tac-btn-toggle-priceline ${state.priceLineVisible ? 'active' : ''}" id="tac-btn-priceline" onclick="window._toggleTacPriceLine()" title="Ocultar/Exibir a linha tracejada do preço atual dentro do gráfico">
              Linha: ${state.priceLineVisible ? 'ON' : 'OFF'}
            </button>
            <!-- Ferramenta Fibonacci 1 (Principal) -->
            <div class="tac-fibo-wrapper">
              <button class="tac-btn-fibo" id="tac-btn-fibo" onclick="window._toggleTacFibo()" title="Fibo 1 (Principal: Retrações + Expansões + Alerta 2.618)">
                📐 Fibo 1
              </button>
              <button class="tac-btn-fibo-clear" id="tac-btn-fibo-clear" onclick="window._clearTacFibo()" title="Limpar Fibo 1">
                ✕
              </button>
            </div>
            <!-- Ferramenta Fibonacci 2 (Secundário - Cluster Carolyn Boroden) -->
            <div class="tac-fibo-wrapper">
              <button class="tac-btn-fibo tac-btn-fibo-2" id="tac-btn-fibo2" onclick="window._toggleTacFibo2()" title="Fibo 2 (Retrações de Pernada Menor / Cluster Boroden)">
                📐 Fibo 2
              </button>
              <button class="tac-btn-fibo-clear" id="tac-btn-fibo2-clear" onclick="window._clearTacFibo2()" title="Limpar Fibo 2">
                ✕
              </button>
            </div>
          </div>
        </div>

        <!-- Barra de Legenda Dinâmica / Inspetor -->
        <div class="tac-legend" id="tac-legend">
          Carregando dados táticos do mercado...
        </div>

        <!-- Linha Central: Mini Painel Binance à Esquerda + Gráfico Tático à Direita -->
        <div class="tac-charts-row-with-panel">
          <div id="binance-order-panel" class="b-order-panel"></div>
          <div class="tac-charts-col-right">
            <div class="tac-charts-container">
              <div class="tac-chart-main" id="tac-chart-main">
                <canvas id="tac-zones-canvas"></canvas>
              </div>
              <div class="tac-chart-vol" id="tac-chart-vol">
                <canvas id="tac-vol-canvas"></canvas>
              </div>
            </div>
          </div>
        </div>

        <!-- HUD Inferior: Termômetro Institucional Descomplicado -->
        <div class="tac-hud">
          <!-- 1. ÍNDICES DE MERCADO: TOP 10 GERAL + MEU ÍNDICE PESSOAL -->
          <div class="tac-hud-block" style="flex:1.25;min-width:235px;position:relative;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
              <div class="tac-hud-label" style="font-weight:700;color:#f0b90b;">📊 ÍNDICES DE MERCADO</div>
              <button type="button" class="tac-oracle-help-btn" onclick="window._toggleTacHudHelp(event, 'tac-indices-popover')" title="Entenda a diferença entre o Top 10 e seu Índice Pessoal">?</button>
            </div>
            
            <!-- Bloco Superior: TOP 10 CRIPTO -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;color:var(--tac-text-muted);font-weight:600;">
                <span>🌐 TOP 10 CRIPTO</span>
                <span id="tac-top10-val-row" style="font-weight:700;font-family:'JetBrains Mono',monospace;"><span id="tac-top10-val" style="color:#eaecef;">--</span> <span id="tac-top10-change" style="font-size:9px;">--%</span></span>
              </div>
              <canvas id="tac-top10-canvas" style="width:100%;height:32px;display:block;margin-top:2px;"></canvas>
              <div id="tac-top10-status" style="font-size:8.5px;color:#848e9c;text-align:center;margin-top:1px;font-weight:600;">Sintonizando...</div>
            </div>

            <!-- Divisor -->
            <div class="tac-hud-divider"></div>

            <!-- Bloco Inferior: MEU ÍNDICE PESSOAL -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;color:var(--tac-text-muted);font-weight:600;">
                <span>🎯 MEU ÍNDICE PESSOAL</span>
                <span id="tac-basket-label" style="font-weight:700;">...</span>
              </div>
              <canvas id="tac-basket-canvas" style="width:100%;height:32px;display:block;margin-top:2px;"></canvas>
              <div id="tac-basket-score" style="font-size:8.5px;color:#848e9c;text-align:center;margin-top:1px;">...</div>
            </div>

            <!-- Popover Informativo: Índices -->
            <div class="tac-oracle-popover" id="tac-indices-popover" style="width:310px;">
              <div class="tac-popover-header">
                <span style="font-weight:700;color:#f0b90b;font-size:11px;">📊 Como Ler os Dois Índices?</span>
                <button type="button" class="tac-popover-close" onclick="window._closeTacHudHelp(event, 'tac-indices-popover')">&times;</button>
              </div>
              <div class="tac-popover-body">
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🌐 ÍNDICE TOP 10 (MARÉ GERAL vs MMA 80):</span>
                  <div>Representa a saúde do mercado cripto ponderado pelas 10 maiores moedas em relação à <strong>MMA 80</strong>. Quando o Top 10 está abaixo da MMA 80, o mercado todo opera sob maré vendedora.</div>
                </div>
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🎯 MEU ÍNDICE PESSOAL (CESTA 5 PARES vs MMA 32):</span>
                  <div>Mede a distância média e alinhamento dos seus 5 pares selecionados (BTC, ETH, BCH, BNB, UNI) em relação à <strong>MMA 32</strong> (Zona de Observação / Reteste no 15m).</div>
                </div>
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">💡 COMO OPERAR:</span>
                  <div>• Opere comprado apenas se a <strong>Maré Geral</strong> e seu <strong>Índice Pessoal</strong> estiverem ambos verdes.</div>
                  <div>• Se o Top 10 estiver caindo e seu índice subindo, cautela redobrada com rompimentos falsos.</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. ORÁCULO QUANTITATIVO: PROBABILIDADE SINTÉTICA + PAR RECOMENDADO -->
          <div class="tac-hud-block" style="flex:1.85;min-width:320px;position:relative;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div class="tac-hud-label" style="font-weight:700;color:#38bdf8;letter-spacing:0.3px;">🧠 ORÁCULO QUANTITATIVO</div>
              <button type="button" class="tac-oracle-help-btn" id="tac-oracle-help-btn" onclick="window._toggleTacOracleHelp(event)" title="O que o Oráculo Quantitativo analisa?">?</button>
            </div>

            <!-- Subtítulo e Número de Probabilidade -->
            <div style="font-size:8.5px;color:#848e9c;text-transform:uppercase;letter-spacing:0.3px;margin-top:2px;">Probabilidade Sintética Estimada</div>
            <div class="tac-oracle-prob-wrap">
              <span class="tac-oracle-prob-pct" id="tac-oracle-prob-pct" style="color:#f6465d;">--%</span>
              <span class="tac-oracle-badge badge-neutral" id="tac-oracle-badge">CALCULANDO...</span>
            </div>

            <!-- Barra Bidirecional (-100% a +100%) -->
            <div class="tac-oracle-bar-track" id="tac-oracle-bar-track">
              <div class="tac-oracle-center-line"></div>
              <div class="tac-oracle-bar-fill" id="tac-oracle-bar-fill" style="left:50%;width:0%;"></div>
              <div class="tac-oracle-bar-needle" id="tac-oracle-bar-needle" style="left:50%;"></div>
            </div>
            <div class="tac-oracle-scale">
              <span>-100%</span>
              <span>-50%</span>
              <span style="color:#ffffff;font-weight:700;">0%</span>
              <span>+50%</span>
              <span>+100%</span>
            </div>
            <div class="tac-oracle-extremes">
              <span style="color:#f6465d;">🔴 VENDA (SHORT)</span>
              <span style="color:#848e9c;">⚪ NEUTRO (0%)</span>
              <span style="color:#0ecb81;">🟢 COMPRA (LONG)</span>
            </div>

            <!-- Card Par Recomendado para Operação (1H / 15M) -->
            <div class="tac-lead-card" id="tac-oracle-lead-card">
              <div class="tac-lead-label">🎯 PAR RECOMENDADO PARA OPERAÇÃO (1H / 15M):</div>
              <div id="tac-oracle-lead-content">
                <div class="tac-lead-header">
                  <span class="tac-lead-symbol" id="tac-oracle-lead-symbol">BTC / USDT</span>
                  <span class="tac-lead-setup-badge badge-bear" id="tac-oracle-lead-setup">Analisando setup...</span>
                </div>
                <div class="tac-lead-metrics" id="tac-oracle-lead-metrics">
                  Distância MMA 32: -- · Vol. Spot: -- · Vol. Futuros: -- · Stop Técnico (MMA 80): --
                </div>
                <div class="tac-lead-action" id="tac-oracle-lead-action">
                  Sintonizando confluência tática...
                </div>
              </div>
            </div>

            <!-- Popover Informativo dos Pilares do Oráculo -->
            <div class="tac-oracle-popover" id="tac-oracle-popover" style="width:330px;">
              <div class="tac-popover-header">
                <span style="font-weight:700;color:#f0b90b;font-size:11px;">🧠 Como o Oráculo Decide?</span>
                <button type="button" class="tac-popover-close" onclick="window._closeTacOracleHelp(event)" title="Fechar">&times;</button>
              </div>
              <div style="font-size:9.5px;color:#848e9c;margin-bottom:8px;line-height:1.3;">
                Confluência em tempo real dos pilares institucionais do ecossistema:
              </div>
              <div class="tac-pillar-list">
                <div class="tac-pillar-item" id="tac-pillar-empire">
                  <span class="tac-pillar-title">👑 EMPIRE Institucional (72h):</span>
                  <span class="tac-pillar-val">Carregando...</span>
                </div>
                <div class="tac-pillar-item" id="tac-pillar-whales">
                  <span class="tac-pillar-title">🐋 Baleias BTC (CEX 24h):</span>
                  <span class="tac-pillar-val">Carregando...</span>
                </div>
                <div class="tac-pillar-item" id="tac-pillar-taker">
                  <span class="tac-pillar-title">⚡ Agressão Taker BTC (5m):</span>
                  <span class="tac-pillar-val">Carregando...</span>
                </div>
                <div class="tac-pillar-item" id="tac-pillar-basket">
                  <span class="tac-pillar-title">📊 Cesta 5 Pares (MMA 32/80):</span>
                  <span class="tac-pillar-val">Carregando...</span>
                </div>
                <div class="tac-pillar-item" id="tac-pillar-leverage">
                  <span class="tac-pillar-title">🎣 Alavancagem Varejo (L/S):</span>
                  <span class="tac-pillar-val">Carregando...</span>
                </div>
                <div class="tac-pillar-item" id="tac-pillar-sentiment">
                  <span class="tac-pillar-title">😨 Sentimento (Fear & Greed):</span>
                  <span class="tac-pillar-val">Carregando...</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. VAREJO & AGRESSÃO (MANADA L/S + TAKER 5M) -->
          <div class="tac-hud-block" style="flex:1.25;min-width:220px;position:relative;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
              <span class="tac-hud-label" style="font-weight:700;color:#f0b90b;">🐟⚡ VAREJO & AGRESSÃO</span>
              <button type="button" class="tac-oracle-help-btn" onclick="window._toggleTacHudHelp(event, 'tac-retail-popover')" title="Como interpretar a Manada e a Agressão?">?</button>
            </div>

            <!-- Superior: Onde está a Manada? (Long/Short) -->
            <div>
              <div style="font-size:9px;color:var(--tac-text-muted);font-weight:600;display:flex;justify-content:space-between;">
                <span>🐟 ONDE ESTÁ A MANADA? (L/S)</span>
              </div>
              <div class="tac-meter-wrap" id="tac-ls-wrap" style="margin-top:2px;">
                <div class="tac-meter-bar">
                  <div class="tac-meter-fill-long" id="tac-ls-long" style="width: 50%;"></div>
                  <div class="tac-meter-fill-short" id="tac-ls-short" style="width: 50%;"></div>
                </div>
                <div class="tac-meter-text">
                  <span style="color:#0ecb81;" id="tac-ls-long-text">50% Alta</span>
                  <span style="color:#f6465d;" id="tac-ls-short-text">50% Baixa</span>
                </div>
              </div>
              <div id="tac-ls-trap-desc" style="font-size:8.5px;font-weight:600;margin-top:1px;line-height:1.2;">Calculando risco de armadilha...</div>
            </div>

            <!-- Divisor -->
            <div class="tac-hud-divider"></div>

            <!-- Inferior: Quem está Agredindo? (5m) -->
            <div>
              <div style="font-size:9px;color:var(--tac-text-muted);font-weight:600;display:flex;justify-content:space-between;">
                <span>⚡ QUEM ESTÁ AGREDINDO? (5M)</span>
              </div>
              <div class="tac-meter-wrap" id="tac-taker-wrap" style="margin-top:2px;">
                <div class="tac-meter-bar">
                  <div class="tac-meter-fill-long" id="tac-taker-long" style="width: 50%;"></div>
                  <div class="tac-meter-fill-short" id="tac-taker-short" style="width: 50%;"></div>
                </div>
                <div class="tac-meter-text">
                  <span style="color:#0ecb81;" id="tac-taker-buy-text">Compradores 50%</span>
                  <span style="color:#f6465d;" id="tac-taker-sell-text">Vendedores 50%</span>
                </div>
              </div>
              <div id="tac-taker-desc" style="font-size:8.5px;font-weight:600;margin-top:1px;">Equilíbrio momentâneo</div>
            </div>

            <!-- Popover Informativo Unificado: Varejo & Agressão -->
            <div class="tac-oracle-popover" id="tac-retail-popover" style="width:340px;">
              <div class="tac-popover-header">
                <span style="font-weight:700;color:#f0b90b;font-size:11px;">🐟⚡ Varejo & Agressão — Guia Tático</span>
                <button type="button" class="tac-popover-close" onclick="window._closeTacHudHelp(event, 'tac-retail-popover')">&times;</button>
              </div>
              <div class="tac-popover-body">
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🐟 1. ONDE ESTÁ A MANADA? (LONG/SHORT):</span>
                  <div>Mede a proporção de contas do varejo (sardinhas) apostando na Alta vs Baixa na Binance Futuros. Funciona como <strong>indicador contrário</strong>: manada > 62% em Long alerta para despejo institucional (Long Squeeze). Manada > 60% em Short indica pânico de fundo propício para puxada das baleias (Short Squeeze).</div>
                </div>
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">⚡ 2. QUEM ESTÁ AGREDINDO? (TAKER 5M):</span>
                  <div>Volume de ordens executadas a mercado nos últimos 5 minutos. Mede a urgência dos players. Se compradores >= 55% (🟢), há apetite imediato. Se vendedores >= 55% (🔴), agressão vendedora nos suportes.</div>
                </div>
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🛡️ FUNÇÃO PRÁTICA:</span>
                  <div>Nunca compre quando a manada inteira estiver na euforia e a agressão for vendedora. Espere a agressão compradora dominar para confirmar sua entrada.</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 4. DINHEIRO INSTITUCIONAL (SMART MONEY): OI + O FLUXO -->
          <div class="tac-hud-block" style="flex:1.45;min-width:250px;position:relative;">
            <div class="tac-hud-label" style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-weight:700;color:#0ecb81;">🦈 DINHEIRO INSTITUCIONAL</span>
              <button type="button" class="tac-oracle-help-btn" onclick="window._toggleTacHudHelp(event, 'tac-inst-popover')" title="Como funciona o Dinheiro Institucional (OI + Fluxo)?">?</button>
            </div>
            
            <!-- Parte Superior: Open Interest (OI) e Delta -->
            <div style="margin-top:2px;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <span style="font-size:9px;color:var(--tac-text-muted);font-weight:600;">CONTRATOS EM ABERTO (OI)</span>
                <span class="tac-hud-val" id="tac-oi-val" style="font-size:12.5px;font-weight:800;">...</span>
              </div>
              <div id="tac-oi-delta-desc" style="font-size:9.5px;font-weight:600;margin-top:1px;">Analisando fluxo institucional...</div>
            </div>

            <!-- Divisor -->
            <div class="tac-hud-divider"></div>

            <!-- Parte Inferior: O Fluxo (Dinheiro Pesado / Acúmulo vs Despejo) -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;color:var(--tac-text-muted);font-weight:600;">
                <span>🌊 O FLUXO (EMPIRE 72H)</span>
              </div>
              <canvas id="tac-truck-canvas" style="width:100%;height:32px;display:block;margin-top:2px;"></canvas>
              <div id="tac-truck-label" style="font-size:9px;font-weight:700;margin-top:2px;text-align:center;">Sintonizando fluxo institucional...</div>
            </div>

            <!-- Popover Informativo Unificado: Dinheiro Institucional -->
            <div class="tac-oracle-popover tac-popover-right" id="tac-inst-popover" style="width:360px;">
              <div class="tac-popover-header">
                <span style="font-weight:700;color:#f0b90b;font-size:11px;">🦈 Dinheiro Institucional — Raio-X Completo</span>
                <button type="button" class="tac-popover-close" onclick="window._closeTacHudHelp(event, 'tac-inst-popover')">&times;</button>
              </div>
              <div class="tac-popover-body">
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🦈 1. OPEN INTEREST (OI):</span>
                  <div>O saldo total em dólares de contratos futuros em aberto. Se o preço sobe e o OI sobe (▲ Verde), há dinheiro NOVO bancando a alta. Se o preço sobe e o OI cai (▼ Vermelho), é apenas repique oco / short squeeze.</div>
                </div>
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🌊 2. O FLUXO (EMPIRE 72H LÍQUIDO):</span>
                  <div>Mede o saldo líquido real de ordens a mercado (Buy Vol - Sell Vol) ponderando Spot e Futuros na janela estrutural de 72 horas.</div>
                </div>
                <div class="tac-popover-section">
                  <span class="tac-popover-tag">🚨 DIVERGÊNCIA INSTITUCIONAL:</span>
                  <div>• <strong>🌊⚠️ DESPEJO FORTE:</strong> Preço subindo no gráfico, mas o fluxo institucional está vendendo! Os tubarões usam a euforia para desovar contratos na cabeça da manada.</div>
                  <div>• <strong>🌊🚨 ACÚMULO FORTE:</strong> Preço caindo no gráfico, mas o fluxo institucional está comprando! Tubarões absorvendo ordens no fundo (Bear trap).</div>
                  <div>• <strong>🌊🟢 / 🌊🔴 FLUXO CONFIRMADO:</strong> Gráfico e tubarões alinhados na mesma direção.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    window._toggleTacMA         = toggleMovingAverages;
    window._toggleTacInd        = toggleIndicators;
    window._toggleTacZones      = toggleEmpireZones;
    window._toggleTacEmpireTags = toggleEmpireTags;
    window._toggleTacPriceLine  = togglePriceLine;
    window._toggleTacFibo       = () => toggleFiboTool(1);
    window._clearTacFibo        = () => clearFibo(1);
    window._toggleTacFibo2      = () => toggleFiboTool(2);
    window._clearTacFibo2       = () => clearFibo(2);
    window._setTacTF            = setTimeframe;
    window._setTacPair          = setPair;
    window._toggleTacOracleHelp = toggleOracleHelp;
    window._closeTacOracleHelp  = closeOracleHelp;
    window._toggleTacHudHelp    = toggleHudHelp;
    window._closeTacHudHelp     = closeHudHelp;
  }

  function toggleOracleHelp(e) {
    toggleHudHelp(e, 'tac-oracle-popover');
  }

  function closeOracleHelp(e) {
    closeHudHelp(e, 'tac-oracle-popover');
  }

  function toggleHudHelp(e, id) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Fecha todos os outros popovers
    document.querySelectorAll('.tac-oracle-popover').forEach(p => {
      if (p.id !== id) p.style.display = 'none';
    });

    const target = document.getElementById(id);
    if (!target) return;

    // Se já estava aberto, fecha
    if (target.style.display === 'block') {
      target.style.display = 'none';
      return;
    }

    // Renderiza fora da vista para medir a altura real
    target.style.top  = '-9999px';
    target.style.left = '-9999px';
    target.style.display = 'block';

    // Calcula posição acima do botão clicado
    const btn = (e && e.target) ? e.target.closest('.tac-oracle-help-btn') || e.target : null;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const popW = target.offsetWidth  || parseInt(target.style.width) || 320;
      const popH = target.offsetHeight || 300;

      // Posiciona acima do botão por padrão
      let top  = rect.top - popH - 10;
      let left = rect.left;

      // Não sair pela direita
      if (left + popW > window.innerWidth - 8) {
        left = window.innerWidth - popW - 8;
      }
      // Não sair pela esquerda
      if (left < 8) left = 8;
      // Se não couber acima, abre abaixo
      if (top < 8) top = rect.bottom + 8;

      target.style.top  = top  + 'px';
      target.style.left = left + 'px';
    } else {
      // Fallback: centro da tela
      target.style.top  = '50px';
      target.style.left = '50px';
    }
  }

  function closeHudHelp(e, id) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const target = document.getElementById(id);
    if (target) target.style.display = 'none';
  }

  // Fecha qualquer popover caso o usuário clique fora dele
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tac-oracle-popover') && !e.target.closest('.tac-oracle-help-btn')) {
      document.querySelectorAll('.tac-oracle-popover').forEach(p => p.style.display = 'none');
    }
  });

  /* ─────────────────────────────────────────────────────────────
     2. INICIALIZAÇÃO DO LIGHTWEIGHT CHARTS (Sem Linhas Tracejadas)
  ───────────────────────────────────────────────────────────── */
  function initCharts() {
    if (typeof LightweightCharts === 'undefined') {
      console.error('[BTC Tactical] LightweightCharts not loaded!');
      return;
    }

    const mainContainer = document.getElementById('tac-chart-main');
    if (!mainContainer) return;

    const baseTheme = {
      layout: {
        background: { type: 'solid', color: '#000000' },
        textColor: '#848e9c',
        fontSize: 11
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      timeScale: {
        borderColor: '#2b313a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 16,
        barSpacing: 8,
        minBarSpacing: 3,
        shiftVisibleRangeOnNewBar: true
      }
    };

    // Gráfico Principal
    const initialH = mainContainer.clientHeight || 450;
    state.charts.main = LightweightCharts.createChart(mainContainer, {
      ...baseTheme,
      width: mainContainer.clientWidth,
      height: initialH,
      rightPriceScale: {
        borderColor: '#2b313a',
        scaleMargins: { top: 0.08, bottom: 0.1 }
      }
    });

    // 1. Candles
    state.series.candles = state.charts.main.addCandlestickSeries({
      upColor: '#00bcd4',
      downColor: '#af0000',
      borderVisible: false,
      wickUpColor: '#00bcd4',
      wickDownColor: '#af0000',
      priceLineVisible: state.priceLineVisible
    });

    // Conecta o módulo modular de linha de posições da Binance com suporte a arrastar TP/SL
    if (window.ChartPositions) {
      window.ChartPositions.setTargetSeries(state.series.candles, state.charts.main, mainContainer);
    }

    // 2. MMAs (Amarela e Roxa) — Sem linha horizontal de preço tracejada
    state.series.mmaShort = state.charts.main.addLineSeries({
      color: '#f0b90b',
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'MMA 8'
    });

    state.series.mmaLong = state.charts.main.addLineSeries({
      color: '#ffffff',
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'MMA 20'
    });

    const empireTitle = state.empireTagsVisible ? 'EMPIRE' : '';

    // 3. Indicador EMPIRE (72h Macro - Saldo Líquido de Volume Delta) — Linhas Verde e Vermelha
    // (Nome interno legado: vwapBuy/vwapSell — Metodologia proprietária EMPIRE, não é VWAP)
    state.series.vwapBuy = state.charts.main.addLineSeries({
      color: '#0ecb81',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: state.empireTagsVisible,
      title: empireTitle
    });

    state.series.vwapSell = state.charts.main.addLineSeries({
      color: '#f6465d',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: state.empireTagsVisible,
      title: empireTitle
    });

    // 4. Volume Real 8h (Intraday Tático Atemporal) — Ciano e Laranja (1.2px)
    state.series.intraBuy = state.charts.main.addLineSeries({
      color: '#38b6ff',
      lineWidth: 1.2,
      priceLineVisible: false,
      lastValueVisible: state.empireTagsVisible,
      title: empireTitle
    });

    state.series.intraSell = state.charts.main.addLineSeries({
      color: '#ff7043',
      lineWidth: 1.2,
      priceLineVisible: false,
      lastValueVisible: state.empireTagsVisible,
      title: empireTitle
    });

    // Sincronização do Canvas de Volume e das Nuvens de Zona com o Gráfico Principal
    state.charts.main.timeScale().subscribeVisibleTimeRangeChange(() => {
      renderVolumeCanvas();
      renderEmpireZones();
    });

    // Crosshair move / Hover & Legenda
    state.charts.main.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.seriesPrices) {
        state.isHovering = false;
        renderDefaultLegend();
        return;
      }
      state.isHovering = true;
      updateLegendOnHover(param);
    });

    // Ao sair do container do gráfico, restaura a legenda e limpa cursor
    mainContainer.addEventListener('mouseleave', () => {
      state.isHovering = false;
      renderDefaultLegend();
      if (!state.fibo.drawing) {
        mainContainer.style.cursor = '';
      }
    });

    // ─── DISTÂNCIA PONTO -> SEGMENTO DE RETA (Para agarrar a linha diagonal do Fibo) ───
    function distToSegment(px, py, x1, y1, x2, y2) {
      if (x1 === null || y1 === null || x2 === null || y2 === null) return Infinity;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    // ─── MAPEAMENTO DE COORDENADAS -> VELA & PREÇO (COM IMÃ CIRÚRGICO) ───
    function getPointFromClientCoords(clientX, clientY) {
      const series = state.series.candles;
      const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
      if (!series || !timeScale || !state.candles.length) return null;

      // 1. Busca horizontalmente a vela mais próxima na tela (liberdade total entre velas à frente e atrás)
      let bestCandle = null;
      let minDistX = Infinity;

      for (let i = 0; i < state.candles.length; i++) {
        const c = state.candles[i];
        const cx = timeScale.timeToCoordinate(c.time);
        if (cx === null || cx === undefined) continue;
        const dx = Math.abs(cx - clientX);
        if (dx < minDistX) {
          minDistX = dx;
          bestCandle = c;
        }
      }

      let targetTime = null;
      if (bestCandle) {
        targetTime = bestCandle.time;
      } else {
        targetTime = timeScale.coordinateToTime(clientX);
        if (!targetTime && state.candles.length) {
          targetTime = state.candles[state.candles.length - 1].time;
        }
      }

      const rawPrice = series.coordinateToPrice(clientY);
      if (rawPrice === null || rawPrice === undefined) return null;

      let finalPrice = rawPrice;
      let isSnap = false;

      // Imã inteligente nos pavios (máxima e mínima) da vela se o cursor estiver a menos de 28px
      if (bestCandle && minDistX <= 30) {
        const yHigh = series.priceToCoordinate(bestCandle.high);
        const yLow  = series.priceToCoordinate(bestCandle.low);
        const distHigh = (yHigh !== null && yHigh !== undefined) ? Math.abs(yHigh - clientY) : Infinity;
        const distLow  = (yLow  !== null && yLow  !== undefined) ? Math.abs(yLow  - clientY) : Infinity;

        if (distHigh <= 22 && distHigh <= distLow) {
          finalPrice = bestCandle.high;
          targetTime = bestCandle.time;
          isSnap = true;
        } else if (distLow <= 22) {
          finalPrice = bestCandle.low;
          targetTime = bestCandle.time;
          isSnap = true;
        }
      }

      return { price: finalPrice, time: targetTime, isSnap };
    }

    // ─── HELPER: Bloqueia/Libera o Scroll/Pan do Gráfico durante arraste de âncoras ───
    function setChartScroll(enabled) {
      if (state.charts && state.charts.main) {
        try {
          state.charts.main.applyOptions({
            handleScroll: enabled,
            handleScale: enabled
          });
        } catch (_) {}
      }
    }

    // ─── HELPER: Verifica se um ponto clicado atinge uma âncora ou linha do Fibo ───
    function checkFiboHit(fiboObj, clientX, clientY, timeScale, series) {
      if (!fiboObj || !fiboObj.p1 || !fiboObj.p2) return null;
      const x1 = fiboObj.p1.time ? timeScale.timeToCoordinate(fiboObj.p1.time) : null;
      const y1 = series.priceToCoordinate(fiboObj.p1.price);
      const x2 = fiboObj.p2.time ? timeScale.timeToCoordinate(fiboObj.p2.time) : null;
      const y2 = series.priceToCoordinate(fiboObj.p2.price);

      const d1 = (x1 !== null && y1 !== null) ? Math.hypot(x1 - clientX, y1 - clientY) : Infinity;
      const d2 = (x2 !== null && y2 !== null) ? Math.hypot(x2 - clientX, y2 - clientY) : Infinity;
      const dLine = distToSegment(clientX, clientY, x1, y1, x2, y2);

      if (d1 <= 20) return { anchor: 'p1' };
      if (d2 <= 20) return { anchor: 'p2' };
      if (dLine <= 10) return { anchor: 'line', clientX, clientY, p1Price: fiboObj.p1.price, p2Price: fiboObj.p2.price };
      return null;
    }

    // ─── INTERAÇÃO FIBONACCI NATIVA ESTILO TRADINGVIEW ───
    // Usamos capture: true para interceptar o clique antes do Lightweight Charts iniciar o pan do gráfico!
    mainContainer.addEventListener('mousedown', e => {
      if (e.button !== 0) return; // Apenas botão esquerdo

      const rect = mainContainer.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const series = state.series.candles;
      const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
      if (!series || !timeScale) return;

      // 1. Verifica se clicou em uma âncora ou linha do Fibo 2 ou Fibo 1
      const hit2 = checkFiboHit(state.fibo2, clientX, clientY, timeScale, series);
      const hit1 = checkFiboHit(state.fibo, clientX, clientY, timeScale, series);

      if (hit2) {
        state.dragTargetFibo = 2;
        state.fibo2.isDragging = true;
        state.fibo2.dragAnchor = hit2.anchor;
        if (hit2.anchor === 'line') state.fibo2.dragStart = hit2;
        setChartScroll(false);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        return;
      } else if (hit1) {
        state.dragTargetFibo = 1;
        state.fibo.isDragging = true;
        state.fibo.dragAnchor = hit1.anchor;
        if (hit1.anchor === 'line') state.fibo.dragStart = hit1;
        setChartScroll(false);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        return;
      }

      // 2. Se NÃO estiver no modo de traçar nenhum Fibo, NÃO intercepta.
      if (!state.fibo.drawing && !state.fibo2.drawing) {
        return;
      }

      // 3. Novo traçado de Fibo iniciado pelo usuário
      const snap = getPointFromClientCoords(clientX, clientY);
      if (!snap || snap.price === null || !snap.time) return;

      const isDrawing2 = state.fibo2.drawing;
      const targetFibo = isDrawing2 ? state.fibo2 : state.fibo;
      state.dragTargetFibo = isDrawing2 ? 2 : 1;

      targetFibo.isDragging = true;
      targetFibo.dragAnchor = 'p2';
      setChartScroll(false);
      targetFibo.p1 = { price: snap.price, time: snap.time };
      targetFibo.p2 = { price: snap.price, time: snap.time };

      renderEmpireZones();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, { capture: true });

    window.addEventListener('mousemove', e => {
      const rect = mainContainer.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const series = state.series.candles;
      const timeScale = state.charts.main ? state.charts.main.timeScale() : null;
      if (!series || !timeScale) return;

      // Se estiver arrastando algum Fibo
      const activeDraggingFibo = (state.dragTargetFibo === 2) ? state.fibo2 : (state.dragTargetFibo === 1) ? state.fibo : null;
      if (activeDraggingFibo && activeDraggingFibo.isDragging && activeDraggingFibo.p1 && activeDraggingFibo.p2) {
        if (activeDraggingFibo.dragAnchor === 'p1') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeDraggingFibo.p1 = { price: pt.price, time: pt.time };
          }
        } else if (activeDraggingFibo.dragAnchor === 'p2') {
          const pt = getPointFromClientCoords(clientX, clientY);
          if (pt && pt.price !== null && pt.time) {
            activeDraggingFibo.p2 = { price: pt.price, time: pt.time };
          }
        } else if (activeDraggingFibo.dragAnchor === 'line' && activeDraggingFibo.dragStart) {
          const curPrice = series.coordinateToPrice(clientY);
          const startPrice = series.coordinateToPrice(activeDraggingFibo.dragStart.clientY);
          if (curPrice !== null && startPrice !== null) {
            const dPrice = curPrice - startPrice;
            activeDraggingFibo.p1.price = activeDraggingFibo.dragStart.p1Price + dPrice;
            activeDraggingFibo.p2.price = activeDraggingFibo.dragStart.p2Price + dPrice;
          }
        }

        renderEmpireZones();
        return;
      }

      // Se NÃO estiver arrastando, atualiza cursor quando passar pelas âncoras de F1 ou F2
      const h2 = checkFiboHit(state.fibo2, clientX, clientY, timeScale, series);
      const h1 = checkFiboHit(state.fibo, clientX, clientY, timeScale, series);

      if ((h2 && (h2.anchor === 'p1' || h2.anchor === 'p2')) || (h1 && (h1.anchor === 'p1' || h1.anchor === 'p2'))) {
        mainContainer.style.cursor = 'grab';
      } else if ((h2 && h2.anchor === 'line') || (h1 && h1.anchor === 'line')) {
        mainContainer.style.cursor = 'move';
      } else if (state.fibo.drawing || state.fibo2.drawing) {
        mainContainer.style.cursor = 'crosshair';
      } else {
        mainContainer.style.cursor = '';
      }
    });

    window.addEventListener('mouseup', () => {
      if (!state.dragTargetFibo) return;

      const isTarget2 = (state.dragTargetFibo === 2);
      const currentDragFibo = isTarget2 ? state.fibo2 : state.fibo;
      const fiboNum = isTarget2 ? 2 : 1;
      const storageKey = getFiboStorageKey(fiboNum, state.currentSymbol);

      if (!currentDragFibo.isDragging) {
        state.dragTargetFibo = null;
        return;
      }

      currentDragFibo.isDragging = false;
      currentDragFibo.dragAnchor = null;
      currentDragFibo.dragStart = null;
      state.dragTargetFibo = null;

      if (currentDragFibo.drawing) {
        // Se desenhou com diferença mínima de preço, fixa o Fibo e encerra o modo traçar!
        if (currentDragFibo.p1 && currentDragFibo.p2 && Math.abs(currentDragFibo.p2.price - currentDragFibo.p1.price) > 0.00001) {
          currentDragFibo.drawing = false;
          currentDragFibo.active = true;
          if (currentDragFibo.alert2618) {
            currentDragFibo.alert2618.armed = false;
            currentDragFibo.alert2618.triggered = false;
            currentDragFibo.alert2618.approachDir = null;
          }
          if (!state.fibo.drawing && !state.fibo2.drawing) {
            mainContainer.classList.remove('fibo-mode');
          }
          updateFiboButtonUI('placed', fiboNum);
          // Persiste no localStorage
          try { localStorage.setItem(storageKey, JSON.stringify({ p1: currentDragFibo.p1, p2: currentDragFibo.p2 })); } catch (_) {}
        }
      } else if (currentDragFibo.active && currentDragFibo.p1 && currentDragFibo.p2) {
        if (currentDragFibo.alert2618) {
          currentDragFibo.alert2618.armed = false;
          currentDragFibo.alert2618.triggered = false;
          currentDragFibo.alert2618.approachDir = null;
        }
        // Persiste após arrastar uma âncora ou a linha toda
        try { localStorage.setItem(storageKey, JSON.stringify({ p1: currentDragFibo.p1, p2: currentDragFibo.p2 })); } catch (_) {}
      }

      mainContainer.style.cursor = '';
      setChartScroll(true); // Re-habilita pan e scroll livre do gráfico após soltar
      renderEmpireZones();
    });

    // Resize Observer do container do gráfico
    const ro = new ResizeObserver(() => {
      if (state.charts.main && mainContainer) {
        state.charts.main.applyOptions({
          width: mainContainer.clientWidth,
          height: mainContainer.clientHeight || 450
        });
        renderVolumeCanvas();
        renderEmpireZones();
        drawTop10Gauge();
        drawBasketGauge();
        drawTruckGauge();
      }
    });
    ro.observe(mainContainer);

    // Sincroniza a altura do gráfico para acompanhar a altura exata do painel de ordens
    function syncChartHeightToPanel() {
      const panel = document.getElementById('binance-order-panel');
      if (!panel || !mainContainer || !state.charts.main) return;

      const panelHeight = panel.offsetHeight || panel.clientHeight;
      if (panelHeight > 400) {
        const volHeight = 80;
        const targetChartHeight = Math.max(420, panelHeight - volHeight);

        mainContainer.style.height = `${targetChartHeight}px`;
        state.charts.main.applyOptions({
          width: mainContainer.clientWidth,
          height: targetChartHeight
        });
        renderEmpireZones();
        renderVolumeCanvas();
      }
    }

    window._syncTacChartHeight = syncChartHeightToPanel;

    // Observa o painel de ordens para ajustar a altura sempre que o painel mudar
    const panelEl = document.getElementById('binance-order-panel');
    if (panelEl) {
      const panelRo = new ResizeObserver(() => {
        syncChartHeightToPanel();
      });
      panelRo.observe(panelEl);
    }

    setTimeout(syncChartHeightToPanel, 100);
    setTimeout(syncChartHeightToPanel, 400);
    setTimeout(syncChartHeightToPanel, 1000);
    window.addEventListener('resize', syncChartHeightToPanel);
  }

  /* ─────────────────────────────────────────────────────────────
     3. CARREGAMENTO E RENDERIZAÇÃO DE DADOS
  ───────────────────────────────────────────────────────────── */
  let activeFetchId = 0;

  async function fetchAndRender() {
    const fetchId = ++activeFetchId;
    try {
      const titleEl = document.getElementById('tac-title-text');
      if (titleEl) {
        titleEl.innerHTML = `&#128200; Preço ${state.currentSymbol}`;
      }

      // Busca dados atualizados do servidor (o histórico do Firebase é cacheado no servidor por 1h)
      const res = await fetch(`${API_URL}?symbol=${state.currentSymbol}&interval=${state.currentTimeframe}`);
      if (!res.ok) throw new Error('Falha ao obter histórico tático: ' + res.status);
      const data = await res.json();

      // Descarta se o usuário trocou de par enquanto a requisição estava em trânsito
      if (fetchId !== activeFetchId) return;

      state.baseAsset = data.baseAsset || 'BTC';
      state.meta = {
        shortLabel: data.shortLabel,
        longLabel:  data.longLabel,
        shortPeriod: data.shortPeriod,
        longPeriod: data.longPeriod
      };
      state.oi = data.oi || {};
      state.candles = (data.candles || []).map(c => ({
        time: Math.floor(c.t / 1000),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.cl,
        volume: c.v,
        buyV: c.buyV,
        sellV: c.sellV,
        mmaShort: c.mmaShort,
        mmaLong: c.mmaLong,
        vwapBuy: c.vwapBuy,
        vwapSell: c.vwapSell,
        isAccum: c.isAccum,
        netAccum72h: c.netAccum72h,
        intraBuy: c.intraBuy,
        intraSell: c.intraSell,
        isIntraAccum: c.isIntraAccum,
        netAccum8h: c.netAccum8h,
        signal: c.signal
      }));

      // Atualiza séries no gráfico
      const candleData = state.candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
      state.series.candles.setData(candleData);

      // Médias
      const maShortData = state.candles
        .filter(c => c.mmaShort !== null)
        .map(c => ({ time: c.time, value: c.mmaShort }));
      const maLongData = state.candles
        .filter(c => c.mmaLong !== null)
        .map(c => ({ time: c.time, value: c.mmaLong }));

      state.series.mmaShort.setData(maShortData);
      state.series.mmaLong.setData(maLongData);

      // Volume Real 72h
      const vBuyData = state.candles
        .filter(c => c.vwapBuy !== null)
        .map(c => ({ time: c.time, value: c.vwapBuy }));
      const vSellData = state.candles
        .filter(c => c.vwapSell !== null)
        .map(c => ({ time: c.time, value: c.vwapSell }));

      state.series.vwapBuy.setData(vBuyData);
      state.series.vwapSell.setData(vSellData);

      // Volume Real 8h (Intraday)
      const iBuyData = state.candles
        .filter(c => c.intraBuy !== null)
        .map(c => ({ time: c.time, value: c.intraBuy }));
      const iSellData = state.candles
        .filter(c => c.intraSell !== null)
        .map(c => ({ time: c.time, value: c.intraSell }));

      state.series.intraBuy.setData(iBuyData);
      state.series.intraSell.setData(iSellData);

      // Respeita visibilidade dos botões
      if (state.series.mmaShort) state.series.mmaShort.applyOptions({ visible: state.maVisible });
      if (state.series.mmaLong)  state.series.mmaLong.applyOptions({ visible: state.maVisible });
      if (state.series.vwapBuy)  state.series.vwapBuy.applyOptions({ visible: state.indicatorsVisible });
      if (state.series.vwapSell) state.series.vwapSell.applyOptions({ visible: state.indicatorsVisible });
      if (state.series.intraBuy) state.series.intraBuy.applyOptions({ visible: state.indicatorsVisible });
      if (state.series.intraSell) state.series.intraSell.applyOptions({ visible: state.indicatorsVisible });

      // Gráfico limpo sem setas de compra e venda
      state.series.candles.setMarkers([]);

      // Renderiza Volume Canvas, Nuvens de Zonas e HUD
      renderVolumeCanvas();
      renderEmpireZones();
      renderDefaultLegend();
      updateHUD();

      // Afasta os candles da escala de preço lateral com margem de respiro à direita (estilo TradingView / Binance)
      state.charts.main.timeScale().applyOptions({ rightOffset: 18 });
      state.charts.main.timeScale().scrollToRealTime();

      // Conecta o WebSocket ao vivo somente após o histórico do par estar 100% desenhado na tela
      openWebSocket();

    } catch (err) {
      console.error('[BTC Tactical] Erro ao carregar dados:', err);
      const leg = document.getElementById('tac-legend');
      if (leg) leg.innerHTML = '<span style="color:#f6465d;">Erro ao conectar com a API tática de futuros.</span>';
    }
  }

  /* ─────────────────────────────────────────────────────────────
     4. VOLUME BICOLOR EMPILHADO NO CANVAS (Compra + Venda)
  ───────────────────────────────────────────────────────────── */
  function renderVolumeCanvas() {
    const canvas = document.getElementById('tac-vol-canvas');
    const container = document.getElementById('tac-chart-vol');
    if (!canvas || !container || !state.charts.main) return;

    const width = container.clientWidth;
    const height = 80;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    if (!state.candles.length) return;

    const timeScale = state.charts.main.timeScale();

    // Encontrar volume máximo das barras visíveis
    let maxVol = 0;
    state.candles.forEach(c => {
      const x = timeScale.timeToCoordinate(c.time);
      if (x !== null && x >= -20 && x <= width + 20) {
        if (c.volume > maxVol) maxVol = c.volume;
      }
    });
    if (maxVol === 0) maxVol = 1;

    // Largura calculada da barra
    let barWidth = 4;
    if (state.candles.length >= 2) {
      const x0 = timeScale.timeToCoordinate(state.candles[state.candles.length - 2].time);
      const x1 = timeScale.timeToCoordinate(state.candles[state.candles.length - 1].time);
      if (x0 !== null && x1 !== null) {
        barWidth = Math.max(2, Math.abs(x1 - x0) * 0.75);
      }
    }

    state.candles.forEach(c => {
      const x = timeScale.timeToCoordinate(c.time);
      if (x === null || x < -20 || x > width + 20) return;

      const totalH = (c.volume / maxVol) * (height - 8);
      const buyRatio = c.volume > 0 ? (c.buyV / c.volume) : 0.5;
      const buyH  = totalH * buyRatio;
      const sellH = totalH - buyH;

      const drawX = x - (barWidth / 2);
      const baseY = height - 2;

      // Parte Verde (Compra) - Embaixo
      ctx.fillStyle = '#0ecb81';
      ctx.fillRect(drawX, baseY - buyH, barWidth, buyH);

      // Parte Vermelha (Venda) - Em cima
      ctx.fillStyle = '#f6465d';
      ctx.fillRect(drawX, baseY - totalH, barWidth, sellH);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     4b. NUVEM / ZONAS DE ACÚMULO E DISTRIBUIÇÃO INSTITUCIONAL
  ───────────────────────────────────────────────────────────── */
  function renderEmpireZones() {
    const canvas = document.getElementById('tac-zones-canvas');
    const container = document.getElementById('tac-chart-main');
    if (!canvas || !container || !state.charts.main) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 450;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const timeScale = state.charts.main.timeScale();
    const series = state.series.candles;

    // Largura útil da área gráfica dos candles (excluindo a escala de preços à direita)
    let chartPlotWidth = width - 60;
    if (typeof timeScale.width === 'function' && timeScale.width() > 100) {
      chartPlotWidth = timeScale.width();
    } else if (state.charts.main && typeof state.charts.main.priceScale === 'function') {
      try {
        const psw = state.charts.main.priceScale('right').width();
        if (psw > 0) chartPlotWidth = width - psw;
      } catch (e) {}
    }

    // Se as nuvens de zonas estiverem visíveis:
    if (state.zonesVisible && state.indicatorsVisible && state.candles.length && series) {
      // Segmenta candles consecutivos por estado (Acúmulo vs Distribuição)
      function drawSegments(isAccumKey, buyKey, sellKey, is72h) {
        const segments = [];
        let curSeg = null;

        for (let i = 0; i < state.candles.length; i++) {
          const c = state.candles[i];
          const status = c[isAccumKey];
          const buyP = c[buyKey];
          const sellP = c[sellKey];

          if (status === null || status === undefined || buyP === null || sellP === null) {
            if (curSeg) { segments.push(curSeg); curSeg = null; }
            continue;
          }

          if (!curSeg || curSeg.status !== status) {
            if (curSeg) segments.push(curSeg);
            curSeg = {
              status,
              startIdx: i,
              endIdx: i
            };
          } else {
            curSeg.endIdx = i;
          }
        }
        if (curSeg) segments.push(curSeg);

        // Renderiza as nuvens translúcidas
        segments.forEach(seg => {
          const startC = state.candles[seg.startIdx];
          const endC   = state.candles[seg.endIdx];

          const xStart = timeScale.timeToCoordinate(startC.time);
          let xEnd = timeScale.timeToCoordinate(endC.time);

          // Se for o último segmento atual, estende até o final da área útil à direita (sem invadir a escala)
          const isCurrent = (seg.endIdx === state.candles.length - 1);
          if (isCurrent) {
            xEnd = chartPlotWidth;
          }

          if (xStart === null && xEnd === null) return;
          const leftX  = xStart !== null ? xStart : 0;
          const rightX = xEnd !== null ? Math.min(xEnd, chartPlotWidth) : chartPlotWidth;
          const segW = Math.max(rightX - leftX, 4);

          if (leftX > chartPlotWidth || rightX < 0) return;

          // Calcula os limites de preço de topo e piso da zona
          let topPrice = -Infinity;
          let bottomPrice = Infinity;

          for (let k = seg.startIdx; k <= seg.endIdx; k++) {
            const cd = state.candles[k];
            const bP = cd[buyKey];
            const sP = cd[sellKey];
            if (bP !== null && sP !== null) {
              topPrice = Math.max(topPrice, bP, sP);
              bottomPrice = Math.min(bottomPrice, bP, sP);
            }
          }

          if (!isFinite(topPrice) || !isFinite(bottomPrice)) return;

          // Converte preços para coordenadas Y da tela
          const yTop = series.priceToCoordinate(topPrice);
          const yBottom = series.priceToCoordinate(bottomPrice);

          if (yTop === null || yBottom === null) return;

          const drawY = Math.min(yTop, yBottom);
          const zoneH = Math.max(Math.abs(yBottom - yTop), 6);

          // Cores suaves da nuvem institucional
          ctx.save();
          if (seg.status) {
            // ACÚMULO (Verde suave para 72h / Ciano suave para 8h)
            if (is72h) {
              ctx.fillStyle = 'rgba(14, 203, 129, 0.09)';
              ctx.strokeStyle = 'rgba(14, 203, 129, 0.35)';
            } else {
              ctx.fillStyle = 'rgba(56, 182, 255, 0.08)';
              ctx.strokeStyle = 'rgba(56, 182, 255, 0.30)';
            }
          } else {
            // DISTRIBUIÇÃO (Vermelho suave para 72h / Laranja suave para 8h)
            if (is72h) {
              ctx.fillStyle = 'rgba(246, 70, 93, 0.09)';
              ctx.strokeStyle = 'rgba(246, 70, 93, 0.35)';
            } else {
              ctx.fillStyle = 'rgba(255, 112, 67, 0.08)';
              ctx.strokeStyle = 'rgba(255, 112, 67, 0.30)';
            }
          }

          // Desenho da nuvem de preenchimento
          ctx.fillRect(leftX, drawY, segW, zoneH);

          // Borda suave superior e inferior delimitando a faixa de briga
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(leftX, drawY);
          ctx.lineTo(leftX + segW, drawY);
          ctx.moveTo(leftX, drawY + zoneH);
          ctx.lineTo(leftX + segW, drawY + zoneH);
          ctx.stroke();

          ctx.restore();
        });
      }

      // 1. Zonas Macro 72h (EMPIRE 72h)
      drawSegments('isAccum', 'vwapBuy', 'vwapSell', true);

      // 2. Zonas Intraday 8h (EMPIRE 8h)
      drawSegments('isIntraAccum', 'intraBuy', 'intraSell', false);
    }

    // ─── DESENHO DAS FERRAMENTAS FIBONACCI (Fibo 1 Principal + Fibo 2 Cluster Boroden) ───
    if (state.fibo && state.fibo.p1 && state.fibo.p2) {
      drawFibonacciRetracement(ctx, width, height, timeScale, series, state.fibo, 1);
    }
    if (state.fibo2 && state.fibo2.p1 && state.fibo2.p2) {
      drawFibonacciRetracement(ctx, width, height, timeScale, series, state.fibo2, 2);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     4c. DESENHO INTERATIVO DE FIBONACCI (TradingView Style / Carolyn Boroden Cluster)
  ───────────────────────────────────────────────────────────── */
  function drawFibonacciRetracement(ctx, width, height, timeScale, series, fiboObj = state.fibo, fiboNum = 1) {
    if (!fiboObj || !fiboObj.p1 || !fiboObj.p2) return;

    const p1 = fiboObj.p1;
    const p2 = fiboObj.p2;

    const x1 = p1.time ? timeScale.timeToCoordinate(p1.time) : null;
    const y1 = series.priceToCoordinate(p1.price);
    const x2 = p2.time ? timeScale.timeToCoordinate(p2.time) : null;
    const y2 = series.priceToCoordinate(p2.price);

    const coordY1 = (y1 !== null && y1 !== undefined) ? y1 : null;
    const coordY2 = (y2 !== null && y2 !== undefined) ? y2 : null;
    const coordX1 = (x1 !== null && x1 !== undefined) ? x1 : null;
    const coordX2 = (x2 !== null && x2 !== undefined) ? x2 : null;

    if (coordY1 === null || coordY2 === null || coordX1 === null || coordX2 === null) return;

    const startX = Math.min(coordX1, coordX2);

    // Delimitação da área útil: para exatamente antes da escala vertical de preços
    let endX = width - 60;
    if (typeof timeScale.width === 'function' && timeScale.width() > 100) {
      endX = timeScale.width();
    } else if (state.charts.main && typeof state.charts.main.priceScale === 'function') {
      try {
        const psw = state.charts.main.priceScale('right').width();
        if (psw > 0) endX = width - psw;
      } catch (e) {}
    }

    const priceDiff = p2.price - p1.price; // Vetor direcional

    // Fibo 1 = Principal (Retrações + Expansões completas)
    // Fibo 2 = Secundário / Cluster Boroden (Apenas Retrações puras, sem expansões!)
    let fibLevels;
    if (fiboNum === 2) {
      fibLevels = [
        { ratio: 1.0,   color: '#38b6ff', isMajor: true },
        { ratio: 0.786, color: '#38b6ff', isMajor: false },
        { ratio: 0.618, color: '#38b6ff', isMajor: true },
        { ratio: 0.5,   color: '#38b6ff', isMajor: true },
        { ratio: 0.382, color: '#38b6ff', isMajor: true },
        { ratio: 0.236, color: '#38b6ff', isMajor: false },
        { ratio: 0.0,   color: '#848e9c', isMajor: true }
      ];
    } else {
      fibLevels = [
        // Expansões Superiores
        { ratio: 4.0,   color: '#0ecb81', isMajor: false },
        { ratio: 3.0,   color: '#0ecb81', isMajor: false },
        { ratio: 2.618, color: '#0ecb81', isMajor: true },
        { ratio: 2.0,   color: '#0ecb81', isMajor: false },
        { ratio: 1.618, color: '#0ecb81', isMajor: true },
        { ratio: 1.272, color: '#0ecb81', isMajor: false },
        // Nível 1.0 (Topo / Início do Impulso)
        { ratio: 1.0,   color: '#0ecb81', isMajor: true },
        // Retrações Áureas
        { ratio: 0.786, color: '#0ecb81', isMajor: false },
        { ratio: 0.618, color: '#0ecb81', isMajor: true },
        { ratio: 0.5,   color: '#0ecb81', isMajor: true },
        { ratio: 0.382, color: '#0ecb81', isMajor: true },
        { ratio: 0.236, color: '#0ecb81', isMajor: false },
        // Nível 0.0 (Fundo / Origem)
        { ratio: 0.0,   color: '#787b86', isMajor: true }
      ];
    }

    ctx.save();

    // 1. Linha guia pontilhada conectando os dois pontos
    const guideColor = fiboNum === 2 ? '#38b6ff' : '#f0b90b';
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(coordX1, coordY1);
    ctx.lineTo(coordX2, coordY2);
    ctx.stroke();

    // Círculos âncora nos pontos com anel de destaque para ajuste
    function drawAnchorPoint(ax, ay) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ax, ay, 6, 0, Math.PI * 2);
      ctx.fillStyle = fiboNum === 2 ? 'rgba(56, 182, 255, 0.4)' : 'rgba(240, 185, 11, 0.4)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = guideColor;
      ctx.fill();
      ctx.restore();
    }

    drawAnchorPoint(coordX1, coordY1);
    drawAnchorPoint(coordX2, coordY2);

    // 2. Linhas horizontais e rótulos de cada nível (linhas puras sem preenchimento de fundo)
    fibLevels.forEach(lev => {
      const targetPrice = p1.price + (priceDiff * lev.ratio);
      const y = series.priceToCoordinate(targetPrice);
      if (y === null || y < -10 || y > height + 10) return;

      // Linha do nível
      ctx.setLineDash([]);
      ctx.strokeStyle = lev.color;
      ctx.lineWidth = lev.isMajor ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();

      // Rótulo textual: ex "F1: 0.618 (75,800.00)" ou "F2: 0.618 (75,800.00)"
      const formattedPrice = formatPrice(targetPrice);
      const labelText = fiboNum === 2 ? `F2: ${lev.ratio} (${formattedPrice})` : `${lev.ratio} (${formattedPrice})`;

      ctx.font = "bold 9.5px 'JetBrains Mono', 'Fira Code', monospace";
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const textW = ctx.measureText(labelText).width;

      const labelRightX = endX - 6; // 6px antes do início da régua de preço
      const labelY = fiboNum === 2 ? (y - 3) : (y - 2);

      // Fundo escuro sutil para garantir legibilidade perfeita
      ctx.fillStyle = 'rgba(11, 14, 17, 0.88)';
      ctx.fillRect(labelRightX - textW - 4, labelY - 10, textW + 6, 12);

      // Texto com a cor oficial do nível de Fibonacci
      ctx.fillStyle = lev.color;
      ctx.fillText(labelText, labelRightX, labelY);
    });

    ctx.restore();
  }

  /* ─────────────────────────────────────────────────────────────
     5. LEGENDA DINÂMICA / INSPETOR (Preço, Volume Real 72h e 8h)
  ───────────────────────────────────────────────────────────── */
  function renderDefaultLegend() {
    const leg = document.getElementById('tac-legend');
    if (!leg || !state.candles.length) return;

    const last = state.candles[state.candles.length - 1];
    formatLegendHTML(leg, last);
  }

  function updateLegendOnHover(param) {
    const leg = document.getElementById('tac-legend');
    if (!leg) return;

    const candle = state.candles.find(c => c.time === param.time);
    if (!candle) {
      renderDefaultLegend();
      return;
    }
    formatLegendHTML(leg, candle);
  }

  function formatVolume(val, asset) {
    if (val === null || val === undefined) return '--';
    const sign = val > 0 ? '+' : '';
    const abs = Math.abs(val);
    if (abs >= 1e6) return sign + (val / 1e6).toFixed(2) + 'M ' + asset;
    if (abs >= 1e3) return sign + (val / 1e3).toFixed(1) + 'K ' + asset;
    return sign + Math.round(val) + ' ' + asset;
  }

  function formatPrice(val) {
    if (val === null || val === undefined) return '--';
    // Precisão por par (igual às casas decimais da Binance Futures)
    const sym = state.currentSymbol || 'BTCUSDT';
    if (sym === 'BTCUSDT')  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (sym === 'ETHUSDT')  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (sym === 'BCHUSDT')  return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    if (sym === 'BNBUSDT')  return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    if (sym === 'UNIUSDT')  return val.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    // Fallback genérico
    if (val >= 10000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 100)   return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    if (val >= 1)     return val.toFixed(4);
    return val.toFixed(5);
  }

  function formatLegendHTML(leg, c) {
    const isUp = c.close >= c.open;
    const pColor = isUp ? '#0ecb81' : '#f6465d';
    const diff = c.close - c.open;
    const pct = c.open > 0 ? ((diff / c.open) * 100).toFixed(2) : '0.00';
    const sign = diff >= 0 ? '+' : '';

    const baseLower = (state.baseAsset || 'btc').toLowerCase();
    const iconImg = `<img src="assets/icons/${baseLower}.png" style="width:16px;height:16px;border-radius:50%;vertical-align:middle;margin-right:6px;box-shadow:0 0 4px rgba(0,0,0,0.4);" alt="${state.baseAsset}" onerror="this.style.display='none'">`;

    // Volume Real 72h
    const status72h = c.isAccum
      ? '<span style="color:#0ecb81;font-weight:700;">🟢 EMPIRE (72h) ACÚMULO</span>'
      : '<span style="color:#f6465d;font-weight:700;">🔴 EMPIRE (72h) DISTRIBUIÇÃO</span>';
    const net72Text = formatVolume(c.netAccum72h, state.baseAsset);
    const p72hVal = c.isAccum ? c.vwapBuy : c.vwapSell;
    const p72hStr = (state.empireTagsVisible && p72hVal) ? ` · $${formatPrice(p72hVal)}` : '';

    // Volume Real 8h (Intraday)
    const status8h = c.isIntraAccum
      ? '<span style="color:#38b6ff;font-weight:700;">🔷 EMPIRE (8h) ACÚMULO</span>'
      : '<span style="color:#ff7043;font-weight:700;">🔶 EMPIRE (8h) DISTRIBUIÇÃO</span>';
    const net8Text = formatVolume(c.netAccum8h, state.baseAsset);
    const p8hVal = c.isIntraAccum ? c.intraBuy : c.intraSell;
    const p8hStr = (state.empireTagsVisible && p8hVal) ? ` · $${formatPrice(p8hVal)}` : '';

    const mmaShortVal = c.mmaShort ? formatPrice(c.mmaShort) : '--';
    const mmaLongVal  = c.mmaLong  ? formatPrice(c.mmaLong)  : '--';

    leg.innerHTML = `
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:14px;font-size:11px;">
        <div style="display:flex;align-items:center;">
          ${iconImg}
          <strong style="color:var(--tac-text-primary);">${state.currentSymbol}</strong>
          <span style="color:${pColor};font-weight:700;margin-left:4px;">$${formatPrice(c.close)}</span>
          <span style="color:${pColor};font-size:10px;margin-left:2px;">(${sign}${pct}%)</span>
        </div>
        <div>
          O: <span style="color:var(--tac-text-primary);">${formatPrice(c.open)}</span>
          H: <span style="color:var(--tac-text-primary);">${formatPrice(c.high)}</span>
          L: <span style="color:var(--tac-text-primary);">${formatPrice(c.low)}</span>
        </div>
        <div style="border-left:1px solid #2b313a;padding-left:10px;">
          ${status72h} <span style="color:${c.isAccum ? '#0ecb81' : '#f6465d'};font-weight:600;">[${net72Text}${p72hStr}]</span>
        </div>
        <div style="border-left:1px solid #2b313a;padding-left:10px;">
          ${status8h} <span style="color:${c.isIntraAccum ? '#38b6ff' : '#ff7043'};font-weight:600;">[${net8Text}${p8hStr}]</span>
        </div>
        <div style="border-left:1px solid #2b313a;padding-left:10px;">
          <span style="color:#f0b90b;">${state.meta.shortLabel}: ${mmaShortVal}</span> &bull; 
          <span style="color:#ffffff;font-weight:600;">${state.meta.longLabel}: ${mmaLongVal}</span>
        </div>
        <div style="border-left:1px solid #2b313a;padding-left:10px;">
          <span style="color:#848e9c;">⏳ Vela ${state.currentTimeframe}:</span> 
          <span id="tac-legend-timer" style="color:#f0b90b;font-family:monospace;font-weight:700;">--:--</span>
        </div>
      </div>
    `;
    updateCandleCountdown();
  }

  /* ─────────────────────────────────────────────────────────────
     6. HUD INFERIOR — TERMÔMETRO INSTITUCIONAL DESCOMPLICADO (LINGUAGEM CLARA)
  ───────────────────────────────────────────────────────────── */
  function updateHUD() {
    // ─── 1. ÍNDICES DE MERCADO (TOP 10 GERAL + MEU ÍNDICE PESSOAL) ───
    const t10ValEl = document.getElementById('tac-top10-val');
    const t10ChgEl = document.getElementById('tac-top10-change');
    const t10StEl  = document.getElementById('tac-top10-status');
    if (state.personalBasket && state.personalBasket.top10) {
      const t10 = state.personalBasket.top10;
      if (t10ValEl && t10.val !== null && t10.val !== undefined) {
        t10ValEl.textContent = t10.val.toFixed(2);
      }
      if (t10ChgEl && t10.changePct !== undefined) {
        const sign = t10.changePct > 0 ? '+' : '';
        const color = t10.changePct > 0 ? '#0ecb81' : (t10.changePct < 0 ? '#f6465d' : '#848e9c');
        t10ChgEl.innerHTML = `<span style="color:${color};">${sign}${t10.changePct.toFixed(2)}%</span>`;
      }
      if (t10StEl && t10.statusText) {
        const color = t10.status === 'bull' ? '#0ecb81' : (t10.status === 'bear' ? '#f6465d' : '#eaecef');
        t10StEl.innerHTML = `<span style="color:${color};">${t10.statusText}</span>`;
      }
    }

    // ─── 2. ORÁCULO QUANTITATIVO: PROBABILIDADE SINTÉTICA + PAR RECOMENDADO ───
    const probPctEl   = document.getElementById('tac-oracle-prob-pct');
    const probBadgeEl = document.getElementById('tac-oracle-badge');
    const probBarEl   = document.getElementById('tac-oracle-bar-fill');
    const probNeedleEl= document.getElementById('tac-oracle-bar-needle');

    if (state.personalBasket && state.personalBasket.oracle) {
      const o = state.personalBasket.oracle;
      const dirScore = (o.pct !== undefined) ? o.pct : ((o.score - 50) * 2);

      if (probPctEl) {
        probPctEl.textContent = `${dirScore > 0 ? '+' : ''}${dirScore}%`;
        probPctEl.style.color = o.color || (dirScore > 0 ? '#0ecb81' : (dirScore < 0 ? '#f6465d' : '#eaecef'));
      }
      if (probBadgeEl) {
        probBadgeEl.textContent = o.verdict || 'NEUTRO';
        probBadgeEl.className = 'tac-oracle-badge ' + (o.badgeClass || 'badge-neutral');
      }

      // Barra Bidirecional (-100% a +100%)
      if (probBarEl && probNeedleEl) {
        const halfWidth = Math.abs(dirScore) / 2;
        if (dirScore >= 0) {
          probBarEl.style.left  = '50%';
          probBarEl.style.width = `${halfWidth}%`;
        } else {
          probBarEl.style.left  = `${50 - halfWidth}%`;
          probBarEl.style.width = `${halfWidth}%`;
        }
        const needlePos = 50 + (dirScore / 2);
        probNeedleEl.style.left = `${needlePos}%`;

        // Gradiente da barra
        if (dirScore >= 36) {
          probBarEl.style.background = 'linear-gradient(90deg, #107048, #0ecb81)';
        } else if (dirScore >= 12) {
          probBarEl.style.background = 'linear-gradient(90deg, #1f6448, #2ebd85)';
        } else if (dirScore <= -36) {
          probBarEl.style.background = 'linear-gradient(270deg, #f6465d, #b32638)';
        } else if (dirScore <= -12) {
          probBarEl.style.background = 'linear-gradient(270deg, #e05365, #882230)';
        } else {
          probBarEl.style.background = 'rgba(132, 142, 156, 0.4)';
        }
      }

      // Par Recomendado (Rigorosamente calculado pelo backend)
      const bp = o.bestPair;
      const symEl    = document.getElementById('tac-oracle-lead-symbol');
      const setupEl  = document.getElementById('tac-oracle-lead-setup');
      const metricsEl= document.getElementById('tac-oracle-lead-metrics');
      const actionEl = document.getElementById('tac-oracle-lead-action');

      if (bp && symEl) {
        // bp.symbol é nome curto ("BTC", "ETH"...)
        symEl.textContent = `${bp.symbol} / USDT`;
        // Infere direção do par a partir da setupName (contém LONG ou SHORT implicitamente)
        const isBull = bp.setupName && (bp.setupName.includes('ALTA') || bp.setupName.includes('Long') || bp.setupName.includes('LONG'));
        if (setupEl) {
          setupEl.textContent = bp.setupName || 'Sem setup ativo';
          if (bp.isWaitingSetup) {
            setupEl.className = 'tac-lead-setup-badge badge-neutral';
            setupEl.style.cssText = 'background:rgba(240,185,11,0.15);color:#f0b90b;border:1px solid rgba(240,185,11,0.3);';
          } else if (isBull) {
            setupEl.className = 'tac-lead-setup-badge badge-bull';
            setupEl.style.cssText = '';
          } else {
            setupEl.className = 'tac-lead-setup-badge badge-bear';
            setupEl.style.cssText = '';
          }
        }
        if (metricsEl) {
          const volSignFut = (bp.futBonus || 0) >= 0 ? '+' : '';
          const volSignSpot = (bp.spotBonus || 0) >= 0 ? '+' : '';
          const volColorF = (bp.futBonus || 0) >= 0 ? '#0ecb81' : ((bp.futBonus || 0) < -40 ? '#f6465d' : '#848e9c');
          const volColorS = (bp.spotBonus || 0) >= 0 ? '#0ecb81' : ((bp.spotBonus || 0) < -40 ? '#f6465d' : '#848e9c');
          const distPct = bp.distMma32Pct || 0;
          const distColor = Math.abs(distPct) <= 0.85 ? '#0ecb81' : (Math.abs(distPct) > 2 ? '#f6465d' : '#38bdf8');

          metricsEl.innerHTML = `
            Distância MMA 32: <span style="color:${distColor};font-weight:700;">${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}%</span> · 
            Vol. Spot: <span style="color:${volColorS};font-weight:700;">${volSignSpot}${bp.spotBonus || 0}%</span> · 
            Vol. Futuros: <span style="color:${volColorF};font-weight:700;">${volSignFut}${bp.futBonus || 0}%</span> · 
            Stop Técnico (MMA 80): <span style="color:#eaecef;font-weight:700;">${bp.stopLossPrice || '--'}</span>
          `;
        }
        if (actionEl) {
          actionEl.textContent = bp.actionMsg || '';
        }
      }

      // Atualiza os pilares institucionais dentro do popover informativo
      if (o.pillars) {
        const setPillar = (id, val) => {
          const el = document.querySelector(`#${id} .tac-pillar-val`);
          if (el && val) el.textContent = val;
        };
        setPillar('tac-pillar-empire', o.pillars.empire);
        setPillar('tac-pillar-whales', o.pillars.whales);
        setPillar('tac-pillar-taker', o.pillars.taker);
        setPillar('tac-pillar-basket', o.pillars.basket);
        setPillar('tac-pillar-leverage', o.pillars.leverage);
        setPillar('tac-pillar-sentiment', o.pillars.sentiment);
      }
    }

    // ─── 3. DINHEIRO DOS TUBARÕES / INSTITUCIONAL (OPEN INTEREST) ───
    const oiValEl = document.getElementById('tac-oi-val');
    const oiDeltaEl = document.getElementById('tac-oi-delta-desc');
    if (oiValEl && state.oi) {
      const oiUsd = state.oi.openInterestUsd || 0;
      let usdStr = '$0';
      if (oiUsd >= 1e9) usdStr = '$' + (oiUsd / 1e9).toFixed(2) + ' B';
      else if (oiUsd >= 1e6) usdStr = '$' + (oiUsd / 1e6).toFixed(1) + ' M';
      else usdStr = '$' + Math.round(oiUsd).toLocaleString();

      oiValEl.innerHTML = `<span>${usdStr}</span> <span style="font-size:10px;color:var(--tac-text-muted);font-weight:500;">em jogo</span>`;

      if (oiDeltaEl) {
        const deltaUsd = state.oi.deltaOiUsd || 0;
        let deltaFmt = '';
        if (Math.abs(deltaUsd) >= 1e6) deltaFmt = '$' + (Math.abs(deltaUsd) / 1e6).toFixed(2) + 'M';
        else if (Math.abs(deltaUsd) >= 1e3) deltaFmt = '$' + (Math.abs(deltaUsd) / 1e3).toFixed(1) + 'K';
        else deltaFmt = '$' + Math.round(Math.abs(deltaUsd));

        // Preço atual subindo ou caindo no candle?
        const lastC = state.candles.length ? state.candles[state.candles.length - 1] : null;
        const isPriceFalling = lastC ? (lastC.close < lastC.open) : false;

        if (deltaUsd > 0) {
          if (isPriceFalling) {
            oiDeltaEl.innerHTML = `<span style="color:#f6465d;">▲ +${deltaFmt} entrando (Venda pesada)</span>`;
          } else {
            oiDeltaEl.innerHTML = `<span style="color:#0ecb81;">▲ +${deltaFmt} entrando (Compra com força)</span>`;
          }
        } else if (deltaUsd < 0) {
          if (isPriceFalling) {
            oiDeltaEl.innerHTML = `<span style="color:#0ecb81;">▼ -${deltaFmt} saindo (Sardinhas estopadas / Repique)</span>`;
          } else {
            oiDeltaEl.innerHTML = `<span style="color:#f6465d;">▼ -${deltaFmt} saindo (Subida oca / Short squeeze)</span>`;
          }
        } else {
          oiDeltaEl.innerHTML = `<span style="color:#848e9c;">• Volume em posição estável</span>`;
        }
      }
    }

    // ─── 4. ONDE ESTÁ A MANADA? (SARDINHAS LONG/SHORT) ───
    const lsLongEl   = document.getElementById('tac-ls-long');
    const lsShortEl  = document.getElementById('tac-ls-short');
    const lsLongText = document.getElementById('tac-ls-long-text');
    const lsShortText= document.getElementById('tac-ls-short-text');
    const lsTrapEl   = document.getElementById('tac-ls-trap-desc');
    if (lsLongEl && lsShortEl && state.oi) {
      const l = state.oi.longPct || 50;
      const s = state.oi.shortPct || 50;
      lsLongEl.style.width  = l + '%';
      lsShortEl.style.width = s + '%';
      if (lsLongText) lsLongText.textContent = `${l}% Apostando Alta`;
      if (lsShortText) lsShortText.textContent = `${s}% Apostando Baixa`;

      if (lsTrapEl) {
        const fr = (state.oi.fundingRate || 0) * 100;
        let frTag = '';
        if (fr > 0.02) frTag = ' <span style="color:#f0b90b;">(🔥 Taxa cara)</span>';
        else if (fr < -0.01) frTag = ' <span style="color:#38b6ff;">(❄️ Taxa negativa)</span>';

        if (l >= 62) {
          lsTrapEl.innerHTML = `<span style="color:#f6465d;">⚠️ Manada comprada! Cuidado com despejo.${frTag}</span>`;
        } else if (s >= 62) {
          lsTrapEl.innerHTML = `<span style="color:#0ecb81;">🔥 Pânico! Sardinhas vendendo no fundo.${frTag}</span>`;
        } else {
          lsTrapEl.innerHTML = `<span style="color:#848e9c;">⚖️ Manada dividida meio a meio.${frTag}</span>`;
        }
      }
    }

    // ─── 5. QUEM ESTÁ AGREDINDO AGORA? (TAKER 5M) ───
    const tkLongEl   = document.getElementById('tac-taker-long');
    const tkShortEl  = document.getElementById('tac-taker-short');
    const tkBuyText  = document.getElementById('tac-taker-buy-text');
    const tkSellText = document.getElementById('tac-taker-sell-text');
    const tkDescEl   = document.getElementById('tac-taker-desc');
    if (tkLongEl && tkShortEl && state.oi) {
      const b = state.oi.takerBuyPct || 50;
      const s = state.oi.takerSellPct || 50;
      tkLongEl.style.width  = b + '%';
      tkShortEl.style.width = s + '%';
      if (tkBuyText) tkBuyText.textContent = `Compradores ${b}%`;
      if (tkSellText) tkSellText.textContent = `Vendedores ${s}%`;

      if (tkDescEl) {
        if (s >= 56) {
          tkDescEl.innerHTML = '<span style="color:#f6465d;">🔴 Vendedores agredindo mais forte</span>';
        } else if (b >= 56) {
          tkDescEl.innerHTML = '<span style="color:#0ecb81;">🟢 Compradores engolindo a mercado</span>';
        } else {
          tkDescEl.innerHTML = '<span style="color:#848e9c;">⚖️ Agressão momentânea equilibrada</span>';
        }
      }
    }

    // ─── 6. GAUGES EM CANVAS: TOP 10 + MEU ÍNDICE PESSOAL + O FLUXO INSTITUCIONAL ───
    drawTop10Gauge();
    drawBasketGauge();
    drawTruckGauge();
  }

  /* ─────────────────────────────────────────────────────────────
     6a. ÍNDICE TOP 10 (MARÉ GERAL vs MMA 80) - NO BLOCO 1
  ───────────────────────────────────────────────────────────── */
  function drawTop10Gauge() {
    const canvas = document.getElementById('tac-top10-canvas');
    if (!canvas) return;

    const t10 = (state.personalBasket && state.personalBasket.top10) || {};
    let diff = (typeof t10.diffMma80 === 'number') ? t10.diffMma80 : 0;
    if (diff === 0 && t10.val && t10.sma80) {
      diff = ((t10.val - t10.sma80) / t10.sma80) * 100;
    }

    const dpr  = window.devicePixelRatio || 1;
    const w    = canvas.clientWidth || 230;
    const h    = 34;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx       = w / 2.0; // Marco Zero no centro exato (MMA 80)
    const barTop   = 16;
    const barH     = 8;
    const maxScale = 4.0;
    const clamped  = Math.max(-maxScale, Math.min(maxScale, diff));
    const barLen   = (clamped / maxScale) * (w / 2.0);
    const tipX     = cx + barLen;

    // Ticks graduados
    for (let val = -4; val <= 4; val++) {
      const tickX   = cx + (val / maxScale) * (w / 2.0);
      const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
      ctx.fillStyle = val === 0 ? '#eaecef' : isMajor ? '#4a5568' : '#283245';
      ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);
    }

    // Barra preenchida a partir do centro
    if (barLen > 0) {
      ctx.fillStyle = 'rgba(14, 203, 129, 0.75)';
      ctx.fillRect(cx, barTop, barLen, barH);
      ctx.fillStyle = '#0ecb81';
      ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
    } else if (barLen < 0) {
      ctx.fillStyle = 'rgba(246, 70, 93, 0.75)';
      ctx.fillRect(cx + barLen, barTop, -barLen, barH);
      ctx.fillStyle = '#f6465d';
      ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
    }

    // Marcador central do zero (MMA 80)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

    // Rótulos na base inferior
    ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#f6465d';
    ctx.textAlign = 'left';
    ctx.fillText('-4%', 4, h - 1);

    ctx.fillStyle = '#0ecb81';
    ctx.textAlign = 'right';
    ctx.fillText('+4%', w - 4, h - 1);

    ctx.fillStyle = '#848e9c';
    ctx.textAlign = 'center';
    ctx.fillText('MMA 80', cx, h - 1);

    // Badge flutuante sobre o cursor
    const badgeValStr = (diff > 0 ? "+" : "") + diff.toFixed(2) + "%";
    const badgeColor  = diff > 0.05 ? "#0ecb81" : (diff < -0.05 ? "#f6465d" : "#848e9c");
    ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
    const textW = ctx.measureText(badgeValStr).width;
    const badgeW = Math.max(textW + 8, 44);
    const badgeH = 12;
    const badgeY = 1;
    const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

    ctx.fillStyle = '#0c1017';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
    else ctx.rect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
    ctx.fill();

    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = badgeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

    ctx.restore();
  }

  /* ─────────────────────────────────────────────────────────────
     6b. MEU ÍNDICE PESSOAL (CESTA 5 PARES) - NO BLOCO 1
  ───────────────────────────────────────────────────────────── */
  function drawBasketGauge() {
    const canvas  = document.getElementById('tac-basket-canvas');
    const labelEl = document.getElementById('tac-basket-label');
    const scoreEl = document.getElementById('tac-basket-score');
    if (!canvas) return;

    const basket = state.personalBasket || {};
    const avgDiff = typeof basket.avgDiff === 'number' ? basket.avgDiff : 0;

    if (labelEl) {
      const color = basket.statusColor || '#848e9c';
      const text = basket.statusText || `${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(2)}%`;
      labelEl.innerHTML = `<span style="color:${color};font-weight:700;">${text}</span>`;
    }

    if (scoreEl) {
      scoreEl.innerHTML = basket.scoreboard || 'Calculando cesta...';
    }

    const dpr  = window.devicePixelRatio || 1;
    const w    = canvas.clientWidth || 230;
    const h    = 34;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx       = w / 2.0; // Marco Zero no centro exato
    const barTop   = 16;
    const barH     = 8;
    const maxScale = 4.0;
    const clamped  = Math.max(-maxScale, Math.min(maxScale, avgDiff));
    const barLen   = (clamped / maxScale) * (w / 2.0);
    const tipX     = cx + barLen;

    // Ticks graduados
    for (let val = -4; val <= 4; val++) {
      const tickX   = cx + (val / maxScale) * (w / 2.0);
      const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
      ctx.fillStyle = val === 0 ? '#eaecef' : isMajor ? '#4a5568' : '#283245';
      ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);
    }

    // Barra preenchida a partir do centro
    if (barLen > 0) {
      ctx.fillStyle = 'rgba(14, 203, 129, 0.75)';
      ctx.fillRect(cx, barTop, barLen, barH);
      ctx.fillStyle = '#0ecb81';
      ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
    } else if (barLen < 0) {
      ctx.fillStyle = 'rgba(246, 70, 93, 0.75)';
      ctx.fillRect(cx + barLen, barTop, -barLen, barH);
      ctx.fillStyle = '#f6465d';
      ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
    }

    // Marcador central do zero
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

    // Rótulos na base inferior
    ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#f6465d';
    ctx.textAlign = 'left';
    ctx.fillText('-4%', 4, h - 1);

    ctx.fillStyle = '#0ecb81';
    ctx.textAlign = 'right';
    ctx.fillText('+4%', w - 4, h - 1);

    ctx.fillStyle = '#848e9c';
    ctx.textAlign = 'center';
    ctx.fillText('MMA 32', cx, h - 1);

    // ── Badge flutuante sobre o cursor (estilo da tela inicial) ──
    const badgeValStr = (avgDiff > 0 ? "+" : "") + avgDiff.toFixed(2) + "%";
    const badgeColor  = avgDiff > 0.05 ? "#0ecb81" : (avgDiff < -0.05 ? "#f6465d" : "#848e9c");
    ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
    const textW = ctx.measureText(badgeValStr).width;
    const badgeW = Math.max(textW + 8, 44);
    const badgeH = 12;
    const badgeY = 1;
    const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

    ctx.fillStyle = '#0c1017';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
    else ctx.rect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
    ctx.fill();

    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = badgeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

    ctx.restore();
  }

  /* ─────────────────────────────────────────────────────────────
     6b. O FLUXO (DINHEIRO PESADO) - NO BLOCO 5
  ───────────────────────────────────────────────────────────── */
  function drawTruckGauge() {
    const canvas  = document.getElementById('tac-truck-canvas');
    const labelEl = document.getElementById('tac-truck-label');
    if (!canvas) return;

    // Confluência com EMPIRE e Delta OI
    const lastCandle  = state.candles.length ? state.candles[state.candles.length - 1] : null;
    const isFalling   = lastCandle ? (lastCandle.close < lastCandle.open) : false;
    const isRising    = lastCandle ? (lastCandle.close > lastCandle.open) : false;
    const isEmpireBuy = lastCandle ? !!lastCandle.isAccum : false;
    const deltaUsd    = (state.oi && state.oi.deltaOiUsd) || 0;

    // Diagnóstico institucional limpo (sem a palavra caminhão)
    if (labelEl) {
      if (isFalling && isEmpireBuy) {
        labelEl.innerHTML = `<span style="color:#0ecb81;">🌊🚨 ACÚMULO FORTE: Preço caindo, mas Tubarão enchendo a mão no fundo!</span>`;
      } else if (isRising && !isEmpireBuy) {
        labelEl.innerHTML = `<span style="color:#f6465d;">🌊⚠️ DESPEJO FORTE: Preço subindo, mas tão descarregando na cabeça da manada!</span>`;
      } else if (isEmpireBuy) {
        labelEl.innerHTML = `<span style="color:#0ecb81;">🌊🟢 FLUXO INSTITUCIONAL: Tubarões acumulando a favor da alta!</span>`;
      } else {
        labelEl.innerHTML = `<span style="color:#f6465d;">🌊🔴 FLUXO INSTITUCIONAL: Tubarões desovando contratos na baixa!</span>`;
      }
    }

    // Desenha o medidor de fluxo (◄ DESPEJO | 0 | ACÚMULO ►)
    const dpr  = window.devicePixelRatio || 1;
    const w    = canvas.clientWidth || 260;
    const h    = 34;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2.0;
    const barTop = 16;
    const barH = 8;

    // Pontuação institucional do fluxo (-4% a +4%)
    let flowScore = 0;
    if (isEmpireBuy) flowScore += 2.0; else flowScore -= 2.0;
    if (deltaUsd > 0) {
      flowScore += (isFalling ? -1.5 : 1.5);
    } else if (deltaUsd < 0) {
      flowScore += (isFalling ? 1.5 : -1.5);
    }
    const maxScore = 4.0;
    const clamped = Math.max(-maxScore, Math.min(maxScore, flowScore));
    const barLen = (clamped / maxScore) * (w / 2.0);
    const tipX = cx + barLen;

    // Ticks graduados
    for (let val = -4; val <= 4; val++) {
      const tickX   = cx + (val / maxScore) * (w / 2.0);
      const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
      ctx.fillStyle = val === 0 ? '#eaecef' : isMajor ? '#4a5568' : '#283245';
      ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);
    }

    // Barra
    if (barLen > 0) {
      ctx.fillStyle = 'rgba(14, 203, 129, 0.70)';
      ctx.fillRect(cx, barTop, barLen, barH);
      ctx.fillStyle = '#0ecb81';
      ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
    } else if (barLen < 0) {
      ctx.fillStyle = 'rgba(246, 70, 93, 0.70)';
      ctx.fillRect(cx + barLen, barTop, -barLen, barH);
      ctx.fillStyle = '#f6465d';
      ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
    }

    // Marcador central do zero
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

    // Rótulos nas pontas
    ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#f6465d';
    ctx.textAlign = 'left';
    ctx.fillText('◄ DESPEJO', 6, h - 1);

    ctx.fillStyle = '#0ecb81';
    ctx.textAlign = 'right';
    ctx.fillText('ACÚMULO ►', w - 6, h - 1);

    ctx.fillStyle = '#848e9c';
    ctx.textAlign = 'center';
    ctx.fillText('0 (NEUTRO)', cx, h - 1);

    // ── Badge flutuante sobre o cursor (estilo da tela inicial) ──
    const flowPct = clamped;
    const badgeValStr = (flowPct > 0 ? "+" : "") + flowPct.toFixed(2) + "%";
    const badgeColor  = flowPct > 0.05 ? "#0ecb81" : (flowPct < -0.05 ? "#f6465d" : "#848e9c");
    ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
    const textW = ctx.measureText(badgeValStr).width;
    const badgeW = Math.max(textW + 8, 44);
    const badgeH = 12;
    const badgeY = 1;
    const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

    ctx.fillStyle = '#0c1017';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
    else ctx.rect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
    ctx.fill();

    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = badgeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

    ctx.restore();
  }

  // ─── Busca em tempo real do Índice Pessoal da Cesta e do Oráculo ─────────────
  // Faz um warm-up do indexCache antes da primeira leitura, caso a página Painel
  // ainda não tenha sido aberta nessa sessão (garantia de top10 real já no primeiro tick).
  let _indexWarmDone = false;
  async function _warmIndexCache() {
    if (_indexWarmDone) return;
    _indexWarmDone = true;
    try { await fetch('/api/crypto-index?interval=15m'); } catch (_) {}
  }

  let isFetchingIndex = false;
  async function fetchPersonalIndexLive() {
    if (isFetchingIndex) return;
    isFetchingIndex = true;
    try {
      await _warmIndexCache();
      const res = await fetch('/api/personal-index');
      if (!res.ok) return;
      const data = await res.json();
      state.personalBasket = data;
      updateHUD();
    } catch (_) {
    } finally {
      isFetchingIndex = false;
    }
  }

  // ─── Atualização em tempo real de Derivativos (OI, Long/Short, Taker) ────────
  // Utiliza o endpoint leve dedicado (/api/tactical-oi), economizando 99% de banda e CPU
  let isFetchingOi = false;
  async function fetchOiLive() {
    if (isFetchingOi) return;
    isFetchingOi = true;
    try {
      const res = await fetch(`/api/tactical-oi?symbol=${state.currentSymbol}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.oi) {
        state.oi = data.oi;
        updateHUD();
      }
    } catch (_) {
    } finally {
      isFetchingOi = false;
    }
  }



  function updateOracleHUD() {
    if (!state.isHovering) {
      renderDefaultLegend();
      updateHUD();
    }
  }

  /* ─────────────────────────────────────────────────────────────
     7. WEBSOCKET EM TEMPO REAL — FUTUROS BINANCE MULTI-PAR
  ───────────────────────────────────────────────────────────── */
  let wsActiveStreamKey = '';

  function openWebSocket(force = false) {
    const symbolLower = state.currentSymbol.toLowerCase();
    const targetStreamKey = `${symbolLower}@kline_${state.currentTimeframe}`;

    // Se já estiver conectado no mesmo par e timeframe e a conexão estiver aberta, não reconecta
    if (!force && state.ws && state.ws.readyState === WebSocket.OPEN && wsActiveStreamKey === targetStreamKey) {
      return;
    }

    if (state.ws) {
      try {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
      } catch (e) {}
      state.ws = null;
    }

    wsActiveStreamKey = targetStreamKey;
    const liveDot = document.getElementById('tac-live-dot');
    const activeSym = state.currentSymbol;
    const wsUrl = `wss://fstream.binance.com/ws/${targetStreamKey}`;
    
    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        if (state.currentSymbol !== activeSym) return;
        if (liveDot) {
          liveDot.innerHTML = '&#9679; AO VIVO';
          liveDot.style.color = '#0ecb81';
        }
      };

      state.ws.onmessage = (evt) => {
        try {
          if (state.currentSymbol !== activeSym) return;
          const msg = JSON.parse(evt.data);
          if (!msg.k) return;
          const k = msg.k;

          lastPriceUpdateTimestamp = Date.now();

          const updatedCandle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            buyV: parseFloat(k.V),
            sellV: parseFloat(k.v) - parseFloat(k.V)
          };

          if (state.series.candles) {
            try {
              state.series.candles.update({
                time: updatedCandle.time,
                open: updatedCandle.open,
                high: updatedCandle.high,
                low: updatedCandle.low,
                close: updatedCandle.close
              });
            } catch (err) {
              console.warn('[BTC Tactical] candle update err:', err);
            }
          }

          // Atualiza candle no array de estado
          if (state.candles.length) {
            const last = state.candles[state.candles.length - 1];
            if (last.time === updatedCandle.time) {
              last.open = updatedCandle.open;
              last.high = updatedCandle.high;
              last.low = updatedCandle.low;
              last.close = updatedCandle.close;
              last.volume = updatedCandle.volume;
              last.buyV = updatedCandle.buyV;
              last.sellV = updatedCandle.sellV;
            } else if (updatedCandle.time > last.time) {
              // Nova barra aberta na Binance: insere imediatamente no estado e atualiza a tela
              state.candles.push({
                ...updatedCandle,
                mmaShort: last.mmaShort,
                mmaLong: last.mmaLong,
                vwapBuy: last.vwapBuy,
                vwapSell: last.vwapSell,
                intraBuy: last.intraBuy,
                intraSell: last.intraSell,
                isAccum: last.isAccum,
                isIntraAccum: last.isIntraAccum,
                netAccum72h: last.netAccum72h,
                netAccum8h: last.netAccum8h
              });
              if (state.series.candles) {
                try {
                  state.series.candles.update({
                    time: updatedCandle.time,
                    open: updatedCandle.open,
                    high: updatedCandle.high,
                    low: updatedCandle.low,
                    close: updatedCandle.close
                  });
                } catch (_) {}
              }
              // Sincroniza indicadores em segundo plano após 1.5s sem travar a conexão ao vivo
              clearTimeout(window._tacCandleTurnTimer);
              window._tacCandleTurnTimer = setTimeout(() => {
                fetchAndRender();
              }, 1500);
              return;
            }
          }

          if (!state.isHovering) {
            renderDefaultLegend();
            renderVolumeCanvas();
            renderEmpireZones();
          }

          // Verifica se o preço atingiu o alvo 2.618 do Fibonacci
          checkFiboAlert(updatedCandle.close);

          // Sincroniza cotação em tempo real com o mini painel de ordens
          if (window.OrderPanel) {
            window.OrderPanel.setMarketContext(state.currentSymbol, updatedCandle.close);
          }

          // Sincroniza o Card 5 (O Fluxo - Dinheiro Pesado) em tempo real conforme o candle oscila
          drawTruckGauge();
        } catch (e) {
          console.warn('[BTC Tactical] WS parse error:', e);
        }
      };

      state.ws.onerror = (err) => {
        console.warn('[BTC Tactical] WS error:', err);
        if (liveDot) {
          liveDot.innerHTML = '&#9675; RECONECTANDO';
          liveDot.style.color = '#f0b90b';
        }
      };

      state.ws.onclose = () => {
        if (liveDot) {
          liveDot.innerHTML = '&#9675; DESCONECTADO';
          liveDot.style.color = '#848e9c';
        }
        // Reconexão automática após 2s
        clearTimeout(wsReconnectTimeout);
        wsReconnectTimeout = setTimeout(() => {
          if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
            openWebSocket(true);
          }
        }, 2000);
      };
    } catch (e) {
      console.warn('[BTC Tactical] WS error:', e);
    }
  }

  // ─── SINCRONIZADOR DE PREÇO EM TEMPO REAL (FALLBACK CONTÍNUO) ───
  // Se o WebSocket ficar sem mensagens por mais de 3.5s, busca candles recentes para nunca congelar nem perder virada de barra
  async function syncLivePriceFallback() {
    const elapsed = Date.now() - lastPriceUpdateTimestamp;
    if (elapsed < 3500) return;

    // Se passou mais de 6 segundos sem nenhum dado do WebSocket, força reconexão imediata
    if (elapsed > 6000) {
      console.warn('[BTC Tactical] WebSocket inativo por >6s. Forçando reconexão...');
      openWebSocket(true);
    }

    try {
      // Busca os últimos 2 candles na Binance Futures para garantir sincronia exata de abertura e fechamento
      const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${state.currentSymbol}&interval=${state.currentTimeframe}&limit=2`);
      if (!res.ok) return;
      const klines = await res.json();
      if (!Array.isArray(klines) || !klines.length) return;

      const latestK = klines[klines.length - 1];
      const kTime = Math.floor(latestK[0] / 1000);
      const kOpen = parseFloat(latestK[1]);
      const kHigh = parseFloat(latestK[2]);
      const kLow  = parseFloat(latestK[3]);
      const kClose= parseFloat(latestK[4]);
      const kVol  = parseFloat(latestK[5]);
      const kBuyV = parseFloat(latestK[9]) || (kVol * 0.5);
      const kSellV= Math.max(0, kVol - kBuyV);

      if (!kClose || isNaN(kClose)) return;
      lastPriceUpdateTimestamp = Date.now();

      if (state.candles.length) {
        const last = state.candles[state.candles.length - 1];

        if (kTime === last.time) {
          last.high = Math.max(last.high, kHigh);
          last.low  = Math.min(last.low, kLow);
          last.close= kClose;
          last.volume = kVol;
          last.buyV   = kBuyV;
          last.sellV  = kSellV;
        } else if (kTime > last.time) {
          // A barra virou! Insere a nova barra imediatamente
          state.candles.push({
            time: kTime,
            open: kOpen,
            high: kHigh,
            low: kLow,
            close: kClose,
            volume: kVol,
            buyV: kBuyV,
            sellV: kSellV,
            mmaShort: last.mmaShort,
            mmaLong: last.mmaLong,
            vwapBuy: last.vwapBuy,
            vwapSell: last.vwapSell,
            intraBuy: last.intraBuy,
            intraSell: last.intraSell,
            isAccum: last.isAccum,
            isIntraAccum: last.isIntraAccum,
            netAccum72h: last.netAccum72h,
            netAccum8h: last.netAccum8h
          });
          setTimeout(fetchAndRender, 1000);
        }

        const activeCandle = state.candles[state.candles.length - 1];
        if (state.series.candles) {
          try {
            state.series.candles.update({
              time: activeCandle.time,
              open: activeCandle.open,
              high: activeCandle.high,
              low: activeCandle.low,
              close: activeCandle.close
            });
          } catch (e) {}
        }

        if (!state.isHovering) {
          renderDefaultLegend();
        }

        // Verifica se o preço atingiu o alvo 2.618 do Fibonacci
        checkFiboAlert(kClose);

        if (window.OrderPanel) {
          window.OrderPanel.setMarketContext(state.currentSymbol, kClose);
        }
      }
    } catch (_) {}
  }

  /* ─────────────────────────────────────────────────────────────
     8. AÇÕES DE INTERFACE: SELETOR DE PARES, TIMEFRAME E MÉDIAS
  ───────────────────────────────────────────────────────────── */
  function setPair(symbol) {
    if (state.currentSymbol === symbol) return;
    state.currentSymbol = symbol;
    try { localStorage.setItem('capich_tac_symbol', symbol); } catch (_) {}

    // Fecha o WebSocket do par anterior imediatamente para não receber candles de escala diferente
    if (state.ws) {
      try {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
      } catch (_) {}
      state.ws = null;
    }

    const liveDot = document.getElementById('tac-live-dot');
    if (liveDot) {
      liveDot.innerHTML = '&#9679; CARREGANDO...';
      liveDot.style.color = '#f0b90b';
    }

    // Carrega os Fibonaccis específicos do novo par selecionado e silencia alertas do par anterior
    loadFiboForSymbol(symbol);

    if (window.OrderPanel) {
      window.OrderPanel.setMarketContext(symbol, 0);
    }

    PAIRS.forEach(p => {
      const btn = document.getElementById(`tac-pair-${p.symbol}`);
      if (btn) {
        if (p.symbol === symbol) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });

    fetchAndRender();
  }

  function setTimeframe(tf) {
    if (state.currentTimeframe === tf) return;
    state.currentTimeframe = tf;
    try { localStorage.setItem('capich_tac_tf', tf); } catch (_) {}

    if (state.ws) {
      try {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
      } catch (_) {}
      state.ws = null;
    }

    const liveDot = document.getElementById('tac-live-dot');
    if (liveDot) {
      liveDot.innerHTML = '&#9679; CARREGANDO...';
      liveDot.style.color = '#f0b90b';
    }

    const btn15 = document.getElementById('tac-tf-15m');
    const btn1h = document.getElementById('tac-tf-1h');
    if (tf === '15m') {
      if (btn15) btn15.classList.add('active');
      if (btn1h) btn1h.classList.remove('active');
    } else {
      if (btn1h) btn1h.classList.add('active');
      if (btn15) btn15.classList.remove('active');
    }

    const timerBadge = document.getElementById('tac-candle-timer');
    if (timerBadge) {
      timerBadge.title = `Tempo restante para o fechamento do candle de ${tf}`;
    }
    updateCandleCountdown();

    fetchAndRender();
  }

  /* ─────────────────────────────────────────────────────────────
     CRONÔMETRO DE FECHAMENTO DO CANDLE (15m / 1h)
  ───────────────────────────────────────────────────────────── */
  function updateCandleCountdown() {
    const timerBadge = document.getElementById('tac-candle-timer');
    const timerVal = document.getElementById('tac-timer-val');
    const legendTimer = document.getElementById('tac-legend-timer');

    const tf = state.currentTimeframe || '15m';
    const now = Date.now();
    const intervalMs = (tf === '1h') ? (60 * 60 * 1000) : (15 * 60 * 1000);
    const nextClose = (Math.floor(now / intervalMs) + 1) * intervalMs;
    const diffSec = Math.max(0, Math.floor((nextClose - now) / 1000));

    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    if (timerVal) timerVal.textContent = timeStr;
    if (legendTimer) legendTimer.textContent = timeStr;

    if (timerBadge) {
      if (diffSec <= 30) {
        timerBadge.classList.add('closing-soon');
      } else {
        timerBadge.classList.remove('closing-soon');
      }
    }
  }

  function toggleMovingAverages() {
    state.maVisible = !state.maVisible;
    try { localStorage.setItem('capich_tac_ma', String(state.maVisible)); } catch (_) {}
    const btn = document.getElementById('tac-btn-ma');
    if (btn) {
      if (state.maVisible) {
        btn.classList.add('active');
        btn.textContent = 'Médias: ON';
      } else {
        btn.classList.remove('active');
        btn.textContent = 'Médias: OFF';
      }
    }

    if (state.series.mmaShort) {
      state.series.mmaShort.applyOptions({ visible: state.maVisible });
    }
    if (state.series.mmaLong) {
      state.series.mmaLong.applyOptions({ visible: state.maVisible });
    }
  }

  function toggleIndicators() {
    state.indicatorsVisible = !state.indicatorsVisible;
    try { localStorage.setItem('capich_tac_ind', String(state.indicatorsVisible)); } catch (_) {}
    const btn = document.getElementById('tac-btn-ind');
    if (btn) {
      if (state.indicatorsVisible) {
        btn.classList.add('active');
        btn.textContent = 'Indicadores: ON';
      } else {
        btn.classList.remove('active');
        btn.textContent = 'Indicadores: OFF';
      }
    }

    if (state.series.vwapBuy) {
      state.series.vwapBuy.applyOptions({ visible: state.indicatorsVisible });
    }
    if (state.series.vwapSell) {
      state.series.vwapSell.applyOptions({ visible: state.indicatorsVisible });
    }
    if (state.series.intraBuy) {
      state.series.intraBuy.applyOptions({ visible: state.indicatorsVisible });
    }
    if (state.series.intraSell) {
      state.series.intraSell.applyOptions({ visible: state.indicatorsVisible });
    }
    renderEmpireZones();
  }

  function toggleEmpireZones() {
    state.zonesVisible = !state.zonesVisible;
    try { localStorage.setItem('capich_tac_zones', String(state.zonesVisible)); } catch (_) {}
    const btn = document.getElementById('tac-btn-zones');
    if (btn) {
      if (state.zonesVisible) {
        btn.classList.add('active');
        btn.textContent = 'Nuvens: ON';
      } else {
        btn.classList.remove('active');
        btn.textContent = 'Nuvens: OFF';
      }
    }
    renderEmpireZones();
  }

  function toggleEmpireTags() {
    state.empireTagsVisible = !state.empireTagsVisible;
    try { localStorage.setItem('capich_tac_tags', String(state.empireTagsVisible)); } catch (_) {}
    const btn = document.getElementById('tac-btn-tags');
    if (btn) {
      if (state.empireTagsVisible) {
        btn.classList.add('active');
        btn.textContent = 'Tags: ON';
      } else {
        btn.classList.remove('active');
        btn.textContent = 'Tags: OFF';
      }
    }

    const titleStr = state.empireTagsVisible ? 'EMPIRE' : '';
    const opt = {
      lastValueVisible: state.empireTagsVisible,
      title: titleStr
    };

    if (state.series.vwapBuy) state.series.vwapBuy.applyOptions(opt);
    if (state.series.vwapSell) state.series.vwapSell.applyOptions(opt);
    if (state.series.intraBuy) state.series.intraBuy.applyOptions(opt);
    if (state.series.intraSell) state.series.intraSell.applyOptions(opt);

    renderDefaultLegend();
  }

  function togglePriceLine() {
    state.priceLineVisible = !state.priceLineVisible;
    try { localStorage.setItem('capich_tac_priceline', String(state.priceLineVisible)); } catch (_) {}
    // Aplica na série de candles
    if (state.series.candles) {
      state.series.candles.applyOptions({ priceLineVisible: state.priceLineVisible });
    }
    const btn = document.getElementById('tac-btn-priceline');
    if (btn) {
      if (state.priceLineVisible) {
        btn.classList.add('active');
        btn.textContent = 'Linha: ON';
      } else {
        btn.classList.remove('active');
        btn.textContent = 'Linha: OFF';
      }
    }
  }

  function toggleFiboTool(which = 1) {
    const is2 = (which === 2);
    const targetFibo = is2 ? state.fibo2 : state.fibo;
    const otherFibo  = is2 ? state.fibo : state.fibo2;

    // Cancela o modo desenho do outro se estivesse aberto
    if (otherFibo.drawing) {
      otherFibo.drawing = false;
      updateFiboButtonUI(otherFibo.active ? 'placed' : 'idle', is2 ? 1 : 2);
    }

    // Entra no modo de traçar o Fibo selecionado
    targetFibo.active = true;
    targetFibo.drawing = true;
    targetFibo.isDragging = false;
    targetFibo.dragAnchor = null;
    targetFibo.p1 = null;
    targetFibo.p2 = null;

    if (targetFibo.alert2618) {
      targetFibo.alert2618.armed = false;
      targetFibo.alert2618.triggered = false;
      targetFibo.alert2618.soundActive = false;
      targetFibo.alert2618.approachDir = null;
      _tacStopAlert();
      _renderFiboAlertBadge(false, null);
    }

    updateFiboButtonUI('drawing', which);
    const mc = document.getElementById('tac-chart-main');
    if (mc) mc.classList.add('fibo-mode');
    renderEmpireZones();
  }

  function clearFibo(which = 1) {
    const is2 = (which === 2);
    const targetFibo = is2 ? state.fibo2 : state.fibo;
    const storageKey = getFiboStorageKey(which, state.currentSymbol);

    targetFibo.active = false;
    targetFibo.drawing = false;
    targetFibo.isDragging = false;
    targetFibo.dragAnchor = null;
    targetFibo.p1 = null;
    targetFibo.p2 = null;

    if (targetFibo.alert2618) {
      targetFibo.alert2618.armed = false;
      targetFibo.alert2618.triggered = false;
      targetFibo.alert2618.soundActive = false;
      targetFibo.alert2618.approachDir = null;
      _tacStopAlert();
      _renderFiboAlertBadge(false, null);
    }

    try { localStorage.removeItem(storageKey); } catch (_) {}
    updateFiboButtonUI('idle', which);

    const mc = document.getElementById('tac-chart-main');
    if (mc && !state.fibo.drawing && !state.fibo2.drawing) {
      mc.classList.remove('fibo-mode');
      mc.style.cursor = '';
    }
    renderEmpireZones();
  }

  function updateFiboButtonUI(mode, which = 1) {
    const is2 = (which === 2);
    const btn = document.getElementById(is2 ? 'tac-btn-fibo2' : 'tac-btn-fibo');
    const btnClear = document.getElementById(is2 ? 'tac-btn-fibo2-clear' : 'tac-btn-fibo-clear');
    if (!btn) return;

    const baseClass = is2 ? 'tac-btn-fibo tac-btn-fibo-2' : 'tac-btn-fibo';
    const label = is2 ? '📐 Fibo 2' : '📐 Fibo 1';

    if (mode === 'drawing') {
      btn.className = `${baseClass} drawing`;
      btn.textContent = '📐 Traçando...';
      btn.title = 'Clique e arraste no gráfico do Ponto 1 ao Ponto 2';
      if (btnClear) btnClear.style.display = 'none';
    } else if (mode === 'placed') {
      btn.className = `${baseClass} active`;
      btn.textContent = label;
      btn.title = is2
        ? 'Fibo 2 ativo (Cluster Carolyn Boroden)! Arraste para ajustar ou clique no ✕ para limpar.'
        : 'Fibo 1 ativo (Principal)! Arraste para ajustar ou clique no ✕ para limpar.';
      if (btnClear) btnClear.style.display = 'inline-flex';
    } else {
      btn.className = baseClass;
      btn.textContent = label;
      btn.title = is2
        ? 'Clique para traçar Fibo 2 (Retrações de Pernada Menor / Cluster Boroden)'
        : 'Clique para traçar Fibo 1 (Principal: Retrações + Expansões até 4.0)';
      if (btnClear) btnClear.style.display = 'none';
    }
  }

})();
