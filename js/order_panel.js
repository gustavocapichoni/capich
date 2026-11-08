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

  let currentSymbol = 'UNIUSDT';
  let baseAsset = 'UNI';
  let currentPrice = 0;
  let currentPositionData = null;
  let isPanelLocked = localStorage.getItem(STORAGE_KEY_LOCKED) === 'true';
  let pollInterval = null;

  // Informações de precisão da Binance para o ativo atual
  let symbolInfo = {
    minQty: 1,
    stepSize: 1,
    decimals: 0
  };

  /**
   * Obtém credenciais salvas no navegador
   */
  function getStoredKeys() {
    return {
      apiKey: localStorage.getItem(STORAGE_KEY_API) || '',
      apiSecret: localStorage.getItem(STORAGE_KEY_SEC) || ''
    };
  }

  /**
   * Salva credenciais no navegador
   */
  function saveStoredKeys(apiKey, apiSecret) {
    if (apiKey) localStorage.setItem(STORAGE_KEY_API, apiKey.trim());
    if (apiSecret) localStorage.setItem(STORAGE_KEY_SEC, apiSecret.trim());
  }

  /**
   * Busca as regras de quantidade mínima da Binance para o símbolo ativo
   */
  async function fetchSymbolPrecision(sym) {
    try {
      const res = await fetch(`/api/trade/symbol-info?symbol=${sym}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        symbolInfo = {
          minQty: data.minQty || 0.001,
          stepSize: data.stepSize || 0.001,
          decimals: data.decimals || 0
        };
        updateQuantityUI();
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
          <span style="font-size: 14px;">⚡</span>
          <span class="bop-title">Execução Binance</span>
        </div>
        <div class="bop-header-actions">
          <button class="bop-btn-lock" id="bop-btn-lock" title="Bloquear / Desbloquear painel">🔓</button>
          <button class="bop-btn-config" id="bop-btn-open-config" title="Configurar Chaves API da Binance">🔑</button>
        </div>
      </div>

      <!-- Símbolo e Preço Atual -->
      <div class="bop-symbol-bar">
        <span class="bop-symbol-name" id="bop-symbol-label">${currentSymbol}</span>
        <span class="bop-symbol-price" id="bop-price-label">$--</span>
      </div>

      <!-- Caixa de Conta: Saldo & Posição -->
      <div class="bop-account-box">
        <div class="bop-row-balance">
          <span>Saldo USDT:</span>
          <span class="bop-val-balance" id="bop-val-balance">Carregando...</span>
        </div>
        <div class="bop-position-status" id="bop-position-container">
          <div class="bop-pos-empty">
            <span>●</span>
            <span>Sem posição aberta</span>
          </div>
        </div>
      </div>

      <!-- Quantidade Direta no Ativo -->
      <div class="bop-amount-box">
        <div class="bop-section-label" id="bop-qty-label">QUANTIDADE (${baseAsset})</div>
        <div class="bop-input-group">
          <input type="number" id="bop-input-qty" class="bop-input-amount" placeholder="0" step="any">
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

      <!-- Take Profit & Stop Loss (Gerenciamento de Risco) -->
      <div class="bop-tpsl-box">
        <div class="bop-tpsl-header">
          <span>🎯 TP &amp; 🛑 SL</span>
          <span id="bop-tpsl-status" style="font-size:9px;color:#848e9c;">(Opcional)</span>
        </div>
        <div class="bop-tpsl-grid">
          <div class="bop-tpsl-col">
            <span class="bop-tpsl-label tp">🎯 TAKE PROFIT</span>
            <input type="number" id="bop-input-tp" class="bop-input-tpsl tp" placeholder="Preço TP ($)" step="any">
          </div>
          <div class="bop-tpsl-col">
            <span class="bop-tpsl-label sl">🛑 STOP LOSS</span>
            <input type="number" id="bop-input-sl" class="bop-input-tpsl sl" placeholder="Preço SL ($)" step="any">
          </div>
        </div>
        <div class="bop-tpsl-actions" id="bop-tpsl-actions">
          <button class="bop-btn-tpsl-apply" id="bop-btn-set-tpsl" title="Aplica ou atualiza o TP/SL na posição atual">💾 Salvar TP/SL</button>
          <button class="bop-btn-tpsl-cancel" id="bop-btn-cancel-tpsl" title="Cancela ordens de TP/SL abertas na Binance">✕ Limpar</button>
        </div>
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
          <div class="bop-modal-footer">
            <button class="bop-btn-cancel" id="bop-cfg-cancel">Cancelar</button>
            <button class="bop-btn-save" id="bop-cfg-save">Salvar Chaves</button>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    fetchSymbolPrecision(currentSymbol);
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
      'bop-input-tp', 'bop-input-sl',
      'bop-btn-set-tpsl', 'bop-btn-cancel-tpsl',
      'bop-btn-buy', 'bop-btn-sell',
      'bop-btn-close'
    ];
    interactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isPanelLocked;
    });
  }

  /**
   * Associa eventos aos elementos da interface
   */
  function bindEvents() {
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
        saveStoredKeys(k, s);
        closeModal();
        setToast('Chaves salvas com sucesso!', 'success');
        fetchAccountData();
      };
    }

    // Input de Quantidade
    const inputQty = document.getElementById('bop-input-qty');
    if (inputQty) {
      inputQty.oninput = () => {
        validateAndCalcCost();
      };
    }

    // Botões rápidos de quantidade baseados na regra da Binance
    const btnMin = document.getElementById('bop-btn-min');
    const btn2x = document.getElementById('bop-btn-2x');
    const btn5x = document.getElementById('bop-btn-5x');
    const btn10x = document.getElementById('bop-btn-10x');

    function setQtyMultiplier(mult) {
      if (isPanelLocked) return;
      if (!inputQty) return;
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

    // Botões e inputs de TP / SL
    const btnSetTpSl = document.getElementById('bop-btn-set-tpsl');
    const btnCancelTpSl = document.getElementById('bop-btn-cancel-tpsl');
    const inputTp = document.getElementById('bop-input-tp');
    const inputSl = document.getElementById('bop-input-sl');

    if (btnSetTpSl) btnSetTpSl.onclick = () => saveTpSl();
    if (btnCancelTpSl) btnCancelTpSl.onclick = () => cancelTpSl();

    if (inputTp) {
      inputTp.oninput = () => {
        const val = parseFloat(String(inputTp.value).replace(',', '.')) || 0;
        if (window.ChartPositions) window.ChartPositions.updateTpLine(val);
      };
    }
    if (inputSl) {
      inputSl.oninput = () => {
        const val = parseFloat(String(inputSl.value).replace(',', '.')) || 0;
        if (window.ChartPositions) window.ChartPositions.updateSlLine(val);
      };
    }

    // Aplica estado de bloqueio persistido
    applyLockState(isPanelLocked);
  }

  /**
   * Atualiza as labels, sufixos e valores padrão conforme o par ativo
   */
  function updateQuantityUI() {
    baseAsset = currentSymbol.replace('USDT', '');
    const labelQty = document.getElementById('bop-qty-label');
    const suffix = document.getElementById('bop-input-suffix');
    const minValEl = document.getElementById('bop-min-val');
    const inputQty = document.getElementById('bop-input-qty');

    if (labelQty) labelQty.textContent = `QUANTIDADE (${baseAsset})`;
    if (suffix) suffix.textContent = baseAsset;
    if (minValEl) minValEl.textContent = `${symbolInfo.minQty} ${baseAsset}`;

    if (inputQty) {
      inputQty.step = symbolInfo.stepSize.toString();
      // Se estiver vazio ou zerado, preenche com a quantidade mínima padrão
      if (!inputQty.value || parseFloat(inputQty.value) <= 0) {
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

    const qty = parseFloat(inputQty.value) || 0;
    const cost = qty * currentPrice;

    costEl.textContent = `Custo aprox: $${cost.toFixed(2)} USDT`;

    // Validação visual de quantidade mínima
    if (qty > 0 && qty < symbolInfo.minQty) {
      if (hintEl) {
        hintEl.innerHTML = `<span style="color:#f6465d;font-weight:700;">⚠️ Qtd mínima é ${symbolInfo.minQty} ${baseAsset}</span>`;
      }
    } else {
      if (hintEl) {
        hintEl.innerHTML = `ℹ️ Mínimo Binance: <strong>${symbolInfo.minQty} ${baseAsset}</strong>`;
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

  /**
   * Busca dados da conta e da posição via API local
   */
  async function fetchAccountData() {
    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) {
      const balEl = document.getElementById('bop-val-balance');
      if (balEl) balEl.textContent = 'Clique na 🔑';
      return;
    }

    try {
      // 1. Saldo
      const balRes = await fetch('/api/trade/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret })
      });
      const balData = await balRes.json();
      if (balData.success) {
        const balEl = document.getElementById('bop-val-balance');
        if (balEl) {
          balEl.textContent = `$${Number(balData.availableBalance).toFixed(2)}`;
        }
      }

      // 2. Posição no par ativo
      const posRes = await fetch('/api/trade/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, symbol: currentSymbol })
      });
      const posData = await posRes.json();
      currentPositionData = posData;

      const posContainer = document.getElementById('bop-position-container');
      if (posContainer && posData.success) {
        if (posData.hasPosition && Math.abs(posData.positionAmt) > 0) {
          const isLong = posData.side === 'LONG';
          const pnlColor = posData.unRealizedProfit >= 0 ? '#0ecb81' : '#f6465d';
          const pnlSign = posData.unRealizedProfit >= 0 ? '+' : '';

          posContainer.innerHTML = `
            <div class="bop-pos-active">
              <span class="bop-pos-badge ${isLong ? 'long' : 'short'}">${posData.side} ${Math.abs(posData.positionAmt)} ${baseAsset}</span>
              <span class="bop-pos-pnl" style="color:${pnlColor};">${pnlSign}$${Number(posData.unRealizedProfit).toFixed(2)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#848e9c;font-family:'JetBrains Mono',monospace;">
              <span>Entrada: $${posData.entryPrice}</span>
              <span>Liq: $${posData.liquidationPrice > 0 ? posData.liquidationPrice.toFixed(2) : '--'}</span>
            </div>
            <button class="bop-btn-close-pos" id="bop-btn-close">✕ Zerar Posição a Mercado</button>
          `;

          const btnClose = document.getElementById('bop-btn-close');
          if (btnClose) {
            btnClose.onclick = () => closePosition();
            if (isPanelLocked) btnClose.disabled = true;
          }

          // Plota ou atualiza linha no gráfico
          if (window.ChartPositions) {
            window.ChartPositions.updatePositionLine(posData);
          }
        } else {
          posContainer.innerHTML = `
            <div class="bop-pos-empty">
              <span>●</span>
              <span>Sem posição aberta</span>
            </div>
          `;
          // Limpa linha no gráfico
          if (window.ChartPositions) {
            window.ChartPositions.clearPositionLine();
          }
        }
      }

      // 3. Ordens Abertas (Take Profit e Stop Loss ativos)
      const ordRes = await fetch('/api/trade/open-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, symbol: currentSymbol })
      });
      const ordData = await ordRes.json();

      if (ordData.success) {
        const inputTp = document.getElementById('bop-input-tp');
        const inputSl = document.getElementById('bop-input-sl');
        const statusEl = document.getElementById('bop-tpsl-status');

        if (window.ChartPositions) {
          window.ChartPositions.updateTpLine(ordData.tpPrice);
          window.ChartPositions.updateSlLine(ordData.slPrice);
        }

        // Se o usuário não está digitando nos campos agora, preenche os valores atuais
        if (inputTp && document.activeElement !== inputTp) {
          if (ordData.tpPrice) inputTp.value = ordData.tpPrice;
        }
        if (inputSl && document.activeElement !== inputSl) {
          if (ordData.slPrice) inputSl.value = ordData.slPrice;
        }

        if (statusEl) {
          if (ordData.tpPrice || ordData.slPrice) {
            statusEl.innerHTML = '<span style="color:#0ecb81;font-weight:700;">🟢 Ativo</span>';
          } else {
            statusEl.innerHTML = '<span style="color:#848e9c;">(Opcional)</span>';
          }
        }
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

    if (qty < symbolInfo.minQty) {
      alert(`Quantidade abaixo do mínimo permitido pela Binance!\nO mínimo para ${currentSymbol} é ${symbolInfo.minQty} ${baseAsset}.`);
      return;
    }

    const tpVal = parseFloat(String(document.getElementById('bop-input-tp')?.value || '').replace(',', '.')) || 0;
    const slVal = parseFloat(String(document.getElementById('bop-input-sl')?.value || '').replace(',', '.')) || 0;

    const btnBuy = document.getElementById('bop-btn-buy');
    const btnSell = document.getElementById('bop-btn-sell');
    if (btnBuy) btnBuy.disabled = true;
    if (btnSell) btnSell.disabled = true;

    setToast(`Enviando ordem ${side} de ${qty} ${baseAsset}...`, '');

    try {
      const payload = {
        apiKey,
        apiSecret,
        symbol: currentSymbol,
        side,
        quantity: qty
      };
      if (tpVal > 0) payload.takeProfit = tpVal;
      if (slVal > 0) payload.stopLoss = slVal;

      const res = await fetch('/api/trade/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Falha ao executar ordem.');
      }

      setToast(`✅ ${side} executado! Preço: $${data.order.avgPrice}`, 'success');

      try {
        const audio = new Audio('assets/audio/notificacao.mp3');
        audio.play().catch(() => {});
      } catch (_) {}

      fetchAccountData();
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
   * Salva ou atualiza Take Profit e Stop Loss para a posição existente
   */
  async function saveTpSl() {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de alterar TP ou SL.');
      return;
    }

    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) {
      alert('Configure suas chaves API antes de definir Stop Loss ou Take Profit.');
      return;
    }

    const tpVal = parseFloat(String(document.getElementById('bop-input-tp')?.value || '').replace(',', '.')) || 0;
    const slVal = parseFloat(String(document.getElementById('bop-input-sl')?.value || '').replace(',', '.')) || 0;

    if (!tpVal && !slVal) {
      alert('Digite o valor de Take Profit ou Stop Loss antes de salvar.');
      return;
    }

    // Validação preventiva no cliente contra preço de mercado e tipo de posição:
    if (currentPositionData && currentPositionData.hasPosition && currentPrice > 0) {
      const isLong = currentPositionData.side === 'LONG';
      if (isLong) {
        if (slVal > 0 && slVal >= currentPrice) {
          alert(`❌ Posição em LONG (Compra):\nO Stop Loss ($${slVal}) não pode ser maior ou igual ao preço atual ($${currentPrice}).\nEle dispararia imediatamente na Binance! Em Long, o Stop Loss deve ficar ABAIXO do preço atual.`);
          return;
        }
        if (tpVal > 0 && tpVal <= currentPrice) {
          alert(`❌ Posição em LONG (Compra):\nO Take Profit ($${tpVal}) não pode ser menor ou igual ao preço atual ($${currentPrice}).\nEle dispararia imediatamente na Binance! Em Long, o Take Profit deve ficar ACIMA do preço atual.`);
          return;
        }
      } else {
        // SHORT
        if (slVal > 0 && slVal <= currentPrice) {
          alert(`❌ Posição em SHORT (Venda):\nO Stop Loss ($${slVal}) não pode ser menor ou igual ao preço atual ($${currentPrice}).\nEle dispararia imediatamente na Binance! Em Short, o Stop Loss deve ficar ACIMA do preço atual.`);
          return;
        }
        if (tpVal > 0 && tpVal >= currentPrice) {
          alert(`❌ Posição em SHORT (Venda):\nO Take Profit ($${tpVal}) não pode ser maior ou igual ao preço atual ($${currentPrice}).\nEle dispararia imediatamente na Binance! Em Short, o Take Profit deve ficar ABAIXO do preço atual.`);
          return;
        }
      }
    }

    const btn = document.getElementById('bop-btn-set-tpsl');
    if (btn) btn.disabled = true;
    setToast('Enviando TP/SL para a Binance...', '');

    try {
      const res = await fetch('/api/trade/set-tpsl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          apiSecret,
          symbol: currentSymbol,
          takeProfit: tpVal,
          stopLoss: slVal
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      if (data.partialWarning) {
        setToast(`⚠️ ${data.partialWarning}`, 'warning');
        alert(data.partialWarning);
      } else {
        setToast('✅ TP e SL atualizados na Binance!', 'success');
      }
      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao salvar TP/SL:', err);
      setToast(`Erro TP/SL: ${err.message}`, 'error');
      alert(`Erro ao configurar TP/SL: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /**
   * Cancela Take Profit e Stop Loss pendentes na Binance
   */
  async function cancelTpSl() {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de limpar ordens.');
      return;
    }

    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    if (!confirm(`Deseja cancelar todas as ordens pendentes de TP e SL em ${currentSymbol}?`)) return;

    setToast('Cancelando TP/SL na Binance...', '');
    try {
      const res = await fetch('/api/trade/cancel-tpsl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, symbol: currentSymbol })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const inputTp = document.getElementById('bop-input-tp');
      const inputSl = document.getElementById('bop-input-sl');
      if (inputTp) inputTp.value = '';
      if (inputSl) inputSl.value = '';

      if (window.ChartPositions) {
        window.ChartPositions.updateTpLine(0);
        window.ChartPositions.updateSlLine(0);
      }

      setToast('Ordens de TP/SL canceladas!', 'success');
      fetchAccountData();
    } catch (err) {
      setToast(`Erro ao cancelar: ${err.message}`, 'error');
    }
  }

  /**
   * Encerra posição a mercado
   */
  async function closePosition() {
    if (isPanelLocked) {
      alert('🔒 Painel bloqueado! Clique no cadeado no topo para desbloquear antes de zerar posição.');
      return;
    }

    const { apiKey, apiSecret } = getStoredKeys();
    if (!apiKey || !apiSecret) return;

    if (!confirm(`Deseja encerrar a mercado toda a sua posição em ${currentSymbol}?`)) return;

    setToast('Encerrando posição a mercado...', '');
    try {
      const res = await fetch('/api/trade/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, symbol: currentSymbol })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setToast(`✅ Posição em ${currentSymbol} zerada!`, 'success');

      const inputTp = document.getElementById('bop-input-tp');
      const inputSl = document.getElementById('bop-input-sl');
      if (inputTp) inputTp.value = '';
      if (inputSl) inputSl.value = '';

      if (window.ChartPositions) {
        window.ChartPositions.clearAllLines();
      }

      fetchAccountData();
    } catch (err) {
      console.error('[OrderPanel] Erro ao fechar posição:', err);
      setToast(`Erro: ${err.message}`, 'error');
    }
  }

  /**
   * Inicia loop de atualização de dados da conta (a cada 3s)
   */
  function startDataPolling() {
    if (pollInterval) clearInterval(pollInterval);
    fetchAccountData();
    pollInterval = setInterval(fetchAccountData, 3000);
  }

  /**
   * Notifica troca de símbolo ou preço a partir do gráfico tático
   */
  function setMarketContext(symbol, price) {
    let changedSymbol = false;
    if (symbol && symbol !== currentSymbol) {
      currentSymbol = symbol;
      baseAsset = symbol.replace('USDT', '');
      changedSymbol = true;

      if (window.ChartPositions) {
        window.ChartPositions.clearAllLines();
      }
      const inputTp = document.getElementById('bop-input-tp');
      const inputSl = document.getElementById('bop-input-sl');
      if (inputTp) inputTp.value = '';
      if (inputSl) inputSl.value = '';

      fetchSymbolPrecision(symbol);
      fetchAccountData();
    }
    if (price && price > 0) {
      currentPrice = price;
    }
    syncSymbolPrice();
    if (changedSymbol) {
      updateQuantityUI();
    }
  }

  // Exporta globalmente
  window.OrderPanel = {
    init: initOrderPanel,
    setMarketContext,
    saveTpSl,
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
