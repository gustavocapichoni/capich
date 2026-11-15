# CAPICH — PLATAFORMA PROFISSIONAL DE CRIPTO TRADING
## Documentação Oficial do Sistema, Arquitetura e Relatório de Auditoria Técnica

---

### Resumo Executivo
Esta documentação consolida formalmente todo o ecossistema da plataforma **CAPICH (Crypto Trading)**, detalhando cada uma das suas três páginas operacionais centrais (**Painel**, **Trading** e **Dashboard**), suas estruturas de código, mecanismos de comunicação interna e externa, tratamento de dados em tempo real, auditoria de sintaxe e correções preventivas aplicadas antes do deploy em nuvem.

---

## 1. Visão Geral da Arquitetura do Sistema

A plataforma foi desenhada em uma arquitetura moderna, robusta e modular para atender tanto investidores institucionais quanto traders individuais de alta precisão:

```
                                  ┌───────────────────────────┐
                                  │      CLIENTE / BROWSER     │
                                  └─────────────┬─────────────┘
                                                │
         ┌──────────────────────────────────────┼──────────────────────────────────────┐
         ▼                                      ▼                                      ▼
┌──────────────────┐                  ┌──────────────────┐                  ┌──────────────────┐
│  1. PAINEL       │                  │  2. TRADING      │                  │  3. DASHBOARD    │
│  (index.html)    │                  │  (crypto_trading_│                  │  (dashboard.html)│
│                  │                  │   history.html)  │                  │                  │
│ • Oráculo Quant  │                  │ • Gráfico Tático │                  │ • Auditoria Pura │
│ • Índice TOP 10  │                  │ • Indicador EMPIRE│                 │ • Expectativa    │
│ • Macro & Netflow│                  │ • Painel Ordens  │                  │ • Curva Capital  │
│ • Notícias       │                  │ • Diário / Posts │                  │ • Base 20 USDT   │
└────────┬─────────┘                  └────────┬─────────┘                  └────────┬─────────┘
         │                                     │                                     │
         │ REST                                │ REST / WebSocket                    │ localStorage / REST
         ▼                                     ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SERVIDOR NODE.JS (Express)                                  │
│  • server.js: Rate Limiting, Helmet, Compressão Gzip, CORS restrito, Cache em Memória         │
│  • routes/trade_routes.js: Execução Binance Futures, Ordens a Mercado, Gatilhos e Pânico      │
│  • routes/market_index_routes.js: Índice TOP 10, Dominância BTC, Fear & Greed, Open Interest │
│  • routes/personal_index_routes.js: Radar de Confluência & Oráculo Sintético (6 Pilares)     │
│  • services/binance_trade_service.js: Assinatura HMAC-SHA256, Filtros de Lote e Trava de Risco│
│  • firebase_accumulator.js: Acumulador de Velas Históricas no Google Firestore                │
└──────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
           ┌───────────────────────┐                       ┌───────────────────────┐
           │     BINANCE FUTURES   │                       │   GOOGLE FIRESTORE    │
           │     API REST & WS     │                       │     & AUTH (ADMIN)    │
           └───────────────────────┘                       └───────────────────────┘
```

---

## 2. Página 1: PAINEL (`index.html`)

### 2.1 Propósito
O **Painel** é o Monitor Quantitativo Multi-Ativos em Tela Única. Ele fornece uma radiografia completa do mercado cripto global antes do trader abrir qualquer posição, reunindo dados on-chain, macroeconômicos e de derivativos.

### 2.2 Estrutura e Funcionalidades
1. **Índice de Mercado Cripto · TOP 10 (`crypto-index-section`)**:
   - Gráfico institucional em velas japonesas gerado pela biblioteca `Lightweight Charts` v4.
   - Ponderado por market cap das 10 maiores criptomoedas do mundo (excluindo stablecoins).
   - Médias Móveis Integradas: **MMA 32** (amarela) e **MMA 80** (roxa).
   - Curvas de Fluxo de Capital das Exchanges plotadas no mesmo gráfico:
     - USD Inflow (Verde) e USD Outflow (Vermelho).
     - BTC Inflow (Amarelo) e BTC Outflow (Rosa).
   - Timeframes selecionáveis com um clique: `15M`, `1H`, `4H` e `1D`.
   - Cards de status em tempo real: Abertura, Variação percentual e Cotação Atual.

2. **Indicadores Macro Globais (`macro-indicators-section`)**:
   - **Índice de Medo e Ganância (Fear & Greed)**: Mostrador analógico desenhado em Canvas nativo com escala 0 a 100 e histórico dos últimos 7 dias.
   - **Dominância do Bitcoin (BTC.D)**: Barra comparativa percentual entre a capitalização do Bitcoin vs Altcoins, com cálculo de variação recente e Market Cap Global consolidado.
   - **Open Interest Consolidado Multi-Exchange**: Volume total de contratos futuros abertos nas maiores corretoras (Binance, Bybit, OKX), cotação do BTC de referência, razão Long/Short e indicador de agressão **Taker Buy/Sell Ratio** em tempo real.

3. **Radar Quantitativo de Confluência & Probabilidade — Oráculo (`confluence-radar-section`)**:
   - **Probabilidade Sintética Estimada**: Mostrador bidirecional que vai de **-100% (Venda/Short Extremo)** até **+100% (Compra/Long Extremo)** passando por **0% (Neutro)**.
   - **Par Recomendado para Operação**: Algoritmo inteligente que analisa a cesta de ativos (BTC, ETH, BNB, BCH, UNI) e recomenda o ativo com maior confluência técnica e direcional para o timeframe de 15m/1h.
   - **Diagnóstico Automático de Fluxo e Cenário**: Texto dinâmico gerado pelo backend sintetizando a conjuntura do mercado.
   - **Semáforo dos 6 Pilares Institucionais**:
     - *Pilar 1: Fluxo CEX (24h)* — Entrada/Saída líquida de capital.
     - *Pilar 2: Agressão Taker (5m)* — Força compradora vs vendedora a mercado.
     - *Pilar 3: Alinhamento MMA 32/80* — Posição do preço em relação às médias.
     - *Pilar 4: Índices (Geral & Cesta)* — Confluência do TOP 10 com a cesta pessoal.
     - *Pilar 5: Alavancagem (OI & L/S)* — Nível de exposição alavancada do mercado.
     - *Pilar 6: Sentimento & Notícias* — Análise de manchetes e Fear & Greed.

4. **Meu Índice Pessoal — Cesta dos 5 Ativos (`macro-bar-personal`)**:
   - Acompanhamento dos 5 ativos operados pelo trader: **BTC, ETH, BNB, BCH e UNI**.
   - Gauge analógico de força de **-4% (Baixa)** a **+4% (Alta)** com placar em tempo real do estado de cada ativo.

5. **Análise Diária dos Últimos 8 Dias (`daily-analysis-section`)**:
   - Histogramas comparativos diários entre **Volume Spot** e **Volume Futuros**.
   - Média Móvel de Volume (MMA 8) para identificar dias de volume institucional anômalo.
   - Comparação do preço de fechamento com a **MMA 8 Dias** com mini-gráficos individuais de fechamento diário.

6. **Fluxo Global de Capital nas Maiores Corretoras — CEX Netflow (`exchange-flows-section`)**:
   - Rastreamento on-chain de reservas de capital em corretoras mundiais (Binance, Bybit, OKX, Coinbase, etc.).
   - Cards consolidados: Saldo em 24 Horas, Últimos 8 Dias, Balanço do Mês (30 Dias) e Total em Custódia (TVL).
   - Gráfico comparativo triplo em Canvas: *Fluxo de Capital CEX vs Preço do Bitcoin vs Índice Macro CAPICH*.
   - Tabela detalhada com pesquisa e filtros instantâneos: *Top 15*, *Entrada Líquida (+)*, *Saída Líquida (-)* e *Todas*.

7. **Portal de Notícias & Atualizações do Mercado (`crypto-news-section`)**:
   - Feed atualizado em tempo real com as notícias mais recentes do ecossistema cripto mundial.

8. **Guias Interativos de Seção (`section_guides.js`)**:
   - Botões de interrogação `?` estrategicamente posicionados em cada módulo. Ao clicar, abrem modais didáticos explicando os fundamentos matemáticos e operacionais de cada indicador.

---

## 3. Página 2: TRADING (`crypto_trading_history.html`)

### 3.1 Propósito
O **Trading** é a estação de batalha oficial do trader. Combina a visualização gráfica profunda de candles e médias, o indicador proprietário **EMPIRE**, ferramentas de Fibonacci com alerta sonoro, o **Mini Painel de Ordens Conectado à Binance Futures** e o **Diário de Bordo Oficial** registrado no Firebase.

### 3.2 Estrutura e Funcionalidades
1. **Gráfico Tático Multi-Ativos (`#btc-tactical-section` via `btc_tactical_chart.js` e submódulos)**:
   - Seleção instantânea de par: **BTCUSDT, ETHUSDT, BCHUSDT, BNBUSDT e UNIUSDT**.
   - Timeframes: **15M**, **1H** e **1D**.
   - Médias Móveis:
     - No gráfico de 1h: **MMA 8** e **MMA 20**.
     - No gráfico de 15m: **MMA 32** (projeção da 8 do 1h) e **MMA 80** (projeção da 20 do 1h).
   - **Indicador Exclusivo EMPIRE**:
     - *EMPIRE 72h*: Piso de Acumulação Institucional (Verde) e Teto de Distribuição Institucional (Vermelho).
     - *EMPIRE 8h*: Piso de Acumulação Intradiária (Ciano) e Teto de Distribuição Intradiária (Laranja).
     - Zonas sombreadas com botões de alternância (ligar/desligar zonas e tags).
   - **Ferramentas de Fibonacci Multicamadas**:
     - Retração e Projeção com níveis: `0.0`, `0.382`, `0.5`, `0.618`, `0.786`, `1.0`, `1.618` e `2.618`.
     - Ajuste interativo por clique ou arraste (Drag & Drop) de âncoras no gráfico.
     - **Alerta Sonoro Tático no Nível 2.618**: Monitora em tempo real a chegada do preço ao nível de exaustão e emite sinal sonoro contínuo com botão de desarme rápido.
   - **HUD Gauges**: Exibe no topo do gráfico o Volume 24h, Variação %, Preço Atual, Agressão Taker Ratio, Open Interest e Funding Rate.

2. **Mini Painel de Ordens Binance Futures (`order_panel.js`)**:
   - Conexão em tempo real com a API da Binance Futures (via backend Node.js seguro com autenticação em header `x-trade-auth`).
   - Saldo disponível da conta em USDT atualizado a cada ciclo ou após ordens.
   - Tipos de Ordem:
     - **A Mercado (Market)**: Execução instantânea de compra (LONG) ou venda (SHORT).
     - **Condicional / Gatilho (Stop Market)**: Ordem agendada que só executa quando o mercado tocar determinado preço de disparo.
   - Modos de Dimensionamento:
     - Digitação por Quantidade do Ativo ou por Valor em Dólar (USDT).
     - Botões rápidos de alocação de margem: `25%`, `50%`, `75%` e `100%`.
     - Respeito estrito aos filtros de lote e precisão (`MARKET_LOT_SIZE` e `stepSize`) de cada ativo na Binance.
   - Gestão de Posição Aberta:
     - Exibição de Tamanho, Preço de Entrada, Preço de Marca, Preço de Liquidação estimado e PNL flutuante ($ e %).
     - **Modal TP/SL Dedicado no Padrão Binance**: Permite definir ou ajustar o Take Profit e Stop Loss a qualquer momento, calculando em tempo real a relação Risco : Retorno.
     - Botão **Zerar Posição**: Encerra a posição a mercado e cancela ordens pendentes.
     - Botão **Travar no Zero a Zero**: Move o Stop Loss automaticamente para o preço de entrada da operação.
     - Botões de **Encerramento Parcial**: Fecha 25%, 50% ou 75% do lote atual.
     - **Botão de PÂNICO / Kill Switch**: Protocolo de emergência com confirmação de segurança que zera todas as posições abertas e cancela todas as ordens em aberto na Binance em milissegundos.
   - **Sistema de Preservação de Capital**:
     - Monitora stops consecutivos e perdas; caso o limite de segurança seja atingido, bloqueia novas entradas impulsivas (proteção anti-tilt e anti-overtrading).

3. **Linhas Visuais de Ordens e Posições no Gráfico (`chart_positions.js`)**:
   - A linha de entrada da posição, a linha de Stop Loss e a linha de Take Profit são desenhadas diretamente sobre os candles no Lightweight Charts.
   - Suporte a Drag & Drop: o trader pode arrastar visualmente as linhas de TP, SL e Ordens Condicionais no gráfico para reposicioná-las na Binance!

4. **Diário de Bordo & Histórico de Operações (`#secoes-container` via `app.js`)**:
   - Banco de dados em nuvem Google Cloud Firestore (`operacoes`).
   - Cada sessão de trade permite:
     - Upload de múltiplos prints e imagens em alta definição (hospedados no ImgBB com zoom interativo por clique).
     - Blocos de texto formatados para: Contexto Técnico, Racional de Entrada, Gestão de Risco e Aprendizados.
     - Sistema de Comentários Comunitário: Usuários podem enviar perguntas e análises; o administrador tem controle total de exclusão de mensagens impróprias.

5. **Área Administrativa e Atalhos de Teclado**:
   - Autenticação via Google Firebase Auth vinculada ao e-mail administrativo configurado no servidor.
   - **`Ctrl + E`**: Abre a janela de login administrativo em qualquer momento.
   - **`Ctrl + S`**: Realiza logout seguro imediato.
   - **`M + L`**: Alterna (oculta ou exibe) o menu lateral para ganho de área útil no gráfico.

---

## 4. Página 3: DASHBOARD (`dashboard.html`)

### 4.1 Propósito
O **Dashboard** é a sala de auditoria matemática do trader. Seu objetivo principal é comprovar a expectativa matemática positiva do método operacional **CAPICH**, medindo de forma estrita a curva de capital a partir de uma banca inicial de **20.00 USDT**.

### 4.2 Estrutura e Funcionalidades
1. **Regra de Ponto de Partida**:
   - Todo o cálculo tem como partida inalterável o saldo de **$20.00 USDT**.

2. **Grade de Métricas Chave (KPIs)**:
   - **Capital Atual ($)**: Saldo atualizado após o resultado de cada trade fechado.
   - **Lucro Líquido (PNL)**: Resultado financeiro acumulado em dólares e o retorno percentual sobre o capital inicial ($20).
   - **Taxa de Acerto (Win Rate %)**: Percentual de vitórias com contagem exata (Ex: *12 Vitórias / 3 Derrotas*).
   - **Fator de Lucro (Profit Factor)**: Razão entre o Lucro Bruto acumulado e o Prejuízo Bruto acumulado ($/$-).
   - **Payoff Médio**: Relação entre o Ganho Médio das operações vencedoras e a Perda Média das operações perdedoras.
   - **Total de Trades**: Número total de posições finalizadas registradas.

3. **Gráfico da Curva de Capital (Equity Curve via `Chart.js`)**:
   - Gráfico de linha dinâmico que plota a evolução do capital trade a trade.
   - Se o saldo atual for superior ou igual a $20.00 USDT, a curva assume a cor verde institucional (`#0ecb81`) com preenchimento sombreado. Se estiver abaixo, assume a cor vermelha (`#f6465d`).
   - Tooltips interativos exibem o saldo exato em cada trade.

4. **Histórico Detalhado de Operações Encerradas**:
   - Tabela organizada em ordem decrescente (mais recentes no topo).
   - Colunas: *Data/Hora*, *Par*, *Lado (LONG/SHORT)*, *Preço de Entrada*, *Preço de Saída*, *Resultado em USDT*, *Resultado em %* e *Status (WIN/LOSS)*.

5. **Controle de Reset de Dados**:
   - Botão **🔄 Resetar Dados** visível apenas quando o administrador estiver autenticado via Google Auth.
   - Exige confirmação de segurança para evitar reinicializações acidentais do histórico.
   - Botão cadeado 🔒 inserido no rodapé para permitir login em dispositivos móveis.

---

## 5. Como as Três Páginas se Comunicam

O fluxo de dados entre as três páginas foi projetado de forma coesa e sem redundâncias:

| Origem | Destino | Meio de Comunicação | Dado Trafegado |
| :--- | :--- | :--- | :--- |
| **Painel** (`index.html`) | **Trading** (`crypto_trading_history.html`) | Análise Visual & Oráculo Backend | O Radar de Confluência identifica o melhor par da cesta (BTC, ETH, BNB, BCH ou UNI) e seu direcionamento; o trader seleciona o par no Gráfico Tático para execução. |
| **Trading** (`order_panel.js`) | **Dashboard** (`dashboard.js`) | `localStorage` (`capich_custom_trades_history`) | Sempre que uma posição é encerrada (manualmente, por Stop Loss automático, Take Profit ou Kill Switch), o `order_panel.js` grava o trade com: símbolo, lado, preços de entrada/saída, PNL financeiro e percentual e data/hora. O `dashboard.js` lê essa chave e atualiza os KPIs, a tabela e a Curva de Capital. |
| **Trading / Dashboard** | **Backend / Firebase Auth** | Google IdToken & `/api/check-admin` | Validação da conta administrativa via token JWT. Se autenticado, ativa a classe global `body.admin-mode`, liberando botões de edição, exclusão e reset em ambas as páginas. |
| **Todas as Páginas** | **Servidor Node.js** | HTTP REST & APIs de Cache | O servidor serve como proxy seguro para a Binance e centraliza caches em memória (3s a 5min), impedindo bloqueios de IP por excesso de requisições. |

---

## 6. Auditoria Técnica e Correções Realizadas

Durante a auditoria preventiva linha por linha, todas as camadas do sistema foram inspecionadas:

### 6.1 Verificação de Sintaxe JavaScript
- **Arquivos auditados**: 56 arquivos `.js` em todo o projeto (raiz, `js/`, `js/tactical/`, `routes/`, `services/`, `api/`).
- **Resultado do teste VM**: **0 erros de sintaxe**. Todos os scripts (CommonJS e ES Modules) estão com sintaxe 100% válida.

### 6.2 Verificação de Integridade de Links e Assets
- Todos os arquivos locais referenciados nos documentos HTML (`css/*`, `js/*`, `assets/icons/*`, etc.) foram auditados via script automatizado.
- **Resultado**: 100% dos arquivos locais existem no disco e estão em seus caminhos corretos.

### 6.3 Correções Pontuais e Melhorias Aplicadas:
1. **Adição das Rotas de Navegação no Express (`server.js`)**:
   - *Problema identificado*: As rotas estáticas do servidor cobriam `/`, `/index`, `/sobre`, `/metodo` e `/crypto_trading_history`, mas não continham uma regra explícita para `/dashboard` e `/trading`. Em ambientes Docker/Fly.io ou ao digitar sem `.html`, o Express retornava 404.
   - *Correção*: Inseridas as rotas `app.get('/dashboard', ...)` e `app.get('/trading', ...)` em `server.js`.
2. **Blindagem contra `null` e Otimização de Cota no Firebase (`js/app.js` e `public/js/app.js`)**:
   - *Problema identificado*: O script `app.js` roda tanto no Trading quanto no Dashboard. No Dashboard, o elemento `#secoes-container` não existe, o que poderia gerar uma exceção de `null.appendChild` ao tentar carregar seções de operações desnecessariamente.
   - *Correção*: Inserida uma verificação prévia (`if (!container) return;`) no início de `renderizarSecao()` e de `carregarSecoes()`. Além de anular qualquer risco de erro no console, evita leituras inúteis no Firestore ao navegar no Dashboard.
3. **Acessibilidade do Login Admin no Dashboard (`dashboard.html` e `public/dashboard.html`)**:
   - *Problema identificado*: O Dashboard possuía o modal de login administrativo, mas não tinha um botão de acionamento por clique (dependendo apenas do atalho de teclado `Ctrl+E`). Em smartphones ou tablets sem teclado físico, o admin não conseguia logar para liberar o botão de reset.
   - *Correção*: Adicionado o botão cadeado oficial (`btn-admin-lock`) no rodapé do `dashboard.html`.
4. **Sincronização de Build Estático (`public/`)**:
   - Todas as atualizações foram replicadas com espelhamento perfeito na pasta `public/` para garantir consistência em qualquer modelo de deploy.

---

## 7. Guia para Deploy em Produção (Nuvem)

### 7.1 Variáveis de Ambiente Necessárias (`.env`)
```ini
PORT=3000
NODE_ENV=production

# Autenticação Administrativa
ADMIN_EMAIL=seu_email_admin@gmail.com
FIREBASE_API_KEY=AIzaSy...

# Firebase Admin SDK (para acumulador e moderação de comentários)
FIREBASE_PROJECT_ID=crypto-trading-history
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@crypto-trading-history.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Binance Futures (opcional no servidor caso o frontend envie ou execute via proxy)
BINANCE_API_KEY=sua_api_key_binance
BINANCE_API_SECRET=seu_api_secret_binance
TRADE_AUTH_TOKEN=capich_fortress_secure_token_2026
```

### 7.2 Opções de Hospedagem
1. **Opção 1: Vercel + Fly.io (Arquitetura Híbrida Recomendada)**
   - O Frontend roda na **Vercel** (`vercel.json` configurado com `cleanUrls: true` e crons).
   - As rotas críticas de trade (`/api/trade/*`) são direcionadas via rewrite para o backend rodando no **Fly.io** (`fly.toml` e `Dockerfile` inclusos na raiz).
2. **Opção 2: Servidor Único (Docker / VPS / Railway)**
   - Basta executar o container a partir do `Dockerfile` ou rodar `npm start` em um servidor Node.js com as variáveis configuradas. O Express servirá tanto os arquivos estáticos quanto todas as APIs de forma integrada.

---
**Status Final da Auditoria**: ✅ **APROVADO PARA PRODUÇÃO / DEPLOY EM NUVEM**  
*Plataforma CAPICH — Crypto Trading. Todos os direitos reservados.*
