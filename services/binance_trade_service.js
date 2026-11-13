/**
 * binance_trade_service.js
 * Módulo de Execução de Ordens e Posições na Binance Futures (USDⓈ-M)
 * 100% Modular e Isolado
 */

const crypto = require('crypto');

const FAPI_URL = 'https://fapi.binance.com';

/**
 * Cria a assinatura HMAC-SHA256 exigida pela Binance
 */
function createSignature(queryString, apiSecret) {
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

/**
 * Faz requisição autenticada para a Binance Futures
 */
async function signedRequest(endpoint, method = 'GET', params = {}, apiKey, apiSecret) {
  if (!apiKey || !apiSecret) {
    throw new Error('API Key e Secret Key são obrigatórias.');
  }

  const timestamp = Date.now();
  const queryParams = { ...params, timestamp, recvWindow: 60000 };
  
  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const signature = createSignature(queryString, apiSecret);
  const fullQuery = `${queryString}&signature=${signature}`;

  const url = method === 'GET' ? `${FAPI_URL}${endpoint}?${fullQuery}` : `${FAPI_URL}${endpoint}`;
  
  const options = {
    method,
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 CAPICH-Trader'
    }
  };

  if (method !== 'GET') {
    options.body = fullQuery;
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok || data.code !== undefined && data.code < 0) {
    const errorMsg = data.msg || `Erro HTTP ${res.status}`;
    throw new Error(`Binance: [${data.code || res.status}] ${errorMsg}`);
  }

  return data;
}

/**
 * Obtém informações da conta e saldo em USDT
 */
async function getAccountBalance(apiKey, apiSecret) {
  const data = await signedRequest('/fapi/v2/balance', 'GET', {}, apiKey, apiSecret);
  const usdt = data.find(b => b.asset === 'USDT') || { balance: '0', availableBalance: '0' };
  return {
    totalBalance: parseFloat(usdt.balance) || 0,
    availableBalance: parseFloat(usdt.availableBalance) || 0,
    crossUnPnl: parseFloat(usdt.crossUnPnl) || 0
  };
}

/**
 * Obtém risco da posição atual no símbolo (ex: BTCUSDT)
 */
async function getPositionRisk(apiKey, apiSecret, symbol) {
  const data = await signedRequest('/fapi/v2/positionRisk', 'GET', { symbol }, apiKey, apiSecret);
  const pos = data.find(p => p.symbol === symbol) || data[0];
  if (!pos) {
    return {
      symbol,
      hasPosition: false,
      positionAmt: 0,
      entryPrice: 0,
      markPrice: 0,
      unRealizedProfit: 0,
      leverage: 1
    };
  }

  const amt = parseFloat(pos.positionAmt) || 0;
  return {
    symbol: pos.symbol,
    hasPosition: Math.abs(amt) > 0,
    positionAmt: amt,
    side: amt > 0 ? 'LONG' : (amt < 0 ? 'SHORT' : 'NONE'),
    entryPrice: parseFloat(pos.entryPrice) || 0,
    markPrice: parseFloat(pos.markPrice) || 0,
    unRealizedProfit: parseFloat(pos.unRealizedProfit) || 0,
    leverage: parseInt(pos.leverage, 10) || 1,
    liquidationPrice: parseFloat(pos.liquidationPrice) || 0
  };
}

/**
 * Obtém todas as posições abertas na conta (qualquer par com saldo diferente de zero)
 */
async function getAllPositions(apiKey, apiSecret) {
  const data = await signedRequest('/fapi/v2/positionRisk', 'GET', {}, apiKey, apiSecret);
  if (!Array.isArray(data)) return [];
  const active = data.filter(p => Math.abs(parseFloat(p.positionAmt) || 0) > 0);

  const positions = await Promise.all(active.map(async (pos) => {
    const symbol = pos.symbol;
    const amt = parseFloat(pos.positionAmt) || 0;
    const entryPrice = parseFloat(pos.entryPrice) || 0;
    const markPrice = parseFloat(pos.markPrice) || 0;
    const unRealizedProfit = parseFloat(pos.unRealizedProfit) || 0;
    const leverage = parseInt(pos.leverage, 10) || 1;
    const liquidationPrice = parseFloat(pos.liquidationPrice) || 0;
    const notional = Math.abs(amt * (markPrice || entryPrice));
    const initialMargin = parseFloat(pos.initialMargin) || (leverage > 0 ? notional / leverage : 0);
    const roi = initialMargin > 0 ? (unRealizedProfit / initialMargin) * 100 : 0;

    let tpPrice = null;
    let slPrice = null;
    try {
      const openOrd = await getOpenOrders(apiKey, apiSecret, symbol);
      tpPrice = openOrd.tpPrice;
      slPrice = openOrd.slPrice;
    } catch (_) {}

    return {
      symbol,
      hasPosition: true,
      positionAmt: amt,
      side: amt > 0 ? 'LONG' : 'SHORT',
      entryPrice,
      markPrice,
      unRealizedProfit,
      leverage,
      liquidationPrice,
      margin: initialMargin,
      marginType: pos.marginType ? (pos.marginType.toLowerCase() === 'cross' ? 'Cross' : 'Isolated') : 'Cross',
      roi,
      tpPrice,
      slPrice
    };
  }));

  return positions;
}

/**
 * Obtém regras de precisão do símbolo na Binance (stepSize e minQty real).
 *
 * A Binance Futures impõe um VALOR MÍNIMO em USDT (MIN_NOTIONAL) por ordem.
 * A quantidade mínima real exigida pela corretora é:
 *   minQty = max(LOT_SIZE.minQty, ceil(MIN_NOTIONAL / precoAtual / stepSize) * stepSize).
 * Isso significa que o minQty varia conforme o preço do ativo em tempo real.
 *
 * Cache de 10 minutos para o exchangeInfo (estrutura de filtros).
 * O preço ao vivo é consultado para garantir cálculo exato.
 */
let exchangeInfoCache = null;
let lastExchangeInfoTime = 0;
const EXCHANGE_INFO_TTL = 10 * 60 * 1000; // 10 minutos

async function getSymbolPrecision(symbol) {
  const now = Date.now();
  if (!exchangeInfoCache || now - lastExchangeInfoTime > EXCHANGE_INFO_TTL) {
    const res = await fetch(`${FAPI_URL}/fapi/v1/exchangeInfo`);
    if (!res.ok) throw new Error(`Falha ao buscar exchangeInfo da Binance: HTTP ${res.status}`);
    exchangeInfoCache = await res.json();
    lastExchangeInfoTime = now;
    console.log('[getSymbolPrecision] exchangeInfo atualizado da Binance.');
  }

  const s = exchangeInfoCache.symbols.find(x => x.symbol === symbol);
  if (!s) return { stepSize: 0.001, minQty: 0.001, lotMinQty: 0.001, minNotional: 0, minQtyByNotional: 0.001, decimals: 3, tickSize: 0.01, priceDecimals: 2, livePrice: 0 };

  const lotFilter      = s.filters.find(f => f.filterType === 'LOT_SIZE')        || {};
  const mktFilter      = s.filters.find(f => f.filterType === 'MARKET_LOT_SIZE') || {};
  const priceFilter    = s.filters.find(f => f.filterType === 'PRICE_FILTER')    || {};
  const notionalFilter = s.filters.find(f => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL')  || {};

  const stepSize    = parseFloat(mktFilter.stepSize || lotFilter.stepSize) || 0.001;
  const lotMinQty   = parseFloat(mktFilter.minQty   || lotFilter.minQty)  || 0.001;
  const minNotional = parseFloat(notionalFilter.notional || notionalFilter.minNotional) || 0;

  const decimals = (s.quantityPrecision !== undefined && s.quantityPrecision !== null)
    ? s.quantityPrecision
    : (stepSize.toString().includes('.') ? stepSize.toString().split('.')[1].replace(/0+$/, '').length || 0 : 0);

  // Busca preço atual ao vivo para calcular minQty baseado no notional mínimo
  let minQtyByNotional = lotMinQty;
  let livePrice = 0;
  if (minNotional > 0) {
    try {
      const tickerRes = await fetch(`${FAPI_URL}/fapi/v1/ticker/price?symbol=${symbol}`);
      const ticker = await tickerRes.json();
      livePrice = parseFloat(ticker.price) || 0;
      if (livePrice > 0) {
        // quantidade mínima para atingir o notional mínimo, arredondada para cima no stepSize
        const rawMinByNotional = minNotional / livePrice;
        let steps = Math.ceil((rawMinByNotional / stepSize) - 1e-9);
        while ((steps * stepSize * livePrice) < minNotional) {
          steps++;
        }
        minQtyByNotional = parseFloat((steps * stepSize).toFixed(decimals));
      }
    } catch (e) {
      console.warn(`[getSymbolPrecision] Não foi possível buscar preço de ${symbol}:`, e.message);
    }
  }

  // minQty efetivo = maior entre o mínimo de lote e o mínimo por notional
  let minQty = Math.max(lotMinQty, minQtyByNotional);
  minQty = parseFloat(minQty.toFixed(decimals));

  const tickSize = parseFloat(priceFilter.tickSize) || 0.01;

  const priceDecimals = tickSize.toString().includes('.')
    ? tickSize.toString().split('.')[1].replace(/0+$/, '').length || 0
    : (s.pricePrecision || 2);

  console.log(`[getSymbolPrecision] ${symbol}: lotMinQty=${lotMinQty}, minNotional=$${minNotional}, livePrice=$${livePrice}, minQtyByNotional=${minQtyByNotional} → minQty FINAL=${minQty}`);

  return {
    symbol,
    stepSize,
    minQty,
    lotMinQty,
    marketMinQty: lotMinQty,
    minNotional,
    minQtyByNotional,
    decimals,
    tickSize,
    priceDecimals,
    livePrice
  };
}

/**
 * Obtém ordens abertas no símbolo (incluindo Stop Loss e Take Profit via endpoints padrão e Algo Service)
 */
async function getOpenOrders(apiKey, apiSecret, symbol) {
  try {
    // Consulta tanto ordens normais quanto ordens algorítmicas/condicionais (Stop Loss e Take Profit)
    const [standardData, algoData] = await Promise.all([
      signedRequest('/fapi/v1/openOrders', 'GET', { symbol }, apiKey, apiSecret).catch(err => {
        console.warn(`[getOpenOrders standardOrders ${symbol}] aviso:`, err.message);
        return [];
      }),
      signedRequest('/fapi/v1/openAlgoOrders', 'GET', { symbol }, apiKey, apiSecret).catch(err => {
        console.warn(`[getOpenOrders algoOrders ${symbol}] aviso:`, err.message);
        return [];
      })
    ]);

    const stdList = Array.isArray(standardData) ? standardData : [];
    const algoList = Array.isArray(algoData) ? algoData : (Array.isArray(algoData?.algoOrders) ? algoData.algoOrders : []);
    const allOrders = [...stdList, ...algoList];
    
    let tpOrder = null;
    let slOrder = null;
    let tpPrice = null;
    let slPrice = null;

    if (allOrders.length > 0) {
      console.log(`[getOpenOrders ${symbol}] Total ordens abertas (Std: ${stdList.length}, Algo: ${algoList.length}): ${allOrders.length}`);
      for (const ord of allOrders) {
        const type = String(ord.orderType || ord.type || ord.origType || ord.algoType || '').toUpperCase();
        const stopPrice = parseFloat(ord.triggerPrice || ord.stopPrice || ord.activatePrice) || 0;
        const price = parseFloat(ord.price) || 0;
        const effectivePrice = stopPrice > 0 ? stopPrice : price;

        console.log(`[getOpenOrders ${symbol}] Ordem ID: ${ord.orderId || ord.algoId}, orderType: ${ord.orderType}, Tipo: ${type}, StopPrice: ${ord.triggerPrice || ord.stopPrice}, Price: ${ord.price}, Side: ${ord.side}`);

        if (type.includes('TAKE_PROFIT') || type.includes('TAKEPROFIT') || type === 'TP') {
          tpOrder = ord;
          tpPrice = effectivePrice;
        } else if (type.includes('STOP') || type.includes('STOP_LOSS') || type === 'SL') {
          slOrder = ord;
          slPrice = effectivePrice;
        } else if (type === 'LIMIT') {
          if (!tpOrder) {
            tpOrder = ord;
            tpPrice = effectivePrice;
          }
        }
      }

      // Classificação inteligente de contingência caso venham apenas como CONDITIONAL
      if ((!tpPrice || !slPrice) && allOrders.length > 0) {
        const condOrders = allOrders.filter(o => {
          const pr = parseFloat(o.triggerPrice || o.stopPrice || o.activatePrice || o.price) || 0;
          return pr > 0;
        });

        if (condOrders.length === 1) {
          const ord = condOrders[0];
          const pr = parseFloat(ord.triggerPrice || ord.stopPrice || ord.activatePrice || ord.price);
          try {
            const pos = await getPositionRisk(apiKey, apiSecret, symbol);
            if (pos && pos.hasPosition && pos.entryPrice > 0) {
              const isLong = pos.positionAmt > 0;
              if (isLong) {
                if (pr > pos.entryPrice) { tpOrder = ord; tpPrice = pr; }
                else { slOrder = ord; slPrice = pr; }
              } else {
                if (pr < pos.entryPrice) { tpOrder = ord; tpPrice = pr; }
                else { slOrder = ord; slPrice = pr; }
              }
            } else {
              if (!slPrice) { slOrder = ord; slPrice = pr; }
            }
          } catch (_) {
            if (!slPrice) { slOrder = ord; slPrice = pr; }
          }
        } else if (condOrders.length >= 2) {
          const ordA = condOrders[0];
          const ordB = condOrders[1];
          const prA = parseFloat(ordA.triggerPrice || ordA.stopPrice || ordA.activatePrice || ordA.price);
          const prB = parseFloat(ordB.triggerPrice || ordB.stopPrice || ordB.activatePrice || ordB.price);

          const highOrd = prA >= prB ? ordA : ordB;
          const lowOrd = prA < prB ? ordA : ordB;
          const highPr = Math.max(prA, prB);
          const lowPr = Math.min(prA, prB);

          const side = String(ordA.side || ordB.side || '').toUpperCase();
          if (side === 'SELL') {
            // Fechamento de LONG: maior preço é Take Profit, menor preço é Stop Loss
            if (!tpPrice) { tpOrder = highOrd; tpPrice = highPr; }
            if (!slPrice) { slOrder = lowOrd; slPrice = lowPr; }
          } else if (side === 'BUY') {
            // Fechamento de SHORT: menor preço é Take Profit, maior preço é Stop Loss
            if (!tpPrice) { tpOrder = lowOrd; tpPrice = lowPr; }
            if (!slPrice) { slOrder = highOrd; slPrice = highPr; }
          } else {
            if (!tpPrice) { tpOrder = highOrd; tpPrice = highPr; }
            if (!slPrice) { slOrder = lowOrd; slPrice = lowPr; }
          }
        }
      }
    }

    return {
      raw: allOrders,
      tpOrder,
      slOrder,
      tpPrice,
      slPrice
    };
  } catch (err) {
    console.error(`[getOpenOrders error ${symbol}]:`, err.message);
    throw err;
  }
}

/**
 * Cancela todas as ordens abertas no símbolo (ordens padrão e ordens de Stop/Take Algo)
 */
async function cancelOpenOrders(apiKey, apiSecret, symbol) {
  const p1 = signedRequest('/fapi/v1/allOpenOrders', 'DELETE', { symbol }, apiKey, apiSecret).catch(() => null);
  const p2 = signedRequest('/fapi/v1/algoOpenOrders', 'DELETE', { symbol }, apiKey, apiSecret).catch(() => null);
  return await Promise.all([p1, p2]);
}

/**
 * Define ou atualiza Take Profit e Stop Loss para a posição existente usando a API Algo Order da Binance
 */
async function setStopLossTakeProfit(apiKey, apiSecret, symbol, { stopLoss, takeProfit }) {
  const pos = await getPositionRisk(apiKey, apiSecret, symbol);
  if (!pos.hasPosition || pos.positionAmt === 0) {
    throw new Error(`Abra uma posição em ${symbol} antes de definir Take Profit ou Stop Loss.`);
  }

  const { priceDecimals, tickSize } = await getSymbolPrecision(symbol);
  const isLong = pos.positionAmt > 0;
  const closeSide = isLong ? 'SELL' : 'BUY';
  const markPrice = pos.markPrice || pos.entryPrice;

  function formatPriceStr(val) {
    const factor = Math.pow(10, priceDecimals);
    const rounded = Math.round(val / tickSize) * tickSize;
    return (Math.round(rounded * factor) / factor).toFixed(priceDecimals);
  }

  const slVal = parseFloat(stopLoss);
  const hasSl = Boolean(slVal && !isNaN(slVal) && slVal > 0);

  const tpVal = parseFloat(takeProfit);
  const hasTp = Boolean(tpVal && !isNaN(tpVal) && tpVal > 0);

  if (!hasSl && !hasTp) {
    throw new Error('Informe ao menos um valor válido para Stop Loss ou Take Profit.');
  }

  // 1. Validação estrita de mercado ANTES de cancelar ordens existentes
  // Isso protege o usuário: se o valor for inválido, NENHUMA ordem anterior é cancelada!
  if (isLong) {
    // Posição LONG: Fechamento é SELL
    if (hasSl && markPrice > 0 && slVal >= markPrice) {
      throw new Error(`Para posição LONG (Compra), o Stop Loss ($${slVal}) deve ser MENOR que o preço atual ($${markPrice}).`);
    }
    if (hasTp && markPrice > 0 && tpVal <= markPrice) {
      throw new Error(`Para posição LONG (Compra), o Take Profit ($${tpVal}) deve ser MAIOR que o preço atual ($${markPrice}).`);
    }
  } else {
    // Posição SHORT: Fechamento é BUY
    if (hasSl && markPrice > 0 && slVal <= markPrice) {
      throw new Error(`Para posição SHORT (Venda), o Stop Loss ($${slVal}) deve ser MAIOR que o preço atual ($${markPrice}).`);
    }
    if (hasTp && markPrice > 0 && tpVal >= markPrice) {
      throw new Error(`Para posição SHORT (Venda), o Take Profit ($${tpVal}) deve ser MENOR que o preço atual ($${markPrice}).`);
    }
  }

  // 2. Somente cancela ordens abertas anteriores APÓS validar que os novos valores são válidos
  try {
    await cancelOpenOrders(apiKey, apiSecret, symbol);
  } catch (_) {}

  const results = {};
  const errors = [];

  // 3. Stop Loss (usando MARK_PRICE para evitar rejeição por volatilidade rápida do livro de ofertas)
  if (hasSl) {
    const formattedSl = formatPriceStr(slVal);
    try {
      const slResult = await signedRequest('/fapi/v1/algoOrder', 'POST', {
        symbol,
        side: closeSide,
        type: 'STOP_MARKET',
        triggerPrice: formattedSl,
        algoType: 'CONDITIONAL',
        closePosition: 'true',
        workingType: 'MARK_PRICE',
        priceProtect: 'TRUE'
      }, apiKey, apiSecret);
      results.stopLoss = { algoId: slResult.algoId || slResult.orderId, stopPrice: formattedSl };
    } catch (err) {
      errors.push(`Stop Loss ($${formattedSl}): ${err.message}`);
    }
  }

  // 4. Take Profit (usando MARK_PRICE)
  if (hasTp) {
    const formattedTp = formatPriceStr(tpVal);
    try {
      const tpResult = await signedRequest('/fapi/v1/algoOrder', 'POST', {
        symbol,
        side: closeSide,
        type: 'TAKE_PROFIT_MARKET',
        triggerPrice: formattedTp,
        algoType: 'CONDITIONAL',
        closePosition: 'true',
        workingType: 'MARK_PRICE',
        priceProtect: 'TRUE'
      }, apiKey, apiSecret);
      results.takeProfit = { algoId: tpResult.algoId || tpResult.orderId, stopPrice: formattedTp };
    } catch (err) {
      errors.push(`Take Profit ($${formattedTp}): ${err.message}`);
    }
  }

  if (errors.length > 0) {
    const detail = errors.join(' | ');
    if (!results.stopLoss && !results.takeProfit) {
      throw new Error(`Falha ao posicionar ordens na Binance: ${detail}`);
    }
    return {
      success: true,
      partialWarning: `Atenção: ${detail}`,
      results
    };
  }

  return {
    success: true,
    results
  };
}

/**
 * Executa ordem a mercado (BUY ou SELL) informando diretamente a quantidade da moeda
 */
async function executeMarketOrder(apiKey, apiSecret, symbol, side, rawQuantity, tpSlOptions = null) {
  const { decimals, minQty, stepSize, minNotional } = await getSymbolPrecision(symbol);

  let quantity = parseFloat(rawQuantity);
  if (!quantity || isNaN(quantity) || quantity <= 0) {
    throw new Error(`Informe uma quantidade válida para ${symbol}.`);
  }

  if (quantity < minQty) {
    const notionalMsg = minNotional > 0 ? ` (~$${minNotional} USDT)` : '';
    throw new Error(`Quantidade mínima exigida pela Binance para ${symbol} é ${minQty}${notionalMsg}.`);
  }

  // Ajusta ao múltiplo do stepSize e arredonda para casas decimais corretas
  const precisionFactor = Math.pow(10, decimals);
  const steps = Math.floor(quantity / stepSize);
  const adjustedQty = Math.round(steps * stepSize * precisionFactor) / precisionFactor;
  const formattedQty = adjustedQty.toFixed(decimals);

  if (parseFloat(formattedQty) < minQty) {
    throw new Error(`Quantidade mínima exigida pela Binance para ${symbol} é ${minQty}`);
  }

  // Dispara a ordem a mercado
  const orderParams = {
    symbol,
    side: side.toUpperCase(), // 'BUY' ou 'SELL'
    type: 'MARKET',
    quantity: formattedQty
  };

  const orderResult = await signedRequest('/fapi/v1/order', 'POST', orderParams, apiKey, apiSecret);

  let tpSlResult = null;
  if (tpSlOptions && (tpSlOptions.stopLoss || tpSlOptions.takeProfit)) {
    try {
      // Pequeno delay para a Binance assentar a posição
      await new Promise(r => setTimeout(r, 450));
      tpSlResult = await setStopLossTakeProfit(apiKey, apiSecret, symbol, tpSlOptions);
    } catch (err) {
      console.warn('[TradeService] Aviso ao definir TP/SL após mercado:', err.message);
      tpSlResult = { success: false, error: err.message };
    }
  }

  return {
    success: true,
    orderId: orderResult.orderId,
    symbol: orderResult.symbol,
    side: orderResult.side,
    executedQty: orderResult.executedQty || formattedQty,
    avgPrice: orderResult.avgPrice || 0,
    tpSlResult,
    raw: orderResult
  };
}

/**
 * Encerra/Zera a posição atual a mercado
 */
async function closeCurrentPosition(apiKey, apiSecret, symbol) {
  // Cancela ordens pendentes (como SL e TP) ao zerar a mercado
  try {
    await cancelOpenOrders(apiKey, apiSecret, symbol);
  } catch (_) {}

  const pos = await getPositionRisk(apiKey, apiSecret, symbol);
  if (!pos.hasPosition || pos.positionAmt === 0) {
    throw new Error(`Não há posição aberta em ${symbol} para encerrar.`);
  }

  const { decimals } = await getSymbolPrecision(symbol);
  const closeSide = pos.positionAmt > 0 ? 'SELL' : 'BUY';
  const closeQty = Math.abs(pos.positionAmt).toFixed(decimals);

  const orderParams = {
    symbol,
    side: closeSide,
    type: 'MARKET',
    quantity: closeQty,
    reduceOnly: 'true'
  };

  const res = await signedRequest('/fapi/v1/order', 'POST', orderParams, apiKey, apiSecret);
  return {
    success: true,
    closedSide: closeSide,
    quantity: closeQty,
    orderId: res.orderId
  };
}

module.exports = {
  getAccountBalance,
  getPositionRisk,
  getAllPositions,
  getOpenOrders,
  cancelOpenOrders,
  setStopLossTakeProfit,
  getSymbolPrecision,
  clearExchangeInfoCache: () => { exchangeInfoCache = null; lastExchangeInfoTime = 0; },
  executeMarketOrder,
  closeCurrentPosition
};
