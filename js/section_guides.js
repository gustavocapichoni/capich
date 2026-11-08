/**
 * section_guides.js
 * Sistema de Ajuda Rápida e Guias Educativos (?) para cada Seção do CAPICH Terminal
 */

(function () {
  'use strict';

  const GUIAS_SECOES = {
    indice_top10: {
      titulo: 'Índice de Mercado Cripto · TOP 10',
      icone: '📈',
      categoria: 'Termômetro Geral',
      oque: 'Cesta ponderada em tempo real com os 10 maiores ativos do mercado (BTC 40%, ETH 20%, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, UNI). Funciona como o "S&P 500" do ecossistema cripto, medindo a saúde real do mercado como um todo.',
      como: [
        '<strong>Velas do Índice:</strong> Mostram se o mercado como um todo está subindo ou corrigindo em bloco.',
        '<strong>MMA 32 (Amarela):</strong> Média móvel aritmética rápida (8 horas no gráfico de 15m). Acima dela = Força compradora intraday.',
        '<strong>MMA 80 (Roxa):</strong> Média móvel aritmética institucional (20 horas no gráfico de 15m). Suporte/resistência do ciclo diário.',
        '<strong>Fluxo CEX (Dólar vs BTC):</strong> Linhas de entrada/saída de capital nas corretoras. Linha amarela subindo = Entrada de capital ou força compradora de BTC.',
        '<strong>Volume Futuros (Prata) vs Spot (Azul):</strong> Revela quem lidera o movimento. Se Futuros representar mais de 85% do volume, o mercado está puramente alavancado e vulnerável a manipulações e liquidações repentinas.'
      ],
      gatilho: 'Quando o índice faz um recuo (pullback) até a MMA 32 de cima para baixo e deixa pavio inferior de rejeição com volume Spot presente, temos um setup de compra de alta probabilidade. Se o índice perder a MMA 32 e MMA 80 simultaneamente, não abra compras.',
      dica: 'Nunca opere uma altcoin na compra se o Índice TOP 10 estiver caindo abaixo da MMA 32. 80% das moedas seguem a direção desse índice.'
    },

    macro_indicadores: {
      titulo: 'Indicadores Macro Globais',
      icone: '🌐',
      categoria: 'Contexto Macroeconômico',
      oque: 'Painel que consolida os três pilares externos mais importantes do mercado: o sentimento coletivo (Fear & Greed), para onde a liquidez está fluindo (Dominância BTC) e o nível de alavancagem aberta (Open Interest).',
      como: [
        '<strong>Fear & Greed:</strong> Mede o medo ou ganância do mercado (0 a 100).',
        '<strong>Dominância do BTC:</strong> Revela se o dinheiro está concentrado no Bitcoin ou migrando para as Altcoins.',
        '<strong>Open Interest em Futuros:</strong> Total de dólares alocados em contratos futuros abertos nas maiores corretoras do mundo.'
      ],
      gatilho: 'O melhor cenário para operar tendências limpas de alta é quando o Fear & Greed está neutro/crescente (40-60) com Open Interest subindo e Dominância estável. Se o Open Interest bater recordes com medo ou euforia extrema, espere por volatilidade violenta.',
      dica: 'Use esta seção para definir o "tamanho da mão": em cenários macro desfavoráveis, reduza os lotes pela metade.'
    },

    macro_fear_greed: {
      titulo: 'Índice de Medo e Ganância (Fear & Greed)',
      icone: '🧭',
      categoria: 'Psicologia do Mercado',
      oque: 'Termômetro clássico do mercado financeiro que quantifica as emoções predominantes dos investidores em uma escala de 0 a 100, baseado em volatilidade, volume social, pesquisas e momentum.',
      como: [
        '<strong>0 a 25 (Extremo Medo · Vermelho):</strong> Pânico e capitulação do varejo. O mercado costuma formar fundos importantes nessa região.',
        '<strong>26 a 45 (Medo · Laranja):</strong> Cautela e desconfiança. Baixo apetite a risco.',
        '<strong>46 a 55 (Neutro · Amarelo):</strong> Indecisão e briga de forças equilibrada.',
        '<strong>56 a 75 (Ganância · Verde Claro):</strong> Otimismo crescente. Posições compradas saudáveis.',
        '<strong>76 a 100 (Extrema Ganância · Verde Forte):</strong> Euforia irracional e FOMO do varejo. Alerta de topo próximo!'
      ],
      gatilho: 'Siga a máxima de Warren Buffett: <em>"Tenha medo quando os outros são gananciosos e seja ganancioso quando os outros estão com medo"</em>. Extremo Medo próximo a suportes é oportunidade de compra; Extrema Ganância é hora de proteger lucros.',
      dica: 'Evite entrar alavancado na compra com o índice acima de 78: as baleias costumam despejar no varejo eufórico.'
    },

    macro_dominance: {
      titulo: 'Dominância do Bitcoin (BTC.D)',
      icone: '🪙',
      categoria: 'Fluxo Setorial',
      oque: 'Mede a fatia percentual do valor de todo o mercado cripto pertencente exclusivamente ao Bitcoin em comparação a todas as altcoins somadas.',
      como: [
        '<strong>Dominância Subindo:</strong> O Bitcoin ganha força relativa. As baleias estão retirando dinheiro das altcoins e guardando em BTC por segurança.',
        '<strong>Dominância Caindo com BTC Estável ou em Alta:</strong> Alerta de <em>Altseason</em>! O lucro do BTC está escorrendo para ETH, SOL e outras altcoins que tendem a valorizar expressivamente.',
        '<strong>Dominância Caindo com BTC Desabando:</strong> Pânico generalizado. Todo mundo vendendo cripto e fugindo para Dólar (USDT/USDC).'
      ],
      gatilho: 'Quando a dominância estiver acima de 58% e subindo, concentre seus trades de compra no próprio Bitcoin. Não compre altcoins, pois qualquer espirro do BTC fará as altcoins caírem o dobro.',
      dica: 'Aguarde a dominância rejeitar uma resistência e começar a cair com o BTC lateralizando para buscar operações explosivas em altcoins.'
    },

    macro_open_interest: {
      titulo: 'Open Interest BTC & Agressão Taker',
      icone: '📊',
      categoria: 'Derivativos & Alavancagem',
      oque: 'O <strong>Open Interest (OI)</strong> consolida o volume financeiro total de contratos futuros em aberto nas 4 maiores exchanges (Binance, Bybit, OKX, Bitget). A barra <strong>Taker</strong> mede se a agressão imediata nos últimos 5 minutos é de compra ou venda.',
      como: [
        '<strong>Preço Sobe + OI Sobe:</strong> Tendência de alta forte e confirmada! Dinheiro novo institucional entrando no mercado.',
        '<strong>Preço Sobe + OI Cai:</strong> Alta fraca, causada apenas por fechamento forçado de posições vendidas (Short Squeeze). Costuma devolver rápido.',
        '<strong>Preço Cai + OI Sobe:</strong> Entrada agressiva de vendedores vendidos a descoberto (Shorts). Tendência de baixa com força.',
        '<strong>Long/Short de Sardinhas (70%+ Long):</strong> Se a maioria das contas estiver comprada e o preço não subir, as baleias vão empurrar para baixo para liquidar esses contratos.'
      ],
      gatilho: 'Nunca compre em topo se o Open Interest estiver nas máximas com mais de 75% das contas em Long: o mercado está prestes a fazer uma "limpeza" de stop loss.',
      dica: 'Monitore a Agressão Taker 5m: quando passar de 58% Compra com preço acima da MMA 32, o timing de entrada está confirmado.'
    },

    oraculo_quantitativo: {
      titulo: 'Oráculo Quantitativo · Confluência em Tempo Real',
      icone: '⚡',
      categoria: 'Inteligência do Terminal',
      oque: 'O cérebro algorítmico do CAPICH. Ele cruza simultaneamente 6 pilares quantitativos: Fluxo CEX On-Chain, Agressão Taker 5m, Médias Móveis 32/80, Índices de Força, Alavancagem das Sardinhas e Notícias de Mercado.',
      como: [
        '<strong>Probabilidade Sintética (-100% a +100%):</strong> Resumo numérico do viés dominante.',
        '<strong>-100% a -30% (Vermelho):</strong> Viés Vendedor / Alta probabilidade de queda.',
        '<strong>-29% a +29% (Cinza):</strong> Mercado em Disputa / Equilíbrio sem lado dominante (aguardar).',
        '<strong>+30% a +100% (Verde):</strong> Viés Comprador / Alta probabilidade de alta.',
        '<strong>Semáforo dos 6 Pilares:</strong> Mostra exatamente quais variáveis estão a favor ou contra o movimento no instante atual.',
        '<strong>Par Recomendado:</strong> Seleciona automaticamente o ativo com o melhor alinhamento técnico entre as médias móveis.'
      ],
      gatilho: 'Só opere a favor do Oráculo quando houver pelo menos 4 dos 6 pilares apontando para a mesma direção. Quando o diagnóstico indicar "MERCADO EM DISPUTA", a melhor decisão é ter paciência e não forçar operações.',
      dica: 'O Oráculo não tenta adivinhar o futuro: ele calcula quem tem a maior vantagem matemática estatística agora.'
    },

    cards_pares: {
      titulo: 'Monitor dos 5 Pares Principais',
      icone: '🎯',
      categoria: 'Visão Tática de Ativos',
      oque: 'Cards individuais de monitoramento em tempo real para os 5 ativos fundamentais de trade da carteira: BTC, ETH, BCH, BNB e UNI, focados no tempo gráfico tático de 15 minutos.',
      como: [
        '<strong>Tendência Vigente (15M):</strong> Calculada pelo cruzamento e posicionamento do preço em relação às médias MMA 32 e MMA 80.',
        '<strong>Alerta de Cruzamento MMA 32:</strong> Notifica o exato momento em que o preço cruza a média rápida, indicando gatilho de entrada ou perda de força.',
        '<strong>Máxima e Mínima em 15m:</strong> Referências de amplitude da vela atual para cálculo de risco e stop.'
      ],
      gatilho: 'O setup clássico e mais lucrativo é o <strong>Pullback na MMA 32</strong>: quando a tendência for de Alta e o preço recuar até a MMA 32 sem fechar abaixo dela, temos uma entrada compradora com stop técnico curto na MMA 80.',
      dica: 'Selecione o par que estiver com o maior afastamento percentual positivo em relação à MMA 32 para pegar a moeda mais forte da rodada.'
    },

    meu_indice_pessoal: {
      titulo: 'Meu Índice Pessoal (Cesta 5 Pares)',
      icone: '📊',
      categoria: 'Força Relativa da Carteira',
      oque: 'Termômetro proprietário que calcula a variação média ponderada e a força técnica da sua cesta particular de 5 ativos (BTC, ETH, BNB, BCH, UNI) em relação à abertura do dia.',
      como: [
        '<strong>Velocímetro (-4% a +4%):</strong> Mostra a aceleração da sua carteira.',
        '<strong>Faixa Vermelha (&lt; -1%):</strong> A cesta está sob pressão vendedora acentuada. Não opere comprado.',
        '<strong>Faixa Neutra (-0.5% a +0.5%):</strong> Mercado lateral, ideal para operações curtas de consolidação.',
        '<strong>Faixa Verde (&gt; +1%):</strong> Cesta em forte expansão compradora com fluxo a favor.',
        '<strong>Scoreboard de Força:</strong> Exibe instantaneamente quantas das 5 moedas estão acima da MMA 32 (ex: "4 Acima de MMA 32").'
      ],
      gatilho: 'Quando o índice da sua cesta estiver na faixa verde e com pelo menos 4 moedas acima da MMA 32, você tem confluência total para abrir posições compradas no par recomendado.',
      dica: 'Nunca compre uma moeda isolada se as outras 4 moedas da sua cesta estiverem caindo: a probabilidade de ser puxada para baixo é altíssima.'
    },

    analise_diaria: {
      titulo: 'Análise Diária (Últimos 8 Dias) · Spot vs Futuros',
      icone: '📅',
      categoria: 'Volume Institucional Diário',
      oque: 'Painel que rastreia os últimos 8 dias de negociação para cada ativo, comparando o volume financeiro real do mercado à vista (Spot) contra o mercado alavancado (Futuros) em relação à média móvel de volume de 8 dias (MMA 8).',
      como: [
        '<strong>Barras Bicolores de Volume:</strong> Verde para dias de fechamento positivo e Vermelho para fechamento negativo.',
        '<strong>Linha Amarela (MMA 8 Volume):</strong> Média de volume dos últimos 8 dias. Dias em que a barra ultrapassa essa linha representam <em>Volume Institucional Anormal</em>.',
        '<strong>Card de Preço vs MMA 8:</strong> Mostra se a cotação diária está acima ou abaixo da média de 8 dias e a distância percentual.',
        '<strong>Gráfico de Fechamento (Sparkline):</strong> Desenho limpo da trajetória dos fechamentos com indicação de máxima e mínima dos 8 dias.'
      ],
      gatilho: 'Falsos rompimentos acontecem com volume abaixo da linha amarela da MMA 8. Se um ativo romper um topo com volume superando com folga a MMA 8 e com predomínio de volume Spot, a tendência diária é sólida e deve continuar.',
      dica: 'Divergência clássica: preço subindo 3 dias seguidos com barras de volume caindo indica cansaço de compradores e reversão iminente.'
    },

    fluxo_cex: {
      titulo: 'Fluxo Global de Capital nas CEX (Netflow On-Chain)',
      icone: '🏦',
      categoria: 'Rastreamento de Baleias',
      oque: 'Sistema que monitora as carteiras das maiores corretoras mundiais (Binance, OKX, Bybit, Coinbase, etc.), calculando se o saldo líquido de moedas e dólares está entrando (Inflow) ou saindo (Outflow) das plataformas.',
      como: [
        '<strong>Saída Líquida / Outflow (Vermelho / Negativo):</strong> Baleias estão sacando moedas das corretoras para guardar em carteiras privadas (Cold Storage). Menos moedas para vender = <strong>Choque de Oferta (Altista a médio prazo)</strong>.',
        '<strong>Entrada Líquida / Inflow (Verde / Positivo):</strong> Grandes investidores transferindo moedas para as corretoras com intenção de vender a mercado = <strong>Aumento de Oferta / Pressão Vendedora</strong>.',
        '<strong>Balanço 24h, 8 Dias e 30 Dias:</strong> Mostra se a movimentação é um espasmo momentâneo ou uma acumulação de longo prazo.',
        '<strong>Tabela Detalhada:</strong> Permite filtrar quais corretoras estão sofrendo maiores saques ou depósitos.'
      ],
      gatilho: 'Grandes picos de Inflow de Bitcoin em corretoras enquanto o preço está em topo indicam que as baleias estão se preparando para despejar. Proteja posições compradas.',
      dica: 'Saques maciços contínuos (Outflow forte) em momentos de queda ou lateralização do preço são a principal assinatura de acumulação institucional silenciosa.'
    },

    portal_noticias: {
      titulo: 'Portal de Notícias & Atualizações do Mercado',
      icone: '📰',
      categoria: 'Catalisadores & Macro',
      oque: 'Feed em tempo real que filtra e compila os fatos relevantes, análises macroeconômicas e notícias das maiores publicações especializadas do ecossistema cripto (CoinTelegraph, Bitcoin Magazine, Livecoins, etc.).',
      como: [
        '<strong>Manchetes Regulatórias:</strong> Notícias sobre SEC, FED, Banco Central ou tributação geram reações rápidas no preço.',
        '<strong>Manchetes Institucionais:</strong> Entradas de fundos, ETFs ou adoção corporativa dão sustentação ao mercado.',
        '<strong>Manchetes de Segurança:</strong> Ataques hacker a protocolos DeFi ou problemas em corretoras geram pânico repentino.'
      ],
      gatilho: 'Quando sair uma notícia de impacto macroeconômico (ex: decisão de taxa de juros do FED ou relatório de inflação CPI nos EUA), não opere nos primeiros 10 minutos. Deixe o mercado digerir o fato e liquidar posições antes de entrar.',
      dica: 'Lembre-se da regra: <em>"Compre no boato, venda no fato"</em>. Quando uma notícia já está em todos os portais, as baleias já se posicionaram horas antes.'
    }
  };

  // ─── CRIAÇÃO DO MODAL NO DOM SE NÃO EXISTIR ─────────────────────
  function criarModalDOM() {
    if (document.getElementById('modal-guia-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'modal-guia-overlay';
    overlay.className = 'modal-guia-overlay';
    overlay.innerHTML = `
      <div class="modal-guia-card" onclick="event.stopPropagation()">
        <div class="modal-guia-header">
          <div class="modal-guia-title-wrap">
            <span class="modal-guia-icon" id="guia-modal-icon">ℹ️</span>
            <div>
              <h3 class="modal-guia-title" id="guia-modal-title">Guia da Seção</h3>
              <span class="modal-guia-badge" id="guia-modal-badge">GUIA RÁPIDO</span>
            </div>
          </div>
          <button class="modal-guia-fechar" onclick="window.fecharGuiaSecao()" title="Fechar (Esc)">&times;</button>
        </div>

        <div class="modal-guia-body">
          <!-- 1. O Que É -->
          <div class="guia-bloco guia-bloco-oque">
            <div class="guia-bloco-header">
              <span>📌</span> O QUE É ESTA ÁREA
            </div>
            <p id="guia-modal-oque">Carregando explicação...</p>
          </div>

          <!-- 2. Como Interpretar -->
          <div class="guia-bloco guia-bloco-como">
            <div class="guia-bloco-header">
              <span>📊</span> COMO INTERPRETAR OS DADOS
            </div>
            <ul id="guia-modal-como"></ul>
          </div>

          <!-- 3. Gatilho Prático Institucional -->
          <div class="guia-bloco guia-bloco-gatilho">
            <div class="guia-bloco-header">
              <span>🎯</span> GATILHO PRÁTICO INSTITUCIONAL
            </div>
            <p id="guia-modal-gatilho">Carregando regra prática...</p>
          </div>

          <!-- 4. Dica de Ouro -->
          <div class="guia-bloco guia-bloco-dica">
            <div class="guia-bloco-header">
              <span>💡</span> REGRA DE OURO DO TRADER
            </div>
            <p id="guia-modal-dica">Carregando dica...</p>
          </div>
        </div>

        <div class="modal-guia-footer">
          <button class="btn-guia-entendi" onclick="window.fecharGuiaSecao()">Entendi, fechar</button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', window.fecharGuiaSecao);
    document.body.appendChild(overlay);

    // Fechar com tecla ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        window.fecharGuiaSecao();
      }
    });
  }

  // ─── FUNÇÃO ABRIR MODAL ──────────────────────────────────────────
  window.abrirGuiaSecao = function (id) {
    criarModalDOM();
    const dados = GUIAS_SECOES[id];
    if (!dados) {
      console.warn('[CAPICH Guia] Seção não encontrada:', id);
      return;
    }

    const overlay = document.getElementById('modal-guia-overlay');
    const elIcon = document.getElementById('guia-modal-icon');
    const elTitle = document.getElementById('guia-modal-title');
    const elBadge = document.getElementById('guia-modal-badge');
    const elOque = document.getElementById('guia-modal-oque');
    const elComo = document.getElementById('guia-modal-como');
    const elGatilho = document.getElementById('guia-modal-gatilho');
    const elDica = document.getElementById('guia-modal-dica');

    if (elIcon) elIcon.textContent = dados.icone || 'ℹ️';
    if (elTitle) elTitle.textContent = dados.titulo || 'Guia da Seção';
    if (elBadge) elBadge.textContent = dados.categoria || 'GUIA RÁPIDO';
    if (elOque) elOque.innerHTML = dados.oque || '';
    if (elGatilho) elGatilho.innerHTML = dados.gatilho || '';
    if (elDica) elDica.innerHTML = dados.dica || '';

    if (elComo) {
      elComo.innerHTML = (dados.como || [])
        .map(item => `<li>${item}</li>`)
        .join('');
    }

    if (overlay) {
      overlay.style.display = 'flex';
      setTimeout(() => overlay.classList.add('ativo'), 10);
    }
  };

  // ─── FUNÇÃO FECHAR MODAL ─────────────────────────────────────────
  window.fecharGuiaSecao = function () {
    const overlay = document.getElementById('modal-guia-overlay');
    if (!overlay) return;
    overlay.classList.remove('ativo');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 220);
  };

  // Inicializa DOM pronto
  document.addEventListener('DOMContentLoaded', criarModalDOM);
})();
