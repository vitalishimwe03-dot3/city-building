-- Billing, subscriptions and free trials
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
  stripe_price_cents INTEGER,
  stripe_currency VARCHAR(10) DEFAULT 'usd',
  billing_interval TEXT DEFAULT 'month',
  duration_days INTEGER DEFAULT 30,
  trial_days INTEGER DEFAULT 0,
  features TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INT NOT NULL,
  plan_id INT NOT NULL,
  status TEXT DEFAULT 'pending',
  provider TEXT DEFAULT 'manual',
  provider_ref VARCHAR(255),
  started_at DATETIME,
  trial_ends_at DATETIME,
  current_period_end DATETIME,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INT NOT NULL,
  subscription_id INT,
  plan_id INT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'RWF',
  status TEXT DEFAULT 'pending',
  provider TEXT DEFAULT 'manual',
  provider_ref VARCHAR(255) UNIQUE,
  method VARCHAR(50),
  reference VARCHAR(255),
  notes TEXT,
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

INSERT OR IGNORE INTO plans (name, slug, description, price_cents, currency, stripe_price_cents, stripe_currency, billing_interval, duration_days, trial_days, features, is_active, sort_order) VALUES
('Starter', 'starter', 'Free access to course catalog, quizzes, gallery and the 7-day mini course.', 0, 'RWF', NULL, 'usd', 'free', 0, 0, '["Browse all courses","Course quiz & gallery","Free 7-day mini course","Community access"]', 1, 0),
('Pro Monthly', 'pro-monthly', 'Full platform access with certificates, progress tracking and an ad-free experience.', 9000, 'RWF', 500, 'usd', 'month', 30, 7, '["Everything in Starter","7-day free trial","Unlimited course access","Certificate downloads","Ad-free experience","Priority support"]', 1, 1),
('Pro Annual', 'pro-annual', 'Best value: a full year of Pro access with two months free.', 79000, 'RWF', 4900, 'usd', 'year', 365, 7, '["Everything in Pro Monthly","7-day free trial","2 months free","Certificate downloads","Ad-free experience","Priority support"]', 1, 2),
('Career Accelerator', 'career', 'Six months of Pro plus internship placement and portfolio review.', 199000, 'RWF', 9900, 'usd', 'one_time', 180, 0, '["Everything in Pro Annual","Internship placement support","Portfolio & CV review","1-on-1 career coaching","Job referral network"]', 1, 3);
