// js/crypto_news.js - Portal de Notícias Cripto Multi-Fonte em Tempo Real

(function () {
  'use strict';

  // Cores por fonte
  const SOURCE_STYLES = {
    'Livecoins':         { border: '#f0b90b', badge: 'rgba(240,185,11,0.18)',  text: '#f0b90b' },
    'Portal do Bitcoin': { border: '#ff9900', badge: 'rgba(255,153,0,0.18)',   text: '#ff9900' },
    'CoinTelegraph':     { border: '#0ecb81', badge: 'rgba(14,203,129,0.18)',  text: '#0ecb81' },
    'Bitcoin Magazine':  { border: '#38bdf8', badge: 'rgba(56,189,248,0.18)', text: '#38bdf8' }
  };

  function formatRelativeTime(dateString) {
    if (!dateString) return 'recente';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'recente';
    const diffMs  = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / (60 * 1000));
    const diffH   = Math.floor(diffMs / (60 * 60 * 1000));
    const diffD   = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffMin < 2)  return 'agora há pouco';
    if (diffMin < 60) return `há ${diffMin} min`;
    if (diffH < 24)   return `há ${diffH} hora${diffH > 1 ? 's' : ''}`;
    return `há ${diffD} dia${diffD > 1 ? 's' : ''}`;
  }

  function getCategoryColor(cat) {
    const c = (cat || '').toUpperCase();
    if (c.includes('BITCOIN') || c.includes('BTC')) return { bg: 'rgba(240,185,11,0.12)', text: '#f0b90b' };
    if (c.includes('ETHEREUM') || c.includes('ETH')) return { bg: 'rgba(98,126,234,0.12)', text: '#627eea' };
    if (c.includes('REGULAÇ') || c.includes('LEI') || c.includes('BRASIL')) return { bg: 'rgba(56,189,248,0.12)', text: '#38bdf8' };
    if (c.includes('HACKER') || c.includes('GOLPE') || c.includes('SEGURANÇ')) return { bg: 'rgba(246,70,93,0.12)', text: '#f6465d' };
    return { bg: 'rgba(14,203,129,0.12)', text: '#0ecb81' };
  }

  async function loadCryptoNews() {
    const container = document.getElementById('crypto-news-grid');
    if (!container) return;

    try {
      const res = await fetch('/api/crypto-news');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const news = await res.json();

      if (!Array.isArray(news) || news.length === 0) {
        container.innerHTML = `<div class="news-empty">Nenhuma notícia disponível no momento.</div>`;
        return;
      }

      let html = '';
      news.forEach(item => {
        const catStyle    = getCategoryColor(item.category);
        const srcStyle    = SOURCE_STYLES[item.source] || { border: '#555', badge: 'rgba(255,255,255,0.08)', text: '#aaa' };
        const timeAgo     = formatRelativeTime(item.pubDate);
        const lang        = item.lang || '';

        html += `
          <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="news-card"
             style="border-top: 2px solid ${srcStyle.border};">
            <div class="news-card-header">
              <span class="news-cat-badge" style="background:${catStyle.bg}; color:${catStyle.text};">
                ${item.category || 'MERCADO'}
              </span>
              <span class="news-time">${timeAgo}</span>
            </div>
            <h4 class="news-card-title">${item.title}</h4>
            <div class="news-card-footer">
              <span class="news-source-badge" style="background:${srcStyle.badge}; color:${srcStyle.text};">
                ${lang} ${item.source || 'Cripto News'}
              </span>
              <span class="news-read-more">Ler ↗</span>
            </div>
          </a>
        `;
      });

      container.innerHTML = html;
    } catch (err) {
      console.warn('Erro ao carregar notícias cripto:', err);
      const container = document.getElementById('crypto-news-grid');
      if (container) {
        container.innerHTML = `<div class="news-empty">⚠️ Portal de notícias temporariamente indisponível.</div>`;
      }
    }
  }

  // Inicialização e atualização a cada 10 minutos
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadCryptoNews();
      setInterval(loadCryptoNews, 10 * 60 * 1000);
    });
  } else {
    loadCryptoNews();
    setInterval(loadCryptoNews, 10 * 60 * 1000);
  }

})();
