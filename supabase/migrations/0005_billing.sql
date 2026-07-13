-- Phase 5: money in. Stripe catalog ids on plans, subscription/dunning state on
-- orgs, and a reported-overage ledger so the daily job can send deltas.

-- Phase 4 seeded price_cents with dollar values (499/999/1499); fix to real
-- cents before any money math. Guarded so re-runs don't multiply again.
update plans set price_cents = price_cents * 100 where price_cents < 10000;

alter table plans
  add column stripe_product_id text,
  add column stripe_price_monthly_id text,
  add column stripe_price_annual_id text,
  -- ponytail: one global metered overage price, duplicated per row so "price ids
  -- live in plans" stays true without a second table.
  add column stripe_overage_price_id text;

alter table orgs
  add column stripe_subscription_id text,
  -- Downgrades take effect next period (Stripe subscription schedule); this is
  -- what the UI shows until customer.subscription.updated flips the price.
  add column pending_plan_id text references plans(id),
  -- Dunning: set once by invoice.payment_failed, cleared by invoice.paid.
  -- Agents pause when it is older than the 7-day grace window (nightly cron).
  add column payment_failed_at timestamptz;

-- Overage minutes already sent to Stripe (meter events are additive, so the
-- daily reporter sends only the delta vs this running total).
alter table usage_periods add column overage_reported numeric not null default 0;
