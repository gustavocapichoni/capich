/**
 * js/tactical/data_feed.js
 * Comunicação com API de histórico tático, polling de Derivativos e WebSockets Binance em tempo real.
 */

import { state, API_URL } from './state.js';
import { renderVolumeCanvas, renderEmpireZones } from './indicators.js';
import { renderDefaultLegend } from './legend.js';
import { updateHUD, drawTruckGauge } from './hud_gauges.js';
import { checkFiboAlert } from './audio_alerts.js';
import { applyPriceFormatToSeries } from './chart_core.js';

let activeFetchId = 0;
let lastPriceUpdateTimestamp = 0;
let wsReconnectTimeout = null;
let wsActiveStreamKey = '';
let _indexWarmDone = false;
let isFetchingIndex = false;
let isFetchingOi = false;
let isFetchingGlobalOi = false;

export async function fetchAndRender() {
  const fetchId = ++activeFetchId;
  try {
    const titleEl = document.getElementById('tac-title-text');
    if (titleEl) {
      titleEl.innerHTML = `&#128200; Preço ${state.currentSymbol}`;
    }

    const res = await fetch(`${API_URL}?symbol=${state.currentSymbol}&interval=${state.currentTimeframe}`);
    if (!res.ok) throw new Error('Falha ao obter histórico tático: ' + res.status);
    const data = await res.json();

    if (fetchId !== activeFetchId) return;

    state.baseAsset = data.baseAsset || 'BTC';
    state.meta = {
      shortLabel: data.shortLabel,
      longLabel:  data.longLabel,
      shortPeriod: data.shortPeriod,
      longPeriod: data.longPeriod
    };
    state.oi = data.oi || {};
    state.candles = (data.candles || []).map(c => ({
      time: Math.floor(c.t / 1000),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.cl,
      volume: c.v,
      buyV: c.buyV,
      sellV: c.sellV,
      mmaShort: c.mmaShort,
      mmaLong: c.mmaLong,
      vwapBuy: c.vwapBuy,
      vwapSell: c.vwapSell,
      isAccum: c.isAccum,
      netAccum72h: c.netAccum72h,
      intraBuy: c.intraBuy,
      intraSell: c.intraSell,
      isIntraAccum: c.isIntraAccum,
      netAccum8h: c.netAccum8h,
      signal: c.signal
    }));

    if (state.series.candles) {
      const candleData = state.candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
      state.series.candles.setData(candleData);
    }

    if (state.series.mmaShort && state.series.mmaLong) {
      const maShortData = state.candles
        .filter(c => c.mmaShort !== null)
        .map(c => ({ time: c.time, value: c.mmaShort }));
      const maLongData = state.candles
        .filter(c => c.mmaLong !== null)
        .map(c => ({ time: c.time, value: c.mmaLong }));

      state.series.mmaShort.setData(maShortData);
      state.series.mmaLong.setData(maLongData);
    }

    if (state.series.vwapBuy && state.series.vwapSell) {
      const vBuyData = state.candles
        .filter(c => c.vwapBuy !== null)
        .map(c => ({ time: c.time, value: c.vwapBuy }));
      const vSellData = state.candles
        .filter(c => c.vwapSell !== null)
        .map(c => ({ time: c.time, value: c.vwapSell }));

      state.series.vwapBuy.setData(vBuyData);
      state.series.vwapSell.setData(vSellData);
    }

    if (state.series.intraBuy && state.series.intraSell) {
      const iBuyData = state.candles
        .filter(c => c.intraBuy !== null)
        .map(c => ({ time: c.time, value: c.intraBuy }));
      const iSellData = state.candles
        .filter(c => c.intraSell !== null)
        .map(c => ({ time: c.time, value: c.intraSell }));

      state.series.intraBuy.setData(iBuyData);
      state.series.intraSell.setData(iSellData);
    }

    const shortTitle = state.currentTimeframe === '15m' ? 'MMA 32' : 'MMA 8';
    const longTitle  = state.currentTimeframe === '15m' ? 'MMA 80' : 'MMA 20';
    const maTagsOn = state.maVisible && state.empireTagsVisible;
    if (state.series.mmaShort) {
      state.series.mmaShort.applyOptions({
        visible: state.maVisible,
        lastValueVisible: maTagsOn,
        title: maTagsOn ? shortTitle : ''
      });
    }
    if (state.series.mmaLong) {
      state.series.mmaLong.applyOptions({
        visible: state.maVisible,
        lastValueVisible: maTagsOn,
        title: maTagsOn ? longTitle : ''
      });
    }
    if (state.series.vwapBuy)  state.series.vwapBuy.applyOptions({ visible: state.indicatorsVisible });
    if (state.series.vwapSell) state.series.vwapSell.applyOptions({ visible: state.indicatorsVisible });
    if (state.series.intraBuy) state.series.intraBuy.applyOptions({ visible: state.indicatorsVisible });
    if (state.series.intraSell) state.series.intraSell.applyOptions({ visible: state.indicatorsVisible });

    applyPriceFormatToSeries(state.currentSymbol);

    if (state.series.candles) {
      state.series.candles.setMarkers([]);
    }

    renderVolumeCanvas();
    renderEmpireZones();
    renderDefaultLegend();
    updateHUD();

    if (state.charts.main) {
      state.charts.main.timeScale().applyOptions({ rightOffset: 18 });
      state.charts.main.timeScale().scrollToRealTime();
    }

    openWebSocket();

  } catch (err) {
    console.error('[BTC Tactical] Erro ao carregar dados:', err);
    const leg = document.getElementById('tac-legend');
    if (leg) leg.innerHTML = '<span style="color:#f6465d;">Erro ao conectar com a API tática de futuros.</span>';
  }
}

async function _warmIndexCache() {
  if (_indexWarmDone) return;
  _indexWarmDone = true;
  try { await fetch('/api/crypto-index?interval=15m'); } catch (_) {}
}

export async function fetchPersonalIndexLive() {
  if (isFetchingIndex) return;
  isFetchingIndex = true;
  try {
    await _warmIndexCache();
    const res = await fetch(`/api/personal-index?symbol=${state.currentSymbol}`);
    if (!res.ok) return;
    const data = await res.json();
    state.personalBasket = data;
    updateHUD();
  } catch (_) {
  } finally {
    isFetchingIndex = false;
  }
}

export async function fetchOiLive() {
  if (isFetchingOi) return;
  isFetchingOi = true;
  try {
    const res = await fetch(`/api/tactical-oi?symbol=${state.currentSymbol}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.oi) {
      state.oi = data.oi;
      updateHUD();
    }
  } catch (_) {
  } finally {
    isFetchingOi = false;
  }
}

export async function fetchGlobalOi() {
  if (isFetchingGlobalOi) return;
  isFetchingGlobalOi = true;
  try {
    const res = await fetch('/api/open-interest');
    if (!res.ok) return;
    const data = await res.json();
    if (data) {
      state.globalOi = data;
      updateHUD();
    }
  } catch (_) {
  } finally {
    isFetchingGlobalOi = false;
  }
}

export function updateOracleHUD() {
  if (!state.isHovering) {
    renderDefaultLegend();
    updateHUD();
  }
}

export function openWebSocket(force = false) {
  const symbolLower = state.currentSymbol.toLowerCase();
  const targetStreamKey = `${symbolLower}@kline_${state.currentTimeframe}`;

  if (!force && state.ws && state.ws.readyState === WebSocket.OPEN && wsActiveStreamKey === targetStreamKey) {
    return;
  }

  if (state.ws) {
    try {
      state.ws.onclose = null;
      state.ws.onerror = null;
      state.ws.close();
    } catch (e) {}
    state.ws = null;
  }

  wsActiveStreamKey = targetStreamKey;
  const liveDot = document.getElementById('tac-live-dot');
  const activeSym = state.currentSymbol;
  const wsUrl = `wss://fstream.binance.com/ws/${targetStreamKey}`;
  
  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      if (state.currentSymbol !== activeSym) return;
      const badgeEl = document.getElementById('tac-ticker-badge');
      const liveDot = document.getElementById('tac-live-dot');
      if (badgeEl) badgeEl.classList.remove('connecting');
      if (liveDot) liveDot.title = 'Fluxo de dados em tempo real';
    };

    state.ws.onmessage = (evt) => {
      try {
        if (state.currentSymbol !== activeSym) return;
        const msg = JSON.parse(evt.data);
        if (!msg.k) return;
        const k = msg.k;

        lastPriceUpdateTimestamp = Date.now();

        const updatedCandle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          buyV: parseFloat(k.V),
          sellV: parseFloat(k.v) - parseFloat(k.V)
        };

        if (state.series.candles) {
          try {
            state.series.candles.update({
              time: updatedCandle.time,
              open: updatedCandle.open,
              high: updatedCandle.high,
              low: updatedCandle.low,
              close: updatedCandle.close
            });
          } catch (err) {
            console.warn('[BTC Tactical] candle update err:', err);
          }
        }

        if (state.candles.length) {
          const last = state.candles[state.candles.length - 1];
          if (last.time === updatedCandle.time) {
            last.open = updatedCandle.open;
            last.high = updatedCandle.high;
            last.low = updatedCandle.low;
            last.close = updatedCandle.close;
            last.volume = updatedCandle.volume;
            last.buyV = updatedCandle.buyV;
            last.sellV = updatedCandle.sellV;
          } else if (updatedCandle.time > last.time) {
            state.candles.push({
              ...updatedCandle,
              mmaShort: last.mmaShort,
              mmaLong: last.mmaLong,
              vwapBuy: last.vwapBuy,
              vwapSell: last.vwapSell,
              intraBuy: last.intraBuy,
              intraSell: last.intraSell,
              isAccum: last.isAccum,
              isIntraAccum: last.isIntraAccum,
              netAccum72h: last.netAccum72h,
              netAccum8h: last.netAccum8h
            });
            if (state.series.candles) {
              try {
                state.series.candles.update({
                  time: updatedCandle.time,
                  open: updatedCandle.open,
                  high: updatedCandle.high,
                  low: updatedCandle.low,
                  close: updatedCandle.close
                });
              } catch (_) {}
            }
            clearTimeout(window._tacCandleTurnTimer);
            window._tacCandleTurnTimer = setTimeout(() => {
              fetchAndRender();
            }, 1500);
            return;
          }
        }

        if (!state.isHovering) {
          renderDefaultLegend();
          renderVolumeCanvas();
          renderEmpireZones();
        }

        checkFiboAlert(updatedCandle.close);

        if (window.OrderPanel) {
          window.OrderPanel.setMarketContext(state.currentSymbol, updatedCandle.close);
        }

        drawTruckGauge();
      } catch (e) {
        console.warn('[BTC Tactical] WS parse error:', e);
      }
    };

    state.ws.onerror = (err) => {
      console.warn('[BTC Tactical] WS error:', err);
      if (liveDot) {
        liveDot.innerHTML = '&#9675; RECONECTANDO';
        liveDot.style.color = '#f0b90b';
      }
    };

    state.ws.onclose = () => {
      if (liveDot) {
        liveDot.innerHTML = '&#9675; DESCONECTADO';
        liveDot.style.color = '#848e9c';
      }
      clearTimeout(wsReconnectTimeout);
      wsReconnectTimeout = setTimeout(() => {
        if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
          openWebSocket(true);
        }
      }, 2000);
    };
  } catch (e) {
    console.warn('[BTC Tactical] WS error:', e);
  }
}

export async function syncLivePriceFallback() {
  const elapsed = Date.now() - lastPriceUpdateTimestamp;
  if (elapsed < 3500) return;

  if (elapsed > 6000) {
    console.warn('[BTC Tactical] WebSocket inativo por >6s. Forçando reconexão...');
    openWebSocket(true);
  }

  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${state.currentSymbol}&interval=${state.currentTimeframe}&limit=2`);
    if (!res.ok) return;
    const klines = await res.json();
    if (!Array.isArray(klines) || !klines.length) return;

    const latestK = klines[klines.length - 1];
    const kTime = Math.floor(latestK[0] / 1000);
    const kOpen = parseFloat(latestK[1]);
    const kHigh = parseFloat(latestK[2]);
    const kLow  = parseFloat(latestK[3]);
    const kClose= parseFloat(latestK[4]);
    const kVol  = parseFloat(latestK[5]);
    const kBuyV = parseFloat(latestK[9]) || (kVol * 0.5);
    const kSellV= Math.max(0, kVol - kBuyV);

    if (!kClose || isNaN(kClose)) return;
    lastPriceUpdateTimestamp = Date.now();

    if (state.candles.length) {
      const last = state.candles[state.candles.length - 1];

      if (kTime === last.time) {
        last.high = Math.max(last.high, kHigh);
        last.low  = Math.min(last.low, kLow);
        last.close= kClose;
        last.volume = kVol;
        last.buyV   = kBuyV;
        last.sellV  = kSellV;
      } else if (kTime > last.time) {
        state.candles.push({
          time: kTime,
          open: kOpen,
          high: kHigh,
          low: kLow,
          close: kClose,
          volume: kVol,
          buyV: kBuyV,
          sellV: kSellV,
          mmaShort: last.mmaShort,
          mmaLong: last.mmaLong,
          vwapBuy: last.vwapBuy,
          vwapSell: last.vwapSell,
          intraBuy: last.intraBuy,
          intraSell: last.intraSell,
          isAccum: last.isAccum,
          isIntraAccum: last.isIntraAccum,
          netAccum72h: last.netAccum72h,
          netAccum8h: last.netAccum8h
        });
        setTimeout(fetchAndRender, 1000);
      }

      const activeCandle = state.candles[state.candles.length - 1];
      if (state.series.candles) {
        try {
          state.series.candles.update({
            time: activeCandle.time,
            open: activeCandle.open,
            high: activeCandle.high,
            low: activeCandle.low,
            close: activeCandle.close
          });
        } catch (e) {}
      }

      if (!state.isHovering) {
        renderDefaultLegend();
      }

      checkFiboAlert(kClose);

      if (window.OrderPanel) {
        window.OrderPanel.setMarketContext(state.currentSymbol, kClose);
      }
    }
  } catch (_) {}
}
