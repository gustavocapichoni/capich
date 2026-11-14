/**
 * js/tactical/dom.js
 * Injeção de componentes HTML na página, grupos de botões e popovers informativos.
 */

import { PAIRS, state } from './state.js';

export function buildHTML() {
  const container = document.getElementById('btc-tactical-section');
  if (!container) return;

  const pairButtonsHtml = PAIRS.map(p => 
    `<button class="tac-pair-btn ${p.symbol === state.currentSymbol ? 'active' : ''}" id="tac-pair-${p.symbol}" onclick="window._setTacPair('${p.symbol}')">${p.label}</button>`
  ).join('');

  container.innerHTML = `
    <!-- Banner de Emergência Failsafe (Queda de Conexão com Binance/Servidor) -->
    <div id="tac-emergency-banner" class="tac-emergency-banner" style="display:none;">
      <div class="tac-emergency-banner-content">
        <span class="tac-emergency-banner-icon">⚠️</span>
        <div class="tac-emergency-banner-text">
          <strong>ALERTA DE SEGURANÇA: CONEXÃO INTERROMPIDA COM A BINANCE / SERVIDOR!</strong>
          <span>A resposta da API falhou há mais de <span id="tac-emergency-lost-seconds">8</span>s. Se possuir posições abertas, verifique imediatamente pelo app oficial da Binance no celular.</span>
        </div>
        <button type="button" class="tac-emergency-banner-close" onclick="document.getElementById('tac-emergency-banner').style.display='none'" title="Fechar aviso">&times;</button>
      </div>
    </div>

    <div class="tac-wrapper">
      <!-- Titlebar -->
      <div class="tac-titlebar">
        <div class="tac-titlebar-left">
          <div class="tac-ticker-badge" id="tac-ticker-badge">
            <span class="tac-live-indicator" id="tac-live-dot" title="Fluxo de dados em tempo real"></span>
            <span id="tac-ticker-content" style="display:inline-flex;align-items:center;gap:4px;">
              <strong style="color:var(--tac-text-primary);">${state.currentSymbol}</strong>
              <span style="color:#848e9c;font-size:10.5px;">Carregando...</span>
            </span>
          </div>

          <!-- Indicador EMPIRE (72h e 8h) no espaço ao lado do par -->
          <div class="tac-empire-header-group" id="tac-empire-header-group">
            <span id="tac-empire-72h-val" class="tac-empire-item"></span>
            <span id="tac-empire-8h-val" class="tac-empire-item" style="border-left:1px solid #2b313a;padding-left:8px;"></span>
          </div>
        </div>
        <div style="display:flex;align-items:center;flex-wrap:nowrap;gap:6px;flex-shrink:0;">
          <!-- Seletor dos 5 Pares -->
          <div class="tac-pair-group">
            ${pairButtonsHtml}
          </div>
          <!-- Timeframe -->
          <div class="tac-tf-group">
            <button class="tac-tf-btn ${state.currentTimeframe === '15m' ? 'active' : ''}" id="tac-tf-15m" onclick="window._setTacTF('15m')">15m</button>
            <button class="tac-tf-btn ${state.currentTimeframe === '1h' ? 'active' : ''}" id="tac-tf-1h" onclick="window._setTacTF('1h')">1h</button>
            <button class="tac-tf-btn ${state.currentTimeframe === '1d' ? 'active' : ''}" id="tac-tf-1d" onclick="window._setTacTF('1d')">1D</button>
          </div>
          <!-- Dropdown Indicadores -->
          <div class="tac-dropdown" id="tac-dropdown-ind">
            <button class="tac-dropdown-btn" onclick="window._toggleTacDropdown('tac-dropdown-ind')" title="Indicadores e Linhas">
              <span>Indicadores</span>
              <span class="tac-dropdown-arrow">▼</span>
            </button>
            <div class="tac-dropdown-menu">
              <!-- Recomendações Dinâmicas dentro de Indicadores -->
              <button class="tac-dropdown-item advisor-item" id="tac-btn-advisor" onclick="window._toggleTacAdvisor(); window._toggleTacDropdown('tac-dropdown-ind');" title="Abrir Guia Mestre de Leitura & Recomendações Dinâmicas">
                <span>💡 Recomendações</span>
                <span class="tac-dropdown-status" style="color:#f0b90b;background:rgba(240,185,11,0.2);">ABRIR</span>
              </button>
              <div style="height:1px;background:#2b313a;margin:2px 0;"></div>
              <!-- Toggle Médias -->
              <button class="tac-dropdown-item ${state.maVisible ? 'active' : ''}" id="tac-btn-ma" onclick="window._toggleTacMA()">
                <span>Médias Móveis</span>
                <span class="tac-dropdown-status">${state.maVisible ? 'ON' : 'OFF'}</span>
              </button>
              <!-- Toggle Indicadores EMPIRE 72h e 8h -->
              <button class="tac-dropdown-item ${state.empire72hVisible ? 'active' : ''}" id="tac-btn-empire-72h" onclick="window._toggleTacEmpire72h()">
                <span>Indicador Empire 72h</span>
                <span class="tac-dropdown-status">${state.empire72hVisible ? 'ON' : 'OFF'}</span>
              </button>
              <button class="tac-dropdown-item ${state.empire8hVisible ? 'active' : ''}" id="tac-btn-empire-8h" onclick="window._toggleTacEmpire8h()">
                <span>Indicador Empire 8h</span>
                <span class="tac-dropdown-status">${state.empire8hVisible ? 'ON' : 'OFF'}</span>
              </button>
              <!-- Toggle Nuvem Empire 72h e 8h -->
              <button class="tac-dropdown-item ${state.zones72hVisible ? 'active' : ''}" id="tac-btn-zones-72h" onclick="window._toggleTacZones72h()">
                <span>Nuvem Empire 72h</span>
                <span class="tac-dropdown-status">${state.zones72hVisible ? 'ON' : 'OFF'}</span>
              </button>
              <button class="tac-dropdown-item ${state.zones8hVisible ? 'active' : ''}" id="tac-btn-zones-8h" onclick="window._toggleTacZones8h()">
                <span>Nuvem Empire 8h</span>
                <span class="tac-dropdown-status">${state.zones8hVisible ? 'ON' : 'OFF'}</span>
              </button>
              <!-- Toggle Tags -->
              <button class="tac-dropdown-item ${state.empireTagsVisible ? 'active' : ''}" id="tac-btn-tags" onclick="window._toggleTacEmpireTags()" title="Tags e cotações na escala de preços">
                <span>Tags de Preço</span>
                <span class="tac-dropdown-status">${state.empireTagsVisible ? 'ON' : 'OFF'}</span>
              </button>
              <!-- Toggle Linha de Preço -->
              <button class="tac-dropdown-item ${state.priceLineVisible ? 'active' : ''}" id="tac-btn-priceline" onclick="window._toggleTacPriceLine()" title="Linha tracejada do preço atual">
                <span>Linha de Preço</span>
                <span class="tac-dropdown-status">${state.priceLineVisible ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          <!-- Dropdown Ferramentas -->
          <div class="tac-dropdown" id="tac-dropdown-tools">
            <button class="tac-dropdown-btn" onclick="window._toggleTacDropdown('tac-dropdown-tools')" title="Ferramentas Gráficas">
              <span>Ferramentas</span>
              <span class="tac-dropdown-arrow">▼</span>
            </button>
            <div class="tac-dropdown-menu align-right">
              <!-- Ferramenta Fibo 1 -->
              <div class="tac-dropdown-tool-row">
                <button class="tac-dropdown-item tac-btn-fibo" id="tac-btn-fibo" onclick="window._toggleTacFibo()" title="Fibo 1 (Principal: Retrações + Expansões + Alerta 2.618)">
                  <span>📐 Fibo 1</span>
                  <span class="tac-dropdown-status" id="tac-status-fibo1">OFF</span>
                </button>
                <button class="tac-btn-fibo-clear" id="tac-btn-fibo-clear" onclick="window._clearTacFibo()" title="Limpar Fibo 1">
                  ✕
                </button>
              </div>

              <!-- Ferramenta Fibo 2 -->
              <div class="tac-dropdown-tool-row">
                <button class="tac-dropdown-item tac-btn-fibo tac-btn-fibo-2" id="tac-btn-fibo2" onclick="window._toggleTacFibo2()" title="Fibo 2 (Retrações de Pernada Menor / Cluster Boroden)">
                  <span>📐 Fibo 2</span>
                  <span class="tac-dropdown-status" id="tac-status-fibo2">OFF</span>
                </button>
                <button class="tac-btn-fibo-clear" id="tac-btn-fibo2-clear" onclick="window._clearTacFibo2()" title="Limpar Fibo 2">
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Linha Central: Mini Painel Binance à Esquerda + Gráfico Tático à Direita -->
      <div class="tac-charts-row-with-panel">
        <div id="binance-order-panel" class="b-order-panel admin-only"></div>
        <div class="tac-charts-col-right">
          <div class="tac-charts-container">
            <div class="tac-chart-main" id="tac-chart-main">
              <canvas id="tac-zones-canvas"></canvas>
              <div id="tac-candle-tooltip" class="tac-candle-tooltip" style="display:none;"></div>
            </div>
            <div class="tac-chart-vol" id="tac-chart-vol">
              <canvas id="tac-vol-canvas"></canvas>
              <div id="tac-vol-tooltip" class="tac-vol-tooltip" style="display:none;"></div>
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

          <!-- Divisor -->
          <div class="tac-hud-divider" style="margin:6px 0 5px 0;"></div>

          <!-- Bloco 3: OI GLOBAL MULTI-EXCHANGE (BTC FUTUROS) -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:8.5px;color:var(--tac-text-muted);font-weight:600;margin-bottom:3px;">
              <span title="Open Interest Consolidado de BTC (Binance, Bybit, OKX, Bitget)">🌐 OI GLOBAL MULTI-EXCHANGE:</span>
              <span style="font-family:'JetBrains Mono',monospace;font-size:9px;">
                <span id="tac-global-oi-val" style="font-weight:700;color:#38bdf8;">$18.00 B</span>
                <span style="color:#848e9c;font-size:8px;font-weight:500;">(Consolidado)</span>
              </span>
            </div>

            <!-- Barra Bicolor Long vs Short -->
            <div class="tac-meter-track" style="height:7px;background:#2b313a;border-radius:3px;overflow:hidden;display:flex;position:relative;" title="Sentimento Consolidado Multi-Exchange (Long vs Short)">
              <div id="tac-global-oi-bar-long" style="height:100%;background:#0ecb81;width:71.7%;transition:width 0.4s ease;"></div>
              <div id="tac-global-oi-bar-short" style="height:100%;background:#f6465d;width:28.3%;transition:width 0.4s ease;"></div>
            </div>

            <!-- Legenda Inferior -->
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:8.5px;margin-top:2px;font-weight:600;font-family:'JetBrains Mono',monospace;">
              <span id="tac-global-oi-long-pct" style="color:#0ecb81;">71.7% Long</span>
              <span style="color:#848e9c;font-size:8px;font-weight:500;">4 Exchanges (BTC)</span>
              <span id="tac-global-oi-short-pct" style="color:#f6465d;">28.3% Short</span>
            </div>
          </div>

          <!-- Popover Informativo: Índices -->
          <div class="tac-oracle-popover" id="tac-indices-popover" style="width:310px;">
            <div class="tac-popover-header">
              <span style="font-weight:700;color:#f0b90b;font-size:11px;">📊 Como Ler os Indicadores Deste Card?</span>
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
                <span class="tac-popover-tag">🌐 OI GLOBAL MULTI-EXCHANGE (BTC FUTUROS):</span>
                <div>Volume total de contratos futuros em aberto somando as 4 maiores corretoras globais (Binance + Bybit + OKX + Bitget) e a proporção média de posicionamento Long vs Short dos traders.</div>
              </div>
              <div class="tac-popover-section">
                <span class="tac-popover-tag">💡 COMO OPERAR:</span>
                <div>• Opere comprado apenas se a <strong>Maré Geral</strong> e seu <strong>Índice Pessoal</strong> estiverem ambos verdes.</div>
                <div>• Use o <strong>OI Global</strong> para confirmar se há combustível institucional e consenso de posições no mercado.</div>
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

        <!-- 3. VAREJO & INSTITUCIONAL (TOP TRADERS + MANADA L/S + TAKER 5M) -->
        <div class="tac-hud-block" style="flex:1.25;min-width:220px;position:relative;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
            <span class="tac-hud-label" style="font-weight:700;color:#f0b90b;">🐟⚡ VAREJO & INSTITUCIONAL</span>
            <button type="button" class="tac-oracle-help-btn" onclick="window._toggleTacHudHelp(event, 'tac-retail-popover')" title="Como interpretar os Tubarões, a Manada e a Agressão?">?</button>
          </div>

          <!-- 1. Posição dos Tubarões (Top Traders) -->
          <!-- 1. Quem está Agredindo? (5m) -->
          <div>
            <div style="font-size:9px;color:var(--tac-text-muted);font-weight:600;display:flex;justify-content:space-between;">
              <span>⚡ QUEM ESTÁ AGREDINDO? (TAKER 5M)</span>
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

          <!-- Divisor -->
          <div class="tac-hud-divider" style="margin:4px 0;"></div>

          <!-- 2. Posição dos Tubarões (Top Traders) -->
          <div>
            <div style="font-size:9px;color:var(--tac-text-muted);font-weight:600;display:flex;justify-content:space-between;">
              <span>🦈 POSIÇÃO DOS TUBARÕES (TOP TRADERS)</span>
            </div>
            <div class="tac-meter-wrap" id="tac-top-wrap" style="margin-top:2px;">
              <div class="tac-meter-bar">
                <div class="tac-meter-fill-long" id="tac-top-long" style="width: 50%;"></div>
                <div class="tac-meter-fill-short" id="tac-top-short" style="width: 50%;"></div>
              </div>
              <div class="tac-meter-text">
                <span style="color:#0ecb81;" id="tac-top-long-text">50% Volume Long</span>
                <span style="color:#f6465d;" id="tac-top-short-text">50% Volume Short</span>
              </div>
            </div>
            <div id="tac-top-desc" style="font-size:8.5px;font-weight:600;margin-top:1px;line-height:1.2;">Sincronizando posição dos tubarões...</div>
          </div>

          <!-- Divisor -->
          <div class="tac-hud-divider" style="margin:4px 0;"></div>

          <!-- 3. Onde está a Manada? (Contas Varejo) -->
          <div>
            <div style="font-size:9px;color:var(--tac-text-muted);font-weight:600;display:flex;justify-content:space-between;">
              <span>🐟 ONDE ESTÁ A MANADA? (CONTAS VAREJO)</span>
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

          <!-- Popover Informativo Unificado: Varejo & Institucional -->
          <div class="tac-oracle-popover" id="tac-retail-popover" style="width:350px;">
            <div class="tac-popover-header">
              <span style="font-weight:700;color:#f0b90b;font-size:11px;">🐟⚡ Varejo & Institucional — Guia Tático</span>
              <button type="button" class="tac-popover-close" onclick="window._closeTacHudHelp(event, 'tac-retail-popover')">&times;</button>
            </div>
            <div class="tac-popover-body">
              <div class="tac-popover-section">
                <span class="tac-popover-tag">🦈 1. POSIÇÃO DOS TUBARÕES (TOP TRADERS):</span>
                <div>Mede a proporção do <strong>volume financeiro real</strong> em posições abertas pelo Top 20% das contas com maior margem na Binance. Mostra onde os grandes players estão posicionados.</div>
              </div>
              <div class="tac-popover-section">
                <span class="tac-popover-tag">🐟 2. ONDE ESTÁ A MANADA? (CONTAS VAREJO):</span>
                <div>Mede a contagem numérica de contas físicas (sardinhas). Funciona como <strong>indicador contrário</strong>: se a manada estiver em euforia de compra e os tubarões vendidos, prepare-se para o despejo.</div>
              </div>
              <div class="tac-popover-section">
                <span class="tac-popover-tag">⚡ 3. QUEM ESTÁ AGREDINDO? (TAKER 5M):</span>
                <div>Volume executado a mercado nos últimos 5 minutos. Mostra qual lado tem urgência imediata de compra ou venda.</div>
              </div>
              <div class="tac-popover-section">
                <span class="tac-popover-tag">🛡️ FUNÇÃO PRÁTICA:</span>
                <div>Opere sempre a favor dos tubarões e do fluxo taker, e nunca contra o movimento institucional quando a manada estiver na direção oposta!</div>
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

            <!-- Barra Medidora Bidirecional do Delta do OI (Saída 🔴 vs 🟢 Entrada) -->
            <div class="tac-oi-meter-wrap" style="margin-top:3px;margin-bottom:2px;">
              <div class="tac-oi-meter-track" id="tac-oi-meter-track" style="height:7px;background:#181c24;border:1px solid rgba(255,255,255,0.08);border-radius:4px;position:relative;overflow:hidden;" title="Fluxo de Capital no OI: Saída de capital à esquerda | Entrada de capital à direita">
                <!-- Linha Central (Ponto Neutro 0) -->
                <div style="position:absolute;left:50%;top:0;bottom:0;width:2px;background:rgba(255,255,255,0.45);transform:translateX(-50%);z-index:2;box-shadow:0 0 3px rgba(255,255,255,0.5);"></div>
                <!-- Preenchimento Dinâmico Bidirecional -->
                <div id="tac-oi-bar-fill" style="position:absolute;top:0;bottom:0;border-radius:2px;transition:all 0.4s ease;left:50%;width:0%;background:#0ecb81;z-index:1;"></div>
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;font-size:9.5px;font-weight:600;margin-top:1px;">
              <div id="tac-oi-delta-desc">Analisando fluxo institucional...</div>
              <span id="tac-oi-delta-pct" style="font-size:8.5px;font-weight:700;color:#848e9c;font-family:'JetBrains Mono',monospace;margin-left:4px;flex-shrink:0;">--</span>
            </div>
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

          <!-- Divisor -->
          <div class="tac-hud-divider" style="margin:5px 0;"></div>

          <!-- 4 BARRAS INDIVIDUAIS: FLUXO DE CAPITAL NAS CORRETORAS (CEX 24H) COM RÉGUA DE MEDIÇÃO -->
          <div class="tac-cex-flow-section" style="display:flex;flex-direction:column;gap:6px;">
            <!-- 1. DÓLAR (USD) -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:8.5px;color:var(--tac-text-muted);font-weight:700;margin-bottom:2px;">
                <span>💵 FLUXO DE DÓLAR (USD)</span>
                <span style="font-size:8px;color:#848e9c;font-weight:500;">24H</span>
              </div>
              <!-- Régua visual de medição Dólar -->
              <div style="margin-left:48px;margin-right:64px;display:flex;flex-direction:column;margin-bottom:2px;">
                <div style="display:flex;justify-content:space-between;font-size:7px;color:#6b7280;font-family:monospace;padding:0 1px;">
                  <span>$0</span>
                  <span>$1B</span>
                  <span>$2B</span>
                  <span>$3B</span>
                  <span>$4B</span>
                  <span>$5B+</span>
                </div>
                <div style="display:flex;justify-content:space-between;height:4px;border-bottom:1px solid rgba(255,255,255,0.12);padding:0 2px;">
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                </div>
              </div>
              <!-- Barra 1: Entrada de Dólares (Verde) -->
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                <span style="font-size:8px;color:#0ecb81;font-weight:700;width:42px;flex-shrink:0;">Entrada</span>
                <div style="flex:1;background:rgba(255,255,255,0.08);height:7px;border-radius:4px;overflow:hidden;position:relative;">
                  <div id="tac-bar-usd-in" style="background:#0ecb81;height:100%;width:0%;border-radius:4px;transition:width 0.5s ease;"></div>
                </div>
                <span id="tac-val-usd-in" style="font-size:8.5px;color:#0ecb81;font-weight:800;width:58px;text-align:right;flex-shrink:0;">+$0</span>
              </div>
              <!-- Barra 2: Saída de Dólares (Vermelho) -->
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:8px;color:#f6465d;font-weight:700;width:42px;flex-shrink:0;">Saída</span>
                <div style="flex:1;background:rgba(255,255,255,0.08);height:7px;border-radius:4px;overflow:hidden;position:relative;">
                  <div id="tac-bar-usd-out" style="background:#f6465d;height:100%;width:0%;border-radius:4px;transition:width 0.5s ease;"></div>
                </div>
                <span id="tac-val-usd-out" style="font-size:8.5px;color:#f6465d;font-weight:800;width:58px;text-align:right;flex-shrink:0;">-$0</span>
              </div>
            </div>

            <!-- 2. BITCOIN (BTC) -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:8.5px;color:var(--tac-text-muted);font-weight:700;margin-bottom:2px;">
                <span>₿ FLUXO DE OURO (BTC)</span>
                <span style="font-size:8px;color:#848e9c;font-weight:500;">24H</span>
              </div>
              <!-- Régua visual de medição BTC -->
              <div style="margin-left:48px;margin-right:64px;display:flex;flex-direction:column;margin-bottom:2px;">
                <div style="display:flex;justify-content:space-between;font-size:7px;color:#6b7280;font-family:monospace;padding:0 1px;">
                  <span>0</span>
                  <span>10K</span>
                  <span>20K</span>
                  <span>30K</span>
                  <span>40K</span>
                  <span>50K+</span>
                </div>
                <div style="display:flex;justify-content:space-between;height:4px;border-bottom:1px solid rgba(255,255,255,0.12);padding:0 2px;">
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.15);height:2px;"></span>
                  <span style="border-left:1px solid rgba(255,255,255,0.25);height:3px;"></span>
                </div>
              </div>
              <!-- Barra 3: Ouro em Oferta / Entrada na CEX (Dourado) -->
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                <span style="font-size:8px;color:#f0b90b;font-weight:700;width:42px;flex-shrink:0;">Oferta</span>
                <div style="flex:1;background:rgba(255,255,255,0.08);height:7px;border-radius:4px;overflow:hidden;position:relative;">
                  <div id="tac-bar-btc-in" style="background:#f0b90b;height:100%;width:0%;border-radius:4px;transition:width 0.5s ease;"></div>
                </div>
                <span id="tac-val-btc-in" style="font-size:8.5px;color:#f0b90b;font-weight:800;width:58px;text-align:right;flex-shrink:0;">+0 BTC</span>
              </div>
              <!-- Barra 4: Ouro no Cofre / Saída da CEX (Laranja) -->
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:8px;color:#ff7043;font-weight:700;width:42px;flex-shrink:0;">Cofre</span>
                <div style="flex:1;background:rgba(255,255,255,0.08);height:7px;border-radius:4px;overflow:hidden;position:relative;">
                  <div id="tac-bar-btc-out" style="background:#ff7043;height:100%;width:0%;border-radius:4px;transition:width 0.5s ease;"></div>
                </div>
                <span id="tac-val-btc-out" style="font-size:8.5px;color:#ff7043;font-weight:800;width:58px;text-align:right;flex-shrink:0;">-0 BTC</span>
              </div>
            </div>
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
                <span class="tac-popover-tag">📊 3. FLUXO CEX (DÓLAR &amp; BITCOIN 24H):</span>
                <div>• <strong>💵 Dólar:</strong> Entrada (🟢) vs Saída (🔴). Se a barra verde estiver mais longa, há injeção de liquidez compradora nas corretoras.</div>
                <div>• <strong>₿ Bitcoin:</strong> Oferta (🟡 Dourado) vs Cofre (🟠 Laranja). Se a barra dourada estiver maior, as baleias mandaram moedas para vender. Se a laranja estiver maior, estão retirando para cofres frios (choque de oferta / acumulação).</div>
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

      <!-- Menu / Barra Inferior (abaixo dos cards) - Posições Abertas e Ordens Binance (Admin Only) -->
      <div class="tac-bottom-menu admin-only" id="tac-bottom-menu">
        <div class="tac-bmenu-header">
          <div class="tac-bmenu-tabs">
            <button class="tac-bmenu-tab active" id="tac-bmenu-tab-positions" type="button">
              <span>Posições</span>
              <span class="tac-bmenu-count" id="tac-bmenu-pos-count">0</span>
            </button>
            <button class="tac-bmenu-tab" id="tac-bmenu-tab-orders" type="button">
              <span>Ordens Abertas</span>
              <span class="tac-bmenu-count" id="tac-bmenu-orders-count">0</span>
            </button>
          </div>
          <div class="tac-bmenu-actions">
            <span class="tac-bmenu-tip" id="tac-bmenu-tip">💡 Clique no ✏️ para ajustar Take Profit e Stop Loss</span>
            <button class="tac-bmenu-refresh-btn" id="tac-bmenu-btn-refresh" type="button" onclick="window.OrderPanel&&window.OrderPanel.refreshPositions&&window.OrderPanel.refreshPositions()" title="Atualizar dados da Binance">🔄</button>
            <button class="tac-bmenu-panic-btn" id="tac-btn-kill-switch" type="button" onclick="window.OrderPanel&&window.OrderPanel.triggerPanicKillSwitch()" title="PÂNICO: Fechar todas as posições e cancelar ordens imediatamente (Kill Switch)">
              <span class="tac-panic-icon">🚨</span>
              <span class="tac-panic-label" id="tac-panic-btn-text">KILL SWITCH</span>
            </button>
          </div>
        </div>
        <div class="tac-positions-table-wrap" id="tac-positions-table-wrap">
          <table class="tac-positions-table">
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Tamanho</th>
                <th>Preço de Entrada</th>
                <th>Preço de Marca</th>
                <th>Preço Liq.</th>
                <th>Margem</th>
                <th>PNL (ROI %)</th>
                <th>TP / SL para posição</th>
                <th style="text-align:right;">Fechar Posição</th>
              </tr>
            </thead>
            <tbody id="tac-positions-tbody">
              <tr class="tac-pos-empty-row">
                <td colspan="9">Nenhuma posição aberta no momento</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tac-positions-table-wrap" id="tac-orders-table-wrap" style="display:none;">
          <table class="tac-positions-table">
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Tipo</th>
                <th>Lado</th>
                <th>Preço de Disparo</th>
                <th>Preço Execução</th>
                <th>Quantidade</th>
                <th>Reduce-Only</th>
                <th style="text-align:right;">Cancelar</th>
              </tr>
            </thead>
            <tbody id="tac-orders-tbody">
              <tr class="tac-pos-empty-row">
                <td colspan="8">Nenhuma ordem condicional aberta no momento</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Backdrop transparente para fechar ao clicar fora -->
      <div id="tac-advisor-backdrop" onclick="window._closeTacAdvisor()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(3px);z-index:9998;transition:opacity 0.25s ease;"></div>

      <!-- Gaveta Deslizante (Drawer) do Diagnóstico & Recomendações -->
      <div id="tac-advisor-drawer" style="position:fixed;top:0;right:0;width:440px;max-width:92vw;height:100vh;background:#12151d;border-left:1px solid #282d38;z-index:9999;box-shadow:-10px 0 35px rgba(0,0,0,0.8);display:flex;flex-direction:column;transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);box-sizing:border-box;">
        <!-- Header da Gaveta -->
        <div style="padding:14px 16px;border-bottom:1px solid #282d38;display:flex;align-items:center;justify-content:space-between;background:#161922;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">💡</span>
            <div>
              <div style="font-size:13px;font-weight:800;color:#f0b90b;letter-spacing:0.5px;">BÚSSOLA TÁTICA &amp; RECOMENDAÇÕES</div>
              <div style="font-size:9.5px;color:#848e9c;">Raio-X de Confluência: Preço + Tubarões + Manada + Fluxo</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button onclick="window._refreshTacAdvisor()" title="Atualizar diagnóstico agora" style="background:rgba(255,255,255,0.06);border:1px solid #333a44;color:#eaecef;border-radius:4px;padding:4px 8px;font-size:10px;font-weight:600;cursor:pointer;">🔄 Atualizar</button>
            <button onclick="window._closeTacAdvisor()" title="Fechar gaveta" style="background:none;border:none;color:#848e9c;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
          </div>
        </div>
        <!-- Corpo da Gaveta com Scroll Suave -->
        <div id="tac-advisor-body" style="flex:1;overflow-y:auto;padding:16px;box-sizing:border-box;">
          <div style="text-align:center;padding:30px 10px;color:#848e9c;font-size:11px;">Carregando diagnóstico do mercado...</div>
        </div>
      </div>
    </div>
  `;
}

export function toggleOracleHelp(e) {
  toggleHudHelp(e, 'tac-oracle-popover');
}

export function closeOracleHelp(e) {
  closeHudHelp(e, 'tac-oracle-popover');
}

export function toggleHudHelp(e, id) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  document.querySelectorAll('.tac-oracle-popover').forEach(p => {
    if (p.id !== id) p.style.display = 'none';
  });

  const target = document.getElementById(id);
  if (!target) return;

  if (target.style.display === 'block') {
    target.style.display = 'none';
    return;
  }

  target.style.top  = '-9999px';
  target.style.left = '-9999px';
  target.style.display = 'block';

  const btn = (e && e.target) ? e.target.closest('.tac-oracle-help-btn') || e.target : null;
  if (btn) {
    const rect = btn.getBoundingClientRect();
    const popW = target.offsetWidth  || parseInt(target.style.width) || 320;
    const popH = target.offsetHeight || 300;

    let top  = rect.top - popH - 10;
    let left = rect.left;

    if (left + popW > window.innerWidth - 8) {
      left = window.innerWidth - popW - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) top = rect.bottom + 8;

    target.style.top  = top  + 'px';
    target.style.left = left + 'px';
  } else {
    target.style.top  = '50px';
    target.style.left = '50px';
  }
}

export function closeHudHelp(e, id) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const target = document.getElementById(id);
  if (target) target.style.display = 'none';
}

export function initHelpListeners() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tac-oracle-popover') && !e.target.closest('.tac-oracle-help-btn')) {
      document.querySelectorAll('.tac-oracle-popover').forEach(p => p.style.display = 'none');
    }
  });
}
