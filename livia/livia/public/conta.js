(async () => {
  const me = await renderNav();
  if (!me.user) return location.href = '/entrar.html?next=' + encodeURIComponent(location.pathname + location.search);
  footer();
  const a = me.access;
  $('#profile').innerHTML = `${esc(me.user.name || '')}<br>${esc(me.user.email)}`;
  const refresh = () => {
    $('#sub').textContent = a.active ? `Plano ${a.plan_name} · ${a.status === 'canceled' ? 'sem renovação, acesso até ' : 'renova/expira em '}${fmtDate(a.expires_at)}` : 'Nenhuma assinatura ativa.';
    $('#cancel').hidden = !(a.active && a.status === 'active');
  };
  refresh();
  $('#cancel').onclick = async () => {
    if (!confirm('Cancelar a renovação? Você mantém o acesso até o fim do período pago.')) return;
    try { await api('/api/subscription/cancel', 'POST'); a.status = 'canceled'; refresh(); say($('#mSub'), 'Renovação cancelada.', true); } catch (x) { say($('#mSub'), x.message); }
  };

  const { plans } = await api('/api/public');
  const wanted = +new URLSearchParams(location.search).get('plano');
  $('#plans').innerHTML = plans.map(p => `<article class="card plan ${p.vip ? 'vip' : ''}" ${p.id === wanted ? 'style="outline:2px solid var(--wine2)"' : ''}>
    <h3>${esc(p.name)}</h3><div class="price" id="pr${p.id}">${money(p.price_cents)} <small>/ ${p.duration_days} dias</small></div>
    <ul>${p.benefits.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
    <p class="fine">${esc(p.renewal_text)}<br>${esc(p.cancel_text)}</p>
    <button class="btn" data-id="${p.id}">${a.active ? 'Renovar / trocar' : 'Assinar'} ${esc(p.name)}</button></article>`).join('');
  $('#plans').onclick = async e => {
    const b = e.target.closest('button[data-id]'); if (!b) return; b.disabled = true;
    try { const r = await api('/api/checkout', 'POST', { plan_id: +b.dataset.id, coupon: $('#coupon').value.trim() || undefined }); location.href = r.url; }
    catch (x) { say($('#mCoupon'), x.message); b.disabled = false; }
  };
  $('#coupon').onchange = async () => {
    const c = $('#coupon').value.trim(); if (!c) return say($('#mCoupon'), '');
    try { const r = await api('/api/coupon', 'POST', { plan_id: plans[0].id, coupon: c }); say($('#mCoupon'), `Cupom válido: ${plans[0].name} por ${money(r.price_cents)} (valores dos demais planos também recebem o desconto).`, true); }
    catch (x) { say($('#mCoupon'), x.message); }
  };

  const pays = await api('/api/me/payments');
  $('#pays').innerHTML = pays.length ? pays.map(p => `<tr><td>${esc(p.created_at.slice(0, 10).split('-').reverse().join('/'))}</td><td>${esc(p.plan || '')}</td><td>${money(p.amount_cents)}</td><td><span class="pill ${p.status === 'paid' ? 'ok' : 'bad'}">${p.status === 'paid' ? 'Pago' : 'Reembolsado'}</span></td></tr>`).join('')
    : '<tr><td colspan="4">Nenhum pagamento ainda.</td></tr>';

  $('#fPass').onsubmit = async e => { e.preventDefault(); try { await api('/api/me/password', 'POST', { current: $('#pc').value, password: $('#pn').value }); say($('#mPass'), 'Senha atualizada.', true); e.target.reset(); } catch (x) { say($('#mPass'), x.message); } };
  $('#fDel').onsubmit = async e => { e.preventDefault(); if (!confirm('Encerrar a conta definitivamente?')) return;
    try { await api('/api/me', 'DELETE', { password: $('#dp').value }); location.href = '/'; } catch (x) { say($('#mDel'), x.message); } };
})();
