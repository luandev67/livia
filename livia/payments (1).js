// Integração com a SigiloPay (checkout hospedado + webhooks).
// Documentação: https://app.sigilopay.com.br/docs/v1/webhooks
//
// Fluxo:
//   1. O site envia o cliente para o link de checkout do produto (cadastrado em cada plano no painel),
//      acrescentando ?uid=<id do usuário>. A SigiloPay devolve esse parâmetro no webhook, em `checkoutUrl`.
//   2. A SigiloPay chama POST /webhooks/payment com JSON {event, token, offerCode, checkoutUrl, client, transaction, ...}.
//   3. O `token` do webhook (gerado no painel da SigiloPay ao criar o webhook) é conferido com a
//      variável de ambiente PAYMENT_WEBHOOK_SECRET.
//   4. O plano é identificado pelo `offerCode` (campo "Código da oferta" de cada plano no painel).
//
// Nenhum dado de cartão passa pelo nosso servidor.

const crypto = require('crypto');

function checkoutUrl(plan, user /*, { price, coupon } */) {
  if (!plan.checkout_url) return null;
  let u;
  try { u = new URL(plan.checkout_url.replace(/\{(\w+)\}/g, (_, k) => ({ user_id: user.id, plan_id: plan.id, email: encodeURIComponent(user.email) }[k] ?? ''))); }
  catch { return null; }
  if (u.protocol !== 'https:') return null;
  u.searchParams.set('uid', String(user.id)); // volta no webhook dentro de checkoutUrl
  return u.toString();
}

// O token vem no corpo do webhook. Comparação em tempo constante.
function verifyToken(body) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const token = body && typeof body.token === 'string' ? body.token : '';
  if (!secret || !token) return false;
  const a = Buffer.from(secret), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const EVENT_MAP = {
  TRANSACTION_PAID: 'paid',
  TRANSACTION_REFUNDED: 'refunded',
  TRANSACTION_CHARGED_BACK: 'refunded',
};

// Converte o payload da SigiloPay para o formato interno.
// Retorna { type: 'paid'|'refunded'|'ignore', offer_code, user_id, email, reference }.
function parseWebhook(body) {
  const type = EVENT_MAP[body && body.event] || 'ignore';
  let userId = null;
  try { userId = parseInt(new URL(body.checkoutUrl).searchParams.get('uid'), 10) || null; } catch { /* sem checkoutUrl */ }
  const tx = (body && body.transaction) || {};
  return {
    type,
    event: body && body.event,
    offer_code: body && body.offerCode ? String(body.offerCode) : '',
    user_id: userId,
    email: body && body.client && typeof body.client.email === 'string' ? body.client.email.toLowerCase() : null,
    reference: tx.id ? String(tx.id) : (tx.identifier ? String(tx.identifier) : ''),
  };
}

async function cancelRecurring(/* user, subscription */) {
  // Não há cobrança recorrente automática: cada período é um novo pagamento. Nada a cancelar no provedor.
  return { ok: true, provider: 'sigilopay' };
}

module.exports = { checkoutUrl, verifyToken, parseWebhook, cancelRecurring };
