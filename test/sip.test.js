'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-test-'));
  const dbPath = path.join(tmpDir, 'portfolio.db');
  process.env.DB_PATH = dbPath;

  const db = require('../src/db');
  const pm = require('../src/portfolio/manager');
  return { db, pm, tmpDir };
}

function teardownDb(db, tmpDir) {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

test('creates SIP plan and returns it in active plans list', () => {
  const { db, pm, tmpDir } = setupDb();

  try {
    const holdingId = pm.upsertHolding({
      asset_type: 'mutual_fund',
      symbol: 'AXISBLUE',
      name: 'Axis Bluechip Fund',
      quantity: 10,
      avg_buy_price: 500,
      current_value: 5200,
      invested_amount: 5000,
      broker: 'manual',
    });

    const planId = pm.addSipPlan({
      holding_id: holdingId,
      fund_name: 'Axis Bluechip Fund',
      amount: 5000,
      frequency: 'monthly',
      sip_day: 10,
      next_due_date: '2099-12-10',
      auto_reminder: true,
      reminder_days_before: 3,
    });

    const plan = pm.getSipPlan(planId);
    assert.equal(plan.fund_name, 'Axis Bluechip Fund');
    assert.equal(plan.amount, 5000);

    const plans = pm.getSipPlans(true);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].id, planId);
    assert.equal(plans[0].holding_name, 'Axis Bluechip Fund');
  } finally {
    teardownDb(db, tmpDir);
  }
});

test('computes SIP performance from SIP transactions and holding value', () => {
  const { db, pm, tmpDir } = setupDb();

  try {
    const holdingId = pm.upsertHolding({
      asset_type: 'mutual_fund',
      symbol: 'HDFCSENSEX',
      name: 'HDFC Index Fund',
      quantity: 12,
      avg_buy_price: 1000,
      current_value: 15000,
      invested_amount: 12000,
      broker: 'manual',
    });

    pm.addSipPlan({
      holding_id: holdingId,
      fund_name: 'HDFC Index Fund',
      amount: 3000,
      frequency: 'monthly',
      sip_day: 5,
      next_due_date: '2099-12-05',
      auto_reminder: true,
      reminder_days_before: 2,
    });

    pm.addTransaction({ holding_id: holdingId, type: 'sip', quantity: 3, price: 1000, amount: 3000, date: '2026-01-05T00:00:00.000Z' });
    pm.addTransaction({ holding_id: holdingId, type: 'sip', quantity: 3, price: 1000, amount: 3000, date: '2026-02-05T00:00:00.000Z' });

    const perf = pm.getSipPerformance();
    assert.equal(perf.totalPlans, 1);
    assert.equal(perf.totalInvested, 6000);
    assert.equal(perf.totalCurrent, 15000);
    assert.equal(perf.totalPnl, 9000);
    assert.equal(perf.plans[0].installment_count, 2);
  } finally {
    teardownDb(db, tmpDir);
  }
});

test('returns upcoming SIP reminders within specified horizon', () => {
  const { db, pm, tmpDir } = setupDb();

  try {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const farFuture = new Date(today.getTime() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    pm.addSipPlan({
      fund_name: 'Reminder Fund',
      amount: 2500,
      frequency: 'monthly',
      sip_day: 12,
      next_due_date: tomorrow,
      auto_reminder: true,
      reminder_days_before: 2,
    });

    pm.addSipPlan({
      fund_name: 'Later Fund',
      amount: 2500,
      frequency: 'monthly',
      sip_day: 22,
      next_due_date: farFuture,
      auto_reminder: true,
      reminder_days_before: 2,
    });

    const reminders = pm.getUpcomingSipReminders(3);
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].fund_name, 'Reminder Fund');
  } finally {
    teardownDb(db, tmpDir);
  }
});
