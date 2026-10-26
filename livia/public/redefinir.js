$('#f').onsubmit = async e => {
  e.preventDefault(); const m = $('#m');
  try {
    await api('/api/reset', 'POST', { token: new URLSearchParams(location.search).get('token'), password: $('#p').value });
    say(m, 'Senha alterada! Redirecionando para o login…', true); setTimeout(() => location.href = '/entrar.html', 1500);
  } catch (x) { say(m, x.message); }
};
