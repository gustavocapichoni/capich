/**
 * chart_positions.js
 * Módulo para plotar e arrastar as linhas da posição real, Take Profit e Stop Loss no gráfico
 * 100% Modular e Desacoplado — Suporta Drag & Drop nativo de TP e SL
 */

(function () {
  'use strict';

  let currentPriceLine = null;
  let currentTpLine = null;
  let currentSlLine = null;
  let currentTpPrice = null;
  let currentSlPrice = null;
  let currentTargetSeries = null;
  let currentChart = null;
  let currentContainer = null;
  let isDragging = null; // 'TP' | 'SL' | null
  let dragListenersBound = false;

  /**
   * Define qual a série de candles do Lightweight Charts que receberá as linhas
   */
  function setTargetSeries(series, chart, container) {
    clearAllLines();
    currentTargetSeries = series;
    currentChart = chart || null;
    currentContainer = container || document.getElementById('tac-chart-main');
    setupDragAndDrop();
  }

  /**
   * Inicializa ouvintes de eventos para arrastar Stop Loss e Take Profit com o mouse
   */
  function setupDragAndDrop() {
    if (dragListenersBound || !currentContainer) return;
    dragListenersBound = true;

    // Detecta aproximação e arrasto da linha
    currentContainer.addEventListener('mousemove', (e) => {
      if (!currentTargetSeries) return;

      const rect = currentContainer.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;

      if (!isDragging) {
        // Se o mouse estiver sobre a linha de TP ou SL (tolerância de 9 pixels), mostra cursor de redimensionar
        let near = null;
        if (currentTpPrice) {
          const tpY = currentTargetSeries.priceToCoordinate(currentTpPrice);
          if (tpY !== null && Math.abs(mouseY - tpY) <= 9) near = 'TP';
        }
        if (!near && currentSlPrice) {
          const slY = currentTargetSeries.priceToCoordinate(currentSlPrice);
          if (slY !== null && Math.abs(mouseY - slY) <= 9) near = 'SL';
        }

        if (near) {
          currentContainer.style.cursor = 'ns-resize';
        } else {
          if (currentContainer.style.cursor === 'ns-resize') {
            currentContainer.style.cursor = '';
          }
        }
      } else {
        // Usuário está com o mouse pressionado arrastando a linha
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
              title: `🎯 TP @ $${cleanPrice}`
            });
          }
          const inp = document.getElementById('bop-input-tp');
          if (inp) inp.value = cleanPrice;
        } else if (isDragging === 'SL') {
          currentSlPrice = cleanPrice;
          if (currentSlLine) {
            currentSlLine.applyOptions({
              price: cleanPrice,
              title: `🛑 SL @ $${cleanPrice}`
            });
          }
          const inp = document.getElementById('bop-input-sl');
          if (inp) inp.value = cleanPrice;
        }
      }
    });

    // Inicia o arrasto ao clicar com o botão esquerdo sobre a linha
    currentContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !currentTargetSeries) return;

      const rect = currentContainer.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;

      let target = null;
      if (currentTpPrice) {
        const tpY = currentTargetSeries.priceToCoordinate(currentTpPrice);
        if (tpY !== null && Math.abs(mouseY - tpY) <= 9) target = 'TP';
      }
      if (!target && currentSlPrice) {
        const slY = currentTargetSeries.priceToCoordinate(currentSlPrice);
        if (slY !== null && Math.abs(mouseY - slY) <= 9) target = 'SL';
      }

      if (target) {
        isDragging = target;
        e.preventDefault();
        e.stopPropagation();

        // Desativa a rolagem/pan do gráfico enquanto arrasta a linha
        if (currentChart) {
          try {
            currentChart.applyOptions({
              handleScroll: false,
              handleScale: false
            });
          } catch (_) {}
        }

        document.body.style.userSelect = 'none';
        currentContainer.style.cursor = 'grabbing';
      }
    }, true); // Captura na fase capture para antecipar o canvas interno do Lightweight Charts

    // Finaliza o arrasto ao soltar o mouse
    window.addEventListener('mouseup', () => {
      if (!isDragging) return;

      const finishedType = isDragging;
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

      // Restaura o título padrão limpo da linha
      if (finishedType === 'TP' && currentTpLine) {
        currentTpLine.applyOptions({ title: 'TP Market' });
      }
      if (finishedType === 'SL' && currentSlLine) {
        currentSlLine.applyOptions({ title: 'SL Market' });
      }

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
      if (currentPriceLine) {
        try {
          currentTargetSeries.removePriceLine(currentPriceLine);
        } catch (_) {}
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
    // Caixinha lateral esquerda na linha (estilo Binance Futures)
    const lineTitle = `PnL ${pnlFormatted} [${qtySign}${Math.abs(posData.positionAmt)}]`;

    const lineOptions = {
      price: posData.entryPrice,
      color: color,
      lineWidth: 1.5,
      lineStyle: 2, // Tracejado (Dashed) como na Binance
      axisLabelVisible: true,
      title: lineTitle
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
  }

  /**
   * Atualiza ou remove a linha de Take Profit (TP)
   */
  function updateTpLine(tpPrice) {
    if (!currentTargetSeries) return;
    const price = parseFloat(tpPrice);

    if (!price || price <= 0) {
      currentTpPrice = null;
      if (currentTpLine) {
        try {
          currentTargetSeries.removePriceLine(currentTpLine);
        } catch (_) {}
        currentTpLine = null;
      }
      return;
    }

    currentTpPrice = price;

    // Se estiver arrastando, não sobrescreve com dados do polling
    if (isDragging === 'TP') return;

    const lineOptions = {
      price: price,
      color: '#0ecb81', // Verde Binance
      lineWidth: 1.5,
      lineStyle: 2, // Tracejado
      axisLabelVisible: true,
      title: 'TP Market'
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
  }

  /**
   * Atualiza ou remove a linha de Stop Loss (SL)
   */
  function updateSlLine(slPrice) {
    if (!currentTargetSeries) return;
    const price = parseFloat(slPrice);

    if (!price || price <= 0) {
      currentSlPrice = null;
      if (currentSlLine) {
        try {
          currentTargetSeries.removePriceLine(currentSlLine);
        } catch (_) {}
        currentSlLine = null;
      }
      return;
    }

    currentSlPrice = price;

    // Se estiver arrastando, não sobrescreve com dados do polling
    if (isDragging === 'SL') return;

    const lineOptions = {
      price: price,
      color: '#f6465d', // Vermelho Stop Loss
      lineWidth: 1.5,
      lineStyle: 2, // Tracejado
      axisLabelVisible: true,
      title: 'SL Market'
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
  }

  /**
   * Remove todas as linhas do gráfico
   */
  function clearAllLines() {
    currentTpPrice = null;
    currentSlPrice = null;
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

  // Exporta globalmente para uso pelo order_panel.js e btc_tactical_chart.js
  window.ChartPositions = {
    setTargetSeries,
    updatePositionLine,
    updateTpLine,
    updateSlLine,
    clearAllLines,
    clearPositionLine
  };
})();
