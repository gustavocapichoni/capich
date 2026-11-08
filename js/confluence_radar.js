// js/confluence_radar.js — Radar Quantitativo de Confluência & Probabilidade (Oráculo)
// Consome a Fonte Única da Verdade do Backend (/api/personal-index)
// 100% Sincronizado com o Gráfico Tático do Histórico

(function () {
  'use strict';

  function setPillar(id, statusText, state) {
    const el = document.getElementById(id);
    const textEl = document.getElementById('pstatus-' + id.replace('pillar-', ''));
    if (!el || !textEl) return;

    el.className = 'pillar-box pillar-' + (state || 'neutral');
    textEl.textContent = statusText || 'Analisando...';
  }

  async function updateRadar() {
    try {
      const res = await fetch('/api/personal-index');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.oracle) return;

      const o = data.oracle;
      const dirScore = o.pct; // ex: +68 ou -42
      const bestPair = o.bestPair;

      // Exposição global para o ecossistema
      window._oracleDirectionalScore = dirScore;
      window._oracleRawScore = o.score;
      try { localStorage.setItem('oracleDirectionalScore', dirScore); } catch(_) {}

      // 1. Atualização dos Textos de Probabilidade e Badge
      const probPctEl   = document.getElementById('radar-prob-pct');
      const probBadgeEl = document.getElementById('radar-prob-badge');
      const probBarEl   = document.getElementById('radar-prob-bar');
      const probNeedleEl= document.getElementById('radar-prob-needle');
      const scorePtsEl  = document.getElementById('radar-score-pts');
      const narrativeEl = document.getElementById('radar-narrative-text');
      const leadValEl   = document.getElementById('radar-lead-val');
      const updatedEl   = document.getElementById('radar-updated-time');

      if (probPctEl) {
        probPctEl.textContent = o.pctText;
        probPctEl.style.color = o.color;
      }
      if (scorePtsEl) {
        scorePtsEl.textContent = `Força Geral: ${o.pctText} / 100`;
      }

      // 2. Barra de Probabilidade Bidirecional (sempre parte do centro 50%)
      if (probBarEl && probNeedleEl) {
        const halfWidth = Math.abs(dirScore) / 2;
        if (dirScore >= 0) {
          probBarEl.style.left  = '50%';
          probBarEl.style.width = `${halfWidth}%`;
        } else {
          probBarEl.style.left  = `${50 - halfWidth}%`;
          probBarEl.style.width = `${halfWidth}%`;
        }
        const needlePos = 50 + (dirScore / 2);
        probNeedleEl.style.left = `${needlePos}%`;

        // Gradiente da barra
        if (dirScore >= 36) {
          probBarEl.style.background = 'linear-gradient(90deg, #107048, #0ecb81)';
        } else if (dirScore >= 12) {
          probBarEl.style.background = 'linear-gradient(90deg, #1f6448, #2ebd85)';
        } else if (dirScore <= -36) {
          probBarEl.style.background = 'linear-gradient(270deg, #f6465d, #b32638)';
        } else if (dirScore <= -12) {
          probBarEl.style.background = 'linear-gradient(270deg, #e05365, #882230)';
        } else {
          probBarEl.style.background = 'rgba(132, 142, 156, 0.4)';
        }
      }

      if (probBadgeEl) {
        probBadgeEl.textContent = o.verdict;
        probBadgeEl.className = 'radar-prob-badge ' + (o.badgeClass || 'badge-neutral');
      }

      // 3. Tooltip Interativo
      const trackEl = document.getElementById('radar-prob-bar-track');
      const tipEl   = document.getElementById('radar-prob-tooltip');
      if (trackEl && tipEl) {
        let tipHtml = '';
        if (dirScore <= -36) {
          tipHtml = `
            <div class="radar-prob-tooltip-title" style="color: #f6465d;">🔴 FORÇA VENDEDORA DOMINANTE (${dirScore}%)</div>
            <div class="radar-prob-tooltip-desc">O mercado está com <strong>${Math.abs(dirScore)}%</strong> de pressão vendedora. Os vendedores estão no comando, médias caindo e fluxo saindo das corretoras.</div>
            <div class="radar-prob-tooltip-action" style="color: #ff6b81;">👉 AÇÃO: NÃO COMPRE! Procure VENDA (Short) no pullback da MMA 32 a favor da tendência mãe (MMA 80).</div>
          `;
        } else if (dirScore >= 36) {
          tipHtml = `
            <div class="radar-prob-tooltip-title" style="color: #0ecb81;">🟢 FORÇA COMPRADORA DOMINANTE (+${dirScore}%)</div>
            <div class="radar-prob-tooltip-desc">O mercado está com <strong>+${dirScore}%</strong> de pressão compradora. Compradores injetando capital, médias subindo e fluxo institucional acumulando.</div>
            <div class="radar-prob-tooltip-action" style="color: #0ecb81;">👉 AÇÃO: Procure COMPRA (Long) na zona de observação (pullback da MMA 32) a favor da tendência mãe (MMA 80).</div>
          `;
        } else if (dirScore > 0) {
          tipHtml = `
            <div class="radar-prob-tooltip-title" style="color: #f0b90b;">🟡 VIÉS COMPRADOR LEVE (+${dirScore}%)</div>
            <div class="radar-prob-tooltip-desc">Leve vantagem compradora (+${dirScore}%). Aguarde mais confluência antes de arriscar.</div>
            <div class="radar-prob-tooltip-action" style="color: #eaecef;">👉 AÇÃO: PACIÊNCIA. Aguarde o índice superar +35% para compras com convicção.</div>
          `;
        } else if (dirScore < 0) {
          tipHtml = `
            <div class="radar-prob-tooltip-title" style="color: #f0b90b;">🟠 VIÉS VENDEDOR LEVE (${dirScore}%)</div>
            <div class="radar-prob-tooltip-desc">Leve vantagem vendedora (${dirScore}%). Aguarde mais confluência antes de arriscar a venda.</div>
            <div class="radar-prob-tooltip-action" style="color: #eaecef;">👉 AÇÃO: PACIÊNCIA. Aguarde o índice cair abaixo de -35% para vendas com convicção.</div>
          `;
        } else {
          tipHtml = `
            <div class="radar-prob-tooltip-title" style="color: #848e9c;">⚪ MERCADO NEUTRO / INDEFINIDO (0%)</div>
            <div class="radar-prob-tooltip-desc">Forças de compra e venda perfeitamente equilibradas. Nenhum lado tem vantagem.</div>
            <div class="radar-prob-tooltip-action" style="color: #eaecef;">👉 AÇÃO: FIQUE DE FORA. Aguarde definição com volume institucional.</div>
          `;
        }
        tipEl.innerHTML = tipHtml;

        trackEl.onmouseenter = () => { tipEl.style.display = 'block'; };
        trackEl.onmouseleave = () => { tipEl.style.display = 'none'; };
      }

      // 4. Par Recomendado (Rigorosamente dentro das regras)
      if (leadValEl && bestPair) {
        const bp = bestPair;
        const volSignFut = bp.futBonus >= 0 ? '+' : '';
        const volSignSpot = bp.spotBonus >= 0 ? '+' : '';
        const volColorFut = bp.futBonus >= 0 ? '#0ecb81' : (bp.futBonus < -40 ? '#f6465d' : '#848e9c');
        const volColorSpot = bp.spotBonus >= 0 ? '#0ecb81' : (bp.spotBonus < -40 ? '#f6465d' : '#848e9c');
        const distColor = Math.abs(bp.distMma32Pct) <= 0.85 ? '#0ecb81' : (Math.abs(bp.distMma32Pct) > 2 ? '#f6465d' : '#38bdf8');
        const badgeBg = bp.isWaitingSetup ? 'rgba(240, 185, 11, 0.15)' : 'rgba(14, 203, 129, 0.15)';
        const badgeColor = bp.isWaitingSetup ? '#f0b90b' : '#0ecb81';

        leadValEl.innerHTML = `
          <div style="font-size: 1.05rem; margin-bottom: 4px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
            <strong style="color: #ffffff; font-size: 1.15rem;">${bp.symbol} / USDT</strong> 
            <span style="font-size: 0.82rem; padding: 2px 8px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor}; font-weight: 600;">${bp.setupName}</span>
          </div>
          <div style="font-size: 0.82rem; color: #848e9c; line-height: 1.45;">
            Distância MMA 32: <span style="color: ${distColor}; font-weight: 700;">${bp.distMma32Pct >= 0 ? '+' : ''}${bp.distMma32Pct.toFixed(2)}%</span> · 
            Vol. Spot: <span style="color: ${volColorSpot}; font-weight: 700;">${volSignSpot}${bp.spotBonus}%</span> · 
            Vol. Futuros: <span style="color: ${volColorFut}; font-weight: 700;">${volSignFut}${bp.futBonus}%</span> · 
            Stop Técnico (MMA 80): <span style="color: #eaecef; font-weight: 700;">${bp.stopLossPrice}</span>
          </div>
          <div style="font-size: 0.78rem; color: #a0aec0; margin-top: 3px; font-style: italic;">
            ${bp.actionMsg}
          </div>
        `;
      }

      // 5. Diagnóstico Narrativo
      if (narrativeEl && o.narrative) {
        narrativeEl.innerHTML = o.narrative;
      }

      // 6. Atualização dos 6 Pilares do Semáforo
      if (o.pillarsDetailed) {
        const pd = o.pillarsDetailed;
        if (pd.flows)       setPillar('pillar-flows', pd.flows.text, pd.flows.state);
        if (pd.taker)       setPillar('pillar-taker', pd.taker.text, pd.taker.state);
        if (pd.technical)   setPillar('pillar-technical', pd.technical.text, pd.technical.state);
        if (pd.indices)     setPillar('pillar-indices', pd.indices.text, pd.indices.state);
        if (pd.derivatives) setPillar('pillar-derivatives', pd.derivatives.text, pd.derivatives.state);
        if (pd.sentiment)   setPillar('pillar-sentiment', pd.sentiment.text, pd.sentiment.state);
      }

      if (updatedEl) {
        const now = new Date(data.updatedAt || Date.now());
        updatedEl.textContent = `Atualizado às ${now.toLocaleTimeString('pt-BR')} · Oráculo Unificado CAPICH`;
      }

    } catch (err) {
      console.warn('[ConfluenceRadar] Erro ao sincronizar Oráculo:', err);
    }
  }

  // Execução inicial e loop de sincronização leve a cada 3 segundos
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(updateRadar, 800);
      setInterval(updateRadar, 3000);
    });
  } else {
    setTimeout(updateRadar, 800);
    setInterval(updateRadar, 3000);
  }

})();
