const express = require('express');
const router = express.Router();
const Billing = require('../models/Billing');
const { sendSubscriptionNotification } = require('../email');

function getBaseUrl(req) {
  return process.env.BASE_URL || (req.protocol + '://' + req.get('host'));
}

function safeNext(value, fallback) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return fallback;
}

function requireUser(req, res, next) {
  if (!req.session?.siteUser) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function csrfProtection(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const token = req.body._csrf || req.headers['x-csrf-token'];
    if (!token || !req.session?.csrfToken || token !== req.session.csrfToken) {
      return res.status(403).render('404', {
        title: 'Invalid form token',
        message: 'Your session expired. Please refresh the page and try again.'
      });
    }
  }
  next();
}

function paymentInstructions() {
  return {
    momoNumber: process.env.PAYMENT_MOMO_NUMBER || '+250 789 257 758',
    accountName: process.env.PAYMENT_ACCOUNT_NAME || 'City Building Engineering Company Ltd',
    bankName: process.env.PAYMENT_BANK_NAME || 'Bank of Kigali',
    bankAccount: process.env.PAYMENT_BANK_ACCOUNT || 'Contact us for account details',
    paypal: process.env.PAYMENT_PAYPAL_LINK || '',
    whatsapp: 'https://wa.me/250789257758'
  };
}

async function attachBilling(req, res, next) {
  res.locals.isPro = false;
  res.locals.subscription = null;
  res.locals.formatAmount = Billing.formatAmount;
  try {
    if (req.session?.siteUser) {
      res.locals.subscription = await Billing.getUserSubscription(req.session.siteUser.id);
      res.locals.isPro = !!res.locals.subscription.is_pro;
    }
  } catch (err) {
    console.error('Failed to load billing state:', err.message);
  }
  next();
}

function requirePro(req, res, next) {
  if (!req.session?.siteUser) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  if (!res.locals.isPro) {
    return res.status(403).json({
      error: 'A Pro plan or free trial is required for this feature.',
      upgradeUrl: '/pricing'
    });
  }
  next();
}

async function notify(data) {
  sendSubscriptionNotification(data).catch(function (err) {
    console.error('Failed to send subscription notification:', err.message);
  });
}

router.get('/pricing', async (req, res, next) => {
  try {
    const plans = await Billing.getPlans();
    res.render('pricing', {
      title: 'Plans & Free Trial - City Building Engineering',
      metaDescription: 'Choose a City Building Engineering plan. Start a 7-day free trial, learn Revit, AutoCAD, ETABS and more, then continue with Pro Monthly, Pro Annual or Career Accelerator. Pay by mobile money, bank transfer or card.',
      plans,
      subscription: res.locals.subscription,
      stripeEnabled: Billing.stripeEnabled(),
      canceled: req.query.canceled === '1',
      formatAmount: Billing.formatAmount,
      breadcrumbs: [
        { name: 'Home', url: getBaseUrl(req) + '/' },
        { name: 'Pricing', url: getBaseUrl(req) + '/pricing' }
      ]
    });
  } catch (err) {
    next(err);
  }
});

router.get('/billing', requireUser, async (req, res, next) => {
  try {
    const summary = await Billing.getUserBillingSummary(req.session.siteUser.id);
    res.render('billing', {
      title: 'Billing & Subscription - City Building Engineering',
      metaDescription: 'Manage your City Building Engineering subscription, free trial, payments and invoices.',
      subscription: summary.subscription,
      payments: summary.payments,
      plans: summary.plans,
      trialUsed: summary.trialUsed,
      instructions: paymentInstructions(),
      stripeEnabled: Billing.stripeEnabled(),
      formatAmount: Billing.formatAmount,
      notice: req.query.success ? 'Payment confirmed. Your plan is active.' : (req.query.submitted ? 'Payment submitted. We will verify it and activate your plan shortly.' : (req.query.trial === 'started' ? 'Your free trial has started!' : (req.query.canceled ? 'Subscription cancellation scheduled for the end of the period.' : '')))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/billing/subscribe', requireUser, csrfProtection, async (req, res, next) => {
  try {
    const planId = Number(req.body.planId || req.body.plan_id);
    const plan = await Billing.getPlanById(planId);
    if (!plan) {
      return res.status(400).redirect('/pricing?invalid=1');
    }
    if (plan.is_free) {
      return res.redirect('/pricing');
    }

    const current = await Billing.getUserSubscription(req.session.siteUser.id);
    const trialUsed = await Billing.hasUsedTrial(req.session.siteUser.id);

    if (plan.trial_days > 0 && !trialUsed && !current.is_pro) {
      await Billing.startTrial(req.session.siteUser.id, plan);
      await notify({
        subject: 'Free trial started',
        name: req.session.siteUser.full_name,
        email: req.session.siteUser.email,
        plan: plan.name,
        status: 'trialing (' + plan.trial_days + ' days)',
        amount: Billing.formatAmount(plan.price, plan.currency)
      });
      return res.redirect('/billing?trial=started');
    }

    if (Billing.stripeEnabled()) {
      try {
        const session = await Billing.createStripeCheckout(req.session.siteUser.id, plan, getBaseUrl(req));
        return res.redirect(session.url);
      } catch (stripeErr) {
        console.error('Stripe checkout failed:', stripeErr.message);
      }
    }

    const payment = await Billing.createPendingPayment(req.session.siteUser.id, plan, 'mobile_money', '');
    return res.redirect('/billing/checkout/' + payment.id);
  } catch (err) {
    if (err.code === 'TRIAL_USED' || err.code === 'NO_TRIAL' || err.code === 'ALREADY_ACTIVE') {
      return res.redirect('/pricing?trial=unavailable');
    }
    next(err);
  }
});

router.get('/billing/checkout/:id', requireUser, async (req, res, next) => {
  try {
    const payment = await Billing.getPaymentById(req.params.id);
    if (!payment || payment.user_id !== req.session.siteUser.id) {
      return res.status(404).render('404', { title: 'Payment not found', message: 'This payment request does not exist.' });
    }
    res.render('billing-checkout', {
      title: 'Complete Payment - City Building Engineering',
      metaDescription: 'Complete your City Building Engineering subscription payment.',
      payment,
      instructions: paymentInstructions(),
      formatAmount: Billing.formatAmount
    });
  } catch (err) {
    next(err);
  }
});

router.post('/billing/checkout/:id/confirm', requireUser, csrfProtection, async (req, res, next) => {
  try {
    const payment = await Billing.getPaymentById(req.params.id);
    if (!payment || payment.user_id !== req.session.siteUser.id) {
      return res.status(404).render('404', { title: 'Payment not found', message: 'This payment request does not exist.' });
    }
    if (payment.status !== 'pending') {
      return res.redirect('/billing');
    }
    const reference = String(req.body.reference || '').trim();
    const method = String(req.body.method || 'mobile_money').slice(0, 40);
    const notes = String(req.body.notes || '').slice(0, 1000);
    if (!reference) {
      return res.status(400).render('billing-checkout', {
        title: 'Complete Payment',
        metaDescription: '',
        payment,
        instructions: paymentInstructions(),
        formatAmount: Billing.formatAmount,
        error: 'Enter the mobile money or bank transaction reference so we can verify your payment.'
      });
    }
    await Billing.updatePaymentReference(payment.id, method, reference, notes);
    await notify({
      subject: 'Subscription payment submitted',
      name: req.session.siteUser.full_name,
      email: req.session.siteUser.email,
      plan: payment.plan_name,
      status: 'awaiting verification',
      amount: Billing.formatAmount(payment.amount, payment.currency),
      reference
    });
    return res.redirect('/billing?submitted=1');
  } catch (err) {
    next(err);
  }
});

router.get('/billing/success', requireUser, async (req, res, next) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId || !Billing.stripeEnabled()) {
      return res.redirect('/billing');
    }
    const session = await Billing.retrieveStripeSession(sessionId);
    await Billing.recordStripeSession(session);
    return res.redirect('/billing?success=1');
  } catch (err) {
    console.error('Stripe success verification failed:', err.message);
    return res.redirect('/billing');
  }
});

router.post('/billing/cancel', requireUser, csrfProtection, async (req, res, next) => {
  try {
    await Billing.cancelSubscription(req.session.siteUser.id);
    res.redirect('/billing?canceled=1');
  } catch (err) {
    next(err);
  }
});

router.post('/billing/resume', requireUser, csrfProtection, async (req, res, next) => {
  try {
    await Billing.resumeSubscription(req.session.siteUser.id);
    res.redirect('/billing');
  } catch (err) {
    next(err);
  }
});

module.exports = {
  router,
  attachBilling,
  requirePro,
  safeNext
};
