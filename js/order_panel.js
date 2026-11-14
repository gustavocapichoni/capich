/**
 * order_panel.js
 * Lógica do Mini Painel Lateral de Execução de Ordens (Binance Futures)
 * 100% Modular e Adaptado às Regras Oficiais da Binance
 */

(function () {
  'use strict';

  const STORAGE_KEY_API = 'capich_binance_api_key';
  const STORAGE_KEY_SEC = 'capich_binance_api_secret';
  const STORAGE_KEY_LOCKED = 'capich_order_panel_locked';

  const defaultInitialSym = localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
  let currentSymbol = defaultInitialSym;
  let baseAsset = defaultInitialSym.replace('USDT', '');
  let currentPrice = 0;
  let currentPositionData = null;
  let isPanelLocked = localStorage.getItem(STORAGE_KEY_LOCKED) === 'true';
  let currentOrderType = 'market'; // 'market' ou 'conditional'
  let pollInterval = null;

  // Informações de precisão da Binance para o ativo atual
  let symbolInfo = {
    minQty: 0.001,
    lotMinQty: 0.001,
    marketMinQty: 0.001,
    stepSize: 0.001,
    decimals: 3,
    minNotional: 0
  };

  const ICON_EYE_OPEN = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  function updateVisibilityButtonUI(visible) {
    const btn = document.getElementById('bop-btn-pos-visibility');
    if (!btn) return;
    if (visible) {
      btn.innerHTML = ICON_EYE_OPEN;
      btn.classList.remove('hidden-lines');
      btn.title = 'Ocultar linhas no gráfico (Posição, Take e Stop)';
    } else {
      btn.innerHTML = ICON_EYE_OFF;
      btn.classList.add('hidden-lines');
      btn.title = 'Exibir linhas no gráfico (Posição, Take e Stop)';
    }
  }

  const STORAGE_KEY_AUTH_TOKEN = 'capich_trade_auth_token';
  const DEFAULT_TRADE_TOKEN = 'capich_fortress_secure_token_2026';

  /**
   * Cabeçalhos seguros de requisição autenticada
   */
  function getTradeAuthHeaders(extra = {}) {
    const token = localStorage.getItem(STORAGE_KEY_AUTH_TOKEN) || DEFAULT_TRADE_TOKEN;
    return {
      'Content-Type': 'application/json',
      'x-trade-auth': token,
      ...extra
    };
  }

  /**
   * Obtém credenciais salvas no navegador
   */
  function getStoredKeys() {
    return {
      apiKey: localStorage.getItem(STORAGE_KEY_API) || '',
      apiSecret: localStorage.getItem(STORAGE_KEY_SEC) || '',
      authToken: localStorage.getItem(STORAGE_KEY_AUTH_TOKEN) || DEFAULT_TRADE_TOKEN
    };
  }

  /**
   * Salva credenciais no navegador
   */
  function saveStoredKeys(apiKey, apiSecret, authToken) {
    if (apiKey) localStorage.setItem(STORAGE_KEY_API, apiKey.trim());
    if (apiSecret) localStorage.setItem(STORAGE_KEY_SEC, apiSecret.trim());
    if (authToken) localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, authToken.trim());
  }

  /**
   * Recalcula dinamicamente a quantidade mínima exigida pela Binance com base no preço atual e no MIN_NOTIONAL.
   * Regra Binance Futures:
   *   minQty = max(lotMinQty, ceil(minNotional / currentPrice / stepSize) * stepSize)
   * Como o preço oscila continuamente, este cálculo garante que a quantidade seja sempre válida na corretora.
   */
  function recalculateDynamicMinQty() {
    if (!symbolInfo.stepSize || !currentPrice || currentPrice <= 0) return false;

    let minByNotional = symbolInfo.lotMinQty || 0.001;
    if (symbolInfo.minNotional > 0) {
      const raw = symbolInfo.minNotional / currentPrice;
      let steps = Math.ceil((raw / symbolInfo.stepSize) - 1e-9);
      while ((steps * symbolInfo.stepSize * currentPrice) < symbolInfo.minNotional) {
        steps++;
      }
      minByNotional = parseFloat((steps * symbolInfo.stepSize).toFixed(symbolInfo.decimals));
    }

    const calculatedMin = Math.max(symbolInfo.lotMinQty || 0.001, minByNotional);
    const finalMin = parseFloat(calculatedMin.toFixed(symbolInfo.decimals));

    const changed = (symbolInfo.minQty !== finalMin);
    symbolInfo.minQty = finalMin;
    return changed;
  }

  /**
   * Busca as regras de quantidade mínima da Binance para o símbolo ativo.
   * Sempre usa ?fresh=true ao trocar de par para garantir o valor atual da corretora.
   * @param {string} sym - Símbolo do par (ex: ETHUSDT)
   * @param {boolean} [forceFresh=false] - Se true, ignora cache e busca direto da Binance
   */
  async function fetchSymbolPrecision(sym, forceFresh = false) {
    try {
      const url = `/api/trade/symbol-info?symbol=${sym}${forceFresh ? '&fresh=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        symbolInfo = {
          minQty:       data.minQty       || 0.001,
          stepSize:     data.stepSize     || 0.001,
          decimals:     data.decimals     !== undefined ? data.decimals : 3,
          lotMinQty:    data.lotMinQty    || data.minQty || 0.001,
          marketMinQty: data.marketMinQty || data.minQty || 0.001,
          minNotional:  data.minNotional  || 0
        };
        if (currentPrice > 0) {
          recalculateDynamicMinQty();
        }
        console.log(`[OrderPanel] ${sym} → minQty=${symbolInfo.minQty} (LOT=${symbolInfo.lotMinQty} / MIN_NOTIONAL=$${symbolInfo.minNotional})`);
        updateQuantityUI(false);
      }
    } catch (e) {
      console.warn('[OrderPanel] Erro ao buscar precisão do par:', e.message);
    }
  }

  /**
   * Inicializa o painel de ordens
   */
  function initOrderPanel() {
    const container = document.getElementById('binance-order-panel');
    if (!container || container.dataset.initialized === 'true') return;
    container.dataset.initialized = 'true';

    baseAsset = currentSymbol.replace('USDT', '');

    container.innerHTML = `
      <div class="bop-header">
        <div class="bop-title-wrap">
          <span class="bop-title">Painel de Controle</span>
        </div>
        <div class="bop-header-actions">
          <button class="bop-btn-visibility" id="bop-btn-pos-visibility" title="Ocultar / Exibir linhas de trade no gráfico"></button>
          <button class="bop-btn-lock" id="bop-btn-lock" title="Bloquear / Desbloquear painel">🔓</button>
          <button class="bop-btn-config" id="bop-btn-open-config" title="Configurar Chaves API da Binance">🔑</button>
        </div>
      </div>

      <!-- Símbolo e Preço Atual -->
      <div class="bop-symbol-bar">
        <span class="bop-symbol-name" id="bop-symbol-label">${currentSymbol}</span>
        <span class="bop-symbol-price" id="bop-price-label">$--</span>
      </div>

      <!-- Caixa de Conta: Saldo -->
      <div class="bop-account-box" style="padding: 8px 10px; margin-bottom: 8px;">
        <div class="bop-row-balance">
          <span>Saldo USDT:</span>
          <span class="bop-val-balance" id="bop-val-balance">Carregando...</span>
        </div>
      </div>

      <!-- Abas de Tipo de Ordem: Market vs Conditional -->
      <div class="bop-order-type-tabs">
        <button type="button" class="bop-tab-type active" id="bop-tab-market" data-type="market">Market</button>
        <button type="button" class="bop-tab-type" id="bop-tab-conditional" data-type="conditional">Conditional</button>
      </div>

      <!-- Campo Específico: Stop Price (apenas no modo Conditional) -->
      <div class="bop-field-block" id="bop-block-stop-price" style="display: none;">
        <div class="bop-section-label">STOP PRICE (USDT)</div>
        <div class="bop-input-group">
          <input type="number" id="bop-input-stop-price" class="bop-input-amount" placeholder="Preço de disparo" min="0" step="any">
          <span class="bop-input-suffix">USDT</span>
        </div>
      </div>

      <!-- Campo Específico: Preço de Execução (fixo em Market Price no modo Conditional) -->
      <div class="bop-field-block" id="bop-block-exec-price" style="display: none;">
        <div class="bop-section-label">PREÇO DE EXECUÇÃO</div>
        <div class="bop-input-group bop-input-disabled-wrap">
          <input type="text" class="bop-input-amount" value="Market Price" readonly disabled>
          <span class="bop-input-suffix" style="color:#f0b90b;font-weight:700;">Market</span>
        </div>
      </div>

      <!-- Quantidade Direta no Ativo -->
      <div class="bop-amount-box">
        <div class="bop-section-label" id="bop-qty-label">QUANTIDADE (${baseAsset})</div>
        <div class="bop-input-group">
          <input type="number" id="bop-input-qty" class="bop-input-amount" placeholder="0" min="0" step="any">
          <span class="bop-input-suffix" id="bop-input-suffix">${baseAsset}</span>
        </div>
        
        <!-- Notificação de Quantidade Mínima oficial da Binance -->
        <div class="bop-min-qty-hint" id="bop-min-qty-hint">
          ℹ️ Mínimo Binance: <strong id="bop-min-val">--</strong>
        </div>

        <!-- Botões rápidos de quantidade -->
        <div class="bop-quick-amounts">
          <button class="bop-btn-quick" id="bop-btn-min">Mínimo</button>
          <button class="bop-btn-quick" id="bop-btn-2x">2x Mín</button>
          <button class="bop-btn-quick" id="bop-btn-5x">5x Mín</button>
          <button class="bop-btn-quick" id="bop-btn-10x">10x Mín</button>
        </div>

        <div class="bop-est-qty" id="bop-cost-usdt">Custo aprox: $0.00 USDT</div>
      </div>

      <!-- Checkbox Reduce-Only (apenas no modo Conditional) -->
      <div class="bop-reduce-only-wrap" id="bop-block-reduce-only" style="display: none;">
        <label class="bop-checkbox-label">
          <input type="checkbox" id="bop-check-reduce-only">
          <span>Reduce-Only (apenas reduzir/fechar)</span>
        </label>
      </div>

      <!-- Botões de Compra e Venda -->
      <div class="bop-actions-grid">
        <button class="bop-btn-trade bop-btn-buy" id="bop-btn-buy">
          <span class="bop-btn-main-txt">Buy/Long</span>
        </button>
        <button class="bop-btn-trade bop-btn-sell" id="bop-btn-sell">
          <span class="bop-btn-main-txt">Sell/Short</span>
        </button>
      </div>

      <!-- Toast / Notificação de Status -->
      <div class="bop-toast" id="bop-toast-msg">Pronto para operar</div>

      <!-- Modal de Chaves da API -->
      <div class="bop-modal-backdrop" id="bop-modal-config" style="display: none;">
        <div class="bop-modal-card">
          <div class="bop-modal-header">
            <h3>🔑 Chaves de API · Binance Futures</h3>
            <button class="bop-modal-close" id="bop-modal-close">&times;</button>
          </div>
          <p style="font-size:11px;color:#848e9c;line-height:1.5;margin:0;">
            Insira suas chaves de API da Binance com permissão de <strong>Futuros (Enable Futures)</strong>. As chaves são salvas apenas localmente no seu computador.
          </p>
          <div class="bop-modal-field">
            <label>API Key</label>
            <input type="text" id="bop-cfg-apikey" placeholder="Cole sua API Key aqui">
          </div>
          <div class="bop-modal-field">
            <label>Secret Key</label>
            <input type="password" id="bop-cfg-apisecret" placeholder="Cole sua Secret Key aqui">
          </div>
          <div class="bop-modal-field">
            <label>Token de Acesso do Servidor (Segurança)</label>
            <input type="password" id="bop-cfg-authtoken" placeholder="Token de segurança do servidor">
          </div>
          <div class="bop-modal-footer">
            <button class="bop-btn-cancel" id="bop-cfg-cancel">Cancelar</button>
            <button class="bop-btn-save" id="bop-cfg-save">Salvar Chaves</button>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    fetchSymbolPrecision(currentSymbol, true); // busca fresca da Binance na inicialização
    syncSymbolPrice();
    startDataPolling();
    if (window._syncTacChartHeight) {
      window._syncTacChartHeight();
      setTimeout(window._syncTacChartHeight, 200);
    }
  }

  /**
   * Aplica o estado de bloqueio (cadeado) em todo o painel
   */
  function applyLockState(locked) {
    isPanelLocked = Boolean(locked);
    try {
      localStorage.setItem(STORAGE_KEY_LOCKED, isPanelLocked ? 'true' : 'false');
    } catch (_) {}

    const container = document.getElementById('binance-order-panel');
    if (container) {
      container.classList.toggle('bop-locked', isPanelLocked);
    }

    const btnLock = document.getElementById('bop-btn-lock');
    if (btnLock) {
      btnLock.textContent = isPanelLocked ? '🔒' : '🔓';
      btnLock.title = isPanelLocked 
        ? 'Painel Bloqueado (Clique para desbloquear)' 
        : 'Painel Desbloqueado (Clique para bloquear)';
      btnLock.classList.toggle('locked', isPanelLocked);
    }

    // Desabilita / Habilita todos os inputs e botões funcionais do painel
    const interactiveIds = [
      'bop-input-qty',
      'bop-btn-min', 'bop-btn-2x', 'bop-btn-5x', 'bop-btn-10x',
      'bop-btn-buy', 'bop-btn-sell'
    ];
    interactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isPanelLocked;
    });

    document.querySelectorAll('.tac-pos-btn-market-close, .tac-pos-btn-edit-tpsl').forEach(el => {
      el.disabled = isPanelLocked;
    });
  }

  /**
   * Associa eventos aos elementos da interface
   */
  function bindEvents() {
    // Olho para Ocultar / Exibir linhas de Posição, Take e Stop no gráfico
    const btnVis = document.getElementById('bop-btn-pos-visibility');
    if (btnVis) {
      const isVisible = (window.ChartPositions && typeof window.ChartPositions.isLinesVisible === 'function')
        ? window.ChartPositions.isLinesVisible()
        : true;
      updateVisibilityButtonUI(isVisible);

      btnVis.onclick = () => {
        if (window.ChartPositions && typeof window.ChartPositions.toggleLinesVisible === 'function') {
          const nextVisible = window.ChartPositions.toggleLinesVisible();
          updateVisibilityButtonUI(nextVisible);
          if (nextVisible) {
            setToast('👁️ Linhas de trade exibidas no gráfico!', 'success');
          } else {
            setToast('🙈 Linhas de trade ocultadas no gráfico!', 'info');
          }
        }
      };

      if (window.ChartPositions && typeof window.ChartPositions.onVisibilityChange === 'function') {
        window.ChartPositions.onVisibilityChange(updateVisibilityButtonUI);
      }
    }

    // Cadeado de Bloqueio / Desbloqueio do painel
    const btnLock = document.getElementById('bop-btn-lock');
    if (btnLock) {
      btnLock.onclick = () => {
        const nextState = !isPanelLocked;
        applyLockState(nextState);
        if (nextState) {
          setToast('🔒 Painel bloqueado com segurança!', 'info');
        } else {
          setToast('🔓 Painel liberado!', 'success');
        }
      };
    }

    // Config modal
    const btnOpenCfg = document.getElementById('bop-btn-open-config');
    const modalCfg = document.getElementById('bop-modal-config');
    const btnCloseCfg = document.getElementById('bop-modal-close');
    const btnCancelCfg = document.getElementById('bop-cfg-cancel');
    const btnSaveCfg = document.getElementById('bop-cfg-save');

    function openModal() {
      const keys = getStoredKeys();
      document.getElementById('bop-cfg-apikey').value = keys.apiKey;
      document.getElementById('bop-cfg-apisecret').value = keys.apiSecret;
      const tokInput = document.getElementById('bop-cfg-authtoken');
      if (tokInput) tokInput.value = keys.authToken || '';
      modalCfg.style.display = 'flex';
    }

    function closeModal() {
      modalCfg.style.display = 'none';
    }

    if (btnOpenCfg) btnOpenCfg.onclick = openModal;
    if (btnCloseCfg) btnCloseCfg.onclick = closeModal;
    if (btnCancelCfg) btnCancelCfg.onclick = closeModal;

    if (btnSaveCfg) {
      btnSaveCfg.onclick = () => {
        const k = document.getElementById('bop-cfg-apikey').value;
        const s = document.getElementById('bop-cfg-apisecret').value;
        const t = document.getElementById('bop-cfg-authtoken')?.value;
        saveStoredKeys(k, s, t);
        closeModal();
        setToast('Credenciais salvas com sucesso!', 'success');
        fetchAccountData();
      };
    }

    // Abas de Tipo de Ordem: Market vs Conditional
    const tabMarket = document.getElementById('bop-tab-market');
    const tabConditional = document.getElementById('bop-tab-conditional');
    const blockStopPrice = document.getElementById('bop-block-stop-price');
    const blockExecPrice = document.getElementById('bop-block-exec-price');
    const blockReduceOnly = document.getElementById('bop-block-reduce-only');

    function switchOrderType(type) {
      currentOrderType = type;
      if (type === 'conditional') {
        tabMarket?.classList.remove('active');
        tabConditional?.classList.add('active');
        if (blockStopPrice) blockStopPrice.style.display = 'flex';
        if (blockExecPrice) blockExecPrice.style.display = 'flex';
        if (blockReduceOnly) blockReduceOnly.style.display = 'block';
      } else {
        tabConditional?.classList.remove('active');
        tabMarket?.classList.add('active');
        if (blockStopPrice) blockStopPrice.style.display = 'none';
        if (blockExecPrice) blockExecPrice.style.display = 'none';
        if (blockReduceOnly) blockReduceOnly.style.display = 'none';
      }
    }

    if (tabMarket) tabMarket.onclick = () => switchOrderType('market');
    if (tabConditional) tabConditional.onclick = () => switchOrderType('conditional');

    // Input de Quantidade
    const inputQty = document.getElementById('bop-input-qty');
    if (inputQty) {
      inputQty.setAttribute('min', '0');
      inputQty.addEventListener('keydown', (e) => {
        if (e.key === '-' || e.key === 'e' || e.key === '+') {
          e.preventDefault();
        }
      });
      const sanitizeQty = () => {
        let v = inputQty.value;
        if (v.includes('-')) {
          v = v.replace(/-/g, '');
          inputQty.value = v;
        }
        if (parseFloat(v) < 0) {
          inputQty.value = '';
        }
        validateAndCalcCost();
      };
      inputQty.addEventListener('input', sanitizeQty);
      inputQty.addEventListener('change', sanitizeQty);
      inputQty.addEventListener('paste', () => setTimeout(sanitizeQty, 10));
    }

    // Botões rápidos de quantidade baseados na regra da Binance
    const btnMin = document.getElementById('bop-btn-min');
    const btn2x = document.getElementById('bop-btn-2x');
    const btn5x = document.getElementById('bop-btn-5x');
    const btn10x = document.getElementById('bop-btn-10x');

    function setQtyMultiplier(mult) {
      if (isPanelLocked) return;
      if (!inputQty) return;
      recalculateDynamicMinQty();
      const target = (symbolInfo.minQty * mult);
      inputQty.value = symbolInfo.decimals > 0 ? target.toFixed(symbolInfo.decimals) : Math.round(target);
      validateAndCalcCost();
    }

    if (btnMin) btnMin.onclick = () => setQtyMultiplier(1);
    if (btn2x)  btn2x.onclick  = () => setQtyMultiplier(2);
    if (btn5x)  btn5x.onclick  = () => setQtyMultiplier(5);
    if (btn10x) btn10x.onclick = () => setQtyMultiplier(10);

    // Botões de Trade
    const btnBuy = document.getElementById('bop-btn-buy');
    const btnSell = document.getElementById('bop-btn-sell');

    if (btnBuy) btnBuy.onclick = () => sendTrade('BUY');
    if (btnSell) btnSell.onclick = () => sendTrade('SELL');

    // Listeners do Modal TP/SL
    const modalInputTp = document.getElementById('modal-tpsl-input-tp');
    const modalInputSl = document.getElementById('modal-tpsl-input-sl');
    if (modalInputTp) {
      modalInputTp.addEventListener('input', () => {
        const btnClr = document.getElementById('modal-tpsl-clear-tp');
        if (btnClr) btnClr.style.display = modalInputTp.value ? 'inline' : 'none';
        updateModalTpSlHints();
      });
    }
    if (modalInputSl) {
      modalInputSl.addEventListener('input', () => {
        const btnClr = document.getElementById('modal-tpsl-clear-sl');
        if (btnClr) btnClr.style.display = modalInputSl.value ? 'inline' : 'none';
        updateModalTpSlHints();
      });
    }

    // Fecha modal TP/SL com a tecla ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modalEl = document.getElementById('modal-tpsl');
        if (modalEl && modalEl.style.display !== 'none') {
          closeTpSlModal();
        }
      }
    });

    // Aplica estado de bloqueio persistido
    applyLockState(isPanelLocked);
  }

  /**
   * Atualiza as labels, sufixos e valores padrão conforme o par ativo.
   * @param {boolean} [resetInput=false] - Se true, substitui o valor do input pela quantidade mínima
   */
  function updateQuantityUI(resetInput = false) {
    baseAsset = currentSymbol.replace('USDT', '');
    const labelQty = document.getElementById('bop-qty-label');
    const suffix = document.getElementById('bop-input-suffix');
    const minValEl = document.getElementById('bop-min-val');
    const inputQty = document.getElementById('bop-input-qty');

    if (labelQty) labelQty.textContent = `QUANTIDADE (${baseAsset})`;
    if (suffix) suffix.textContent = baseAsset;

    const notionalTag = symbolInfo.minNotional > 0
      ? ` <span style="font-size:10px;color:#848e9c;font-weight:400;">(Mín. $${symbolInfo.minNotional} USDT)</span>`
      : '';

    if (minValEl) {
      minValEl.innerHTML = `${symbolInfo.minQty} ${baseAsset}${notionalTag}`;
    }

    if (inputQty) {
      inputQty.step = symbolInfo.stepSize.toString();
      const currentVal = parseFloat(inputQty.value) || 0;
      // Se resetInput for true (troca de par), ou se o campo estiver vazio ou zerado, preenche com o mínimo
      if (resetInput || !inputQty.value || currentVal <= 0) {
        inputQty.value = symbolInfo.minQty.toString();
      }
    }

    validateAndCalcCost();
  }

  /**
   * Valida quantidade mínima e calcula custo em USDT
   */
  function validateAndCalcCost() {
    const inputQty = document.getElementById('bop-input-qty');
    const costEl = document.getElementById('bop-cost-usdt');
    const hintEl = document.getElementById('bop-min-qty-hint');
    if (!inputQty || !costEl) return;

    recalculateDynamicMinQty();

    const qty = parseFloat(inputQty.value) || 0;
    const cost = qty * currentPrice;

    costEl.textContent = `Custo aprox: $${cost.toFixed(2)} USDT`;

    const isBelowMinQty = qty > 0 && qty < symbolInfo.minQty;
    const isBelowNotional = qty > 0 && symbolInfo.minNotional > 0 && cost < (symbolInfo.minNotional - 0.01);

    // Validação visual de quantidade mínima e valor mínimo (MIN_NOTIONAL)
    if (isBelowMinQty || isBelowNotional) {
      if (hintEl) {
        hintEl.innerHTML = `<span style="color:#f6465d;font-weight:700;">⚠️ Mínimo Binance: ${symbolInfo.minQty} ${baseAsset} ($${symbolInfo.minNotional || 0} USDT)</span>`;
      }
    } else {
      const notionalTag = symbolInfo.minNotional > 0
        ? ` <span style="font-size:10px;color:#848e9c;font-weight:400;">(Mín. $${symbolInfo.minNotional} USDT)</span>`
        : '';
      if (hintEl) {
        hintEl.innerHTML = `ℹ️ Mínimo Binance: <strong id="bop-min-val">${symbolInfo.minQty} ${baseAsset}</strong>${notionalTag}`;
      }
    }
  }

  /**
   * Exibe mensagens de feedback no painel
   */
  function setToast(msg, type = '') {
    const toast = document.getElementById('bop-toast-msg');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'bop-toast ' + type;
  }

  /**
   * Sincroniza cotação e símbolo
   */
  function syncSymbolPrice() {
    const labelSym = document.getElementById('bop-symbol-label');
    const labelPrice = document.getElementById('bop-price-label');

    if (labelSym) labelSym.textContent = currentSymbol;
    if (labelPrice && currentPrice > 0) {
      labelPrice.textContent = `$${Number(currentPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }
    validateAndCalcCost();
  }

  // ─── GERENCIAMENTO DE POSIÇÕES (MENU INFERIOR ESTILO BINANCE) ───────────────
  let allPositionsList = [];
  let allConditionalOrdersList = [];
  let activeBottomTab = 'positions'; // 'positions' | 'orders'
  let modalActiveSymbol = null;
  let modalActivePos = null;

  /**
   * Inicializa o clique nas abas do Menu Inferior (Posições / Ordens Abertas)
   */
  function initBottomMenuTabs() {
    const tabPos = document.getElementById('tac-bmenu-tab-positions');
    const tabOrd = document.getElementById('tac-bmenu-tab-orders');
    const wrapPos = document.getElementById('tac-positions-table-wrap');
    const wrapOrd = document.getElementById('tac-orders-table-wrap');
    const tipEl = document.getElementById('tac-bmenu-tip');

    if (tabPos && !tabPos.dataset.bound) {
      tabPos.dataset.bound = 'true';
      tabPos.addEventListener('click', () => {
        activeBottomTab = 'positions';
        tabPos.classList.add('active');
        tabOrd?.classList.remove('active');
        if (wrapPos) wrapPos.style.display = 'block';
        if (wrapOrd) wrapOrd.style.display = 'none';
        if (tipEl) tipEl.textContent = '💡 Clique no ✏️ para ajustar Take Profit e Stop Loss';
      });
    }

    if (tabOrd && !tabOrd.dataset.bound) {
      tabOrd.dataset.bound = 'true';
      tabOrd.addEventListener('click', () => {
        activeBottomTab = 'orders';
        tabOrd.classList.add('active');
        tabPos?.classList.remove('active');
        if (wrapPos) wrapPos.style.display = 'none';
        if (wrapOrd) wrapOrd.style.display = 'block';
        if (tipEl) tipEl.textContent = '💡 As ordens condicionais disparam a mercado quando o preço atingir o Stop Price';
      });
    }
  }

  // ─── WEBSOCKET MARK PRICE (tempo real) ──────────────────────────────────────
  let markPriceWs = null;
  let markPriceWsReconnectTimer = null;
  let markPriceWsActive = false;

  /**
   * Inicia (ou reinicia) o WebSocket de mark price da Binance Futures.
   * Usa o stream combinado !markPrice@arr@1s — atualiza todos os pares a cada 1s.
   * Sem autenticação necessária (stream público).
   */
  function startMarkPriceWs() {
    if (markPriceWs) {
      try { markPriceWs.close(); } catch (_) {}
      markPriceWs = null;
    }
    if (markPriceWsReconnectTimer) {
      clearTimeout(markPriceWsReconnectTimer);
      markPriceWsReconnectTimer = null;
    }

    const url = 'wss://fstream.binance.com/stream?streams=!markPrice@arr@1s';
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[MarkPriceWS] Não foi possível abrir WebSocket:', e.message);
      return;
    }

    ws.onopen = () => {
      markPriceWsActive = true;
      console.log('[MarkPriceWS] Conectado ao stream de mark price da Binance.');
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        // O stream combinado vem como { stream, data: [...] }
        const arr = msg.data || msg;
        if (!Array.isArray(arr)) return;
        arr.forEach(item => {
          if (!item.s || !item.p) return; // s = symbol, p = markPrice
          onMarkPriceUpdate(item.s, parseFloat(item.p));
        });
      } catch (_) {}
    };

    ws.onerror = () => {
      markPriceWsActive = false;
    };

    ws.onclose = () => {
      markPriceWsActive = false;
      console.warn('[MarkPriceWS] Conexão encerrada. Reconectando em 5s...');
      markPriceWsReconnectTimer = setTimeout(startMarkPriceWs, 5000);
    };

    markPriceWs = ws;
  }

  /**
   * Para o WebSocket de mark price (ex: quando não há posições abertas).
   */
  function stopMarkPriceWs() {
    if (markPriceWsReconnectTimer) {
      clearTimeout(markPriceWsReconnectTimer);
      markPriceWsReconnectTimer = null;
    }
    if (markPriceWs) {
      markPriceWs.onclose = null; // evita reconexão automática
      try { markPriceWs.close(); } catch (_) {}
      markPriceWs = null;
    }
    markPriceWsActive = false;
  }

  /**
   * Chamado a cada tick do WebSocket para um symbol+markPrice.
   * Atualiza as células da linha correspondente sem re-renderizar a tabela.
   */
  function onMarkPriceUpdate(symbol, markPrice) {
    const posIdx = allPositionsList.findIndex(p => p.symbol === symbol);
    if (posIdx === -1) return; // sem posição aberta nesse par

    const pos = allPositionsList[posIdx];

    // Recalcula PnL e ROI com o novo mark price
    const size = Math.abs(pos.positionAmt);
    const isLong = pos.side === 'LONG';
    const newPnl = isLong
      ? (markPrice - pos.entryPrice) * size
      : (pos.entryPrice - markPrice) * size;
    const newRoi = isLong
      ? ((markPrice - pos.entryPrice) / pos.entryPrice) * pos.leverage * 100
      : ((pos.entryPrice - markPrice) / pos.entryPrice) * pos.leverage * 100;

    // Atualiza o objeto em memória
    pos.unRealizedProfit = newPnl;
    pos.roi = newRoi;
    pos.markPrice = markPrice;

    // Atualiza células no DOM (sem re-render da tabela)
    const pnlSign  = newPnl >= 0 ? '+' : '';
    const roiSign  = newRoi >= 0 ? '+' : '';
    const pnlClass = newPnl >= 0 ? 'color-long' : 'color-short';

    const markEl = document.getElementById(`tac-cell-mark-${symbol}`);
    const pnlEl  = document.getElementById(`tac-cell-pnl-${symbol}`);
    const rowEl  = document.querySelector(`.tac-pos-row[data-symbol="${symbol}"]`);

    if (markEl) {
      markEl.textContent = '$' + markPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }
    if (pnlEl) {
      pnlEl.className = `tac-pos-mono ${pnlClass}`;
      pnlEl.style.fontWeight = '700';
      pnlEl.innerHTML = `${pnlSign}$${newPnl.toFixed(2)} USDT <span style="font-size:9.5px;font-weight:600;">(${roiSign}${newRoi.toFixed(2)}%)</span>`;
    }
    // Pulso visual na linha ao atualizar
    if (rowEl) {
      rowEl.classList.remove('tac-row-pulse');
      void rowEl.offsetWidth; // força reflow para reiniciar animação
      rowEl.classList.add('tac-row-pulse');
    }

    // Atualiza também o preço de marca no painel lateral (se for o par atual)
    if (symbol === currentSymbol) {
      currentPrice = markPrice;
      syncSymbolPrice();
    }
  }

  /**
   * Renderiza a tabela de posições abertas no menu inferior
   */
  function renderPositionsTable(positions) {
    allPositionsList = Array.isArray(positions) ? positions : [];
    const tbody = document.getElementById('tac-positions-tbody');
    const countEl = document.getElementById('tac-bmenu-pos-count');
    if (countEl) countEl.textContent = allPositionsList.length;

    if (!tbody) return;

    if (!allPositionsList || allPositionsList.length === 0) {
      tbody.innerHTML = `
        <tr class="tac-pos-empty-row">
          <td colspan="9">Nenhuma posição aberta no momento</td>
        </tr>
      `;
      stopMarkPriceWs(); // sem posições, fecha o WS para economizar
      return;
    }

    // Inicia / mantém o WebSocket de mark price em tempo real
    if (!markPriceWsActive) {
      startMarkPriceWs();
    }

    tbody.innerHTML = allPositionsList.map(pos => {
      const isLong = pos.side === 'LONG';
      const baseSym = pos.symbol.replace('USDT', '');
      const pnlSign = pos.unRealizedProfit >= 0 ? '+' : '';
      const roiSign = pos.roi >= 0 ? '+' : '';
      const pnlClass = pos.unRealizedProfit >= 0 ? 'color-long' : 'color-short';
      const tpFormatted = pos.tpPrice ? Number(pos.tpPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--';
      const slFormatted = pos.slPrice ? Number(pos.slPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--';
      const hasTpSl = Boolean(pos.tpPrice || pos.slPrice);

      return `
        <tr class="tac-pos-row" data-symbol="${pos.symbol}">
          <!-- Símbolo -->
          <td>
            <div class="tac-pos-sym-group">
              <span class="tac-pos-side-badge ${isLong ? 'long' : 'short'}">${pos.side}</span>
              <span class="tac-pos-sym-name" onclick="window._setTacPair && window._setTacPair('${baseSym}')" style="cursor:pointer;" title="Clique para abrir o gráfico de ${pos.symbol}">
                <strong style="color:var(--tac-text-primary);">${pos.symbol}</strong>
                <span class="tac-pos-sym-sub">Perp ${pos.leverage}x</span>
              </span>
            </div>
          </td>
          <!-- Tamanho -->
          <td class="tac-pos-mono ${isLong ? 'color-long' : 'color-short'}" style="font-weight:700;">
            ${Math.abs(pos.positionAmt)} ${baseSym}
          </td>
          <!-- Preço de Entrada -->
          <td class="tac-pos-mono">$${pos.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <!-- Preço de Marca (atualizado em tempo real) -->
          <td class="tac-pos-mono" id="tac-cell-mark-${pos.symbol}">$${pos.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <!-- Preço Liq. -->
          <td class="tac-pos-mono" style="color:#f6465d;">
            ${pos.liquidationPrice > 0 ? '$' + pos.liquidationPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}
          </td>
          <!-- Margem -->
          <td class="tac-pos-mono">
            $${pos.margin.toFixed(2)} USDT <span style="font-size:9.5px;color:#848e9c;">(${pos.marginType})</span>
          </td>
          <!-- PNL (ROI %) — atualizado em tempo real -->
          <td class="tac-pos-mono ${pnlClass}" id="tac-cell-pnl-${pos.symbol}" style="font-weight:700;">
            ${pnlSign}$${pos.unRealizedProfit.toFixed(2)} USDT
            <span style="font-size:9.5px;font-weight:600;">(${roiSign}${pos.roi.toFixed(2)}%)</span>
          </td>
          <!-- TP / SL para posição -->
          <td>
            <div class="tac-pos-tpsl-cell">
              <span>
                <span style="color:#0ecb81;" title="Take Profit">${tpFormatted}</span> / 
                <span style="color:#f6465d;" title="Stop Loss">${slFormatted}</span>
              </span>
              <button type="button" class="tac-pos-btn-edit-tpsl" onclick="window.OrderPanel.openTpSlModal('${pos.symbol}')" title="${hasTpSl ? 'Editar Take Profit e Stop Loss' : 'Adicionar Take Profit e Stop Loss'}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
            </div>
          </td>
          <!-- Fechar Posição -->
          <td style="text-align:right;">
            <button type="button" class="tac-pos-btn-market-close" onclick="window.OrderPanel.closePosition('${pos.symbol}')" title="Zerar posição a mercado">
              Market
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Renderiza a tabela de ordens abertas/condicionais no menu inferior
   */
  function renderOrdersTable(orders) {
    allConditionalOrdersList = Array.isArray(orders) ? orders : [];
    const tbody = document.getElementById('tac-orders-tbody');
    const countEl = document.getElementById('tac-bmenu-orders-count');
    if (countEl) countEl.textContent = allConditionalOrdersList.length;

    if (!tbody) return;

    if (!allConditionalOrdersList || allConditionalOrdersList.length === 0) {
      tbody.innerHTML = `
        <tr class="tac-pos-empty-row">
          <td colspan="8">Nenhuma ordem condicional aberta no momento</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = allConditionalOrdersList.map(ord => {
      const isBuy = ord.side === 'BUY';
      const baseSym = (ord.symbol || '').replace('USDT', '');
      const sideBadge = isBuy ? 'BUY' : 'SELL';
      const sideClass = isBuy ? 'color-long' : 'color-short';
      const badgeClass = isBuy ? 'long' : 'short';
      const stopPriceVal = parseFloat(ord.stopPrice || ord.price || ord.triggerPrice) || 0;
      const stopFormatted = stopPriceVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      const qtyFormatted = `${ord.quantity} ${baseSym}`;
      const typeLabel = ord.type === 'TAKE_PROFIT_MARKET' ? 'Take Profit Market' : (ord.type === 'STOP_MARKET' ? 'Stop Market' : ord.type);

      return `
        <tr class="tac-pos-row" data-algo-id="${ord.algoId}">
          <!-- Símbolo -->
          <td>
            <div class="tac-pos-sym-group">
              <span class="tac-pos-side-badge ${badgeClass}">${sideBadge}</span>
              <span class="tac-pos-sym-name" onclick="window._setTacPair && window._setTacPair('${baseSym}')" style="cursor:pointer;" title="Clique para abrir o gráfico de ${ord.symbol}">
                <strong style="color:var(--tac-text-primary);">${ord.symbol}</strong>
                <span class="tac-pos-sym-sub">Perp</span>
              </span>
            </div>
          </td>
          <!-- Tipo -->
          <td style="color:#848e9c;font-size:10.5px;">${typeLabel}</td>
          <!-- Lado -->
          <td class="tac-pos-mono ${sideClass}" style="font-weight:700;">${sideBadge}</td>
          <!-- Preço de Disparo -->
          <td class="tac-pos-mono" style="color:#f0b90b;font-weight:700;">$${stopFormatted}</td>
          <!-- Preço de Execução -->
          <td class="tac-pos-mono" style="color:#848e9c;">Market</td>
          <!-- Quantidade -->
          <td class="tac-pos-mono" style="font-weight:700;">${qtyFormatted}</td>
          <!-- Reduce-Only -->
          <td style="font-size:10px;color:#848e9c;">${ord.reduceOnly ? '<span style="color:#f0b90b;font-weight:700;">Sim</span>' : 'Não'}</td>
          <!-- Ação Cancelar -->
          <td style="text-align:right;">
            <button type="button" class="tac-pos-btn-market-close" style="background:rgba(246,70,93,0.15);color:#f6465d;border:1px solid rgba(246,70,93,0.3);" onclick="window.OrderPanel.cancelConditionalOrderById('${ord.algoId}', '${ord.symbol}', ${stopPriceVal})" title="Cancelar ordem condicional">
              Cancelar
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Cancela uma ordem condicional específica na Binance (sem popup de confirmação)
   */
  async function cancelConditionalOrderById(algoId, symbol, price) {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de cancelar ordens.');
      return;
    }
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    const sym = symbol || currentSymbol;
    setToast(`Cancelando ordem condicional ${sym}...`, '');
    try {
      const res = await fetch('/api/trade/cancel-conditional', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret, symbol: sym, algoId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ Ordem condicional cancelada!`, 'success');
      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao cancelar ordem condicional:', err);
      setToast(`Erro: ${err.message}`, 'error');
      alert(`Erro ao cancelar ordem: ${err.message}`);
    }
  }

  /**
   * Modifica o preço de disparo de uma ordem condicional arrastada no gráfico (sem popup)
   */
  async function modifyConditionalOrderById(algoId, symbol, newStopPrice) {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Desbloqueie o painel para mover ordens.');
      return;
    }
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    const sym = symbol || currentSymbol;
    setToast(`Movendo ordem condicional para $${newStopPrice}...`, '');
    try {
      const res = await fetch('/api/trade/modify-conditional', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret, symbol: sym, algoId, newStopPrice })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ Ordem condicional movida para $${newStopPrice}!`, 'success');
      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao mover ordem condicional:', err);
      setToast(`Erro: ${err.message}`, 'error');
      alert(`Erro ao mover ordem: ${err.message}`);
      fetchAccountData();
    }
  }

  /**
   * Abre o modal de ajuste de TP / SL para o símbolo informado.
   * @param {string} symbol - Ex: "ETHUSDT"
   * @param {number} [prefillTp] - Valor de TP a pré-preencher (usado pelo drag & drop do gráfico)
   * @param {number} [prefillSl] - Valor de SL a pré-preencher (usado pelo drag & drop do gráfico)
   */
  function openTpSlModal(symbol, prefillTp, prefillSl) {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado para desbloquear antes de ajustar ordens.');
      return;
    }
    const pos = allPositionsList.find(p => p.symbol === symbol);
    if (!pos) {
      alert(`Posição em ${symbol} não encontrada.`);
      return;
    }

    modalActiveSymbol = symbol;
    modalActivePos = pos;

    const modalEl = document.getElementById('modal-tpsl');
    if (!modalEl) return;

    const isLong = pos.side === 'LONG';
    const symTag = document.getElementById('modal-tpsl-sym-tag');
    if (symTag) {
      symTag.innerHTML = `<strong>${pos.symbol}</strong> <span style="color:${isLong ? '#0ecb81' : '#f6465d'};font-weight:700;">${isLong ? 'Longo' : 'Curto'} ${pos.leverage}x</span>`;
    }

    const entryEl = document.getElementById('modal-tpsl-entry-val');
    if (entryEl) entryEl.textContent = `$${pos.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const markEl = document.getElementById('modal-tpsl-mark-val');
    if (markEl) markEl.textContent = `$${pos.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const liqEl = document.getElementById('modal-tpsl-liq-val');
    if (liqEl) {
      liqEl.textContent = pos.liquidationPrice > 0 ? `$${pos.liquidationPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '--';
    }

    const inputTp = document.getElementById('modal-tpsl-input-tp');
    const inputSl = document.getElementById('modal-tpsl-input-sl');
    const btnClrTp = document.getElementById('modal-tpsl-clear-tp');
    const btnClrSl = document.getElementById('modal-tpsl-clear-sl');

    // Se vieram valores do drag & drop, usa-os; senão usa os valores salvos na posição
    const tpValue = prefillTp && prefillTp > 0 ? prefillTp : (pos.tpPrice || '');
    const slValue = prefillSl && prefillSl > 0 ? prefillSl : (pos.slPrice || '');

    if (inputTp) inputTp.value = tpValue;
    if (inputSl) inputSl.value = slValue;

    if (btnClrTp) btnClrTp.style.display = tpValue ? 'inline' : 'none';
    if (btnClrSl) btnClrSl.style.display = slValue ? 'inline' : 'none';

    updateModalTpSlHints();

    modalEl.style.display = 'flex';
  }

  /**
   * Fecha o modal de TP / SL
   */
  function closeTpSlModal() {
    const modalEl = document.getElementById('modal-tpsl');
    if (modalEl) modalEl.style.display = 'none';
    modalActiveSymbol = null;
    modalActivePos = null;
  }

  function clearSingleTp() {
    const inputTp = document.getElementById('modal-tpsl-input-tp');
    if (inputTp) inputTp.value = '';
    const btnClrTp = document.getElementById('modal-tpsl-clear-tp');
    if (btnClrTp) btnClrTp.style.display = 'none';
    updateModalTpSlHints();
  }

  function clearSingleSl() {
    const inputSl = document.getElementById('modal-tpsl-input-sl');
    if (inputSl) inputSl.value = '';
    const btnClrSl = document.getElementById('modal-tpsl-clear-sl');
    if (btnClrSl) btnClrSl.style.display = 'none';
    updateModalTpSlHints();
  }

  /**
   * Atualiza dinamicamente as dicas de PnL e ROI % no modal conforme digitação
   */
  function updateModalTpSlHints() {
    if (!modalActivePos) return;
    const isLong = modalActivePos.side === 'LONG';
    const entry = modalActivePos.entryPrice || 0;
    const size = Math.abs(modalActivePos.positionAmt) || 0;
    const lev = modalActivePos.leverage || 1;

    const inputTp = document.getElementById('modal-tpsl-input-tp');
    const inputSl = document.getElementById('modal-tpsl-input-sl');
    const hintTp = document.getElementById('modal-tpsl-tp-hint');
    const hintSl = document.getElementById('modal-tpsl-sl-hint');
    const rrBox = document.getElementById('modal-tpsl-rr-box');
    const rrVal = document.getElementById('modal-tpsl-rr-val');

    const tpVal = parseFloat(String(inputTp?.value || '').replace(',', '.')) || 0;
    const slVal = parseFloat(String(inputSl?.value || '').replace(',', '.')) || 0;

    let tpPnl = 0;
    let tpRoi = 0;
    let slPnl = 0;
    let slRoi = 0;

    if (tpVal > 0 && entry > 0 && size > 0) {
      tpPnl = isLong ? (tpVal - entry) * size : (entry - tpVal) * size;
      tpRoi = isLong ? ((tpVal - entry) / entry) * lev * 100 : ((entry - tpVal) / entry) * lev * 100;
      const sign = tpPnl >= 0 ? '+' : '';
      const roiSign = tpRoi >= 0 ? '+' : '';
      const col = tpPnl >= 0 ? '#0ecb81' : '#f6465d';
      if (hintTp) {
        hintTp.innerHTML = `Quando o preço de marca atingir <strong>${tpVal} USDT</strong>, será acionada uma ordem a mercado. Lucro estimado de <strong style="color:${col};">${sign}$${tpPnl.toFixed(2)} USDT (${roiSign}${tpRoi.toFixed(2)}%)</strong>.`;
      }
    } else {
      if (hintTp) hintTp.innerHTML = 'Insira o preço para realizar lucro.';
    }

    if (slVal > 0 && entry > 0 && size > 0) {
      slPnl = isLong ? (slVal - entry) * size : (entry - slVal) * size;
      slRoi = isLong ? ((slVal - entry) / entry) * lev * 100 : ((entry - slVal) / entry) * lev * 100;
      const sign = slPnl >= 0 ? '+' : '';
      const roiSign = slRoi >= 0 ? '+' : '';
      const col = slPnl >= 0 ? '#0ecb81' : '#f6465d';
      if (hintSl) {
        hintSl.innerHTML = `Quando o preço de marca atingir <strong>${slVal} USDT</strong>, será acionada uma ordem a mercado. Prejuízo estimado de <strong style="color:${col};">${sign}$${slPnl.toFixed(2)} USDT (${roiSign}${slRoi.toFixed(2)}%)</strong>.`;
      }
    } else {
      if (hintSl) hintSl.innerHTML = 'Insira o preço de proteção contra perdas.';
    }

    // Risco:Retorno
    if (tpVal > 0 && slVal > 0 && entry > 0) {
      const profitDist = Math.abs(tpVal - entry);
      const lossDist = Math.abs(entry - slVal);
      if (lossDist > 0 && rrBox && rrVal) {
        const ratio = (profitDist / lossDist).toFixed(2);
        rrVal.textContent = `1 : ${ratio}`;
        rrBox.style.display = 'flex';
      } else if (rrBox) {
        rrBox.style.display = 'none';
      }
    } else if (rrBox) {
      rrBox.style.display = 'none';
    }
  }

  /**
   * Salva as ordens de TP e SL via Modal na Binance
   */
  async function saveTpSlModal() {
    if (!modalActiveSymbol) return;
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) {
      alert('Configure suas chaves API antes de enviar ordens.');
      return;
    }

    const inputTp = document.getElementById('modal-tpsl-input-tp');
    const inputSl = document.getElementById('modal-tpsl-input-sl');
    const tpVal = parseFloat(String(inputTp?.value || '').replace(',', '.')) || 0;
    const slVal = parseFloat(String(inputSl?.value || '').replace(',', '.')) || 0;

    // Se ambos estiverem vazios/zerados, cancela ordens existentes
    if (tpVal <= 0 && slVal <= 0) {
      if (!confirm(`Deseja remover o Take Profit e o Stop Loss de ${modalActiveSymbol}?`)) return;
      try {
        await fetch('/api/trade/cancel-tpsl', {
          method: 'POST',
          headers: getTradeAuthHeaders(),
          body: JSON.stringify({ apiKey, apiSecret, symbol: modalActiveSymbol })
        });
        setToast('Ordens de TP/SL canceladas!', 'success');
        closeTpSlModal();
        fetchAccountData();
      } catch (e) {
        alert(`Erro: ${e.message}`);
      }
      return;
    }

    const btnConfirm = document.getElementById('modal-tpsl-btn-confirm');
    if (btnConfirm) btnConfirm.disabled = true;

    try {
      const res = await fetch('/api/trade/set-tpsl', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({
          apiKey,
          apiSecret,
          symbol: modalActiveSymbol,
          takeProfit: tpVal > 0 ? tpVal : '',
          stopLoss: slVal > 0 ? slVal : ''
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ TP/SL atualizado em ${modalActiveSymbol}!`, 'success');
      closeTpSlModal();
      fetchAccountData();
    } catch (err) {
      alert(`Erro ao configurar TP/SL na Binance: ${err.message}`);
    } finally {
      if (btnConfirm) btnConfirm.disabled = false;
    }
  }

  /**
   * Encerra posição a mercado
   */
  async function closePosition(sym) {
    const targetSymbol = sym || currentSymbol;
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de zerar posição.');
      return;
    }
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    if (!confirm(`Deseja encerrar a mercado toda a sua posição em ${targetSymbol}?`)) return;

    setToast(`Encerrando posição em ${targetSymbol} a mercado...`, '');
    try {
      const res = await fetch('/api/trade/close', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret, symbol: targetSymbol })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ Posição em ${targetSymbol} zerada!`, 'success');
      if (targetSymbol === currentSymbol && window.ChartPositions) {
        window.ChartPositions.clearAllLines();
      }
      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao fechar posição:', err);
      setToast(`Erro: ${err.message}`, 'error');
      alert(`Erro ao encerrar posição: ${err.message}`);
    }
  }

  /**
   * Cancela apenas o Take Profit da posição
   */
  async function cancelPositionTp(sym) {
    const targetSymbol = sym || currentSymbol;
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de cancelar ordens.');
      return;
    }
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    if (!confirm(`Deseja cancelar o Take Profit de ${targetSymbol}?`)) return;

    setToast(`Cancelando Take Profit de ${targetSymbol}...`, '');
    try {
      const res = await fetch('/api/trade/cancel-tp', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret, symbol: targetSymbol })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ Take Profit de ${targetSymbol} cancelado!`, 'success');
      if (window.ChartPositions) {
        window.ChartPositions.updateTpLine(null);
      }
      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao cancelar Take Profit:', err);
      setToast(`Erro: ${err.message}`, 'error');
      alert(`Erro ao cancelar Take Profit: ${err.message}`);
    }
  }

  /**
   * Cancela apenas o Stop Loss da posição
   */
  async function cancelPositionSl(sym) {
    const targetSymbol = sym || currentSymbol;
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de cancelar ordens.');
      return;
    }
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    if (!confirm(`Deseja cancelar o Stop Loss de ${targetSymbol}?`)) return;

    setToast(`Cancelando Stop Loss de ${targetSymbol}...`, '');
    try {
      const res = await fetch('/api/trade/cancel-sl', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret, symbol: targetSymbol })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ Stop Loss de ${targetSymbol} cancelado!`, 'success');
      if (window.ChartPositions) {
        window.ChartPositions.updateSlLine(null);
      }
      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao cancelar Stop Loss:', err);
      setToast(`Erro: ${err.message}`, 'error');
      alert(`Erro ao cancelar Stop Loss: ${err.message}`);
    }
  }

  let rateLimitCooldownUntil = 0;

  function handleRateLimitBan(errMsg) {
    let waitMs = 30000;
    const match = errMsg && String(errMsg).match(/banned until (\d+)/i);
    if (match && match[1]) {
      const banTime = parseInt(match[1], 10);
      if (banTime > Date.now()) {
        waitMs = banTime - Date.now() + 2000;
      }
    }
    rateLimitCooldownUntil = Date.now() + waitMs;
    const secs = Math.ceil(waitMs / 1000);
    console.warn(`[OrderPanel] Rate-limit Binance detectado. Aguardando ${secs}s antes de novas requisições.`);
    setToast(`⚠️ Rate-limit Binance: pausando requisições por ${secs}s para estabilizar IP...`, 'error');
  }

  /**
   * Busca dados da conta e da posição via API local
   */
  async function fetchAccountData() {
    if (Date.now() < rateLimitCooldownUntil) {
      return;
    }

    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) {
      const balEl = document.getElementById('bop-val-balance');
      if (balEl) balEl.textContent = 'Clique na 🔑';
      renderPositionsTable([]);
      return;
    }

    try {
      // 1. Saldo
      const balRes = await fetch('/api/trade/balance', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret })
      });
      const balData = await balRes.json();
      if (balRes.status === 401) {
        const balEl = document.getElementById('bop-val-balance');
        if (balEl) balEl.textContent = 'Token Inválido';
        setToast('🔒 Token de segurança do servidor inválido.', 'error');
        return;
      }
      if (balData.success) {
        const balEl = document.getElementById('bop-val-balance');
        if (balEl) {
          balEl.textContent = `$${Number(balData.availableBalance).toFixed(2)}`;
        }
      } else {
        const balEl = document.getElementById('bop-val-balance');
        if (balEl) {
          balEl.textContent = 'Erro na chave/IP';
          balEl.title = balData.error || 'Verifique se o IP está salvo na Binance';
        }
        console.warn('[/api/trade/balance] Erro:', balData.error);
        if (balData.error && (balData.error.includes('-1003') || balData.error.includes('Way too many requests'))) {
          handleRateLimitBan(balData.error);
          return;
        } else if (balData.error && (balData.error.includes('-2015') || balData.error.includes('IP') || balData.error.includes('Invalid API-key'))) {
          setToast('⚠️ Binance: ' + balData.error, 'error');
        }
      }

      // 2. Todas as posições ativas da conta (para o Menu Inferior)
      initBottomMenuTabs();
      const allPosRes = await fetch('/api/trade/all-positions', {
        method: 'POST',
        headers: getTradeAuthHeaders(),
        body: JSON.stringify({ apiKey, apiSecret })
      });
      const allPosData = await allPosRes.json();
      if (allPosData.success && Array.isArray(allPosData.positions)) {
        renderPositionsTable(allPosData.positions);

        // Se o par atualmente aberto no gráfico estiver posicionado, plota as linhas no gráfico
        const currentActivePos = allPosData.positions.find(p => p.symbol === currentSymbol);
        if (currentActivePos) {
          currentPositionData = currentActivePos;
          if (window.ChartPositions) {
            window.ChartPositions.updatePositionLine(currentActivePos);
            window.ChartPositions.updateTpLine(currentActivePos.tpPrice || 0);
            window.ChartPositions.updateSlLine(currentActivePos.slPrice || 0);
          }
        } else {
          currentPositionData = null;
          if (window.ChartPositions) {
            window.ChartPositions.clearAllLines();
          }
        }
      } else {
        if (allPosData.error && (allPosData.error.includes('-1003') || allPosData.error.includes('Way too many requests'))) {
          handleRateLimitBan(allPosData.error);
          return;
        }
        // Em caso de falha transitória, mantém os dados visuais anteriores em vez de limpar tudo
        console.warn('[/api/trade/all-positions] Resposta não-sucedida, mantendo estado anterior.');
      }

      // 3. Todas as ordens abertas / condicionais (para o Menu Inferior e gráfico)
      try {
        const openOrdersRes = await fetch('/api/trade/open-orders', {
          method: 'POST',
          headers: getTradeAuthHeaders(),
          body: JSON.stringify({ apiKey, apiSecret, symbol: 'ALL' })
        });
        const openOrdersData = await openOrdersRes.json();
        if (openOrdersData.success && Array.isArray(openOrdersData.conditionalOrders)) {
          const condOrders = openOrdersData.conditionalOrders;
          renderOrdersTable(condOrders);

          // Atualiza as linhas de ordens condicionais no gráfico apenas para o par ativo
          if (window.ChartPositions) {
            const pairCondOrders = condOrders.filter(o => o.symbol === currentSymbol);
            window.ChartPositions.updateConditionalLines(pairCondOrders);
          }
        } else if (openOrdersData.error && (openOrdersData.error.includes('-1003') || openOrdersData.error.includes('Way too many requests'))) {
          handleRateLimitBan(openOrdersData.error);
          return;
        }
      } catch (errOpen) {
        console.warn('[/api/trade/open-orders] Aviso:', errOpen.message);
      }

      if (window._syncTacChartHeight) {
        window._syncTacChartHeight();
      }
    } catch (err) {
      console.warn('[OrderPanel] Polling warning:', err.message);
    }
  }

  /**
   * Envia ordem a mercado com a quantidade informada na moeda
   */
  async function sendTrade(side) {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de executar qualquer trade.');
      return;
    }

    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) {
      alert('Por favor, clique no ícone da chave 🔑 para configurar suas credenciais da Binance.');
      return;
    }

    const input = document.getElementById('bop-input-qty');
    const qty = parseFloat(input?.value) || 0;
    if (qty <= 0) {
      alert(`Insira uma quantidade válida de ${baseAsset} para o trade.`);
      return;
    }

    recalculateDynamicMinQty();
    const estCost = qty * currentPrice;

    if (qty < symbolInfo.minQty || (symbolInfo.minNotional > 0 && estCost < (symbolInfo.minNotional - 0.01))) {
      const notionalInfo = symbolInfo.minNotional > 0
        ? `\nRegra Binance Futures: O valor da ordem deve ser de no mínimo $${symbolInfo.minNotional} USDT (atual: ~$${estCost.toFixed(2)} USDT).`
        : '';
      alert(`Quantidade abaixo do mínimo permitido pela Binance!\n\nO mínimo atual para ${currentSymbol} é ${symbolInfo.minQty} ${baseAsset} (~$${(symbolInfo.minQty * currentPrice).toFixed(2)} USDT).${notionalInfo}`);
      return;
    }

    const btnBuy = document.getElementById('bop-btn-buy');
    const btnSell = document.getElementById('bop-btn-sell');
    if (btnBuy) btnBuy.disabled = true;
    if (btnSell) btnSell.disabled = true;

    try {
      if (currentOrderType === 'conditional') {
        // ─── Envio de Ordem Condicional a Mercado ───
        const inputStop = document.getElementById('bop-input-stop-price');
        const stopVal = parseFloat(String(inputStop?.value || '').replace(',', '.')) || 0;
        if (stopVal <= 0) {
          alert(`Insira um Preço de Disparo (Stop Price) válido em USDT para a ordem condicional.`);
          if (btnBuy) btnBuy.disabled = false;
          if (btnSell) btnSell.disabled = false;
          return;
        }

        const isReduceOnly = Boolean(document.getElementById('bop-check-reduce-only')?.checked);
        setToast(`Agendando ordem condicional ${side} em $${stopVal}...`, '');

        const payload = {
          apiKey,
          apiSecret,
          symbol: currentSymbol,
          side,
          quantity: qty,
          stopPrice: stopVal,
          reduceOnly: isReduceOnly
        };

        const res = await fetch('/api/trade/conditional-order', {
          method: 'POST',
          headers: getTradeAuthHeaders(),
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Falha ao agendar ordem condicional.');
        }

        const roText = isReduceOnly ? ' (Reduce-Only)' : '';
        setToast(`✅ Condicional ${side} agendada em $${data.stopPrice}${roText}!`, 'success');

        try {
          const audio = new Audio('assets/audio/notificacao.mp3');
          audio.play().catch(() => {});
        } catch (_) {}

        if (inputStop) inputStop.value = '';
        fetchAccountData();
      } else {
        // ─── Envio de Ordem a Mercado Direta ───
        setToast(`Enviando ordem ${side} de ${qty} ${baseAsset}...`, '');

        const payload = {
          apiKey,
          apiSecret,
          symbol: currentSymbol,
          side,
          quantity: qty
        };

        const res = await fetch('/api/trade/order', {
          method: 'POST',
          headers: getTradeAuthHeaders(),
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Falha ao executar ordem.');
        }

        const numAvg = parseFloat(data.order?.avgPrice) || currentPrice || 0;
        const dec = symbolInfo.priceDecimals || 4;
        const formattedPrice = numAvg > 0 ? `$${numAvg.toFixed(dec)}` : '';
        setToast(`✅ ${side} executado! Preço: ${formattedPrice}`, 'success');

        try {
          const audio = new Audio('assets/audio/notificacao.mp3');
          audio.play().catch(() => {});
        } catch (_) {}

        fetchAccountData();
      }
    } catch (err) {
      console.error('[OrderPanel] Erro ao enviar ordem:', err);
      setToast(`Erro: ${err.message}`, 'error');
      alert(`Erro na ordem: ${err.message}`);
    } finally {
      if (btnBuy) btnBuy.disabled = false;
      if (btnSell) btnSell.disabled = false;
    }
  }



  /**
   * Inicia loop de atualização de dados da conta (a cada 5s para respeitar limites da Binance)
   */
  function startDataPolling() {
    if (pollInterval) clearInterval(pollInterval);
    fetchAccountData();
    pollInterval = setInterval(fetchAccountData, 5000);
  }

  /**
   * Notifica troca de símbolo ou preço a partir do gráfico tático
   */
  async function setMarketContext(symbol, price) {
    let changedSymbol = false;
    if (symbol && symbol !== currentSymbol) {
      currentSymbol = symbol;
      baseAsset = symbol.replace('USDT', '');
      changedSymbol = true;

      if (window.ChartPositions) {
        window.ChartPositions.clearAllLines();
      }
      fetchAccountData();
    }
    if (price && price > 0) {
      currentPrice = price;
    }

    if (changedSymbol) {
      // Ao trocar de par, busca regras atualizadas direto da Binance e reseta quantidade para o mínimo
      await fetchSymbolPrecision(symbol, true);
      recalculateDynamicMinQty();
      updateQuantityUI(true);
    } else if (price && price > 0) {
      // Quando o preço oscila em tempo real, recalcula dinamicamente se o minQty mudou
      const changed = recalculateDynamicMinQty();
      if (changed) {
        updateQuantityUI(false);
      } else {
        validateAndCalcCost();
      }
    }

    syncSymbolPrice();
  }

  // Exporta globalmente
  window.OrderPanel = {
    init: initOrderPanel,
    setMarketContext,
    openTpSlModal,
    closeTpSlModal,
    saveTpSlModal,
    clearSingleTp,
    clearSingleSl,
    cancelPositionTp,
    cancelPositionSl,
    closePosition,
    cancelConditionalOrderById,
    modifyConditionalOrderById,
    refreshPositions: fetchAccountData,
    getPrecision: () => symbolInfo
  };

  // Garante inicialização mesmo se o DOM do gráfico for gerado dinamicamente
  function tryInit() {
    if (document.getElementById('binance-order-panel')) {
      initOrderPanel();
      return true;
    }
    return false;
  }

  if (!tryInit()) {
    const observer = new MutationObserver(() => {
      if (tryInit()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
