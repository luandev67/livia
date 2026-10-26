# Lívia — plataforma de assinaturas

Node.js + Express + SQLite. Sem build: `npm install && npm start`.

## Rodar
1. `cp .env.example .env` e edite (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PAYMENT_WEBHOOK_SECRET`, `BASE_URL`).
2. `npm install`
3. `npm start` → http://localhost:3000 (a conta admin é criada na 1ª execução; troque a senha).
4. Entre em `/admin.html`: envie fotos/vídeos, ajuste planos, preços, textos e termos.

Produção: `NODE_ENV=production`, atrás de HTTPS (Nginx/Caddy/Render/Fly). Em produção o site redireciona para HTTPS e usa cookies `Secure`.

## O que já está implementado
- Cadastro com data de nascimento (bloqueia menores de 18) + aviso de maioridade na entrada, login, logout, recuperação de senha por e-mail, troca de senha, encerramento de conta.
- Controle de acesso **no servidor**: `/media/:id` e `/api/content` só liberam para assinante ativo (VIP separado). Arquivos ficam em `uploads/`, fora da pasta pública.
- Planos, cupons, assinantes e conteúdo editáveis no painel. Preços 100% configuráveis.
- Proteções: helmet/CSP, rate limit de login, bcrypt, sessões com token em hash no banco, cookie httpOnly, header anti-CSRF, validação de tipo de arquivo.
- Termos, privacidade e reembolso editáveis (os textos padrão são **modelos**: revise com advogado/LGPD).
- Aviso de conteúdo gerado por IA na home e nos itens marcados; o upload exige confirmação de direitos sobre a imagem.

## Pagamentos (você precisa configurar)
Nenhuma chave foi inventada e nenhum pagamento é simulado. O fluxo é por **checkout hospedado** do provedor (dados de cartão nunca tocam seu servidor):
1. **Escolha um provedor que aceite expressamente seu tipo de conteúdo** (Stripe e PayPal normalmente não aceitam conteúdo adulto/sensual; confirme por escrito com CCBill, Segpay, Epoch etc.).
2. No painel → Planos, cole o link de checkout do provedor em cada plano. Placeholders: `{user_id} {plan_id} {email} {price} {coupon} {ref}`.
3. Configure no provedor o webhook `POST https://seudominio/webhooks/payment` e defina `PAYMENT_WEBHOOK_SECRET` (HMAC-SHA256 do corpo, header `x-signature`).
4. Em `payments.js`, ajuste `normalizeWebhook()` ao payload real do provedor e `cancelRecurring()` para chamar a API de cancelamento dele. Formato interno:
   `{ "type": "payment.succeeded|payment.refunded|subscription.cancelled", "user_id": 1, "plan_id": 1, "amount_cents": 2990, "reference": "id-único" }`
   Pagamentos são idempotentes pelo `reference`.

## E-mail
Defina `SMTP_*` no `.env`. Sem SMTP, o link de recuperação aparece no console do servidor.

## Antes de lançar
- Verificação de idade **forte** (documento/selfie via serviço especializado), se a lei ou seu processador exigir; hoje é declaratória (data de nascimento + confirmação).
- Revisar termos/privacidade com advogado; usar apenas imagens próprias, licenciadas ou de personagem 100% fictícia, sem semelhança com pessoas reais.
- Backups de `data.db` e `uploads/`; domínio com HTTPS.
