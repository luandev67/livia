(() => {
  renderNav();
  const forms = { Login: $('#fLogin'), Reg: $('#fReg'), Forgot: $('#fForgot') };
  const show = k => { for (const n in forms) { forms[n].hidden = n !== k; $('#t' + n).classList.toggle('on', n === k); } };
  for (const n in forms) $('#t' + n).onclick = () => show(n);
  if (location.hash === '#cadastro') show('Reg');
  const next = new URLSearchParams(location.search).get('next');
  const dest = (next && next.startsWith('/') && !next.startsWith('//')) ? next : '/membros.html';

  forms.Login.onsubmit = async e => { e.preventDefault(); const m = $('#mLogin'); say(m, '');
    try { const r = await api('/api/login', 'POST', { email: $('#le').value, password: $('#lp').value }); location.href = r.role === 'admin' && dest === '/membros.html' ? '/admin.html' : dest; }
    catch (x) { say(m, x.message); } };
  forms.Reg.onsubmit = async e => { e.preventDefault(); const m = $('#mReg'); say(m, '');
    try { await api('/api/register', 'POST', { name: $('#rn').value, email: $('#re').value, password: $('#rp').value, birthdate: $('#rb').value, accept: $('#ra').checked }); location.href = dest === '/membros.html' ? '/conta.html' : dest; }
    catch (x) { say(m, x.message); } };
  forms.Forgot.onsubmit = async e => { e.preventDefault(); const m = $('#mForgot');
    try { await api('/api/forgot', 'POST', { email: $('#fe').value }); say(m, 'Se o e-mail estiver cadastrado, você receberá um link em instantes.', true); }
    catch (x) { say(m, x.message); } };
})();
