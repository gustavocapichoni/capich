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
 * Configura alavancagem para o símbolo
 */
async function setLeverage(apiKey, apiSecret, symbol, leverage) {
  return await signedRequest('/fapi/v1/leverage', 'POST', {
    symbol,
    leverage: parseInt(leverage, 10)
  }, apiKey, apiSecret);
}

/**
 * Obtém regras de precisão do símbolo na Binance (stepSize e minQty)
 */
let exchangeInfoCache = null;
let lastExchangeInfoTime = 0;

async function getSymbolPrecision(symbol) {
  const now = Date.now();
  const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  if (!exchangeInfoCache || now - lastExchangeInfoTime > 3600000) {
    try {
      let res = await fetch(`${FAPI_URL}/fapi/v1/exchangeInfo`, { headers: BROWSER_HEADERS });
      if (!res.ok) {
        res = await fetch(`https://fapi1.binance.com/fapi/v1/exchangeInfo`, { headers: BROWSER_HEADERS });
      }
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.symbols)) {
          exchangeInfoCache = json;
          lastExchangeInfoTime = now;
        }
      }
    } catch (_) {}
  }

  const KNOWN_DEFAULTS = {
    'BTCUSDT': { stepSize: 0.001, minQty: 0.001, decimals: 3, priceDecimals: 1, tickSize: 0.1 },
    'ETHUSDT': { stepSize: 0.001, minQty: 0.001, decimals: 3, priceDecimals: 2, tickSize: 0.01 },
    'BCHUSDT': { stepSize: 0.01, minQty: 0.01, decimals: 2, priceDecimals: 2, tickSize: 0.01 },
    'BNBUSDT': { stepSize: 0.01, minQty: 0.01, decimals: 2, priceDecimals: 2, tickSize: 0.01 },
    'UNIUSDT': { stepSize: 1, minQty: 1, decimals: 0, priceDecimals: 4, tickSize: 0.0001 }
  };

  const s = (exchangeInfoCache && Array.isArray(exchangeInfoCache.symbols))
    ? exchangeInfoCache.symbols.find(x => x.symbol === symbol)
    : null;

  if (!s && KNOWN_DEFAULTS[symbol]) {
    return KNOWN_DEFAULTS[symbol];
  }
  if (!s) return { stepSize: 0.001, minQty: 0.001, precision: 3 };

  const lotFilter = s.filters.find(f => f.filterType === 'LOT_SIZE') || {};
  const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER') || {};
  const stepSize = parseFloat(lotFilter.stepSize) || 0.001;
  const minQty = parseFloat(lotFilter.minQty) || 0.001;
  const tickSize = parseFloat(priceFilter.tickSize) || 0.01;

  // Calcula casas decimais a partir do stepSize
  const decimals = stepSize.toString().includes('.') 
    ? stepSize.toString().split('.')[1].length 
    : 0;

  const priceDecimals = tickSize.toString().includes('.')
    ? tickSize.toString().split('.')[1].length
    : (s.pricePrecision || 2);

  return { stepSize, minQty, decimals, tickSize, priceDecimals };
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
  const { decimals, minQty, stepSize } = await getSymbolPrecision(symbol);

  let quantity = parseFloat(rawQuantity);
  if (!quantity || isNaN(quantity) || quantity <= 0) {
    throw new Error(`Informe uma quantidade válida para ${symbol}.`);
  }

  if (quantity < minQty) {
    throw new Error(`Quantidade mínima exigida pela Binance para ${symbol} é ${minQty}`);
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
  getOpenOrders,
  cancelOpenOrders,
  setStopLossTakeProfit,
  setLeverage,
  getSymbolPrecision,
  executeMarketOrder,
  closeCurrentPosition
};
