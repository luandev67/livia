// Camada de pagamentos — independente de provedor.
//
// IMPORTANTE: nem todo processador aceita conteúdo adulto/sensual (ex.: Stripe e PayPal
// costumam proibir). Escolha um provedor que aceite expressamente o seu modelo de negócio
// (ex.: CCBill, Segpay, Epoch ou equivalente) e confirme isso por escrito com ele.
//
// Modelo usado aqui (checkout hospedado):
//   1. O site redireciona o assinante para a página de checkout HOSPEDADA do provedor
//      (os dados do cartão nunca passam pelo nosso servidor).
//   2. O provedor chama POST /webhooks/payment, assinado com HMAC-SHA256.
//   3. O webhook libera/renova/cancela o acesso.
//
// Para integrar um provedor real, ajuste:
//   - checkoutUrl(): monte a URL do provedor (use o template de cada plano no painel admin).
//   - normalizeWebhook(): converta o payload do provedor para o formato interno abaixo.
//   - cancelRecurring(): chame a API do provedor para parar a cobrança recorrente.

const crypto = require('crypto');

// Placeholders aceitos no template de URL do plano:
// {user_id} {plan_id} {email} {price} {coupon} {ref}
function checkoutUrl(plan, user, { price, coupon }) {
  if (!plan.checkout_url) return null;
  const ref = crypto.randomBytes(8).toString('hex');
  const map = {
    user_id: user.id, plan_id: plan.id, email: encodeURIComponent(user.email),
    price: (price / 100).toFixed(2), coupon: encodeURIComponent(coupon || ''), ref,
  };
  return plan.checkout_url.replace(/\{(\w+)\}/g, (_, k) => (k in map ? map[k] : ''));
}

function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signatureHeader).trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Formato interno esperado:
// { type: 'payment.succeeded' | 'payment.refunded' | 'subscription.cancelled',
//   user_id, plan_id, amount_cents, reference }
function normalizeWebhook(body) {
  return body; // TODO: mapear o payload real do seu provedor.
}

async function cancelRecurring(/* user, subscription */) {
  // TODO: chamar a API do provedor para cancelar a recorrência.
  // Enquanto isso, o servidor apenas marca a assinatura como "cancelada" (sem renovar) e
  // o acesso continua até o fim do período já pago.
  return { ok: true, provider: 'manual' };
}

module.exports = { checkoutUrl, verifySignature, normalizeWebhook, cancelRecurring };
