// ── Auth Routes (Redesigned OTP Flow - Self-Contained) ──
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const passport = require('../config/passport');
const SiteUser = require('../models/SiteUser');
const User = require('../models/User');
const { sendNewStudentNotification, sendUserPasswordResetEmail, sendAdminPasswordResetEmail, sendOtpEmail } = require('../email');
const { validatePasswordStrength } = require('../utils/password');

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many signup attempts, please try again after an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const resendOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { error: 'Too many resend attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Signup ──
router.get('/signup', (req, res) => {
  res.render('signup', { title: 'Sign up' });
});

router.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const { fullName, email, phone, password, confirmPassword } = req.body;
    if (!fullName || !email || !password || password !== confirmPassword) {
      return res.status(400).render('signup', { title: 'Sign up', error: 'Please provide valid details and matching passwords.' });
    }
    const strengthErrors = validatePasswordStrength(password);
    if (strengthErrors.length > 0) {
      return res.status(400).render('signup', { title: 'Sign up', error: 'Password must include: ' + strengthErrors.join(', ') + '.' });
    }
    const exists = await SiteUser.getUserByEmail(email);
    if (exists) return res.status(400).render('signup', { title: 'Sign up', error: 'Email already registered.' });
    await SiteUser.createUser(fullName, email, phone, password);
    const otp = SiteUser.generateOtp();
    await SiteUser.createOtp(email, otp);
    sendOtpEmail(email, otp).catch(e => console.error('Failed to send OTP email:', e));
    sendNewStudentNotification({ fullName, email, phone }).catch(e => {
      console.error('Failed to send new-student notification:', e);
    });
    res.redirect(`/verify-email?email=${encodeURIComponent(email)}&generated=true`);
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(503).render('signup', { title: 'Sign up', error: 'Signup service is temporarily unavailable. Please try again later.' });
  }
});

// ── Email Verification ──
router.get('/verify-email', (req, res) => {
  const { email, pending, generated, showCode } = req.query;
  if (!email) return res.redirect('/signup');
  res.render('verify-email', { title: 'Verify Email', email, pending, generated, showCode, error: null, success: null });
});

router.post('/verify-email', otpLimiter, async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.render('verify-email', { title: 'Verify Email', email, error: 'Missing email or verification code.', success: null });
    }
    const valid = await SiteUser.verifyOtp(email, otp);
    if (!valid) {
      return res.render('verify-email', { title: 'Verify Email', email, error: 'Invalid or expired verification code. Please try again or request a new code.', success: null });
    }
    res.render('verify-email', { title: 'Verify Email', email, error: null, success: 'Email verified successfully! You can now log in.' });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-otp', resendOtpLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await SiteUser.getUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Email not found' });
    if (user.is_verified) return res.status(400).json({ error: 'Email already verified' });
    const otp = await SiteUser.resendOtp(email);
    if (!otp) return res.status(400).json({ error: 'Unable to resend code' });
    sendOtpEmail(email, otp).catch(e => console.error('Failed to resend OTP:', e));
    // Return OTP in response for self-contained verification (no external email dependency)
    return res.json({ success: true, message: 'Verification code sent.', otp: otp });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

// Get OTP directly (for self-contained verification)
router.post('/get-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await SiteUser.getUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Email not found' });
    if (user.is_verified) return res.status(400).json({ error: 'Email already verified' });
    const otp = await SiteUser.resendOtp(email);
    if (!otp) return res.status(400).json({ error: 'Unable to generate code' });
    return res.json({ success: true, otp: otp });
  } catch (err) {
    console.error('Get OTP error:', err);
    res.status(500).json({ error: 'Failed to generate code' });
  }
});

function safeNext(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/admin')) return value;
  return null;
}

// ── Login ──
router.get('/login', (req, res) => {
  res.render('login', { title: 'Login', next: safeNext(req.query.next) });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const nextUrl = safeNext(req.body.next || req.query.next);
    if (!email || !password) return res.status(400).render('login', { title: 'Login', error: 'Email and password required.', next: nextUrl });
    // 1. Try admin authentication first
    const admin = await User.verifyUser(email, password);
    if (admin) {
      if (!admin.is_active) {
        return res.status(403).render('login', { title: 'Login', error: 'This account has been deactivated. Contact your administrator.' });
      }
      if (!admin.role || !['admin', 'super_admin', 'superadmin'].includes(admin.role)) {
        return res.status(403).render('login', { title: 'Login', error: 'Your account does not have admin privileges.' });
      }
      req.session.regenerate(function(err) {
        if (err) return next(err);
        req.session.userId = admin.id;
        req.session.adminUser = admin;
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        req.session.createdAt = Date.now();
        res.redirect('/admin/dashboard');
      });
      return;
    }
    // 2. Try student authentication
    const user = await SiteUser.verifyUser(email, password);
    if (!user) return res.status(401).render('login', { title: 'Login', error: 'Invalid credentials.' });
    if (user.googleOnly) {
      return res.status(401).render('login', { title: 'Login', error: 'This account uses Google sign-in. Please click "Continue with Gmail" below to log in.' });
    }
    if (!user.is_verified) {
      await SiteUser.resendOtp(email).catch(() => {});
      return res.redirect(`/verify-email?email=${encodeURIComponent(email)}&pending=true`);
    }
    if (!user.is_active) {
      return res.status(403).render('login', { title: 'Login', error: 'This account has been deactivated.' });
    }
    req.session.regenerate(function(err) {
      if (err) return next(err);
      req.session.siteUser = { id: user.id, email: user.email, full_name: user.full_name };
      req.session.userLanguage = user.language || 'en';
      if (!req.session.csrfToken) req.ses

module.exports = router;
      if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.redirect(nextUrl || '/');
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(503).render('login', { title: 'Login', error: 'Login service is temporarily unavailable. Please try again later.' });
  }
});

// ── Google OAuth (only if configured) ──
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CLIENT_ID.includes('your-google-client-id')) {
  router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      if (!req.user) return res.redirect('/login');
      req.session.regenerate(function(err) {
        if (err) return res.redirect('/login');
        req.session.siteUser = { id: req.user.id, email: req.user.email, full_name: req.user.full_name };
        req.session.userLanguage = req.user.language || 'en';
        if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        res.redirect('/');
      });
    }
  );
} else {
  router.get('/auth/google', (req, res) => {
    res.render('login', { title: 'Login', error: 'Google sign-in is not configured. Please sign in with email and password or use the verification code.', next: safeNext(req.query.next) });
  });
}

// ── Logout ──
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => { res.redirect('/'); });
  } else {
    res.redirect('/');
  }
});

// ── Account ──
router.get('/account', async (req, res) => {
  if (!req.session.siteUser) return res.redirect('/login');
  const SiteUserModel = require('../models/SiteUser');
  const user = await SiteUserModel.getUserById(req.session.siteUser.id);
  res.render('account', { title: 'Account Settings', user, error: null, success: null, dashboardNews: [], csrfToken: req.session?.csrfToken });
});

module.exports = router;
