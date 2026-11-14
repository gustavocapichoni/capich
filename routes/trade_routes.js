/**
 * trade_routes.js
 * Rotas REST para o Mini Painel de Ordens da Binance Futures
 * Totalmente Modular e Seguro
 */

const express = require('express');
const router = express.Router();
const tradeService = require('../services/binance_trade_service');

const DEFAULT_TRADE_TOKEN = 'capich_fortress_secure_token_2026';

/**
 * Middleware de Autenticação Tática (Fortress Mode)
 * Exige cabeçalho 'x-trade-auth' ou Bearer token correspondente ao TRADE_AUTH_TOKEN
 */
function requireTradeAuth(req, res, next) {
  if (req.path === '/symbol-info') return next();

  const serverToken = process.env.TRADE_AUTH_TOKEN || DEFAULT_TRADE_TOKEN;
  const clientToken = req.headers['x-trade-auth'] ||
                      req.query.token ||
                      (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : null);

  if (!clientToken || clientToken !== serverToken) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado: token de segurança inválido ou ausente.'
    });
  }
  next();
}

router.use(requireTradeAuth);

/**
 * Extrai credenciais dos headers ou do corpo da requisição ou do .env
 */
function getCredentials(req) {
  const apiKey = req.headers['x-api-key'] || req.body.apiKey || process.env.BINANCE_API_KEY;
  const apiSecret = req.headers['x-api-secret'] || req.body.apiSecret || process.env.BINANCE_API_SECRET;
  return { apiKey, apiSecret };
}

// ─── 0. Obter Regras do Símbolo (minQty, stepSize, decimais) ──────────────────
// Busca MARKET_LOT_SIZE da Binance (minQty real para ordens a mercado).
// Suporta ?fresh=true para ignorar o cache e buscar direto da Binance.
router.get('/symbol-info', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const fresh  = req.query.fresh === 'true';
    if (fresh) tradeService.clearExchangeInfoCache();
    const info = await tradeService.getSymbolPrecision(symbol);
    res.json({ success: true, symbol, ...info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 1. Obter Saldo da Conta em USDT ──────────────────────────────────────────
router.post('/balance', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    const balance = await tradeService.getAccountBalance(apiKey, apiSecret);
    res.json({ success: true, ...balance });
  } catch (err) {
    console.error('[/api/trade/balance] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. Obter Posição Atual no Par (ex: BTCUSDT) ──────────────────────────────
router.post('/position', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const symbol = (req.body.symbol || 'BTCUSDT').toUpperCase();
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    const position = await tradeService.getPositionRisk(apiKey, apiSecret, symbol);
    res.json({ success: true, ...position });
  } catch (err) {
    console.error('[/api/trade/position] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 2.1 Obter Todas as Posições Abertas da Conta ───────────────────────────
router.post('/all-positions', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    const positions = await tradeService.getAllPositions(apiKey, apiSecret);
    res.json({ success: true, positions });
  } catch (err) {
    console.error('[/api/trade/all-positions] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3. Executar Ordem a Mercado (BUY / SELL) ─────────────────────────────────
router.post('/order', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const { symbol, side, quantity, stopLoss, takeProfit } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    if (!symbol || !side || !quantity) {
      return res.status(400).json({ error: 'Par, lado (BUY/SELL) e quantidade do ativo são obrigatórios.' });
    }

    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      return res.status(400).json({ error: 'A quantidade deve ser um valor maior que zero.' });
    }

    if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') {
      const numSL = parseFloat(stopLoss);
      if (isNaN(numSL) || numSL < 0) {
        return res.status(400).json({ error: 'O Stop Loss não pode ser um valor negativo.' });
      }
    }

    if (takeProfit !== undefined && takeProfit !== null && takeProfit !== '') {
      const numTP = parseFloat(takeProfit);
      if (isNaN(numTP) || numTP < 0) {
        return res.status(400).json({ error: 'O Take Profit não pode ser um valor negativo.' });
      }
    }

    const tpSlOptions = (stopLoss || takeProfit) ? { stopLoss, takeProfit } : null;

    const order = await tradeService.executeMarketOrder(
      apiKey,
      apiSecret,
      symbol.toUpperCase(),
      side.toUpperCase(),
      numQty,
      tpSlOptions
    );

    // Retorna a ordem e busca a nova posição atualizada
    const updatedPos = await tradeService.getPositionRisk(apiKey, apiSecret, symbol.toUpperCase());

    res.json({
      success: true,
      message: `Ordem ${side.toUpperCase()} executada com sucesso!`,
      order,
      position: updatedPos
    });
  } catch (err) {
    console.error('[/api/trade/order] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.0b Executar Ordem Condicional a Mercado (Gatilho Stop Price) ───────────
router.post('/conditional-order', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const { symbol, side, quantity, stopPrice, reduceOnly } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    if (!symbol || !side || !quantity || !stopPrice) {
      return res.status(400).json({ error: 'Par, lado (BUY/SELL), quantidade e Preço de Disparo (Stop Price) são obrigatórios.' });
    }

    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      return res.status(400).json({ error: 'A quantidade deve ser maior que zero.' });
    }

    const numStop = parseFloat(stopPrice);
    if (isNaN(numStop) || numStop <= 0) {
      return res.status(400).json({ error: 'O preço de disparo deve ser maior que zero.' });
    }

    const result = await tradeService.executeConditionalOrder(
      apiKey,
      apiSecret,
      symbol.toUpperCase(),
      side.toUpperCase(),
      numQty,
      numStop,
      Boolean(reduceOnly)
    );

    res.json({
      success: true,
      message: `Ordem condicional ${side.toUpperCase()} agendada com sucesso em $${result.stopPrice}!`,
      order: result.order,
      type: result.type,
      stopPrice: result.stopPrice,
      quantity: result.quantity,
      reduceOnly: result.reduceOnly
    });
  } catch (err) {
    console.error('[/api/trade/conditional-order] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.1 Obter Ordens Abertas (TP / SL / Limites / Condicionais) ──────────────
router.post('/open-orders', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const rawSym = req.body.symbol;
    const symbol = (rawSym && String(rawSym).toUpperCase() !== 'ALL') ? String(rawSym).toUpperCase() : 'ALL';
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }

    const openData = await tradeService.getOpenOrders(apiKey, apiSecret, symbol);
    res.json({ success: true, ...openData });
  } catch (err) {
    console.error('[/api/trade/open-orders] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.1.1 Cancelar Ordem Condicional pelo algoId ────────────────────────────
router.post('/cancel-conditional', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const { symbol, algoId } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    if (!symbol || !algoId) {
      return res.status(400).json({ error: 'Símbolo e algoId da ordem são obrigatórios.' });
    }
    const result = await tradeService.cancelConditionalOrder(apiKey, apiSecret, symbol.toUpperCase(), algoId);
    res.json({ success: true, result });
  } catch (err) {
    console.error('[/api/trade/cancel-conditional] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.1.2 Modificar Preço de Disparo de Ordem Condicional (Drag & Drop) ─────
router.post('/modify-conditional', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const { symbol, algoId, newStopPrice } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    if (!symbol || !algoId || !newStopPrice) {
      return res.status(400).json({ error: 'Símbolo, ID e novo preço são obrigatórios.' });
    }
    const result = await tradeService.modifyConditionalOrder(apiKey, apiSecret, symbol.toUpperCase(), algoId, newStopPrice);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[/api/trade/modify-conditional] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.2 Definir / Atualizar Stop Loss e Take Profit da Posição ───────────────
router.post('/set-tpsl', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const { symbol, stopLoss, takeProfit } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    if (!symbol) {
      return res.status(400).json({ error: 'Símbolo é obrigatório.' });
    }

    if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') {
      const numSL = parseFloat(stopLoss);
      if (isNaN(numSL) || numSL < 0) {
        return res.status(400).json({ error: 'O Stop Loss não pode ser um valor negativo.' });
      }
    }

    if (takeProfit !== undefined && takeProfit !== null && takeProfit !== '') {
      const numTP = parseFloat(takeProfit);
      if (isNaN(numTP) || numTP < 0) {
        return res.status(400).json({ error: 'O Take Profit não pode ser um valor negativo.' });
      }
    }

    const result = await tradeService.setStopLossTakeProfit(apiKey, apiSecret, symbol.toUpperCase(), {
      stopLoss,
      takeProfit
    });

    res.json({
      success: true,
      message: result.partialWarning || 'Stop Loss / Take Profit atualizados na Binance com sucesso!',
      partialWarning: result.partialWarning,
      result
    });
  } catch (err) {
    console.error('[/api/trade/set-tpsl] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.3 Cancelar Stop Loss e Take Profit ─────────────────────────────────────
router.post('/cancel-tpsl', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const symbol = (req.body.symbol || 'BTCUSDT').toUpperCase();
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }

    await tradeService.cancelOpenOrders(apiKey, apiSecret, symbol);
    res.json({
      success: true,
      message: 'Ordens pendentes canceladas com sucesso na Binance!'
    });
  } catch (err) {
    console.error('[/api/trade/cancel-tpsl] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.4 Cancelar Apenas o Take Profit da Posição ─────────────────────────────
router.post('/cancel-tp', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const symbol = (req.body.symbol || 'BTCUSDT').toUpperCase();
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    const result = await tradeService.cancelPositionTp(apiKey, apiSecret, symbol);
    res.json({ success: true, result });
  } catch (err) {
    console.error('[/api/trade/cancel-tp] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 3.5 Cancelar Apenas o Stop Loss da Posição ───────────────────────────────
router.post('/cancel-sl', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const symbol = (req.body.symbol || 'BTCUSDT').toUpperCase();
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }
    const result = await tradeService.cancelPositionSl(apiKey, apiSecret, symbol);
    res.json({ success: true, result });
  } catch (err) {
    console.error('[/api/trade/cancel-sl] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 4. Encerrar / Zerar Posição Atual a Mercado ──────────────────────────────
router.post('/close', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const symbol = (req.body.symbol || 'BTCUSDT').toUpperCase();

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Chaves de API não configuradas.' });
    }

    const result = await tradeService.closeCurrentPosition(apiKey, apiSecret, symbol);
    res.json({
      success: true,
      message: `Posição em ${symbol} encerrada com sucesso!`,
      result
    });
  } catch (err) {
    console.error('[/api/trade/close] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
