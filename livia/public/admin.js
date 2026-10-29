(async () => {
  const me = await renderNav();
  if (!me.user || me.user.role !== 'admin') return location.href = '/entrar.html?next=/admin.html';
  const view = $('#view');
  const views = {};

  views.content = async () => {
    const list = await api('/api/admin/content');
    view.innerHTML = `<form class="card" id="up"><h3>Enviar conteúdo</h3>
      <label>Título</label><input name="title" maxlength="120">
      <label>Arquivo (JPG, PNG, WEBP, MP4, WEBM)</label><input type="file" name="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" required>
      <label class="chk"><input type="checkbox" name="is_preview"> Prévia pública (visível para todos)</label>
      <label class="chk"><input type="checkbox" name="vip_only"> Exclusivo do plano VIP</label>
      <label class="chk"><input type="checkbox" name="hero"> Usar como foto de destaque da página inicial</label>
      <label class="chk"><input type="checkbox" name="ai_generated" checked> Conteúdo gerado/auxiliado por IA (exibir identificação)</label>
      <label class="chk"><input type="checkbox" name="rights" required> Confirmo que sou titular dos direitos ou tenho autorização para usar esta imagem/vídeo, e que não retrata pessoa real sem consentimento.</label>
      <p class="msg" id="m"></p><button class="btn small">Enviar</button></form>
      <div class="card scroll" style="margin-top:16px"><table><thead><tr><th>Arquivo</th><th>Título</th><th>Visibilidade</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td>${c.kind === 'video' ? '🎬' : '🖼️'} <a href="/media/${c.id}" target="_blank">#${c.id}</a></td><td>${esc(c.title)}</td>
        <td>${c.is_preview ? '<span class="pill ok">Prévia</span> ' : ''}${c.vip_only ? '<span class="pill">VIP</span> ' : ''}${c.published ? '' : '<span class="pill bad">Oculto</span>'}</td>
        <td class="row"><button class="btn small ghost" data-a="prev" data-id="${c.id}" data-v="${c.is_preview ? 0 : 1}">${c.is_preview ? 'Tornar privado' : 'Tornar prévia'}</button>
        <button class="btn small ghost" data-a="pub" data-id="${c.id}" data-v="${c.published ? 0 : 1}">${c.published ? 'Ocultar' : 'Publicar'}</button>
        <button class="btn small ghost" data-a="del" data-id="${c.id}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="4">Nada enviado ainda.</td></tr>'}</tbody></table></div>`;
    $('#up').onsubmit = async e => { e.preventDefault(); const m = $('#m'); say(m, 'Enviando…', true);
      try { await api('/api/admin/content', 'POST', new FormData(e.target)); load('content'); } catch (x) { say(m, x.message); } };
    view.onclick = async e => { const b = e.target.closest('button[data-a]'); if (!b) return; const id = b.dataset.id;
      if (b.dataset.a === 'del') { if (!confirm('Excluir definitivamente?')) return; await api('/api/admin/content/' + id, 'DELETE'); }
      else await api('/api/admin/content/' + id, 'PATCH', b.dataset.a === 'prev' ? { is_preview: +b.dataset.v } : { published: +b.dataset.v });
      load('content'); };
  };

  views.plans = async () => {
    const plans = await api('/api/admin/plans');
    view.innerHTML = `<p class="sub">Preços em reais. Cole o link de checkout do produto na SigiloPay e o código da oferta correspondente. O site acrescenta o ID do cliente ao link automaticamente.</p>` +
      plans.map(p => `<form class="card" data-id="${p.id}" style="margin-bottom:14px"><div class="row">
        <div><label>Nome</label><input name="name" value="${esc(p.name)}"></div>
        <div><label>Preço (R$)</label><input name="price" type="number" step="0.01" min="0" value="${(p.price_cents / 100).toFixed(2)}"></div>
        <div><label>Duração (dias)</label><input name="duration_days" type="number" min="1" value="${p.duration_days}"></div></div>
        <label>Benefícios (um por linha)</label><textarea name="benefits" rows="4">${esc(JSON.parse(p.benefits).join('\n'))}</textarea>
        <label>Link de checkout do provedor</label><input name="checkout_url" value="${esc(p.checkout_url)}" placeholder="https://…?ref={ref}&user={user_id}&plan={plan_id}">
        <label>Código da oferta (SigiloPay) — identifica este plano nos pagamentos</label><input name="offer_code" value="${esc(p.offer_code || '')}">
        <label>Texto de renovação</label><input name="renewal_text" value="${esc(p.renewal_text)}">
        <label>Texto de cancelamento</label><input name="cancel_text" value="${esc(p.cancel_text)}">
        <div class="row"><label class="chk"><input type="checkbox" name="vip" ${p.vip ? 'checked' : ''}> Plano VIP</label><label class="chk"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Ativo</label>
        <div><input name="sort" type="number" value="${p.sort}" style="width:80px" title="Ordem"></div></div>
        <p class="msg"></p><button class="btn small">Salvar plano</button></form>`).join('') +
      `<button class="btn small ghost" id="newPlan">+ Novo plano</button>`;
    const body = f => ({ id: +f.dataset.id || undefined, name: f.name.value, price_cents: Math.round(parseFloat(f.price.value || 0) * 100),
      duration_days: +f.duration_days.value, benefits: f.benefits.value.split('\n').map(s => s.trim()).filter(Boolean), checkout_url: f.checkout_url.value,
      offer_code: f.offer_code.value, renewal_text: f.renewal_text.value, cancel_text: f.cancel_text.value, vip: f.vip.checked, active: f.active.checked, sort: +f.sort.value });
    view.querySelectorAll('form').forEach(f => f.onsubmit = async e => { e.preventDefault(); const m = f.querySelector('.msg');
      try { await api('/api/admin/plans', 'POST', body(f)); say(m, 'Salvo.', true); } catch (x) { say(m, x.message); } });
    $('#newPlan').onclick = async () => { await api('/api/admin/plans', 'POST', { name: 'Novo plano', price_cents: 1000, duration_days: 30, benefits: [], active: false }); load('plans'); };
  };

  views.subs = async () => {
    const s = await api('/api/admin/subscribers');
    view.innerHTML = `<div class="card scroll"><table><thead><tr><th>E-mail</th><th>Plano</th><th>Status</th><th>Expira</th><th>Total pago</th><th>Cadastro</th></tr></thead><tbody>
      ${s.map(u => { const act = u.expires_at > Date.now() / 1000 && (u.status === 'active' || u.status === 'canceled');
        return `<tr><td>${esc(u.email)}</td><td>${esc(u.plan || '—')}</td><td><span class="pill ${act ? 'ok' : ''}">${act ? (u.status === 'canceled' ? 'Cancelada (vigente)' : 'Ativa') : 'Sem acesso'}</span></td>
        <td>${u.expires_at ? fmtDate(u.expires_at) : '—'}</td><td>${money(u.total_cents)}</td><td>${esc(u.created_at.slice(0, 10))}</td></tr>`; }).join('') || '<tr><td colspan="6">Nenhum assinante ainda.</td></tr>'}</tbody></table></div>`;
  };

  views.coupons = async () => {
    const c = await api('/api/admin/coupons');
    view.innerHTML = `<form class="card" id="fc"><h3>Novo cupom</h3><div class="row">
      <div><label>Código</label><input name="code" required></div><div><label>Desconto (%)</label><input name="percent_off" type="number" min="1" max="100" required></div>
      <div><label>Limite de usos (0 = ilimitado)</label><input name="max_uses" type="number" min="0" value="0"></div></div>
      <p class="msg" id="m"></p><button class="btn small">Salvar cupom</button></form>
      <div class="card scroll" style="margin-top:16px"><table><thead><tr><th>Código</th><th>Desconto</th><th>Usos</th><th></th></tr></thead><tbody>
      ${c.map(x => `<tr><td>${esc(x.code)}</td><td>${x.percent_off}%</td><td>${x.uses}${x.max_uses ? ' / ' + x.max_uses : ''}</td><td><button class="btn small ghost" data-code="${esc(x.code)}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="4">Nenhum cupom.</td></tr>'}</tbody></table></div>
      <p class="sub" style="margin-top:12px;font-size:.85rem">O site valida o cupom e repassa o preço final ao link de checkout via {price}; configure o desconto correspondente no seu provedor.</p>`;
    $('#fc').onsubmit = async e => { e.preventDefault(); const f = e.target;
      try { await api('/api/admin/coupons', 'POST', { code: f.code.value, percent_off: +f.percent_off.value, max_uses: +f.max_uses.value }); load('coupons'); } catch (x) { say($('#m'), x.message); } };
    view.onclick = async e => { const b = e.target.closest('button[data-code]'); if (b) { await api('/api/admin/coupons/' + encodeURIComponent(b.dataset.code), 'DELETE'); load('coupons'); } };
  };

  views.profile = async () => {
    const s = await api('/api/admin/settings');
    const F = [['artist_name', 'Nome artístico', 1], ['tagline', 'Frase de destaque', 1], ['bio', 'Biografia', 4], ['ai_disclosure', 'Aviso de conteúdo gerado por IA', 2],
      ['support_email', 'E-mail de suporte', 1], ['terms', 'Termos de Uso', 8], ['privacy', 'Política de Privacidade', 8], ['refund', 'Reembolso e cancelamento', 8]];
    view.innerHTML = `<form class="card" id="fs">${F.map(([k, l, r]) => `<label>${l}</label>${r === 1 ? `<input name="${k}" value="${esc(s[k])}">` : `<textarea name="${k}" rows="${r}">${esc(s[k])}</textarea>`}`).join('')}
      <p class="msg" id="m"></p><button class="btn small">Salvar</button></form>
      <p class="sub" style="margin-top:12px;font-size:.85rem">A foto de destaque é definida ao enviar uma imagem marcada como "foto de destaque" na aba Conteúdo.</p>`;
    $('#fs').onsubmit = async e => { e.preventDefault(); const o = {}; F.forEach(([k]) => o[k] = e.target[k].value);
      try { await api('/api/admin/settings', 'PUT', o); say($('#m'), 'Salvo.', true); } catch (x) { say($('#m'), x.message); } };
  };

  async function load(t) {
    view.onclick = null;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    try { await views[t](); } catch (x) { view.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; }
  }
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) load(b.dataset.t); };
  load('content');
})();
