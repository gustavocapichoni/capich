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
        const indicator = document.getElementById('admin-indicator');
        const nameEl    = document.getElementById('admin-user-name');
        if (indicator) indicator.style.display = 'flex';
        if (nameEl)    nameEl.textContent = user.displayName || user.email;
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
  if (e.key === 'Escape') { fecharModalImagem(); fecharModalAdmin(); }
});

window.abrirModalImagem  = abrirModalImagem;
window.fecharModalImagem = fecharModalImagem;

// ─── Utilitários ──────────────────────────────────────────────────────────────
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
