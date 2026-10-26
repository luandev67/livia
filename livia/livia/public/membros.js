(async () => {
  const me = await renderNav();
  if (!me.user) return location.href = '/entrar.html?next=/membros.html';
  footer();
  if (!me.access.active) {
    $('#status').innerHTML = 'Você ainda não tem uma assinatura ativa. <a href="/conta.html" style="text-decoration:underline">Escolher um plano</a>';
    return;
  }
  $('#status').textContent = `Plano ${me.access.plan_name}` + (me.access.expires_at ? ` · acesso até ${fmtDate(me.access.expires_at)}` : '');
  const items = await api('/api/content');
  const g = $('#gallery');
  g.innerHTML = items.length ? items.map(i => `<div class="thumb ${i.locked ? 'locked' : ''}" data-id="${i.id}" data-k="${i.kind}" data-l="${i.locked ? 1 : 0}">
    ${i.locked ? '' : i.kind === 'video' ? `<video src="/media/${i.id}#t=0.1" muted playsinline preload="metadata"></video>` : `<img loading="lazy" src="/media/${i.id}" alt="${esc(i.title)}">`}
    <span class="tag">${esc(i.title || '')}${i.ai_generated ? ' · IA' : ''}</span></div>`).join('') : '<p class="sub">Novos conteúdos em breve.</p>';
  g.onclick = e => {
    const t = e.target.closest('.thumb'); if (!t) return;
    if (t.dataset.l === '1') return alert('Conteúdo exclusivo do plano VIP.');
    openViewer('/media/' + t.dataset.id, t.dataset.k);
  };
})();
