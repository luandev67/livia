(async () => {
  renderNav(); footer();
  const doc = new URLSearchParams(location.search).get('doc') || 'termos';
  try { $('#t').textContent = (await api('/api/legal/' + encodeURIComponent(doc))).text; } catch { $('#t').textContent = 'Documento não encontrado.'; }
})();
