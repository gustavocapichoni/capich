// ─── Monitor Multi-Ativos em Tempo Real (Port do py-alert para Web) ───────────

const COINS = [
  {
    symbol: "BTCUSDT",
    name: "BTC",
    iconImg: "assets/icons/btc.png",
    title: "BTC / USDT",
    subtitle: "15m · Binance Futuros",
    accent: "#F0B90B",
    decimals: 2
  },
  {
    symbol: "ETHUSDT",
    name: "ETH",
    iconImg: "assets/icons/eth.png",
    title: "ETH / USDT",
    subtitle: "15m · Binance Futuros",
    accent: "#627EEA",
    decimals: 2
  },
  {
    symbol: "BCHUSDT",
    name: "BCH",
    iconImg: "assets/icons/bch.png",
    title: "BCH / USDT",
    subtitle: "15m · Binance Futuros",
    accent: "#8DC351",
    decimals: 2
  },
  {
    symbol: "BNBUSDT",
    name: "BNB",
    iconImg: "assets/icons/bnb.png",
    title: "BNB / USDT",
    subtitle: "15m · Binance Futuros",
    accent: "#F3BA2F",
    decimals: 2
  },
  {
    symbol: "UNIUSDT",
    name: "UNI",
    iconImg: "assets/icons/uni.png",
    title: "UNI / USDT",
    subtitle: "15m · Binance Futuros",
    accent: "#FF007A",
    decimals: 4
  }
];

// ─── Estado Global ────────────────────────────────────────────────────────────
let soundEnabled = true;
try {
  const savedSound = localStorage.getItem("capich_sound_enabled");
  if (savedSound !== null) soundEnabled = (savedSound === "true");
} catch (_) {}

let audioCtx = null;
let flashState = false;

// Áudio de Notificação em Loop
const alertAudio = new Audio("assets/audio/notificacao.mp3");
alertAudio.loop = true;
alertAudio.preload = "auto";

function updateAudioState() {
  const hasActiveAlarms = coinsState.some(c => c.alertSoundActive);
  if (hasActiveAlarms && soundEnabled) {
    if (alertAudio.paused) {
      alertAudio.currentTime = 0;
      alertAudio.play().catch(() => {
        // Fallback para Web Audio se o navegador restringir áudio antes do primeiro clique
        const active = coinsState.filter(c => c.alertSoundActive);
        if (active.length > 0) {
          playBeep(active[0].soundFreq || 1200, 300);
        }
      });
    }
  } else {
    alertAudio.pause();
    alertAudio.currentTime = 0;
  }
}

// Estado individual de cada moeda
const coinsState = COINS.map(cfg => ({
  cfg,
  lastClose: 0,
  currentHigh: 0,
  currentLow: 0,
  currentClose: 0,
  currentSma32: 0,
  currentSma80: 0,
  dailyCloses: [],
  lastDailyFetch: 0,
  macroDiffPct: 0,
  definedTrend: null, // "ALTA", "BAIXA" ou null
  alertArmed: false,
  alertTriggered: false,
  alertSoundActive: false,
  soundFreq: 1200,
  lastPriceColor: "#FFFFFF",
  lastTimestamp: "--:--:--"
}));
window.coinsState = coinsState;

// ─── Web Audio API (Sintetizador idêntico ao winsound.Beep) ───────────────────
function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

// Qualquer clique na tela destrava o áudio conforme a política dos navegadores
document.addEventListener("click", initAudio, { once: true });
document.addEventListener("keydown", initAudio, { once: true });

function playBeep(freq, durationMs = 280) {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    // Envelope sonoro suave para não estalar o alto-falante
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (durationMs / 1000));

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + (durationMs / 1000));
  } catch (err) {
    console.warn("Erro ao reproduzir áudio:", err);
  }
}

// Loop contínuo de verificação de alertas e animação de piscar
setInterval(() => {
  updateAudioState();
  flashState = !flashState;
  updateFlashingUI();
}, 460);

function updateFlashingUI() {
  coinsState.forEach((coin, idx) => {
    const cardEl = document.getElementById(`coin-card-${idx}`);
    if (!cardEl) return;
    const alertBox = cardEl.querySelector(".card-alert-box");
    if (!alertBox) return;

    if (coin.alertSoundActive) {
      if (flashState) {
        alertBox.classList.add("flashing");
      } else {
        alertBox.classList.remove("flashing");
      }
    } else {
      alertBox.classList.remove("flashing");
    }
  });
}

// ─── Formatação de Preço ──────────────────────────────────────────────────────
function fmtPrice(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val) || val === 0) return "--";
  return "$" + Number(val).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// ─── Construção Inicial dos Cards no DOM ──────────────────────────────────────
function buildCardsDOM() {
  const container = document.getElementById("cards-grid");
  if (!container) return;
  container.innerHTML = "";

  coinsState.forEach((coin, idx) => {
    const cfg = coin.cfg;
    const card = document.createElement("div");
    card.className = "coin-card";
    card.id = `coin-card-${idx}`;

    card.innerHTML = `
      <!-- 1. Header do Ativo -->
      <div class="card-coin-header">
        <div class="card-coin-title" style="color: ${cfg.accent};">
          <img src="${cfg.iconImg}" alt="${cfg.name}" class="coin-icon-img" onerror="this.style.display='none'">
          <span>${cfg.title}</span>
          <button class="btn-section-help sm" onclick="abrirGuiaSecao('cards_pares')" title="Como interpretar os Cards dos 5 Pares?">?</button>
        </div>
        <div class="card-coin-subtitle">${cfg.subtitle}</div>
      </div>

      <!-- 2. Preço Atual -->
      <div class="card-price-box">
        <div class="card-box-label">PREÇO ATUAL (TEMPO REAL)</div>
        <div class="card-price-val" id="price-val-${idx}">Conectando...</div>
      </div>

      <!-- 3. Máx e Mín 15m -->
      <div class="card-hl-box">
        <div>
          <div class="hl-col-label hl-max-label">▲ MÁX 15m</div>
          <div class="hl-val hl-max-val" id="max-val-${idx}">--</div>
        </div>
        <div>
          <div class="hl-col-label hl-min-label">▼ MÍN 15m</div>
          <div class="hl-val hl-min-val" id="min-val-${idx}">--</div>
        </div>
      </div>

      <!-- 4. Médias Móveis 15m -->
      <div class="card-ma-box">
        <div class="card-box-label">MÉDIAS MÓVEIS (15m ARITMÉTICAS)</div>
        <div class="ma-grid">
          <div>
            <div class="ma-col-label ma-32-label">MMA 32</div>
            <div class="ma-32-val" id="sma32-val-${idx}">--</div>
          </div>
          <div>
            <div class="ma-col-label ma-80-label">MMA 80</div>
            <div class="ma-80-val" id="sma80-val-${idx}">--</div>
          </div>
        </div>
      </div>

      <!-- 5. Tendência Vigente -->
      <div class="card-trend-box">
        <div class="card-box-label">TENDÊNCIA VIGENTE (15m)</div>
        <div class="trend-status-val indef" id="trend-status-${idx}">Calculando...</div>
        <div class="trend-detail-val" id="trend-detail-${idx}">Aguardando dados...</div>
        <div class="trend-macro-val" id="macro-asset-${idx}" style="color: #848e9c;">Macro 3D/8D: --</div>
      </div>

      <!-- 6. Painel de Alerta Cruzamento MMA 32 -->
      <div class="card-alert-box" id="alert-box-${idx}">
        <div class="alert-header">🔔 ALERTA CRUZAMENTO MMA 32</div>
        <div class="alert-desc" id="alert-desc-${idx}">⏳ Aguardando definição da tendência</div>
        <button class="btn-reset-alert" id="btn-reset-${idx}" onclick="resetAlert(${idx})">Resetar Alerta</button>
      </div>

      <!-- 7. Rodapé do Card -->
      <div class="card-foot" id="card-foot-${idx}">
        ● Conectando...
      </div>
    `;

    container.appendChild(card);
  });
}

// ─── Busca e Processamento de Cada Moeda ──────────────────────────────────────
async function fetchCoinData(coinIndex) {
  const coin = coinsState[coinIndex];
  const cfg = coin.cfg;
  const now = Date.now();

  // 1. Atualização periódica dos candles diários (1d) a cada 30 segundos
  if (now - coin.lastDailyFetch > 30000 || coin.dailyCloses.length === 0) {
    try {
      const url1d = `https://fapi.binance.com/fapi/v1/klines?symbol=${cfg.symbol}&interval=1d&limit=10`;
      const res1d = await fetch(url1d);
      if (res1d.ok) {
        const data1d = await res1d.json();
        coin.dailyCloses = data1d.map(k => parseFloat(k[4]));
        coin.lastDailyFetch = now;
      }
    } catch (e) {
      // Falha silenciosa de 1d, tentará no próximo ciclo
    }
  }

  // 2. Busca dos candles de 15m
  try {
    const url15m = `https://fapi.binance.com/fapi/v1/klines?symbol=${cfg.symbol}&interval=15m&limit=85`;
    const res15m = await fetch(url15m);
    if (!res15m.ok) throw new Error(`HTTP ${res15m.status}`);
    const klines = await res15m.json();

    if (klines && klines.length >= 80) {
      const lastK = klines[klines.length - 1];
      const high  = parseFloat(lastK[2]);
      const low   = parseFloat(lastK[3]);
      const close = parseFloat(lastK[4]);

      const closes = klines.map(k => parseFloat(k[4]));
      const sma32  = closes.slice(-32).reduce((a, b) => a + b, 0) / 32.0;
      const sma80  = closes.slice(-80).reduce((a, b) => a + b, 0) / 80.0;

      // Força Operacional 15m / 1H (Preço vs MMA 32)
      // MMA 32 nos 15m é a projeção direta da MMA 8 do gráfico de 1h
      const diff15m = sma32 > 0 ? ((close - sma32) / sma32) * 100.0 : 0.0;

      processTick(coinIndex, high, low, close, sma32, sma80, diff15m);
    }
  } catch (err) {
    const footEl = document.getElementById(`card-foot-${coinIndex}`);
    if (footEl) {
      footEl.innerHTML = `<span style="color: #f6465d;">⚠ Reconectando...</span>`;
    }
  }
}

// ─── Processamento do Tick (Lógica da Estratégia) ─────────────────────────────
function processTick(idx, high, low, close, sma32, sma80, diff15m) {
  const coin = coinsState[idx];
  const dec = coin.cfg.decimals;

  // Cor instantânea do preço (alta / baixa / neutro)
  let priceColor = "#FFFFFF";
  if (coin.lastClose > 0) {
    if (close > coin.lastClose) priceColor = "#0ECB81";
    else if (close < coin.lastClose) priceColor = "#F6465D";
    else priceColor = coin.lastPriceColor || "#FFFFFF";
  }

  coin.lastPriceColor = priceColor;
  coin.lastClose      = close;
  coin.currentHigh    = high;
  coin.currentLow     = low;
  coin.currentClose   = close;
  coin.currentSma32   = sma32;
  coin.currentSma80   = sma80;
  coin.macroDiffPct   = diff15m;

  // Hora atual formatada
  const d = new Date();
  const ts = d.toTimeString().split(" ")[0] + "." + Math.floor(d.getMilliseconds() / 100);
  coin.lastTimestamp = ts;

  // Atualiza elementos no DOM
  const elPrice = document.getElementById(`price-val-${idx}`);
  if (elPrice) {
    elPrice.textContent = fmtPrice(close, dec);
    elPrice.style.color = priceColor;
  }

  const elMax = document.getElementById(`max-val-${idx}`);
  if (elMax) elMax.textContent = fmtPrice(high, dec);

  const elMin = document.getElementById(`min-val-${idx}`);
  if (elMin) elMin.textContent = fmtPrice(low, dec);

  const elSma32 = document.getElementById(`sma32-val-${idx}`);
  if (elSma32) elSma32.textContent = fmtPrice(sma32, dec);

  const elSma80 = document.getElementById(`sma80-val-${idx}`);
  if (elSma80) elSma80.textContent = fmtPrice(sma80, dec);

  const elMacroAsset = document.getElementById(`macro-asset-${idx}`);
  if (elMacroAsset) {
    const macroCor = diff15m > 0 ? "#0ECB81" : (diff15m < 0 ? "#F6465D" : "#848E9C");
    const sinal = diff15m > 0 ? "+" : "";
    elMacroAsset.textContent = `Força 15m vs MMA32: ${sinal}${diff15m.toFixed(2)}%`;
    elMacroAsset.style.color = macroCor;
  }

  const elFoot = document.getElementById(`card-foot-${idx}`);
  if (elFoot) {
    elFoot.innerHTML = `<span class="card-foot-live">● Ao vivo</span> · ${ts}`;
  }

  // ── Verificação da Tendência Vigente ──
  const isUptrendSetup   = (close > sma32 && close > sma80 && sma32 > sma80);
  const isDowntrendSetup = (close < sma32 && close < sma80 && sma32 < sma80);

  const elTrendStatus = document.getElementById(`trend-status-${idx}`);
  const elTrendDetail = document.getElementById(`trend-detail-${idx}`);

  if (isUptrendSetup) {
    if (elTrendStatus) {
      elTrendStatus.textContent = "▲ TENDÊNCIA DE ALTA";
      elTrendStatus.className = "trend-status-val alta";
    }
    if (elTrendDetail) {
      elTrendDetail.textContent = "Preço > MMA32 > MMA80";
      elTrendDetail.style.color = "#0ECB81";
    }

    if (coin.definedTrend !== "ALTA") {
      coin.definedTrend   = "ALTA";
      coin.alertArmed     = true;
      coin.alertTriggered = false;
    } else if (!coin.alertArmed && !coin.alertTriggered) {
      coin.alertArmed = true;
    }
  } else if (isDowntrendSetup) {
    if (elTrendStatus) {
      elTrendStatus.textContent = "▼ TENDÊNCIA DE BAIXA";
      elTrendStatus.className = "trend-status-val baixa";
    }
    if (elTrendDetail) {
      elTrendDetail.textContent = "Preço < MMA32 < MMA80";
      elTrendDetail.style.color = "#F6465D";
    }

    if (coin.definedTrend !== "BAIXA") {
      coin.definedTrend   = "BAIXA";
      coin.alertArmed     = true;
      coin.alertTriggered = false;
    } else if (!coin.alertArmed && !coin.alertTriggered) {
      coin.alertArmed = true;
    }
  } else {
    if (coin.definedTrend) {
      if (elTrendStatus) {
        elTrendStatus.textContent = "— CORREÇÃO / TESTE";
        elTrendStatus.className = "trend-status-val neutra";
      }
      if (elTrendDetail) {
        elTrendDetail.textContent = `Tendência Base: ${coin.definedTrend}`;
        elTrendDetail.style.color = "#848E9C";
      }
    } else {
      if (elTrendStatus) {
        elTrendStatus.textContent = "— INDEFINIDA";
        elTrendStatus.className = "trend-status-val indef";
      }
      if (elTrendDetail) {
        elTrendDetail.textContent = "Médias / Preço sem alinhamento";
        elTrendDetail.style.color = "#848E9C";
      }
    }
  }

  // ── Verificação de Cruzamento em Tempo Real ──
  checkRealtimeCrossing(idx, close, sma32, dec, ts);

  // Atualiza o medidor macro no topo
  updateMacroIndex();
}

// ─── Cruzamento e Alertas ─────────────────────────────────────────────────────
function checkRealtimeCrossing(idx, close, sma32, dec, ts) {
  const coin = coinsState[idx];
  const elAlertDesc = document.getElementById(`alert-desc-${idx}`);
  updateAudioState();
  const elBtnReset  = document.getElementById(`btn-reset-${idx}`);

  if (coin.alertTriggered) {
    return;
  }

  if (!coin.alertArmed) {
    if (coin.definedTrend === null && elAlertDesc) {
      elAlertDesc.textContent = "⏳ Aguardando definição da tendência (alinhamento das médias)";
      elAlertDesc.className = "alert-desc";
    }
    return;
  }

  // Tendência ALTA: Preço tocou ou cruzou abaixo da MMA 32
  if (coin.definedTrend === "ALTA") {
    if (close <= sma32) {
      coin.alertTriggered   = true;
      coin.alertArmed       = false;
      coin.alertSoundActive = true;
      coin.soundFreq        = 900; // Tom grave para cruzamento para baixo

      if (elAlertDesc) {
        elAlertDesc.innerHTML = `🔔 <strong>CRUZOU MMA 32 ABAIXO!</strong><br>Preço: ${fmtPrice(close, dec)} ≤ MMA: ${fmtPrice(sma32, dec)}<br>Às ${ts}`;
        elAlertDesc.className = "alert-desc triggered";
      }
      if (elBtnReset) {
        elBtnReset.textContent = "🔕 Silenciar Alerta";
        elBtnReset.classList.add("active-alarm");
      }
      updateAudioState();
    } else {
      if (elAlertDesc) {
        elAlertDesc.textContent = `🟢 Armado (ALTA): Dispara se Preço cruzar ≤ ${fmtPrice(sma32, dec)}`;
        elAlertDesc.className = "alert-desc armed-alta";
      }
    }
  }
  // Tendência BAIXA: Preço tocou ou cruzou acima da MMA 32
  else if (coin.definedTrend === "BAIXA") {
    if (close >= sma32) {
      coin.alertTriggered   = true;
      coin.alertArmed       = false;
      coin.alertSoundActive = true;
      coin.soundFreq        = 1400; // Tom agudo para cruzamento para cima

      if (elAlertDesc) {
        elAlertDesc.innerHTML = `🔔 <strong>CRUZOU MMA 32 ACIMA!</strong><br>Preço: ${fmtPrice(close, dec)} ≥ MMA: ${fmtPrice(sma32, dec)}<br>Às ${ts}`;
        elAlertDesc.className = "alert-desc triggered";
      }
      if (elBtnReset) {
        elBtnReset.textContent = "🔕 Silenciar Alerta";
        elBtnReset.classList.add("active-alarm");
      }
      updateAudioState();
    } else {
      if (elAlertDesc) {
        elAlertDesc.textContent = `🔴 Armado (BAIXA): Dispara se Preço cruzar ≥ ${fmtPrice(sma32, dec)}`;
        elAlertDesc.className = "alert-desc armed-baixa";
      }
    }
  }
}

// ─── Resetar / Silenciar Alerta ───────────────────────────────────────────────
window.resetAlert = function(idx) {
  const coin = coinsState[idx];
  coin.alertSoundActive = false;
  coin.alertTriggered   = false;

  const elBtn = document.getElementById(`btn-reset-${idx}`);
  if (elBtn) {
    elBtn.textContent = "Resetar Alerta";
    elBtn.classList.remove("active-alarm");
  }

  const elBox = document.getElementById(`alert-box-${idx}`);
  if (elBox) elBox.classList.remove("flashing");

  const elAlertDesc = document.getElementById(`alert-desc-${idx}`);
  updateAudioState();

  // Rearme inteligente
  if (coin.currentClose > 0 && coin.currentSma32 > 0) {
    if (coin.definedTrend === "ALTA" && coin.currentClose > coin.currentSma32) {
      coin.alertArmed = true;
      if (elAlertDesc) {
        elAlertDesc.textContent = `🟢 Rearmado (ALTA): Aguardando Preço ≤ MMA32`;
        elAlertDesc.className = "alert-desc armed-alta";
      }
    } else if (coin.definedTrend === "BAIXA" && coin.currentClose < coin.currentSma32) {
      coin.alertArmed = true;
      if (elAlertDesc) {
        elAlertDesc.textContent = `🔴 Rearmado (BAIXA): Aguardando Preço ≥ MMA32`;
        elAlertDesc.className = "alert-desc armed-baixa";
      }
    } else {
      coin.alertArmed = false;
      if (elAlertDesc) {
        elAlertDesc.textContent = "⏳ Aguardando retorno ao alinhamento da tendência";
        elAlertDesc.className = "alert-desc";
      }
    }
  } else {
    if (elAlertDesc) {
      elAlertDesc.textContent = "⬤ Resetado";
      elAlertDesc.className = "alert-desc";
    }
  }
};

window.silenceAll = function() {
  coinsState.forEach((coin, idx) => {
    coin.alertSoundActive = false;
    const elBtn = document.getElementById(`btn-reset-${idx}`);
    if (elBtn) {
      elBtn.textContent = "Resetar Alerta";
      elBtn.classList.remove("active-alarm");
    }
    const elBox = document.getElementById(`alert-box-${idx}`);
    if (elBox) elBox.classList.remove("flashing");
  });
  updateAudioState();
};

window.toggleSound = function(checkbox) {
  soundEnabled = checkbox.checked;
  try {
    localStorage.setItem("capich_sound_enabled", String(soundEnabled));
  } catch (_) {}
  if (!soundEnabled) {
    window.silenceAll();
  } else {
    initAudio();
  }
};

// ─── Medidor Macro (Canvas Termômetro Centralizado no Zero) ───────────────────
function updateMacroIndex() {
  const diffs = coinsState
    .map(c => c.macroDiffPct)
    .filter(d => !isNaN(d) && d !== 0);

  if (diffs.length === 0) return;

  const avgDiff  = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const posCount = diffs.filter(d => d > 0).length;
  const negCount = diffs.filter(d => d < 0).length;

  const elStatus = document.getElementById("macro-status-text");
  const elScore  = document.getElementById("macro-scoreboard");

  const sinal = avgDiff > 0 ? "+" : "";
  if (elStatus) {
    if (avgDiff > 0.05) {
      elStatus.textContent = `▲ ${sinal}${avgDiff.toFixed(2)}% · MERCADO COMPRADOR (1H/15m > MMA 32)`;
      elStatus.style.color = "#0ECB81";
    } else if (avgDiff < -0.05) {
      elStatus.textContent = `▼ ${sinal}${avgDiff.toFixed(2)}% · MERCADO VENDEDOR (1H/15m < MMA 32)`;
      elStatus.style.color = "#F6465D";
    } else {
      elStatus.textContent = `— ${sinal}${avgDiff.toFixed(2)}% · MERCADO NEUTRO (Gatilho na MMA 32)`;
      elStatus.style.color = "#EAECEF";
    }
  }

  if (elScore) {
    elScore.innerHTML = `Força da Cesta (15m):<br><strong>🟢 ${posCount} Acima da MMA 32</strong> | <strong>🔴 ${negCount} Abaixo da MMA 32</strong>`;
  }

  // Desenho da barra visual no Canvas
  drawGauge(avgDiff);
}

function drawGauge(avgDiff) {
  const canvas = document.getElementById("gauge-canvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width || 400;
  const h = 34;

  canvas.style.height = "34px";

  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const cx = w / 2.0; // Marco Zero exatamente no centro
  const barTop = 15;
  const barH = 12;

  // Escala máxima visual: +/- 4%
  const maxScale = 4.0;
  const clampedDiff = Math.max(-maxScale, Math.min(maxScale, avgDiff));
  const barLen = (clampedDiff / maxScale) * (w / 2.0);
  const tipX = cx + barLen;

  // Régua de marcas graduadas (-4, -3, -2, -1, 0, +1, +2, +3, +4)
  for (let val = -4; val <= 4; val++) {
    const tickX = cx + (val / maxScale) * (w / 2.0);
    const isMajor = val === 0 || Math.abs(val) === 2 || Math.abs(val) === 4;
    
    // Traço
    ctx.fillStyle = val === 0 ? "#eaecef" : isMajor ? "#4a5568" : "#283245";
    ctx.fillRect(tickX - 0.5, barTop + (isMajor ? 0 : 2), 1, isMajor ? barH : barH - 4);

    // Texto com os números (-4, -3, -2, -1, 0, 1, 2, 3, 4)
    ctx.fillStyle = val === 0 ? "#ffffff" : isMajor ? "#848e9c" : "#4a5568";
    ctx.font = "8px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(val === 0 ? "0" : (val > 0 ? "+" + val : val), tickX, h - 1);
  }

  // Barra preenchida
  if (barLen > 0) {
    // Positivo (Verde para a direita)
    ctx.fillStyle = "rgba(14, 203, 129, 0.65)";
    ctx.fillRect(cx, barTop, barLen, barH);

    // Marcador branco/neon na ponta
    ctx.fillStyle = "#0ecb81";
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  } else if (barLen < 0) {
    // Negativo (Vermelho para a esquerda)
    ctx.fillStyle = "rgba(246, 70, 93, 0.65)";
    ctx.fillRect(cx + barLen, barTop, -barLen, barH);

    // Marcador vermelho na ponta
    ctx.fillStyle = "#f6465d";
    ctx.fillRect(tipX - 1.5, barTop - 2, 3, barH + 4);
  }

  // Linha central do Zero (sempre por cima para referência)
  ctx.fillStyle = "#eaecef";
  ctx.fillRect(cx - 1, barTop - 2, 2, barH + 4);

  // ── Valor Dinâmico Flutuante em Tempo Real (Acompanha a ponta da barra) ──
  const badgeValStr = (avgDiff > 0 ? "+" : "") + avgDiff.toFixed(2) + "%";
  const badgeColor  = avgDiff > 0.05 ? "#0ecb81" : (avgDiff < -0.05 ? "#f6465d" : "#848e9c");
  
  ctx.font = "bold 9px 'Courier New', monospace";
  const textW = ctx.measureText(badgeValStr).width;
  const badgeW = Math.max(textW + 12, 52);
  const badgeH = 13;
  const badgeY = 1;
  const badgeX = Math.max(badgeW / 2 + 2, Math.min(w - badgeW / 2 - 2, tipX));

  // Balãozinho / Pill com sombra
  ctx.fillStyle = "#0c1017";
  ctx.beginPath();
  ctx.roundRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH, 3);
  ctx.fill();

  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Texto do valor ao vivo
  ctx.fillStyle = badgeColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeValStr, badgeX, badgeY + badgeH / 2 + 0.5);

  ctx.restore();
}

window.addEventListener("resize", () => {
  const diffs = coinsState.map(c => c.macroDiffPct).filter(d => !isNaN(d) && d !== 0);
  if (diffs.length > 0) {
    drawGauge(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  }
});

// ─── Inicialização e Loop de Requisições ──────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  const chkSound = document.getElementById("chk-sound");
  if (chkSound) chkSound.checked = soundEnabled;

  buildCardsDOM();

  // Inicia loops independentes e escalonados para cada moeda (otimizado para desempenho)
  coinsState.forEach((_, idx) => {
    setTimeout(() => {
      fetchCoinData(idx);
      // Intervalo contínuo a cada 1.8 segundos (estável e leve para CPU)
      setInterval(() => fetchCoinData(idx), 1800);
    }, idx * 300);
  });
});
