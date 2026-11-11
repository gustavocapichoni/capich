import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc,
  doc, updateDoc, orderBy, query, serverTimestamp,
  arrayUnion, arrayRemove, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ─── Init Firebase ────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBAbjQw57zMy2lNUON-UmGDUjwolb9lCUM",
  authDomain: "crypto-trading-history.firebaseapp.com",
  projectId: "crypto-trading-history",
  storageBucket: "crypto-trading-history.firebasestorage.app",
  messagingSenderId: "517966922019",
  appId: "1:517966922019:web:435125485805caf4494c96"
};

const app      = initializeApp(firebaseConfig);
const db       = getFirestore(app);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();
let   isAdmin  = false;

// ─── ImgBB (upload gratuito de imagens) ──────────────────────────────────────
const IMGBB_KEY = '26271da8b4db21c02aca3cd22fc2cfbb';

async function uploadToImgBB(file) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('key', IMGBB_KEY);

  const resp = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: formData
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error?.message || 'Erro ao enviar para ImgBB');
  return { url: data.data.url, displayUrl: data.data.display_url };
}

// ─── Autenticação ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const idToken = await user.getIdToken();
      const resp    = await fetch('/api/check-admin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ idToken })
      });
      const { isAdmin: adminOk } = await resp.json();

      if (adminOk) {
        isAdmin = true;
        document.body.classList.add('admin-mode');
        // Preenche identidade do admin no menu lateral
        const menuNameEl = document.getElementById('menu-admin-name-label');
        const adminUserNameEl = document.getElementById('admin-user-name');
        const displayName = user.displayName || user.email || 'Admin';
        const firstName = displayName.split(' ')[0];
        if (menuNameEl) menuNameEl.textContent = firstName;
        if (adminUserNameEl) adminUserNameEl.textContent = displayName;
      } else {
        alert('Acesso negado: essa conta Google não tem permissão de administrador.');
        await signOut(auth);
      }
    } catch (err) {
      console.error('Erro ao verificar admin:', err);
    }
  } else {
    isAdmin = false;
    document.body.classList.remove('admin-mode');
    const indicator = document.getElementById('admin-indicator');
    if (indicator) indicator.style.display = 'none';
    // Limpa nome do menu lateral
    const menuNameEl = document.getElementById('menu-admin-name-label');
    if (menuNameEl) menuNameEl.textContent = 'Admin';
  }
});

async function fazerLoginGoogle() {
  try {
    await signInWithPopup(auth, provider);
    fecharModalAdmin();
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Erro login:', err);
      alert('Erro ao fazer login. Verifique o console.');
    }
  }
}

async function fazerLogout() {
  await signOut(auth);
  isAdmin = false;
  document.body.classList.remove('admin-mode');
}

function abrirModalAdmin()  { document.getElementById('modal-admin').classList.add('ativo'); }
function fecharModalAdmin() { document.getElementById('modal-admin').classList.remove('ativo'); }

window.fazerLoginGoogle = fazerLoginGoogle;
window.fazerLogout      = fazerLogout;
window.abrirModalAdmin  = abrirModalAdmin;
window.fecharModalAdmin = fecharModalAdmin;

// ─── Modal imagem ─────────────────────────────────────────────────────────────
function abrirModalImagem(src) {
  if (!src) return;
  document.getElementById('modal-img').src = src;
  document.getElementById('modal-zoom').classList.add('ativo');
}
function fecharModalImagem() { document.getElementById('modal-zoom').classList.remove('ativo'); }

document.addEventListener('keydown', (e) => {
  // Atalhos Globais:
  // Ctrl+E → Abrir login admin
  if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    abrirModalAdmin();
    return;
  }

  // Ctrl+S → Fazer logout / Sair
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    // Evita o comportamento padrão do navegador de abrir a janela "Salvar página como"
    e.preventDefault();
    if (document.body.classList.contains('admin-mode')) {
      fazerLogout();
    }
    return;
  }

  if (e.key === 'Escape') {
    fecharModalImagem();
    fecharModalAdmin();
    fecharModalComentario();
  }
});

// ── Atalho M+L: ocultar/exibir menu lateral ─────────────────────────────────
(function () {
  const STORAGE_KEY_MENU = 'capich_menu_collapsed';
  let mPressed = false;
  let mTimer = null;

  // Restaura estado salvo
  if (localStorage.getItem(STORAGE_KEY_MENU) === 'true') {
    document.body.classList.add('menu-collapsed');
  }

  function toggleMenu() {
    const isCollapsed = document.body.classList.toggle('menu-collapsed');
    try { localStorage.setItem(STORAGE_KEY_MENU, isCollapsed ? 'true' : 'false'); } catch (_) {}
    // Notifica o gráfico tático para re-ajustar o tamanho se possível
    setTimeout(() => {
      if (window._syncTacChartHeight) window._syncTacChartHeight();
      if (window.dispatchEvent) window.dispatchEvent(new Event('resize'));
    }, 280);
  }

  document.addEventListener('keydown', (e) => {
    // Ignora se o foco está em input, textarea ou contenteditable
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;

    if (e.key === 'm' || e.key === 'M') {
      mPressed = true;
      clearTimeout(mTimer);
      mTimer = setTimeout(() => { mPressed = false; }, 600);
    }
    if ((e.key === 'l' || e.key === 'L') && mPressed) {
      mPressed = false;
      clearTimeout(mTimer);
      e.preventDefault();
      toggleMenu();
    }
  });

  window.toggleAdminMenu = toggleMenu;
})();

window.abrirModalImagem  = abrirModalImagem;
window.fecharModalImagem = fecharModalImagem;

// ─── Modal comentários ────────────────────────────────────────────────────────
function abrirModalComentario(secaoId) {
  const modal = document.getElementById('modal-comentario');
  const inputSecao = document.getElementById('comentario-secao-id');
  const inputAutor = document.getElementById('comentario-autor');
  const inputTexto = document.getElementById('comentario-texto');
  if (!modal) return;

  if (inputSecao) inputSecao.value = secaoId;
  if (inputTexto) inputTexto.value = '';

  const nomeSalvo = localStorage.getItem('capich_trader_nome');
  if (nomeSalvo && inputAutor && !inputAutor.value) {
    inputAutor.value = nomeSalvo;
  }

  modal.classList.add('ativo');
  setTimeout(() => {
    if (inputAutor && !inputAutor.value) inputAutor.focus();
    else if (inputTexto) inputTexto.focus();
  }, 100);
}

function fecharModalComentario() {
  const modal = document.getElementById('modal-comentario');
  if (modal) modal.classList.remove('ativo');
}

window.abrirModalComentario  = abrirModalComentario;
window.fecharModalComentario = fecharModalComentario;

// ─── Utilitários ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function obterDataHoraAtual() {
  const now = new Date();
  return now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR');
}
function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ─── Criar nova seção ─────────────────────────────────────────────────────────
async function criarNovaSecao() {
  if (!isAdmin) return;
  const dataHora = obterDataHoraAtual();
  try {
    const docRef = await addDoc(collection(db, 'operacoes'), {
      dataHora, imagens: [], blocos: [], criadoEm: serverTimestamp()
    });
    renderizarSecao({ id: docRef.id, dataHora, imagens: [], blocos: [] }, true);
  } catch (err) {
    console.error('Erro ao criar seção:', err);
    alert(`Erro ao criar seção: ${err.message || err}`);
  }
}
window.criarNovaSecao = criarNovaSecao;

// ─── Renderizar seção ─────────────────────────────────────────────────────────
function renderizarSecao(dados, noTopo = false) {
  const container = document.getElementById('secoes-container');
  const secao = document.createElement('section');
  secao.className = 'operacao-section';
  secao.dataset.id = dados.id;

  const imagensHTML = (dados.imagens || []).map(img => `
    <div class="img-item" data-img-id="${img.id}">
      <img src="${img.url}" alt="Imagem da operação" onclick="abrirModalImagem('${img.url}')">
      <button class="btn-remover-img admin-only" onclick="removerImagem(this,'${dados.id}','${img.id}')" title="Remover imagem">×</button>
    </div>
  `).join('');

  const blocosHTML = (dados.blocos || []).map(bloco => `
    <div class="bloco-texto" data-bloco-id="${bloco.id}">
      <div class="bloco-conteudo">${bloco.texto.replace(/\n/g, '<br>')}</div>
      <button class="btn-remover-bloco admin-only" onclick="removerBloco(this,'${dados.id}','${bloco.id}')">× Remover bloco</button>
    </div>
  `).join('');

  const comentarios = dados.comentarios || [];
  const comentariosHTML = comentarios.map(c => `
    <div class="comentario-item" data-comentario-id="${c.id}">
      <div class="comentario-top">
        <div class="comentario-autor-wrap">
          <span style="font-size:0.95rem;">💬</span>
          <span class="comentario-autor-nome">${escapeHtml(c.autor || 'Anônimo')}</span>
          <span class="comentario-data">${c.dataHora || ''}</span>
        </div>
        <button class="btn-remover-comentario admin-only" onclick="removerComentario(this,'${dados.id}','${c.id}')" title="Remover comentário (Admin)">🗑️ Excluir</button>
      </div>
      <div class="comentario-texto">${escapeHtml(c.texto).replace(/\n/g, '<br>')}</div>
    </div>
  `).join('');

  secao.innerHTML = `
    <div class="section-header">
      <div class="section-date-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>${dados.dataHora}</span>
      </div>
    </div>

    <!-- Galeria de imagens -->
    <div class="galeria-imagens">
      <div class="galeria-grid">${imagensHTML}</div>
      <label class="btn-importar admin-only" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;cursor:pointer;">
        + Adicionar imagem
        <input type="file" accept="image/*" multiple onchange="adicionarImagem(event,this)" style="display:none;">
      </label>
    </div>

    <!-- Blocos de texto salvos (visível para todos) -->
    <div class="blocos-container">${blocosHTML}</div>

    <!-- Bloco de Comentários (visível para todos) -->
    <div class="comentarios-bloco">
      <div class="comentarios-header-row">
        <div class="comentarios-titulo">
          <span>Comentários</span>
          <span class="comentarios-count" id="count-comentarios-${dados.id}">${comentarios.length}</span>
        </div>
        <button class="btn-abrir-comentario" onclick="abrirModalComentario('${dados.id}')">
          💬 Deixe seu comentário
        </button>
      </div>
      <div class="comentarios-lista" id="lista-comentarios-${dados.id}">
        ${comentariosHTML || '<div class="comentarios-vazio">Nenhum comentário ainda. Seja o primeiro a comentar!</div>'}
      </div>
    </div>

    <!-- Área de critérios – sempre visível para admin -->
    <div class="criterios-area admin-only">
      <h3>Critérios da Operação</h3>
      <textarea class="criterios-conteudo" placeholder="Descreva os critérios da operação aqui..."></textarea>
    </div>

    <!-- Footer da seção – admin only -->
    <div class="secao-footer admin-only">
      <button class="btn-salvar" onclick="salvarBloco(this)">💾 Salvar</button>
      <button class="btn-excluir" onclick="excluirSecao(this)">🗑️ Excluir seção</button>
    </div>
  `;

  if (noTopo) container.prepend(secao);
  else container.appendChild(secao);
}

// ─── Adicionar imagem ─────────────────────────────────────────────────────────
async function adicionarImagem(event, input) {
  if (!isAdmin) return;
  const files   = Array.from(event.target.files);
  if (!files.length) return;

  const secao   = input.closest('.operacao-section');
  const secaoId = secao.dataset.id;
  const galeria = secao.querySelector('.galeria-grid');

  for (const file of files) {
    const imgId       = gerarId();
    const placeholder = document.createElement('div');
    placeholder.className = 'img-item loading';
    placeholder.innerHTML = '<span>Enviando...</span>';
    galeria.appendChild(placeholder);

    try {
      const { url } = await uploadToImgBB(file);
      const imagemObj = { id: imgId, url };

      await updateDoc(doc(db, 'operacoes', secaoId), { imagens: arrayUnion(imagemObj) });

      placeholder.className     = 'img-item';
      placeholder.dataset.imgId = imgId;
      placeholder.innerHTML     = `
        <img src="${url}" alt="Imagem da operação" onclick="abrirModalImagem('${url}')">
        <button class="btn-remover-img admin-only" onclick="removerImagem(this,'${secaoId}','${imgId}')" title="Remover imagem">×</button>
      `;
    } catch (err) {
      console.error('Erro ao enviar imagem:', err);
      placeholder.remove();
      alert(`Erro ao enviar imagem: ${err.message || err}`);
    }
  }
  input.value = '';
}
window.adicionarImagem = adicionarImagem;

// ─── Remover imagem ───────────────────────────────────────────────────────────
async function removerImagem(btn, secaoId, imgId) {
  if (!isAdmin || !confirm('Remover esta imagem?')) return;
  try {
    const snap      = await getDoc(doc(db, 'operacoes', secaoId));
    const imagemObj = snap.data().imagens.find(i => i.id === imgId);
    if (imagemObj) {
      await updateDoc(doc(db, 'operacoes', secaoId), { imagens: arrayRemove(imagemObj) });
    }
    btn.closest('.img-item').remove();
  } catch (err) {
    console.error('Erro ao remover imagem:', err);
  }
}
window.removerImagem = removerImagem;

// ─── Salvar bloco de texto ────────────────────────────────────────────────────
async function salvarBloco(btn) {
  if (!isAdmin) return;
  const secao    = btn.closest('.operacao-section');
  const secaoId  = secao.dataset.id;
  const textarea = secao.querySelector('.criterios-conteudo');
  const texto    = textarea.value.trim();

  if (!texto) { alert('Escreva algo antes de salvar.'); return; }

  const blocoId  = gerarId();
  const blocoObj = { id: blocoId, texto, criadoEm: new Date().toISOString() };

  try {
    await updateDoc(doc(db, 'operacoes', secaoId), { blocos: arrayUnion(blocoObj) });

    const container = secao.querySelector('.blocos-container');
    const div       = document.createElement('div');
    div.className   = 'bloco-texto';
    div.dataset.blocoId = blocoId;
    div.innerHTML   = `
      <div class="bloco-conteudo">${texto.replace(/\n/g, '<br>')}</div>
      <button class="btn-remover-bloco admin-only" onclick="removerBloco(this,'${secaoId}','${blocoId}')">× Remover bloco</button>
    `;
    container.appendChild(div);

    textarea.value = '';
  } catch (err) {
    console.error('Erro ao salvar bloco:', err);
    alert(`Erro ao salvar: ${err.message || err}`);
  }
}
window.salvarBloco = salvarBloco;

// ─── Remover bloco de texto ───────────────────────────────────────────────────
async function removerBloco(btn, secaoId, blocoId) {
  if (!isAdmin || !confirm('Remover este bloco de texto?')) return;
  try {
    const snap     = await getDoc(doc(db, 'operacoes', secaoId));
    const blocoObj = snap.data().blocos.find(b => b.id === blocoId);
    if (blocoObj) {
      await updateDoc(doc(db, 'operacoes', secaoId), { blocos: arrayRemove(blocoObj) });
    }
    btn.closest('.bloco-texto').remove();
  } catch (err) {
    console.error('Erro ao remover bloco:', err);
  }
}
window.removerBloco = removerBloco;

// ─── Enviar comentário na operação ──────────────────────────────────────────
async function enviarComentario(event) {
  event.preventDefault();
  const secaoId    = document.getElementById('comentario-secao-id').value;
  const autorInput = document.getElementById('comentario-autor');
  const textoInput = document.getElementById('comentario-texto');
  const btnSubmit  = document.getElementById('btn-submit-comentario');

  const autor = (autorInput?.value || '').trim() || 'Anônimo';
  const texto = (textoInput?.value || '').trim();

  if (!secaoId || !texto) {
    alert('Por favor, escreva seu comentário antes de enviar.');
    return;
  }

  try { localStorage.setItem('capich_trader_nome', autor); } catch (e) {}

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando...';
  }

  try {
    // Salva via backend com Firebase Admin (permite usuários públicos sem bloqueio de regras do Firestore)
    const resp = await fetch(`/api/operacoes/${secaoId}/comentarios`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ autor, texto })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || 'Erro ao enviar comentário.');
    }

    const comentarioSalvo = data.comentario;

    const lista = document.getElementById(`lista-comentarios-${secaoId}`);
    if (lista) {
      const vazio = lista.querySelector('.comentarios-vazio');
      if (vazio) vazio.remove();

      const item = document.createElement('div');
      item.className = 'comentario-item';
      item.dataset.comentarioId = comentarioSalvo.id;
      item.innerHTML = `
        <div class="comentario-top">
          <div class="comentario-autor-wrap">
            <span style="font-size:0.95rem;">💬</span>
            <span class="comentario-autor-nome">${escapeHtml(comentarioSalvo.autor)}</span>
            <span class="comentario-data">${comentarioSalvo.dataHora}</span>
          </div>
          <button class="btn-remover-comentario admin-only" onclick="removerComentario(this,'${secaoId}','${comentarioSalvo.id}')" title="Remover comentário (Admin)">🗑️ Excluir</button>
        </div>
        <div class="comentario-texto">${escapeHtml(comentarioSalvo.texto).replace(/\n/g, '<br>')}</div>
      `;
      lista.appendChild(item);

      const countEl = document.getElementById(`count-comentarios-${secaoId}`);
      if (countEl) {
        const total = lista.querySelectorAll('.comentario-item').length;
        countEl.textContent = total;
      }
    }

    if (textoInput) textoInput.value = '';
    fecharModalComentario();
  } catch (err) {
    console.error('Erro ao enviar comentário:', err);
    alert(`Erro ao salvar comentário: ${err.message || err}`);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Enviar Comentário';
    }
  }
}
window.enviarComentario = enviarComentario;

// ─── Remover comentário (Admin only) ──────────────────────────────────────────
async function removerComentario(btn, secaoId, comentarioId) {
  if (!isAdmin) {
    alert('Apenas o administrador pode remover comentários.');
    return;
  }
  if (!confirm('Deseja realmente excluir este comentário nocivo/indesejado?')) return;

  try {
    let idToken = '';
    if (auth.currentUser) {
      idToken = await auth.currentUser.getIdToken();
    }

    const resp = await fetch(`/api/operacoes/${secaoId}/comentarios/${comentarioId}`, {
      method:  'DELETE',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${idToken}`
      }
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || 'Erro ao excluir comentário no servidor.');
    }

    const item = btn.closest('.comentario-item');
    const lista = item ? item.parentElement : null;
    if (item) item.remove();

    if (lista) {
      const total = lista.querySelectorAll('.comentario-item').length;
      const countEl = document.getElementById(`count-comentarios-${secaoId}`);
      if (countEl) countEl.textContent = total;
      if (total === 0) {
        lista.innerHTML = '<div class="comentarios-vazio">Nenhum comentário ainda. Seja o primeiro a comentar!</div>';
      }
    }
  } catch (err) {
    console.error('Erro ao remover comentário:', err);
    alert(`Erro ao remover comentário: ${err.message || err}`);
  }
}
window.removerComentario = removerComentario;

// ─── Excluir seção inteira ────────────────────────────────────────────────────
async function excluirSecao(btn) {
  if (!isAdmin || !confirm('Excluir esta seção e todas as imagens dela?')) return;
  const secao   = btn.closest('.operacao-section');
  const secaoId = secao.dataset.id;
  try {
    await deleteDoc(doc(db, 'operacoes', secaoId));
    secao.remove();
  } catch (err) {
    console.error('Erro ao excluir seção:', err);
    alert(`Erro ao excluir: ${err.message || err}`);
  }
}
window.excluirSecao = excluirSecao;

// ─── Inscrição de email ───────────────────────────────────────────────────────
async function inscreverEmail(event) {
  event.preventDefault();
  const form      = event.target;
  const emailEl   = form.querySelector('input[type="email"]');
  const btnSubmit = form.querySelector('button[type="submit"]');
  const email     = emailEl.value.trim();
  if (!email) return;

  btnSubmit.disabled    = true;
  btnSubmit.textContent = 'Salvando...';

  try {
    await addDoc(collection(db, 'inscritos'), {
      email, criadoEm: serverTimestamp()
    });
    form.innerHTML = '<p class="inscricao-sucesso">✅ Email cadastrado! Obrigado.</p>';
  } catch (err) {
    console.error('Erro ao inscrever email:', err);
    btnSubmit.disabled    = false;
    btnSubmit.textContent = 'Inscrever';
    alert('Erro ao salvar email. Tente novamente.');
  }
}
window.inscreverEmail = inscreverEmail;

// ─── Carregar todas as seções ─────────────────────────────────────────────────
async function carregarSecoes() {
  try {
    const q    = query(collection(db, 'operacoes'), orderBy('criadoEm', 'desc'));
    const snap = await getDocs(q);
    snap.forEach(d => renderizarSecao({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Erro ao carregar seções:', err);
  }
}

window.addEventListener('DOMContentLoaded', carregarSecoes);
