/**
 * trade_routes.js
 * Rotas REST para o Mini Painel de Ordens da Binance Futures
 * Totalmente Modular e Seguro
 */

const express = require('express');
const router = express.Router();
const tradeService = require('../services/binance_trade_service');

/**
 * Extrai credenciais exclusivamente enviadas pelo navegador do usuário (100% isolado e seguro)
 */
function getCredentials(req) {
  const apiKey = req.headers['x-api-key'] || req.body.apiKey;
  const apiSecret = req.headers['x-api-secret'] || req.body.apiSecret;
  return { apiKey, apiSecret };
}

// ─── 0. Obter Regras do Símbolo (minQty, stepSize, decimais) ──────────────────
router.get('/symbol-info', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
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

    const tpSlOptions = (stopLoss || takeProfit) ? { stopLoss, takeProfit } : null;

    const order = await tradeService.executeMarketOrder(
      apiKey,
      apiSecret,
      symbol.toUpperCase(),
      side.toUpperCase(),
      parseFloat(quantity),
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

// ─── 3.1 Obter Ordens Abertas (TP / SL / Limites) ────────────────────────────
router.post('/open-orders', async (req, res) => {
  try {
    const { apiKey, apiSecret } = getCredentials(req);
    const symbol = (req.body.symbol || 'BTCUSDT').toUpperCase();
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
