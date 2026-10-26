(async () => {
  // verificação de idade (declaratória) — o cadastro também exige data de nascimento
  const gate = $('#age');
  try { if (!localStorage.getItem('age_ok')) gate.hidden = false; } catch { gate.hidden = false; }
  $('#ageYes').onclick = () => { try { localStorage.setItem('age_ok', '1'); } catch {} gate.hidden = true; };

  const [d] = await Promise.all([api('/api/public'), renderNav()]);
  const s = d.settings;
  document.title = `${s.artist_name} — Conteúdo exclusivo`;
  $('#name').textContent = s.artist_name; $('#bio').textContent = s.bio; $('#ai').textContent = s.ai_disclosure;
  if (s.hero) $('#hero').innerHTML = `<img src="${s.hero}" alt="${esc(s.artist_name)}" fetchpriority="high">`;
  footer(s.support_email);

  const g = $('#gallery');
  g.innerHTML = d.previews.length ? d.previews.map(p => `<div class="thumb" data-id="${p.id}" data-k="${p.kind}">
      ${p.kind === 'video' ? `<video src="/media/${p.id}#t=0.1" muted playsinline preload="metadata"></video>` : `<img loading="lazy" src="/media/${p.id}" alt="${esc(p.title)}">`}
      <span class="tag">${esc(p.title || 'Prévia')}</span></div>`).join('')
    : '<p class="sub">As prévias aparecerão aqui.</p>';
  g.onclick = e => { const t = e.target.closest('.thumb'); if (t) openViewer('/media/' + t.dataset.id, t.dataset.k); };

  $('#plans').innerHTML = d.plans.map(p => `<article class="card plan ${p.vip ? 'vip' : ''}">
      <h3>${esc(p.name)}</h3>
      <div class="price">${money(p.price_cents)} <small>/ ${p.duration_days} dias</small></div>
      <ul>${p.benefits.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      <p class="fine">${esc(p.renewal_text)}<br>${esc(p.cancel_text)}</p>
      <a class="btn" href="/conta.html?plano=${p.id}">Assinar ${esc(p.name)}</a></article>`).join('');
})();
