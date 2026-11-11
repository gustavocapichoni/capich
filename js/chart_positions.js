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
  let currentTargetSeries = null;
  let currentChart = null;
  let currentContainer = null;
  let isDragging = null; // 'TP' | 'SL' | null
  let dragListenersBound = false;

  let posBadgeEl = null;
  let tpBadgeEl = null;
  let slBadgeEl = null;

  function ensureBadges() {
    if (!currentContainer) return;

    if (!posBadgeEl) {
      posBadgeEl = document.createElement('div');
      posBadgeEl.id = 'chart-pos-badge';
      posBadgeEl.className = 'chart-line-badge pos-badge';
      posBadgeEl.style.display = 'none';
      currentContainer.appendChild(posBadgeEl);
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
          tpBadgeEl.innerHTML = `<span style="font-weight:800;color:#0ecb81;">🎯 TP Market</span><span class="badge-price">$${cleanPrice}</span>`;
          tpBadgeEl.style.top = `${Math.round(mouseY - 12)}px`;
          tpBadgeEl.style.display = 'inline-flex';
        }
        const inp = document.getElementById('bop-input-tp');
        if (inp) inp.value = cleanPrice;
      } else if (isDragging === 'SL') {
        currentSlPrice = cleanPrice;
        if (currentSlLine) {
          currentSlLine.applyOptions({
            price: cleanPrice,
            title: ''
          });
        }
        if (slBadgeEl) {
          slBadgeEl.innerHTML = `<span style="font-weight:800;color:#f6465d;">🛑 SL Market</span><span class="badge-price">$${cleanPrice}</span>`;
          slBadgeEl.style.top = `${Math.round(mouseY - 12)}px`;
          slBadgeEl.style.display = 'inline-flex';
        }
        const inp = document.getElementById('bop-input-sl');
        if (inp) inp.value = cleanPrice;
      }
    });

    // Finaliza o arrasto ao soltar o mouse em qualquer lugar da tela
    window.addEventListener('mouseup', () => {
      if (!isDragging) return;

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

      // Salva automaticamente o novo Stop / Take na Binance
      if (window.OrderPanel && typeof window.OrderPanel.saveTpSl === 'function') {
        window.OrderPanel.saveTpSl();
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
      `;
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
      `;
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
      `;
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
    if (posBadgeEl) posBadgeEl.style.display = 'none';
    if (tpBadgeEl)  tpBadgeEl.style.display = 'none';
    if (slBadgeEl)  slBadgeEl.style.display = 'none';

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
      if (posBadgeEl) posBadgeEl.style.display = 'none';
      if (tpBadgeEl)  tpBadgeEl.style.display = 'none';
      if (slBadgeEl)  slBadgeEl.style.display = 'none';
    } else {
      if (lastPosData) updatePositionLine(lastPosData);
      if (currentTpPrice) updateTpLine(currentTpPrice);
      if (currentSlPrice) updateSlLine(currentSlPrice);
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
    clearAllLines,
    clearPositionLine,
    updateBadgePositions,
    setLinesVisible,
    toggleLinesVisible,
    isLinesVisible,
    onVisibilityChange
  };
})();
