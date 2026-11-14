/**
 * chart_positions.js
 * Módulo para plotar e arrastar as linhas da posição real, Take Profit e Stop Loss no gráfico
 * 100% Modular e Desacoplado — Suporta Drag & Drop nativo de TP e SL
 * Badges de PnL, TP e SL posicionados no lado esquerdo da linha (Estilo Binance Futures)
 */

(function () {
  'use strict';

  const STORAGE_KEY_POS_VISIBLE = 'capich_chart_positions_visible';
  let areLinesVisible = localStorage.getItem(STORAGE_KEY_POS_VISIBLE) !== 'false';
  let visibilityListener = null;

  let currentPriceLine = null;
  let currentTpLine = null;
  let currentSlLine = null;
  let currentTpPrice = null;
  let currentSlPrice = null;
  let lastPosData = null;
  let lastConditionalOrders = null;
  let currentTargetSeries = null;
  let currentChart = null;
  let currentContainer = null;
  let isDragging = null; // 'TP' | 'SL' | null
  let dragListenersBound = false;

  // Ordens condicionais avulsas (linhas azuis/laranjas no gráfico)
  let conditionalLines = []; // array de { algoId, side, price, quantity, priceLine, badgeEl }

  let posBadgeEl = null;
  let tpBadgeEl = null;
  let slBadgeEl = null;
  let ghostBadgeEl = null;
  let ghostLine = null;

  function ensureBadges() {
    if (!currentContainer) return;

    if (!posBadgeEl) {
      posBadgeEl = document.createElement('div');
      posBadgeEl.id = 'chart-pos-badge';
      posBadgeEl.className = 'chart-line-badge pos-badge';
      posBadgeEl.style.display = 'none';
      posBadgeEl.title = 'Arraste para cima (TP) ou para baixo (SL)';
      currentContainer.appendChild(posBadgeEl);

      // Permite puxar TP e SL a partir do badge da posição sem popup
      posBadgeEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !currentTargetSeries || !lastPosData) return;
        // Ignora clique no botão [x] de zerar posição
        if (e.target && (e.target.classList.contains('badge-close-btn') || e.target.closest('.badge-close-btn'))) return;

        e.preventDefault();
        e.stopPropagation();

        isDragging = {
          type: 'POS_DRAG_NEW_ORDER',
          posData: lastPosData,
          entryPrice: parseFloat(lastPosData.entryPrice),
          isLong: String(lastPosData.side).toUpperCase() === 'LONG',
          symbol: lastPosData.symbol || localStorage.getItem('capich_tac_symbol') || 'BTCUSDT',
          currentGhostPrice: null,
          orderKind: null
        };

        if (currentChart) {
          try { currentChart.applyOptions({ handleScroll: false, handleScale: false }); } catch (_) {}
        }
        document.body.style.userSelect = 'none';
        currentContainer.style.cursor = 'crosshair';
      });
    }

    if (!ghostBadgeEl) {
      ghostBadgeEl = document.createElement('div');
      ghostBadgeEl.id = 'chart-ghost-badge';
      ghostBadgeEl.className = 'chart-line-badge ghost-badge';
      ghostBadgeEl.style.display = 'none';
      ghostBadgeEl.style.pointerEvents = 'none';
      ghostBadgeEl.style.zIndex = '120';
      currentContainer.appendChild(ghostBadgeEl);
    }

    if (!tpBadgeEl) {
      tpBadgeEl = document.createElement('div');
      tpBadgeEl.id = 'chart-tp-badge';
      tpBadgeEl.className = 'chart-line-badge tp-badge';
      tpBadgeEl.style.display = 'none';
      tpBadgeEl.title = 'Arraste para ajustar Take Profit';
      currentContainer.appendChild(tpBadgeEl);

      tpBadgeEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !currentTargetSeries) return;
        isDragging = 'TP';
        e.preventDefault();
        e.stopPropagation();
        if (currentChart) {
          try { currentChart.applyOptions({ handleScroll: false, handleScale: false }); } catch (_) {}
        }
        document.body.style.userSelect = 'none';
        currentContainer.style.cursor = 'grabbing';
      });
    }

    if (!slBadgeEl) {
      slBadgeEl = document.createElement('div');
      slBadgeEl.id = 'chart-sl-badge';
      slBadgeEl.className = 'chart-line-badge sl-badge';
      slBadgeEl.style.display = 'none';
      slBadgeEl.title = 'Arraste para ajustar Stop Loss';
      currentContainer.appendChild(slBadgeEl);

      slBadgeEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !currentTargetSeries) return;
        isDragging = 'SL';
        e.preventDefault();
        e.stopPropagation();
        if (currentChart) {
          try { currentChart.applyOptions({ handleScroll: false, handleScale: false }); } catch (_) {}
        }
        document.body.style.userSelect = 'none';
        currentContainer.style.cursor = 'grabbing';
      });
    }
  }

  function bindPosCloseBtn() {
    if (!posBadgeEl) return;
    const btn = posBadgeEl.querySelector('.badge-close-btn');
    if (btn) {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sym = localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
        if (window.OrderPanel && typeof window.OrderPanel.closePosition === 'function') {
          window.OrderPanel.closePosition(sym);
        }
      };
    }
  }

  function bindTpCloseBtn() {
    if (!tpBadgeEl) return;
    const btn = tpBadgeEl.querySelector('.badge-close-btn');
    if (btn) {
      btn.onmousedown = (e) => e.stopPropagation();
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sym = localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
        if (window.OrderPanel && typeof window.OrderPanel.cancelPositionTp === 'function') {
          window.OrderPanel.cancelPositionTp(sym);
        }
      };
    }
  }

  function bindSlCloseBtn() {
    if (!slBadgeEl) return;
    const btn = slBadgeEl.querySelector('.badge-close-btn');
    if (btn) {
      btn.onmousedown = (e) => e.stopPropagation();
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sym = localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
        if (window.OrderPanel && typeof window.OrderPanel.cancelPositionSl === 'function') {
          window.OrderPanel.cancelPositionSl(sym);
        }
      };
    }
  }

  function updateBadgePositions() {
    if (!currentTargetSeries || !currentContainer) return;
    if (!areLinesVisible) {
      if (posBadgeEl) posBadgeEl.style.display = 'none';
      if (tpBadgeEl)  tpBadgeEl.style.display = 'none';
      if (slBadgeEl)  slBadgeEl.style.display = 'none';
      return;
    }
    const maxH = currentContainer.clientHeight || 450;

    // 1. Posição aberta
    if (posBadgeEl && lastPosData && lastPosData.entryPrice) {
      const y = currentTargetSeries.priceToCoordinate(lastPosData.entryPrice);
      if (y !== null && y >= 5 && y <= maxH - 5) {
        posBadgeEl.style.top = `${Math.round(y - 12)}px`;
        posBadgeEl.style.display = 'inline-flex';
      } else {
        posBadgeEl.style.display = 'none';
      }
    }

    // 2. Take Profit
    if (tpBadgeEl && currentTpPrice) {
      const y = currentTargetSeries.priceToCoordinate(currentTpPrice);
      if (y !== null && y >= 5 && y <= maxH - 5) {
        tpBadgeEl.style.top = `${Math.round(y - 12)}px`;
        tpBadgeEl.style.display = 'inline-flex';
      } else {
        tpBadgeEl.style.display = 'none';
      }
    }

    // 3. Stop Loss
    if (slBadgeEl && currentSlPrice) {
      const y = currentTargetSeries.priceToCoordinate(currentSlPrice);
      if (y !== null && y >= 5 && y <= maxH - 5) {
        slBadgeEl.style.top = `${Math.round(y - 12)}px`;
        slBadgeEl.style.display = 'inline-flex';
      } else {
        slBadgeEl.style.display = 'none';
      }
    }

    // 4. Ordens Condicionais
    updateConditionalBadgePositions();
  }

  /**
   * Define qual a série de candles do Lightweight Charts que receberá as linhas
   */
  function setTargetSeries(series, chart, container) {
    clearAllLines();
    currentTargetSeries = series;
    currentChart = chart || null;
    currentContainer = container || document.getElementById('tac-chart-main');
    ensureBadges();
    setupDragAndDrop();

    if (currentChart) {
      try {
        currentChart.timeScale().subscribeVisibleTimeRangeChange(updateBadgePositions);
        currentChart.timeScale().subscribeVisibleLogicalRangeChange(updateBadgePositions);
      } catch (_) {}
    }
  }

  /**
   * Inicializa ouvintes de eventos para arrastar Stop Loss e Take Profit com o mouse
   * Arraste permitido exclusivamente pelas caixinhas/badges no gráfico (tpBadgeEl e slBadgeEl)
   */
  function setupDragAndDrop() {
    if (dragListenersBound || !currentContainer) return;
    dragListenersBound = true;

    // Acompanha o movimento do mouse durante o arrasto iniciado por uma badge
    window.addEventListener('mousemove', (e) => {
      if (!isDragging || !currentTargetSeries || !areLinesVisible) return;

      const rect = currentContainer.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;

      e.preventDefault();
      const rawPrice = currentTargetSeries.coordinateToPrice(mouseY);
      if (!rawPrice || rawPrice <= 0) return;

      const pInfo = (window.OrderPanel && window.OrderPanel.getPrecision) ? window.OrderPanel.getPrecision() : null;
      const dec = pInfo ? (pInfo.priceDecimals || 4) : 4;
      const cleanPrice = parseFloat(rawPrice.toFixed(dec));

      if (isDragging === 'TP') {
        currentTpPrice = cleanPrice;
        if (currentTpLine) {
          currentTpLine.applyOptions({
            price: cleanPrice,
            title: ''
          });
        }
        if (tpBadgeEl) {
          tpBadgeEl.innerHTML = `<span style="font-weight:800;color:#0ecb81;">🎯 TP Market</span><span class="badge-price">$${cleanPrice}</span><button type="button" class="badge-close-btn" title="Cancelar Take Profit">&times;</button>`;
          bindTpCloseBtn();
          tpBadgeEl.style.top = `${Math.round(mouseY - 12)}px`;
          tpBadgeEl.style.display = 'inline-flex';
        }
        // Atualiza o preço de TP em memória (usado ao abrir o modal ao soltar)
      } else if (isDragging === 'SL') {
        currentSlPrice = cleanPrice;
        if (currentSlLine) {
          currentSlLine.applyOptions({
            price: cleanPrice,
            title: ''
          });
        }
        if (slBadgeEl) {
          slBadgeEl.innerHTML = `<span style="font-weight:800;color:#f6465d;">🛑 SL Market</span><span class="badge-price">$${cleanPrice}</span><button type="button" class="badge-close-btn" title="Cancelar Stop Loss">&times;</button>`;
          bindSlCloseBtn();
          slBadgeEl.style.top = `${Math.round(mouseY - 12)}px`;
          slBadgeEl.style.display = 'inline-flex';
        }
        // Atualiza o preço de SL em memória (usado ao abrir o modal ao soltar)
      } else if (isDragging && typeof isDragging === 'object' && isDragging.type === 'CONDITIONAL') {
        const cl = isDragging.cl;
        if (cl) {
          cl.dragPrice = cleanPrice;
          if (cl.priceLine) {
            try { cl.priceLine.applyOptions({ price: cleanPrice, title: '' }); } catch (_) {}
          }
          if (cl.badgeEl) {
            const isSell = String(cl.side || '').toUpperCase() === 'SELL';
            const lineColor = isSell ? '#f0b90b' : '#1890ff';
            const sideLabel = isSell ? 'Venda Cond.' : 'Compra Cond.';
            cl.badgeEl.innerHTML = `<span style="font-weight:800;color:${lineColor};">⚡ ${sideLabel}</span><span class="badge-price">$${cleanPrice}</span><span class="badge-qty">(${cl.quantity})</span><button type="button" class="badge-close-btn" title="Cancelar ordem condicional">&times;</button>`;
            const btn = cl.badgeEl.querySelector('.badge-close-btn');
            if (btn) {
              btn.onmousedown = (ev) => ev.stopPropagation();
              btn.onclick = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (window.OrderPanel && typeof window.OrderPanel.cancelConditionalOrderById === 'function') {
                  window.OrderPanel.cancelConditionalOrderById(cl.algoId, cl.symbol || '', cleanPrice);
                }
              };
            }
            cl.badgeEl.style.top = `${Math.round(mouseY - 12)}px`;
            cl.badgeEl.style.display = 'inline-flex';
          }
        }
      } else if (isDragging && typeof isDragging === 'object' && isDragging.type === 'POS_DRAG_NEW_ORDER') {
        const entry = isDragging.entryPrice;
        const isLong = isDragging.isLong;
        const orderKind = isLong ? (cleanPrice > entry ? 'TP' : 'SL') : (cleanPrice < entry ? 'TP' : 'SL');

        isDragging.orderKind = orderKind;
        isDragging.currentGhostPrice = cleanPrice;

        const isTp = (orderKind === 'TP');
        const color = isTp ? '#0ecb81' : '#f6465d';
        const label = isTp ? '🎯 Novo TP Market' : '🛑 Novo SL Market';

        const size = Math.abs(parseFloat(isDragging.posData.positionAmt)) || 1;
        const lev = parseFloat(isDragging.posData.leverage) || 1;
        const pnl = isLong ? (cleanPrice - entry) * size : (entry - cleanPrice) * size;
        const roi = entry > 0 ? (isLong ? ((cleanPrice - entry) / entry) * lev * 100 : ((entry - cleanPrice) / entry) * lev * 100) : 0;
        const pnlSign = pnl >= 0 ? '+' : '';
        const roiSign = roi >= 0 ? '+' : '';

        const lineOpts = {
          price: cleanPrice,
          color: color,
          lineWidth: 1.5,
          lineStyle: 2,
          axisLabelVisible: true,
          title: ''
        };

        if (ghostLine) {
          try { ghostLine.applyOptions(lineOpts); } catch (_) {}
        } else {
          try { ghostLine = currentTargetSeries.createPriceLine(lineOpts); } catch (_) {}
        }

        if (ghostBadgeEl) {
          ghostBadgeEl.innerHTML = `
            <span style="font-weight:800;color:${color};">${label}</span>
            <span class="badge-price" style="background:${isTp ? 'rgba(14,203,129,0.18)' : 'rgba(246,70,93,0.18)'};">$${cleanPrice}</span>
            <span style="font-size:10px;font-weight:700;color:${pnl >= 0 ? '#0ecb81' : '#f6465d'};">${pnlSign}$${pnl.toFixed(2)} (${roiSign}${roi.toFixed(1)}%)</span>
          `;
          ghostBadgeEl.style.top = `${Math.round(mouseY - 12)}px`;
          ghostBadgeEl.style.display = 'inline-flex';
          ghostBadgeEl.style.borderColor = color;
        }
      }
    });

    // Finaliza o arrasto ao soltar o mouse em qualquer lugar da tela
    window.addEventListener('mouseup', () => {
      if (!isDragging) return;

      const draggedItem = isDragging;
      isDragging = null;

      // Reativa a rolagem e escala do gráfico
      if (currentChart) {
        try {
          currentChart.applyOptions({
            handleScroll: true,
            handleScale: true
          });
        } catch (_) {}
      }

      document.body.style.userSelect = '';
      if (currentContainer) currentContainer.style.cursor = '';

      updateBadgePositions();

      // Caso 1: Ordem condicional arrastada — move IMEDIATAMENTE sem popup de confirmação
      if (draggedItem && typeof draggedItem === 'object' && draggedItem.type === 'CONDITIONAL') {
        const cl = draggedItem.cl;
        const finalPrice = (cl && cl.dragPrice) ? cl.dragPrice : draggedItem.originalPrice;
        if (finalPrice && finalPrice !== draggedItem.originalPrice) {
          if (cl) cl.price = finalPrice;
          const sym = draggedItem.symbol || localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
          if (window.OrderPanel && typeof window.OrderPanel.modifyConditionalOrderById === 'function') {
            window.OrderPanel.modifyConditionalOrderById(draggedItem.algoId, sym, finalPrice);
          }
        }
        return;
      }

      // Caso 2: Puxou novo TP ou SL a partir do badge da posição — envia IMEDIATAMENTE sem popup
      if (draggedItem && typeof draggedItem === 'object' && draggedItem.type === 'POS_DRAG_NEW_ORDER') {
        if (ghostLine) {
          try { currentTargetSeries.removePriceLine(ghostLine); } catch (_) {}
          ghostLine = null;
        }
        if (ghostBadgeEl) ghostBadgeEl.style.display = 'none';

        const finalPrice = draggedItem.currentGhostPrice;
        const orderKind = draggedItem.orderKind;
        const sym = draggedItem.symbol || localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';

        if (finalPrice && finalPrice > 0 && finalPrice !== draggedItem.entryPrice && orderKind) {
          if (window.OrderPanel && typeof window.OrderPanel.setDirectTpSl === 'function') {
            if (orderKind === 'TP') {
              window.OrderPanel.setDirectTpSl(sym, { takeProfit: finalPrice });
            } else if (orderKind === 'SL') {
              window.OrderPanel.setDirectTpSl(sym, { stopLoss: finalPrice });
            }
          }
        }
        return;
      }

      // Caso 3: Take Profit existente arrastado — atualiza IMEDIATAMENTE sem popup
      if (draggedItem === 'TP' && currentTpPrice) {
        const sym = localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
        if (window.OrderPanel && typeof window.OrderPanel.setDirectTpSl === 'function') {
          window.OrderPanel.setDirectTpSl(sym, { takeProfit: currentTpPrice });
        }
        return;
      }

      // Caso 4: Stop Loss existente arrastado — atualiza IMEDIATAMENTE sem popup
      if (draggedItem === 'SL' && currentSlPrice) {
        const sym = localStorage.getItem('capich_tac_symbol') || 'BTCUSDT';
        if (window.OrderPanel && typeof window.OrderPanel.setDirectTpSl === 'function') {
          window.OrderPanel.setDirectTpSl(sym, { stopLoss: currentSlPrice });
        }
        return;
      }
    });
  }

  /**
   * Atualiza ou remove a linha de posição com base nos dados reais da Binance
   * @param {Object} posData - { hasPosition, side, entryPrice, positionAmt, unRealizedProfit }
   */
  function updatePositionLine(posData) {
    if (!currentTargetSeries) return;

    // Se não há posição aberta ou o preço de entrada é zero, remove a linha
    if (!posData || !posData.hasPosition || !posData.entryPrice || posData.entryPrice <= 0) {
      lastPosData = null;
      if (posBadgeEl) posBadgeEl.style.display = 'none';
      if (currentPriceLine) {
        try {
          currentTargetSeries.removePriceLine(currentPriceLine);
        } catch (_) {}
        currentPriceLine = null;
      }
      return;
    }

    lastPosData = posData;

    // Se o usuário ocultou as linhas, remove da tela e oculta badge
    if (!areLinesVisible) {
      if (posBadgeEl) posBadgeEl.style.display = 'none';
      if (currentPriceLine) {
        try { currentTargetSeries.removePriceLine(currentPriceLine); } catch (_) {}
        currentPriceLine = null;
      }
      return;
    }

    const unPnl = parseFloat(posData.unRealizedProfit) || 0;
    const isProfitable = unPnl >= 0;
    // Estilo Binance: VERDE se positivo (lucro), VERMELHO se negativo (prejuízo)
    const color = isProfitable ? '#0ecb81' : '#f6465d';
    const pnlSign = isProfitable ? '+' : '';
    const pnlFormatted = `${pnlSign}$${unPnl.toFixed(2)}`;
    const isLong = posData.side === 'LONG';
    const qtySign = isLong ? '+' : '-';
    const pInfo = (window.OrderPanel && window.OrderPanel.getPrecision) ? window.OrderPanel.getPrecision() : null;
    const dec = pInfo ? (pInfo.priceDecimals || 4) : 4;
    const entryFormatted = Number(posData.entryPrice).toFixed(dec);

    ensureBadges();
    if (posBadgeEl) {
      posBadgeEl.className = `chart-line-badge pos-badge ${isProfitable ? 'profit' : 'loss'}`;
      posBadgeEl.innerHTML = `
        <span style="font-weight:800;color:${color};">PnL ${pnlFormatted}</span>
        <span class="badge-price">$${entryFormatted}</span>
        <span class="badge-qty">[${qtySign}${Math.abs(posData.positionAmt)}]</span>
        <button type="button" class="badge-close-btn" title="Zerar posição a mercado">&times;</button>
      `;
      bindPosCloseBtn();
    }

    const lineOptions = {
      price: posData.entryPrice,
      color: color,
      lineWidth: 1.5,
      lineStyle: 2, // Tracejado (Dashed) como na Binance
      axisLabelVisible: true,
      title: '' // Título no badge flutuante à esquerda, não colado na régua
    };

    if (currentPriceLine) {
      currentPriceLine.applyOptions(lineOptions);
    } else {
      try {
        currentPriceLine = currentTargetSeries.createPriceLine(lineOptions);
      } catch (e) {
        console.warn('[ChartPositions] Erro ao criar price line:', e.message);
      }
    }

    updateBadgePositions();
  }

  /**
   * Atualiza ou remove a linha de Take Profit (TP)
   */
  function updateTpLine(tpPrice) {
    if (!currentTargetSeries) return;
    const price = parseFloat(tpPrice);

    if (!price || price <= 0) {
      currentTpPrice = null;
      if (tpBadgeEl) tpBadgeEl.style.display = 'none';
      if (currentTpLine) {
        try {
          currentTargetSeries.removePriceLine(currentTpLine);
        } catch (_) {}
        currentTpLine = null;
      }
      return;
    }

    currentTpPrice = price;

    ensureBadges();
    if (tpBadgeEl) {
      const pInfo = (window.OrderPanel && window.OrderPanel.getPrecision) ? window.OrderPanel.getPrecision() : null;
      const dec = pInfo ? (pInfo.priceDecimals || 4) : 4;
      tpBadgeEl.innerHTML = `
        <span style="font-weight:800;color:#0ecb81;">🎯 TP Market</span>
        <span class="badge-price">$${Number(price).toFixed(dec)}</span>
        <button type="button" class="badge-close-btn" title="Cancelar Take Profit">&times;</button>
      `;
      bindTpCloseBtn();
    }

    // Se o usuário ocultou as linhas, remove da tela e oculta badge
    if (!areLinesVisible) {
      if (tpBadgeEl) tpBadgeEl.style.display = 'none';
      if (currentTpLine) {
        try { currentTargetSeries.removePriceLine(currentTpLine); } catch (_) {}
        currentTpLine = null;
      }
      return;
    }

    // Se estiver arrastando, não sobrescreve com dados do polling
    if (isDragging === 'TP') return;

    const lineOptions = {
      price: price,
      color: '#0ecb81', // Verde Binance
      lineWidth: 1.5,
      lineStyle: 2, // Tracejado
      axisLabelVisible: true,
      title: ''
    };

    if (currentTpLine) {
      currentTpLine.applyOptions(lineOptions);
    } else {
      try {
        currentTpLine = currentTargetSeries.createPriceLine(lineOptions);
      } catch (e) {
        console.warn('[ChartPositions] Erro ao criar TP line:', e.message);
      }
    }

    updateBadgePositions();
  }

  /**
   * Atualiza ou remove a linha de Stop Loss (SL)
   */
  function updateSlLine(slPrice) {
    if (!currentTargetSeries) return;
    const price = parseFloat(slPrice);

    if (!price || price <= 0) {
      currentSlPrice = null;
      if (slBadgeEl) slBadgeEl.style.display = 'none';
      if (currentSlLine) {
        try {
          currentTargetSeries.removePriceLine(currentSlLine);
        } catch (_) {}
        currentSlLine = null;
      }
      return;
    }

    currentSlPrice = price;

    ensureBadges();
    if (slBadgeEl) {
      const pInfo = (window.OrderPanel && window.OrderPanel.getPrecision) ? window.OrderPanel.getPrecision() : null;
      const dec = pInfo ? (pInfo.priceDecimals || 4) : 4;
      slBadgeEl.innerHTML = `
        <span style="font-weight:800;color:#f6465d;">🛑 SL Market</span>
        <span class="badge-price">$${Number(price).toFixed(dec)}</span>
        <button type="button" class="badge-close-btn" title="Cancelar Stop Loss">&times;</button>
      `;
      bindSlCloseBtn();
    }

    // Se o usuário ocultou as linhas, remove da tela e oculta badge
    if (!areLinesVisible) {
      if (slBadgeEl) slBadgeEl.style.display = 'none';
      if (currentSlLine) {
        try { currentTargetSeries.removePriceLine(currentSlLine); } catch (_) {}
        currentSlLine = null;
      }
      return;
    }

    // Se estiver arrastando, não sobrescreve com dados do polling
    if (isDragging === 'SL') return;

    const lineOptions = {
      price: price,
      color: '#f6465d', // Vermelho Stop Loss
      lineWidth: 1.5,
      lineStyle: 2, // Tracejado
      axisLabelVisible: true,
      title: ''
    };

    if (currentSlLine) {
      currentSlLine.applyOptions(lineOptions);
    } else {
      try {
        currentSlLine = currentTargetSeries.createPriceLine(lineOptions);
      } catch (e) {
        console.warn('[ChartPositions] Erro ao criar SL line:', e.message);
      }
    }

    updateBadgePositions();
  }

  /**
   * Remove todas as linhas do gráfico
   */
  function clearAllLines() {
    currentTpPrice = null;
    currentSlPrice = null;
    lastPosData = null;
    lastConditionalOrders = null;
    if (posBadgeEl) posBadgeEl.style.display = 'none';
    if (tpBadgeEl)  tpBadgeEl.style.display = 'none';
    if (slBadgeEl)  slBadgeEl.style.display = 'none';
    if (ghostBadgeEl) ghostBadgeEl.style.display = 'none';

    if (ghostLine && currentTargetSeries) {
      try { currentTargetSeries.removePriceLine(ghostLine); } catch (_) {}
      ghostLine = null;
    }

    // limpa linhas condicionais
    clearConditionalLines();

    if (!currentTargetSeries) return;
    if (currentPriceLine) {
      try { currentTargetSeries.removePriceLine(currentPriceLine); } catch (_) {}
      currentPriceLine = null;
    }
    if (currentTpLine) {
      try { currentTargetSeries.removePriceLine(currentTpLine); } catch (_) {}
      currentTpLine = null;
    }
    if (currentSlLine) {
      try { currentTargetSeries.removePriceLine(currentSlLine); } catch (_) {}
      currentSlLine = null;
    }
  }

  function clearPositionLine() {
    clearAllLines();
  }

  /**
   * Atualiza as linhas de ordens condicionais avulsas no gráfico (linhas laranjas/azuis).
   * @param {Array} orders - Array de { algoId, side, price, quantity, reduceOnly }
   */
  function updateConditionalLines(orders) {
    lastConditionalOrders = orders || [];
    if (!currentTargetSeries || !currentContainer) return;

    if (!areLinesVisible) {
      clearConditionalLines();
      return;
    }

    const pInfo = (window.OrderPanel && window.OrderPanel.getPrecision) ? window.OrderPanel.getPrecision() : null;
    const dec = pInfo ? (pInfo.priceDecimals || 4) : 4;

    // Remove as linhas que não existem mais
    const newIds = new Set((orders || []).map(o => String(o.algoId)));
    conditionalLines = conditionalLines.filter(cl => {
      if (!newIds.has(String(cl.algoId))) {
        // Remove priceLine e badge do DOM
        if (cl.priceLine) {
          try { currentTargetSeries.removePriceLine(cl.priceLine); } catch (_) {}
        }
        if (cl.badgeEl && cl.badgeEl.parentNode) {
          cl.badgeEl.parentNode.removeChild(cl.badgeEl);
        }
        return false;
      }
      return true;
    });

    if (!orders || orders.length === 0) return;

    for (const ord of orders) {
      const idStr = String(ord.algoId);
      const price = parseFloat(ord.price);
      if (!price || price <= 0) continue;

      const isSell = String(ord.side || '').toUpperCase() === 'SELL';
      // Laranja para ordens de venda condicional, azul para compra
      const lineColor = isSell ? '#f0b90b' : '#1890ff';
      const sideLabel = isSell ? 'Venda Cond.' : 'Compra Cond.';
      const emoji = isSell ? '⚡' : '⚡';

      const existing = conditionalLines.find(cl => String(cl.algoId) === idStr);

      if (existing) {
        existing.symbol = ord.symbol || existing.symbol;
        existing.side = ord.side || existing.side;
        existing.quantity = ord.quantity || existing.quantity;
        // Atualiza preço se mudou externamente (e não está sendo arrastado agora)
        const isDraggingThis = isDragging && typeof isDragging === 'object' && isDragging.type === 'CONDITIONAL' && String(isDragging.algoId) === idStr;
        if (!isDraggingThis && existing.price !== price) {
          existing.price = price;
          if (existing.priceLine) {
            try { existing.priceLine.applyOptions({ price }); } catch (_) {}
          }
        }
        if (existing.badgeEl && !isDraggingThis) {
          existing.badgeEl.innerHTML = `<span style="font-weight:800;color:${lineColor};">${emoji} ${sideLabel}</span><span class="badge-price">$${Number(price).toFixed(dec)}</span><span class="badge-qty">(${ord.quantity})</span><button type="button" class="badge-close-btn" title="Cancelar ordem condicional">&times;</button>`;
          attachConditionalDrag(existing);
        }
      } else {
        // Cria nova linha e badge
        let priceLine = null;
        try {
          priceLine = currentTargetSeries.createPriceLine({
            price,
            color: lineColor,
            lineWidth: 1.5,
            lineStyle: 1, // dotted
            axisLabelVisible: true,
            title: ''
          });
        } catch (e) {
          console.warn('[ChartPositions] Erro ao criar linha condicional:', e.message);
        }

        // Badge flutuante
        const badge = document.createElement('div');
        badge.className = 'chart-line-badge conditional-badge';
        badge.style.cssText = `position:absolute;left:4px;display:none;align-items:center;gap:5px;padding:2px 7px;border-radius:4px;font-size:10.5px;background:#1a1d23;border:1px solid ${lineColor};z-index:15;cursor:ns-resize;`;
        badge.innerHTML = `<span style="font-weight:800;color:${lineColor};">${emoji} ${sideLabel}</span><span class="badge-price">$${Number(price).toFixed(dec)}</span><span class="badge-qty">(${ord.quantity})</span><button type="button" class="badge-close-btn" title="Cancelar ordem condicional">&times;</button>`;
        currentContainer.appendChild(badge);

        const clObj = { algoId: ord.algoId, side: ord.side, price, quantity: ord.quantity, priceLine, badgeEl: badge, symbol: ord.symbol };
        attachConditionalDrag(clObj);
        conditionalLines.push(clObj);
      }
    }

    updateConditionalBadgePositions();
  }

  /**
   * Conecta ouvintes de arrastar e de cancelar (✕) na badge condicional
   */
  function attachConditionalDrag(cl) {
    if (!cl || !cl.badgeEl) return;

    cl.badgeEl.style.cursor = 'ns-resize';
    cl.badgeEl.title = 'Arraste para ajustar o preço de disparo';

    cl.badgeEl.onmousedown = (e) => {
      if (e.button !== 0 || !currentTargetSeries) return;
      isDragging = {
        type: 'CONDITIONAL',
        algoId: cl.algoId,
        cl: cl,
        symbol: cl.symbol,
        originalPrice: cl.price,
        side: cl.side,
        quantity: cl.quantity
      };
      e.preventDefault();
      e.stopPropagation();
      if (currentChart) {
        try { currentChart.applyOptions({ handleScroll: false, handleScale: false }); } catch (_) {}
      }
      document.body.style.userSelect = 'none';
      if (currentContainer) currentContainer.style.cursor = 'grabbing';
    };

    const btn = cl.badgeEl.querySelector('.badge-close-btn');
    if (btn) {
      btn.onmousedown = (e) => e.stopPropagation();
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.OrderPanel && typeof window.OrderPanel.cancelConditionalOrderById === 'function') {
          window.OrderPanel.cancelConditionalOrderById(cl.algoId, cl.symbol || '', cl.price);
        }
      };
    }
  }

  /**
   * Remove todas as linhas condicionais do gráfico
   */
  function clearConditionalLines() {
    for (const cl of conditionalLines) {
      if (cl.priceLine && currentTargetSeries) {
        try { currentTargetSeries.removePriceLine(cl.priceLine); } catch (_) {}
      }
      if (cl.badgeEl && cl.badgeEl.parentNode) {
        cl.badgeEl.parentNode.removeChild(cl.badgeEl);
      }
    }
    conditionalLines = [];
  }

  /**
   * Atualiza posição vertical dos badges de ordens condicionais
   */
  function updateConditionalBadgePositions() {
    if (!currentTargetSeries || !currentContainer) return;
    const maxH = currentContainer.clientHeight || 450;
    for (const cl of conditionalLines) {
      if (!cl.badgeEl || !cl.priceLine) continue;
      // Se esta ordem estiver sendo arrastada agora, não sobrescreve sua posição
      if (isDragging && typeof isDragging === 'object' && isDragging.type === 'CONDITIONAL' && String(isDragging.algoId) === String(cl.algoId)) {
        continue;
      }
      if (!areLinesVisible) {
        cl.badgeEl.style.display = 'none';
        continue;
      }
      const y = currentTargetSeries.priceToCoordinate(cl.price);
      if (y !== null && y >= 5 && y <= maxH - 5) {
        cl.badgeEl.style.top = `${Math.round(y - 12)}px`;
        cl.badgeEl.style.display = 'inline-flex';
      } else {
        cl.badgeEl.style.display = 'none';
      }
    }
  }

  function clearPositionLine() {
    clearAllLines();
  }

  /**
   * Define e aplica a visibilidade das linhas de posição, TP e SL no gráfico
   */
  function setLinesVisible(visible) {
    areLinesVisible = !!visible;
    try {
      localStorage.setItem(STORAGE_KEY_POS_VISIBLE, areLinesVisible ? 'true' : 'false');
    } catch (_) {}

    if (!areLinesVisible) {
      if (currentTargetSeries) {
        if (currentPriceLine) {
          try { currentTargetSeries.removePriceLine(currentPriceLine); } catch (_) {}
          currentPriceLine = null;
        }
        if (currentTpLine) {
          try { currentTargetSeries.removePriceLine(currentTpLine); } catch (_) {}
          currentTpLine = null;
        }
        if (currentSlLine) {
          try { currentTargetSeries.removePriceLine(currentSlLine); } catch (_) {}
          currentSlLine = null;
        }
      }
      clearConditionalLines();
      if (posBadgeEl) posBadgeEl.style.display = 'none';
      if (tpBadgeEl)  tpBadgeEl.style.display = 'none';
      if (slBadgeEl)  slBadgeEl.style.display = 'none';
    } else {
      if (lastPosData) updatePositionLine(lastPosData);
      if (currentTpPrice) updateTpLine(currentTpPrice);
      if (currentSlPrice) updateSlLine(currentSlPrice);
      if (lastConditionalOrders && lastConditionalOrders.length > 0) {
        updateConditionalLines(lastConditionalOrders);
      }
      updateBadgePositions();
    }

    if (typeof visibilityListener === 'function') {
      try { visibilityListener(areLinesVisible); } catch (_) {}
    }
    return areLinesVisible;
  }

  function toggleLinesVisible() {
    return setLinesVisible(!areLinesVisible);
  }

  function isLinesVisible() {
    return areLinesVisible;
  }

  function onVisibilityChange(fn) {
    visibilityListener = fn;
  }

  // Exporta globalmente para uso pelo order_panel.js e btc_tactical_chart.js
  window.ChartPositions = {
    setTargetSeries,
    updatePositionLine,
    updateTpLine,
    updateSlLine,
    updateConditionalLines,
    clearConditionalLines,
    clearAllLines,
    clearPositionLine,
    updateBadgePositions,
    setLinesVisible,
    toggleLinesVisible,
    isLinesVisible,
    onVisibilityChange
  };
})();
