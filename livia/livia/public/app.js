// Utilitários compartilhados
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = t => new Date(t * 1000).toLocaleDateString('pt-BR');

async function api(url, method = 'GET', body) {
  const opt = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(data.error || 'Erro inesperado.'); e.status = r.status; throw e; }
  return data;
}
function say(el, text, ok) { el.textContent = text || ''; el.className = 'msg ' + (text ? (ok ? 'ok' : 'err') : ''); }

async function renderNav(site) {
  const me = await api('/api/me').catch(() => ({ user: null }));
  const nav = $('#nav');
  if (!nav) return me;
  const links = me.user
    ? `<a href="/membros.html">Conteúdo</a><a href="/conta.html">Minha conta</a>${me.user.role === 'admin' ? '<a href="/admin.html">Admin</a>' : ''}<button id="logout">Sair</button>`
    : `<a href="/#planos">Planos</a><a href="/entrar.html">Entrar</a>`;
  nav.innerHTML = links;
  const lo = $('#logout'); if (lo) lo.onclick = async () => { await api('/api/logout', 'POST'); location.href = '/'; };
  return me;
}
function footer(email) {
  const f = $('#footer'); if (!f) return;
  f.innerHTML = `<div class="wrap"><p><a href="/legal.html?doc=termos">Termos de Uso</a><a href="/legal.html?doc=privacidade">Privacidade</a><a href="/legal.html?doc=reembolso">Reembolso e cancelamento</a></p>
  <p style="margin-top:10px">Conteúdo exclusivo para maiores de 18 anos. ${email ? 'Suporte: ' + esc(email) : ''}</p></div>`;
}
function openViewer(url, kind) {
  const v = document.createElement('div'); v.className = 'viewer';
  v.innerHTML = kind === 'video' ? `<video src="${url}" controls autoplay playsinline controlsList="nodownload"></video>` : `<img src="${url}" alt="">`;
  v.onclick = e => { if (e.target === v) v.remove(); };
  document.body.appendChild(v);
}
