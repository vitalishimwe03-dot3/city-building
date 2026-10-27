require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const passport = require('./src/config/passport');
const pool = require('./src/db');
const initDb = require('./src/models/initDb');
const { setAdminLocals } = require('./src/middleware/auth');
const { localizationMiddleware } = require('./src/localization');
const adConfig = require('./src/config/ads');
const billing = require('./src/routes/billing');
const Billing = require('./src/models/Billing');
const logger = require('./src/logger');

const app = express();
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, 'public')));
// Stripe webhooks must receive the raw body, so register before JSON parsing.
app.post('/billing/stripe-webhook', express.raw({ type: 'application/json' }), Billing.handleStripeWebhook);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://pagead2.googlesyndication.com', 'https://www.googletagmanager.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://pagead2.googlesyndication.com'],
  connectSrc: ["'self'", 'https://pagead2.googlesyndication.com'],
  frameSrc: ["'self'", 'https://www.google.com'],
  objectSrc: ["'none'"]
};

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'city-building-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 4 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());

app.use(setAdminLocals);
app.use(localizationMiddleware);
app.use(billing.attachBilling);

app.use((req, res, next) => {
  req.pool = pool;
  const proto = req.protocol;
  const host = req.get('host');
  res.locals.canonicalUrl = `${proto}://${host}${req.originalUrl}`;
  res.locals.reqProtocol = proto;
  res.locals.reqHost = host;
  res.locals.currentPath = req.path;
  res.locals.metaDescription = 'City Building Engineering Company Ltd offers professional software training in Revit, AutoCAD, ETABS, Lumion and more. Enroll in Kigali, Rwanda for career-ready engineering and design courses.';
  const adsForPro = res.locals.isPro ? Object.assign({}, adConfig, {
    adsenseEnabled: false,
    affiliateEnabled: false,
    leadGenEnabled: false,
    cpeEnabled: false,
    showTopBanner: false,
    showFooterBanner: false,
    showInContent: false,
    showAffiliate: false,
    showSponsored: false
  }) : adConfig;
  res.locals.adConfig = adsForPro;
  const gId = process.env.GOOGLE_CLIENT_ID;
  res.locals.googleAuthEnabled = !!(gId && gId !== 'your-google-client-id.apps.googleusercontent.com' && process.env.GOOGLE_CLIENT_SECRET);
  next();
});

app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /account/\nDisallow: /billing/\nDisallow: /login\nDisallow: /signup\nDisallow: /logout\nDisallow: /verify-otp\n\nSitemap: ${base}/sitemap.xml\n`);
});

app.get('/google7qR302reJ6yBRijxdhL35_lYWBhNEoYYF31a_xZ8YRo.html', (req, res) => {
  res.type('text/html').send('google-site-verification: 7qR302reJ6yBRijxdhL35_lYWBhNEoYYF31a_xZ8YRo');
});

app.get('/9f7b3c8a2e4d6f901234567890abcdef.txt', (req, res) => {
  res.type('text/plain').send('9f7b3c8a2e4d6f901234567890abcdef');
});

app.get('/indexnow', async (req, res) => {
  const https = require('https');
  const key = '9f7b3c8a2e4d6f901234567890abcdef';
  const host = req.get('host');
  const urls = [
    `https://${host}/`,
    `https://${host}/about`,
    `https://${host}/services`,
    `https://${host}/contact`,
    `https://${host}/pricing`,
    `https://${host}/certificate`,
    `https://${host}/career`,
    `https://${host}/faq`,
    `https://${host}/internship`,
    `https://${host}/gallery`,
    `https://${host}/alumni`
  ];
  const data = JSON.stringify({
    host: host,
    key: key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: urls
  });
  const options = {
    hostname: 'api.indexnow.org',
    path: '/indexnow',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  const request = https.request(options, (response) => {
    res.json({ success: true, status: response.statusCode, urls: urls.length });
  });
  request.on('error', (err) => {
    res.status(500).json({ success: false, error: err.message });
  });
  request.write(data);
  request.end();
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const [cats] = await pool.query('SELECT slug, created_at FROM categories');
    const [courses] = await pool.query('SELECT id, slug, created_at FROM subcourses');
    let urls = '';
    const base = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    const pages = [
      { path: '', changefreq: 'weekly', priority: '1.0' },
      { path: '/about', changefreq: 'monthly', priority: '0.9' },
      { path: '/services', changefreq: 'monthly', priority: '0.9' },
      { path: '/contact', changefreq: 'monthly', priority: '0.8' },
      { path: '/certificate', changefreq: 'monthly', priority: '0.8' },
      { path: '/career', changefreq: 'monthly', priority: '0.8' },
      { path: '/faq', changefreq: 'monthly', priority: '0.7' },
      { path: '/internship', changefreq: 'monthly', priority: '0.8' },
      { path: '/pricing', changefreq: 'monthly', priority: '0.8' },
      { path: '/gallery', changefreq: 'weekly', priority: '0.7' },
      { path: '/alumni', changefreq: 'monthly', priority: '0.7' },
      { path: '/quiz', changefreq: 'monthly', priority: '0.6' },
      { path: '/free-course', changefreq: 'monthly', priority: '0.7' },
      { path: '/verify-certificate', changefreq: 'monthly', priority: '0.6' }
    ];
    pages.forEach(p => { urls += `<url><loc>${base}${p.path}</loc><lastmod>${now}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>\n`; });
    (cats || []).forEach(c => { if (c.slug) { const lm = c.created_at ? new Date(c.created_at).toISOString() : now; urls += `<url><loc>${base}/category/${c.slug}</loc><lastmod>${lm}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`; } });
    (courses || []).forEach(c => { if (c.id) { const lm = c.created_at ? new Date(c.created_at).toISOString() : now; urls += `<url><loc>${base}/course/${c.id}</loc><lastmod>${lm}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`; } });
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  } catch (err) {
    next(err);
  }
});

app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/auth'));
app.use('/', billing.router);
app.use('/admin', require('./src/routes/admin'));
app.use('/admin/images', require('./src/routes/admin-images'));
app.use('/admin/slides', require('./src/routes/admin-slides'));
app.use('/api', require('./src/routes/api'));
app.use('/api', require('./src/routes/api-images'));

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page not found', message: 'The page you are looking for does not exist.' });
});

app.use((err, req, res, next) => {
  if (err && Array.isArray(err.errors)) {
    logger.error({ err: { message: 'AggregateError', errors: err.errors.map(e => e.message) } }, 'Request failed with aggregate errors');
  } else {
    logger.error({ err }, 'Unhandled request error');
  }
  if (process.env.NODE_ENV !== 'production') {
    const details = (err && Array.isArray(err.errors)) ? err.errors.map(e => e.stack || e.message).join('\n---\n') : (err.stack || err.message || String(err));
    res.status(500).send(`<h1>Server error</h1><pre>${details}</pre>`);
    return;
  }
  res.status(500).render('404', { title: 'Server error', message: 'Something unexpected happened. Please try again later.' });
});

const port = process.env.PORT || 3000;

logger.info({ dir: __dirname }, 'Starting server...');
initDb.init()
  .then(() => {
    app.listen(port, function() {
      logger.info({ port }, 'Server listening');
    });
  })
  .catch(function(err) {
    logger.fatal({ err }, 'Failed to initialize database, exiting.');
    process.exit(1);
  });

module.exports = app;
