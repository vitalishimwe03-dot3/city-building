const crypto = require('crypto');
const pool = require('../db');

const DAY_MS = 24 * 60 * 60 * 1000;
const ZERO_DECIMAL_CURRENCIES = ['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'CLP', 'XOF', 'XAF', 'KMF', 'DJF'];

function formatAmount(amount, currency) {
  const code = String(currency || 'RWF').toUpperCase();
  const value = Number(amount) || 0;
  if (ZERO_DECIMAL_CURRENCIES.includes(code)) {
    return value.toLocaleString('en-US') + ' ' + code;
  }
  return (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + code;
}

function toSqlDate(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

function nowSql() {
  return toSqlDate(Date.now());
}

function addDaysSql(days) {
  return toSqlDate(Date.now() + Number(days || 0) * DAY_MS);
}

function parseDbDate(value) {
  if (!value) return null;
  const text = String(value);
  const iso = text.includes('T') ? text : text.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

function parseFeatures(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(value).split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  }
}

function decoratePlan(plan) {
  if (!plan) return null;
  return Object.assign({}, plan, {
    features: parseFeatures(plan.features),
    price: Number(plan.price_cents) || 0,
    is_free: !Number(plan.price_cents)
  });
}

function decorateSubscription(row) {
  if (!row) {
    return {
      status: 'free',
      is_pro: false,
      plan_name: 'Starter',
      plan_slug: 'starter',
      days_left: 0
    };
  }
  const now = Date.now();
  const periodEnd = parseDbDate(row.current_period_end);
  const trialEnd = parseDbDate(row.trial_ends_at);
  const end = row.status === 'trialing' ? trialEnd : periodEnd;
  const expired = row.status !== 'canceled' && end ? end.getTime() <= now : false;
  const isPro = !expired && ['active', 'trialing', 'canceled'].includes(row.status) && !!end && end.getTime() > now;
  const daysLeft = end ? Math.max(0, Math.ceil((end.getTime() - now) / DAY_MS)) : 0;
  return Object.assign({}, row, {
    features: parseFeatures(row.features),
    is_pro: isPro,
    is_expired: expired,
    effective_status: expired ? 'expired' : row.status,
    days_left: daysLeft,
    plan_price: Number(row.price_cents) || 0
  });
}

async function getPlans() {
  const [rows] = await pool.query('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  return (rows || []).map(decoratePlan);
}

async function getPlanById(id) {
  const [[row]] = await pool.query('SELECT * FROM plans WHERE id = ? AND is_active = 1 LIMIT 1', [id]);
  return decoratePlan(row);
}

async function getPlanBySlug(slug) {
  const [[row]] = await pool.query('SELECT * FROM plans WHERE slug = ? AND is_active = 1 LIMIT 1', [slug]);
  return decoratePlan(row);
}

async function getRawSubscription(userId) {
  const [[row]] = await pool.query(
    `SELECT s.*, p.name AS plan_name, p.slug AS plan_slug, p.description AS plan_description,
            p.price_cents, p.currency, p.billing_interval, p.duration_days, p.trial_days, p.features
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = ?
     ORDER BY s.id DESC
     LIMIT 1`,
    [userId]
  );
  return row || null;
}

async function getUserSubscription(userId) {
  return decorateSubscription(await getRawSubscription(userId));
}

async function hasUsedTrial(userId) {
  const [[row]] = await pool.query('SELECT trial_used FROM users WHERE id = ?', [userId]);
  return !!(row && row.trial_used);
}

async function getUserPayments(userId) {
  const [rows] = await pool.query(
    `SELECT pay.*, p.name AS plan_name, p.slug AS plan_slug
     FROM payments pay
     JOIN plans p ON p.id = pay.plan_id
     WHERE pay.user_id = ?
     ORDER BY pay.created_at DESC, pay.id DESC
     LIMIT 50`,
    [userId]
  );
  return rows || [];
}

async function getUserBillingSummary(userId) {
  const [subscription, payments, plans, trialUsed] = await Promise.all([
    getUserSubscription(userId),
    getUserPayments(userId),
    getPlans(),
    hasUsedTrial(userId)
  ]);
  return { subscription, payments, plans, trialUsed };
}

async function startTrial(userId, plan) {
  if (!plan || !plan.trial_days) {
    const err = new Error('This plan does not include a free trial.');
    err.code = 'NO_TRIAL';
    throw err;
  }
  if (await hasUsedTrial(userId)) {
    const err = new Error('You have already used your free trial.');
    err.code = 'TRIAL_USED';
    throw err;
  }
  const current = await getUserSubscription(userId);
  if (current.is_pro) {
    const err = new Error('You already have an active plan.');
    err.code = 'ALREADY_ACTIVE';
    throw err;
  }

  const trialEnd = addDaysSql(plan.trial_days);
  const [result] = await pool.query(
    `INSERT INTO subscriptions (user_id, plan_id, status, provider, started_at, trial_ends_at, current_period_end)
     VALUES (?, ?, 'trialing', 'manual', ?, ?, ?)`,
    [userId, plan.id, nowSql(), trialEnd, trialEnd]
  );
  await pool.query('UPDATE users SET trial_used = 1 WHERE id = ?', [userId]);
  return { subscriptionId: result.insertId, trialEnd };
}

async function createPendingPayment(userId, plan, method, reference) {
  const [result] = await pool.query(
    `INSERT INTO payments (user_id, plan_id, amount, currency, status, provider, method, reference)
     VALUES (?, ?, ?, ?, 'pending', 'manual', ?, ?)`,
    [userId, plan.id, plan.price, plan.currency, method || 'mobile_money', reference || '']
  );
  return getPaymentById(result.insertId);
}

async function getPaymentById(id) {
  const [[row]] = await pool.query(
    `SELECT pay.*, p.name AS plan_name, p.slug AS plan_slug, p.duration_days, p.trial_days,
            u.full_name AS user_name, u.email AS user_email
     FROM payments pay
     JOIN plans p ON p.id = pay.plan_id
     JOIN users u ON u.id = pay.user_id
     WHERE pay.id = ?
     LIMIT 1`,
    [id]
  );
  return row || null;
}

async function activatePlanForUser(userId, plan, options) {
  const opts = options || {};
  const existing = await getRawSubscription(userId);
  const now = Date.now();
  let base = now;
  if (existing && ['active', 'trialing', 'canceled'].includes(existing.status)) {
    const periodEnd = parseDbDate(existing.current_period_end);
    if (periodEnd && periodEnd.getTime() > base) base = periodEnd.getTime();
  }
  const periodEnd = toSqlDate(base + Number(plan.duration_days || 30) * DAY_MS);
  let subscriptionId;

  if (existing) {
    subscriptionId = existing.id;
    await pool.query(
      `UPDATE subscriptions
       SET plan_id = ?, status = 'active', provider = ?, provider_ref = ?,
           started_at = COALESCE(started_at, ?), trial_ends_at = NULL,
           current_period_end = ?, cancel_at_period_end = 0, canceled_at = NULL, updated_at = ?
       WHERE id = ?`,
      [plan.id, opts.provider || 'manual', opts.providerRef || null, nowSql(), periodEnd, nowSql(), existing.id]
    );
  } else {
    const [result] = await pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, provider, provider_ref, started_at, current_period_end)
       VALUES (?, ?, 'active', ?, ?, ?, ?)`,
      [userId, plan.id, opts.provider || 'manual', opts.providerRef || null, nowSql(), periodEnd]
    );
    subscriptionId = result.insertId;
  }

  return { subscriptionId, currentPeriodEnd: periodEnd };
}

async function markPaymentPaid(paymentId, options) {
  const opts = options || {};
  const payment = await getPaymentById(paymentId);
  if (!payment) return null;
  if (payment.status === 'paid') return payment;
  const plan = await getPlanById(payment.plan_id);
  if (!plan) return null;

  const activation = await activatePlanForUser(payment.user_id, plan, {
    provider: opts.provider || payment.provider || 'manual',
    providerRef: opts.providerRef || payment.provider_ref || null
  });

  await pool.query(
    `UPDATE payments
     SET status = 'paid', subscription_id = ?, reference = COALESCE(NULLIF(?, ''), reference),
         notes = COALESCE(NULLIF(?, ''), notes), paid_at = ?, provider = ?, updated_at = ?
     WHERE id = ?`,
    [activation.subscriptionId, opts.reference || '', opts.notes || '', nowSql(), opts.provider || payment.provider || 'manual', nowSql(), paymentId]
  );

  return getPaymentById(paymentId);
}

async function updatePaymentReference(paymentId, method, reference, notes) {
  await pool.query(
    `UPDATE payments SET method = ?, reference = ?, notes = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
    [method || 'mobile_money', reference || '', notes || '', nowSql(), paymentId]
  );
}

async function rejectPayment(paymentId, notes) {
  await pool.query(
    `UPDATE payments SET status = 'failed', notes = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
    [notes || 'Payment could not be verified.', nowSql(), paymentId]
  );
}

async function cancelSubscription(userId) {
  await pool.query(
    `UPDATE subscriptions
     SET cancel_at_period_end = 1, canceled_at = ?, updated_at = ?
     WHERE user_id = ? AND status IN ('active', 'trialing')`,
    [nowSql(), nowSql(), userId]
  );
}

async function resumeSubscription(userId) {
  await pool.query(
    `UPDATE subscriptions
     SET cancel_at_period_end = 0, canceled_at = NULL, updated_at = ?
     WHERE user_id = ? AND status IN ('active', 'trialing')`,
    [nowSql(), userId]
  );
}

async function getAllSubscriptions() {
  const [rows] = await pool.query(
    `SELECT s.*, u.full_name AS user_name, u.email AS user_email,
            p.name AS plan_name, p.slug AS plan_slug, p.price_cents, p.currency
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN plans p ON p.id = s.plan_id
     ORDER BY s.created_at DESC, s.id DESC`
  );
  return (rows || []).map(decorateSubscription);
}

async function getAllPayments(status) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE pay.status = ?';
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT pay.*, u.full_name AS user_name, u.email AS user_email,
            p.name AS plan_name, p.slug AS plan_slug
     FROM payments pay
     JOIN users u ON u.id = pay.user_id
     JOIN plans p ON p.id = pay.plan_id
     ${where}
     ORDER BY pay.created_at DESC, pay.id DESC
     LIMIT 200`,
    params
  );
  return rows || [];
}

async function getBillingStats() {
  const [[active]] = await pool.query(
    "SELECT COUNT(*) AS total FROM subscriptions WHERE status IN ('active', 'trialing')"
  );
  const [[trials]] = await pool.query("SELECT COUNT(*) AS total FROM subscriptions WHERE status = 'trialing'");
  const [[pending]] = await pool.query("SELECT COUNT(*) AS total FROM payments WHERE status = 'pending'");
  const [revenue] = await pool.query(
    "SELECT currency, SUM(amount) AS total FROM payments WHERE status = 'paid' GROUP BY currency"
  );
  const [revenue30] = await pool.query(
    "SELECT currency, SUM(amount) AS total FROM payments WHERE status = 'paid' AND paid_at >= datetime('now', '-30 days') GROUP BY currency"
  );
  return {
    activeSubscriptions: active?.total || 0,
    trials: trials?.total || 0,
    pendingPayments: pending?.total || 0,
    revenue: revenue || [],
    revenue30: revenue30 || []
  };
}

// ---------- Stripe (optional) ----------

function stripeEnabled() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'));
}

async function stripeRequest(path, method, body) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: method || 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body ? body.toString() : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Stripe request failed.';
    throw new Error(message);
  }
  return data;
}

async function createStripeCheckout(userId, plan, baseUrl) {
  if (!stripeEnabled()) throw new Error('Stripe is not configured.');
  const amount = plan.stripe_price_cents || plan.price_cents;
  const currency = plan.stripe_currency || 'usd';
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', baseUrl + '/billing/success?session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', baseUrl + '/pricing?canceled=1');
  params.append('client_reference_id', String(userId));
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', currency);
  params.append('line_items[0][price_data][unit_amount]', String(amount));
  params.append('line_items[0][price_data][product_data][name]', plan.name + ' - City Building Engineering');
  params.append('metadata[user_id]', String(userId));
  params.append('metadata[plan_id]', String(plan.id));
  params.append('metadata[plan_slug]', plan.slug);
  return stripeRequest('checkout/sessions', 'POST', params);
}

async function retrieveStripeSession(sessionId) {
  return stripeRequest('checkout/sessions/' + encodeURIComponent(sessionId), 'GET');
}

async function recordStripeSession(session) {
  if (!session || session.payment_status !== 'paid') return null;
  const userId = Number(session.metadata?.user_id || session.client_reference_id);
  const planId = Number(session.metadata?.plan_id);
  if (!userId || !planId) return null;

  const [[existing]] = await pool.query('SELECT id FROM payments WHERE provider_ref = ? LIMIT 1', [session.id]);
  if (existing) return existing.id;

  const plan = await getPlanById(planId);
  if (!plan) return null;

  const activation = await activatePlanForUser(userId, plan, {
    provider: 'stripe',
    providerRef: session.id
  });

  const [result] = await pool.query(
    `INSERT INTO payments (user_id, subscription_id, plan_id, amount, currency, status, provider, provider_ref, method, paid_at)
     VALUES (?, ?, ?, ?, ?, 'paid', 'stripe', ?, 'card', ?)`,
    [userId, activation.subscriptionId, planId, Number(session.amount_total) || plan.price, String(session.currency || 'usd').toUpperCase(), session.id, nowSql()]
  );
  return result.insertId;
}

function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(',').reduce(function (acc, part) {
    const pair = part.split('=');
    if (pair.length === 2) acc[pair[0]] = pair[1];
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + payload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleStripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeEnabled() || !secret) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' });
  }
  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (!verifyStripeSignature(payload, req.headers['stripe-signature'], secret)) {
    return res.status(400).json({ error: 'Invalid Stripe signature.' });
  }
  try {
    const event = JSON.parse(payload);
    if (event.type === 'checkout.session.completed') {
      await recordStripeSession(event.data.object);
    }
    return res.json({ received: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  formatAmount,
  getPlans,
  getPlanById,
  getPlanBySlug,
  getUserSubscription,
  getUserBillingSummary,
  getUserPayments,
  hasUsedTrial,
  startTrial,
  createPendingPayment,
  getPaymentById,
  activatePlanForUser,
  markPaymentPaid,
  updatePaymentReference,
  rejectPayment,
  cancelSubscription,
  resumeSubscription,
  getAllSubscriptions,
  getAllPayments,
  getBillingStats,
  stripeEnabled,
  createStripeCheckout,
  retrieveStripeSession,
  recordStripeSession,
  handleStripeWebhook
};
