const fs = require('fs'), path = require('path'), crypto = require('crypto');
// .env simples, sem dependências
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser'), bcrypt = require('bcryptjs'), multer = require('multer');
const Database = require('better-sqlite3'), nodemailer = require('nodemailer');
const pay = require('./payments');

const PROD = process.env.NODE_ENV === 'production';
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); // NÃO é servido estaticamente
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- Banco ---------- */
const db = new Database(path.join(process.env.DATA_DIR || __dirname, 'data.db'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, pass TEXT NOT NULL,
  role TEXT DEFAULT 'user', birthdate TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS resets(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL,
  duration_days INTEGER NOT NULL, benefits TEXT DEFAULT '[]', vip INTEGER DEFAULT 0, checkout_url TEXT DEFAULT '',
  renewal_text TEXT DEFAULT '', cancel_text TEXT DEFAULT '', active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS subscriptions(user_id INTEGER PRIMARY KEY, plan_id INTEGER, status TEXT NOT NULL,
  expires_at INTEGER NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, plan_id INTEGER, amount_cents INTEGER,
  status TEXT, reference TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS content(id INTEGER PRIMARY KEY, title TEXT, kind TEXT, file TEXT NOT NULL, mime TEXT,
  is_preview INTEGER DEFAULT 0, vip_only INTEGER DEFAULT 0, published INTEGER DEFAULT 1, ai_generated INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY, percent_off INTEGER NOT NULL, max_uses INTEGER DEFAULT 0,
  uses INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);

const DEFAULT_SETTINGS = {
  site_name: 'Lívia',
  artist_name: 'Lívia',
  tagline: 'Conteúdo exclusivo, bastidores e novidades em primeira mão.',
  bio: 'Oi, eu sou a Lívia. Aqui você encontra ensaios exclusivos, bastidores e conteúdo que não publico em nenhum outro lugar. Assine para entrar no meu espaço privado.',
  ai_disclosure: 'Lívia é uma personagem virtual. O conteúdo deste site é produzido com auxílio de inteligência artificial.',
  hero_content_id: '',
  support_email: 'contato@seudominio.com',
  terms: 'TERMOS DE USO (modelo — revise com um advogado antes de publicar)\n\n1. Acesso restrito a maiores de 18 anos.\n2. O conteúdo é protegido por direitos autorais; é proibido copiar, redistribuir ou compartilhar o acesso.\n3. A conta é pessoal e intransferível.\n4. Podemos suspender contas que violem estes termos.\n5. O conteúdo é produzido com auxílio de IA quando indicado.',
  privacy: 'POLÍTICA DE PRIVACIDADE (modelo — revise com um advogado, observando a LGPD)\n\nColetamos e-mail, nome, data de nascimento (verificação de idade) e histórico de pagamentos. Dados de cartão são tratados exclusivamente pelo provedor de pagamentos. Você pode solicitar a exclusão da conta e dos dados a qualquer momento na área "Minha conta".',
  refund: 'REEMBOLSO E CANCELAMENTO (modelo — ajuste à sua oferta)\n\nVocê pode cancelar a renovação a qualquer momento em "Minha conta"; o acesso continua até o fim do período já pago. Pedidos de reembolso podem ser feitos em até 7 dias da compra pelo e-mail de suporte.',
};
const getSettings = () => {
  const o = { ...DEFAULT_SETTINGS };
  db.prepare('SELECT key,value FROM settings').all().forEach(r => { o[r.key] = r.value; });
  return o;
};
if (db.prepare('SELECT COUNT(*) c FROM plans').get().c === 0) {
  const ins = db.prepare('INSERT INTO plans(name,price_cents,duration_days,benefits,vip,renewal_text,cancel_text,sort) VALUES(?,?,?,?,?,?,?,?)');
  const cancel = 'Cancele quando quiser em "Minha conta". O acesso segue até o fim do período pago.';
  ins.run('Mensal', 2990, 30, JSON.stringify(['Acesso por 30 dias', 'Galeria privada', 'Novos conteúdos toda semana']), 0, 'Renova a cada 30 dias.', cancel, 1);
  ins.run('Trimestral', 7490, 90, JSON.stringify(['Acesso por 90 dias', 'Galeria privada', 'Desconto em relação ao mensal']), 0, 'Renova a cada 90 dias.', cancel, 2);
  ins.run('VIP', 12990, 30, JSON.stringify(['Tudo do plano Mensal', 'Conteúdos VIP exclusivos', 'Acesso antecipado a novidades']), 1, 'Renova a cada 30 dias.', cancel, 3);
}
// valores/preços acima são exemplos editáveis no painel.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
    !db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  db.prepare("INSERT INTO users(email,name,pass,role,birthdate) VALUES(?,?,?,?,?)")
    .run(process.env.ADMIN_EMAIL.toLowerCase(), 'Admin', bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12), 'admin', '1990-01-01');
  console.log('Administrador criado:', process.env.ADMIN_EMAIL);
}

/* ---------- Helpers ---------- */
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const isEmail = s => typeof s === 'string' && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s) && s.length <= 254;
const ageOf = bd => { const d = new Date(bd); if (isNaN(d)) return -1; const t = new Date(); let a = t.getFullYear() - d.getFullYear();
  if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function accessOf(userId) {
  const s = db.prepare('SELECT s.*, p.name plan_name, p.vip FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=?').get(userId);
  if (!s) return { active: false, vip: false };
  const active = s.expires_at > now() && (s.status === 'active' || s.status === 'canceled');
  return { active, vip: active && !!s.vip, status: s.status, expires_at: s.expires_at, plan_name: s.plan_name, plan_id: s.plan_id };
}

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587),
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;
async function sendMail(to, subject, text) {
  if (!mailer) { console.log(`\n[EMAIL não configurado] Para: ${to}\nAssunto: ${subject}\n${text}\n`); return; }
  await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
}

/* ---------- App ---------- */
const app = express();
app.set('trust proxy', 1);
if (PROD) app.use((req, res, next) => req.secure ? next() : res.redirect(301, 'https://' + req.headers.host + req.url));
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], styleSrcAttr: ["'unsafe-inline'"],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], mediaSrc: ["'self'"],
    objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
  } },
}));

// Webhook primeiro: precisa do corpo bruto para validar a assinatura.
app.post('/webhooks/payment', express.raw({ type: '*/*', limit: '100kb' }), (req, res) => {
  if (!pay.verifySignature(req.body, req.get('x-signature'))) return res.status(401).json({ error: 'assinatura inválida' });
  let ev; try { ev = pay.normalizeWebhook(JSON.parse(req.body.toString('utf8'))); } catch { return res.status(400).json({ error: 'json inválido' }); }
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(ev.user_id);
  if (!user) return res.status(404).json({ error: 'usuário não encontrado' });
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(ev.plan_id);
  const tx = db.transaction(() => {
    if (ev.type === 'payment.succeeded') {
      if (!plan || !ev.reference) throw new Error('dados incompletos');
      if (db.prepare('SELECT 1 FROM payments WHERE reference=?').get(ev.reference)) return; // idempotente
      db.prepare('INSERT INTO payments(user_id,plan_id,amount_cents,status,reference) VALUES(?,?,?,?,?)')
        .run(user.id, plan.id, ev.amount_cents | 0, 'paid', ev.reference);
      const cur = db.prepare('SELECT expires_at FROM subscriptions WHERE user_id=?').get(user.id);
      const base = Math.max(now(), cur ? cur.expires_at : 0);
      db.prepare(`INSERT INTO subscriptions(user_id,plan_id,status,expires_at) VALUES(?,?,'active',?)
        ON CONFLICT(user_id) DO UPDATE SET plan_id=excluded.plan_id,status='active',expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`)
        .run(user.id, plan.id, base + plan.duration_days * DAY);
    } else if (ev.type === 'payment.refunded') {
      db.prepare("UPDATE payments SET status='refunded' WHERE reference=?").run(ev.reference);
      db.prepare("UPDATE subscriptions SET status='expired',expires_at=? WHERE user_id=?").run(now(), user.id);
    } else if (ev.type === 'subscription.cancelled') {
      db.prepare("UPDATE subscriptions SET status='canceled' WHERE user_id=? AND status='active'").run(user.id);
    } else throw new Error('evento desconhecido');
  });
  try { tx(); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// sessão
app.use((req, res, next) => {
  req.user = null;
  const t = req.cookies.sid;
  if (t) {
    const s = db.prepare('SELECT user_id, expires FROM sessions WHERE token=?').get(sha(t));
    if (s && s.expires > now()) req.user = db.prepare('SELECT id,email,name,role FROM users WHERE id=?').get(s.user_id);
  }
  next();
});
// proteção CSRF: requisições que alteram dados exigem header customizado (não enviável cross-site sem CORS)
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'fetch')
    return res.status(403).json({ error: 'requisição inválida' });
  next();
});
const needUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'faça login' });
const needAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'acesso negado' });
const needSub = (req, res, next) => {
  if (req.user.role === 'admin') { req.access = { active: true, vip: true }; return next(); }
  req.access = accessOf(req.user.id);
  req.access.active ? next() : res.status(402).json({ error: 'assinatura necessária' });
};

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' } });
const slowLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, message: { error: 'Muitas tentativas. Tente mais tarde.' } });

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = 14 * DAY;
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(sha(token), userId, now() + ttl);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: ttl * 1000, path: '/' });
}

/* ---------- API pública ---------- */
const publicSettings = s => ({ site_name: s.site_name, artist_name: s.artist_name, tagline: s.tagline, bio: s.bio,
  ai_disclosure: s.ai_disclosure, support_email: s.support_email, hero: s.hero_content_id ? `/media/${s.hero_content_id}` : null });
const planOut = p => ({ id: p.id, name: p.name, price_cents: p.price_cents, duration_days: p.duration_days,
  benefits: JSON.parse(p.benefits || '[]'), vip: !!p.vip, renewal_text: p.renewal_text, cancel_text: p.cancel_text });

app.get('/api/public', (req, res) => {
  const s = getSettings();
  res.json({
    settings: publicSettings(s),
    plans: db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY sort,id').all().map(planOut),
    previews: db.prepare('SELECT id,title,kind FROM content WHERE is_preview=1 AND published=1 ORDER BY id DESC LIMIT 12').all(),
  });
});
app.get('/api/legal/:doc', (req, res) => {
  const k = { termos: 'terms', privacidade: 'privacy', reembolso: 'refund' }[req.params.doc];
  if (!k) return res.status(404).json({ error: 'não encontrado' });
  res.json({ text: getSettings()[k] });
});

/* ---------- Auth ---------- */
app.post('/api/register', authLimiter, asyncH(async (req, res) => {
  const { email, password, name, birthdate, accept } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'A senha deve ter entre 8 e 128 caracteres.' });
  if (ageOf(birthdate) < 18) return res.status(400).json({ error: 'Cadastro permitido apenas para maiores de 18 anos.' });
  if (accept !== true) return res.status(400).json({ error: 'Aceite os Termos de Uso e a Política de Privacidade.' });
  const em = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
  const r = db.prepare('INSERT INTO users(email,name,pass,birthdate) VALUES(?,?,?,?)')
    .run(em, String(name || '').slice(0, 80), await bcrypt.hash(password, 12), birthdate);
  startSession(res, r.lastInsertRowid);
  res.json({ ok: true });
}));
app.post('/api/login', authLimiter, asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  const u = typeof email === 'string' ? db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()) : null;
  const ok = await bcrypt.compare(String(password || ''), u ? u.pass : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!u || !ok) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  startSession(res, u.id);
  res.json({ ok: true, role: u.role });
}));
app.post('/api/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(req.cookies.sid));
  res.clearCookie('sid'); res.json({ ok: true });
});
app.post('/api/forgot', slowLimiter, asyncH(async (req, res) => {
  const u = isEmail(req.body && req.body.email) ? db.prepare('SELECT id,email FROM users WHERE email=?').get(req.body.email.toLowerCase()) : null;
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO resets(token_hash,user_id,expires) VALUES(?,?,?)').run(sha(token), u.id, now() + 3600);
    await sendMail(u.email, 'Redefinição de senha', `Para criar uma nova senha, acesse (válido por 1 hora):\n${BASE_URL}/redefinir.html?token=${token}\n\nSe não foi você, ignore este e-mail.`);
  }
  res.json({ ok: true }); // resposta idêntica, exista ou não a conta
}));
app.post('/api/reset', slowLimiter, asyncH(async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'A senha deve ter entre 8 e 128 caracteres.' });
  const r = db.prepare('SELECT * FROM resets WHERE token_hash=?').get(sha(String(token || '')));
  if (!r || r.expires < now()) return res.status(400).json({ error: 'Link inválido ou expirado.' });
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(await bcrypt.hash(password, 12), r.user_id);
  db.prepare('DELETE FROM resets WHERE user_id=?').run(r.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id);
  res.json({ ok: true });
}));

/* ---------- Conta / assinatura ---------- */
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user, access: req.user.role === 'admin' ? { active: true, vip: true, plan_name: 'Administrador' } : accessOf(req.user.id) });
});
app.get('/api/me/payments', needUser, (req, res) => res.json(db.prepare(
  `SELECT p.created_at, p.amount_cents, p.status, p.reference, pl.name plan FROM payments p LEFT JOIN plans pl ON pl.id=p.plan_id
   WHERE p.user_id=? ORDER BY p.id DESC`).all(req.user.id)));
app.post('/api/me/password', needUser, authLimiter, asyncH(async (req, res) => {
  const { current, password } = req.body || {};
  const u = db.prepare('SELECT pass FROM users WHERE id=?').get(req.user.id);
  if (!(await bcrypt.compare(String(current || ''), u.pass))) return res.status(401).json({ error: 'Senha atual incorreta.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'A nova senha deve ter entre 8 e 128 caracteres.' });
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(await bcrypt.hash(password, 12), req.user.id);
  res.json({ ok: true });
}));
app.post('/api/subscription/cancel', needUser, asyncH(async (req, res) => {
  const s = db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(req.user.id);
  if (!s || s.status !== 'active') return res.status(400).json({ error: 'Não há renovação ativa para cancelar.' });
  await pay.cancelRecurring(req.user, s);
  db.prepare("UPDATE subscriptions SET status='canceled',updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(req.user.id);
  res.json({ ok: true, until: s.expires_at });
}));
app.delete('/api/me', needUser, authLimiter, asyncH(async (req, res) => {
  if (req.user.role === 'admin') return res.status(400).json({ error: 'Contas de administrador não podem ser encerradas aqui.' });
  const u = db.prepare('SELECT pass FROM users WHERE id=?').get(req.user.id);
  if (!(await bcrypt.compare(String((req.body || {}).password || ''), u.pass))) return res.status(401).json({ error: 'Senha incorreta.' });
  const s = db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(req.user.id);
  if (s && s.status === 'active') await pay.cancelRecurring(req.user, s);
  db.prepare('DELETE FROM users WHERE id=?').run(req.user.id); // cascata remove sessões, assinatura e pagamentos
  res.clearCookie('sid'); res.json({ ok: true });
}));

/* ---------- Checkout ---------- */
function priceWithCoupon(plan, code) {
  let price = plan.price_cents, coupon = null;
  if (code) {
    const c = db.prepare('SELECT * FROM coupons WHERE code=? AND active=1').get(String(code).trim().toUpperCase());
    if (!c || (c.max_uses > 0 && c.uses >= c.max_uses)) return { error: 'Cupom inválido ou esgotado.' };
    price = Math.round(plan.price_cents * (100 - c.percent_off) / 100); coupon = c.code;
  }
  return { price, coupon };
}
app.post('/api/coupon', needUser, (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get((req.body || {}).plan_id);
  if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });
  const r = priceWithCoupon(plan, (req.body || {}).coupon);
  r.error ? res.status(400).json({ error: r.error }) : res.json({ price_cents: r.price });
});
app.post('/api/checkout', needUser, (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get((req.body || {}).plan_id);
  if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });
  const r = priceWithCoupon(plan, (req.body || {}).coupon);
  if (r.error) return res.status(400).json({ error: r.error });
  const url = pay.checkoutUrl(plan, req.user, { price: r.price, coupon: r.coupon });
  if (!url) return res.status(503).json({ error: 'Pagamentos ainda não configurados. O administrador precisa informar o link de checkout do plano.' });
  if (r.coupon) db.prepare('UPDATE coupons SET uses=uses+1 WHERE code=?').run(r.coupon);
  res.json({ url });
});

/* ---------- Conteúdo (controle de acesso no servidor) ---------- */
app.get('/api/content', needUser, needSub, (req, res) => {
  const rows = db.prepare('SELECT id,title,kind,vip_only,ai_generated,created_at FROM content WHERE published=1 ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, locked: !!r.vip_only && !req.access.vip })));
});
app.get('/media/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM content WHERE id=?').get(+req.params.id);
  if (!c) return res.status(404).end();
  if (!(c.is_preview && c.published)) {
    if (!req.user) return res.status(401).end();
    if (req.user.role !== 'admin') {
      const a = accessOf(req.user.id);
      if (!a.active || !c.published || (c.vip_only && !a.vip)) return res.status(403).end();
    }
  }
  const file = path.join(UPLOAD_DIR, path.basename(c.file));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set({ 'Cache-Control': c.is_preview ? 'public, max-age=3600' : 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': c.mime });
  res.sendFile(file); // suporta Range para vídeos
});

/* ---------- Admin ---------- */
const MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + MIME[f.mimetype]) }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (r, f, cb) => cb(MIME[f.mimetype] ? null : new Error('Tipo de arquivo não permitido (use JPG, PNG, WEBP, MP4 ou WEBM).'), !!MIME[f.mimetype]),
});
const admin = express.Router();
admin.use(needAdmin);

admin.get('/settings', (req, res) => res.json(getSettings()));
admin.put('/settings', (req, res) => {
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.transaction(() => { for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof (req.body || {})[k] === 'string') up.run(k, req.body[k].slice(0, 20000)); })();
  res.json({ ok: true });
});
admin.get('/plans', (req, res) => res.json(db.prepare('SELECT * FROM plans ORDER BY sort,id').all()));
admin.post('/plans', (req, res) => {
  const b = req.body || {};
  const row = [String(b.name || '').slice(0, 60), b.price_cents | 0, Math.max(1, b.duration_days | 0), JSON.stringify(Array.isArray(b.benefits) ? b.benefits.map(String) : []),
    b.vip ? 1 : 0, String(b.checkout_url || ''), String(b.renewal_text || ''), String(b.cancel_text || ''), b.active ? 1 : 0, b.sort | 0];
  if (!row[0] || row[1] < 0) return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
  if (b.id) db.prepare('UPDATE plans SET name=?,price_cents=?,duration_days=?,benefits=?,vip=?,checkout_url=?,renewal_text=?,cancel_text=?,active=?,sort=? WHERE id=?').run(...row, b.id);
  else db.prepare('INSERT INTO plans(name,price_cents,duration_days,benefits,vip,checkout_url,renewal_text,cancel_text,active,sort) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...row);
  res.json({ ok: true });
});
admin.get('/content', (req, res) => res.json(db.prepare('SELECT * FROM content ORDER BY id DESC').all()));
admin.post('/content', (req, res, next) => upload.single('file')(req, res, err => err ? res.status(400).json({ error: err.message }) : next()), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const b = req.body;
  if (b.rights !== 'on' && b.rights !== 'true') { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'Confirme que possui os direitos/autorização de uso do conteúdo.' }); }
  const kind = req.file.mimetype.startsWith('video') ? 'video' : 'photo';
  const hero = b.hero === 'on' || b.hero === 'true';
  const r = db.prepare('INSERT INTO content(title,kind,file,mime,is_preview,vip_only,ai_generated) VALUES(?,?,?,?,?,?,?)')
    .run(String(b.title || '').slice(0, 120), kind, req.file.filename, req.file.mimetype,
      (hero || b.is_preview === 'on') ? 1 : 0, b.vip_only === 'on' ? 1 : 0, b.ai_generated === 'on' ? 1 : 0);
  if (hero && kind === 'photo') db.prepare("INSERT INTO settings(key,value) VALUES('hero_content_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(r.lastInsertRowid));
  res.json({ ok: true, id: r.lastInsertRowid });
});
admin.patch('/content/:id', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE content SET title=COALESCE(?,title),is_preview=COALESCE(?,is_preview),vip_only=COALESCE(?,vip_only),published=COALESCE(?,published) WHERE id=?')
    .run(b.title ?? null, b.is_preview == null ? null : +!!b.is_preview, b.vip_only == null ? null : +!!b.vip_only, b.published == null ? null : +!!b.published, +req.params.id);
  res.json({ ok: true });
});
admin.delete('/content/:id', (req, res) => {
  const c = db.prepare('SELECT file FROM content WHERE id=?').get(+req.params.id);
  if (c) { fs.unlink(path.join(UPLOAD_DIR, path.basename(c.file)), () => {}); db.prepare('DELETE FROM content WHERE id=?').run(+req.params.id); }
  res.json({ ok: true });
});
admin.get('/subscribers', (req, res) => res.json(db.prepare(
  `SELECT u.id,u.email,u.name,u.created_at,s.status,s.expires_at,p.name plan,
     (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE user_id=u.id AND status='paid') total_cents
   FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id LEFT JOIN plans p ON p.id=s.plan_id
   WHERE u.role='user' ORDER BY u.id DESC LIMIT 500`).all()));
admin.get('/coupons', (req, res) => res.json(db.prepare('SELECT * FROM coupons ORDER BY code').all()));
admin.post('/coupons', (req, res) => {
  const b = req.body || {}, code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code) || !(b.percent_off >= 1 && b.percent_off <= 100)) return res.status(400).json({ error: 'Código (3-30 letras/números) e desconto (1-100%) obrigatórios.' });
  db.prepare('INSERT INTO coupons(code,percent_off,max_uses,active) VALUES(?,?,?,1) ON CONFLICT(code) DO UPDATE SET percent_off=excluded.percent_off,max_uses=excluded.max_uses,active=excluded.active')
    .run(code, b.percent_off | 0, b.max_uses | 0);
  res.json({ ok: true });
});
admin.delete('/coupons/:code', (req, res) => { db.prepare('DELETE FROM coupons WHERE code=?').run(req.params.code); res.json({ ok: true }); });
app.use('/api/admin', needUser, admin);

/* ---------- Estáticos ---------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: PROD ? '1h' : 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'não encontrado' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erro interno.' }); });

if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => console.log('Servidor em ' + BASE_URL));
}
module.exports = { app, db };
