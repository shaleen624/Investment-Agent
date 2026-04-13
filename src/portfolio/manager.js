'use strict';

/**
 * Portfolio Manager — CRUD operations for holdings, goals, and profile.
 * All data is stored in SQLite via src/db/index.js.
 */

const logger  = require('../config/logger');
const { run, get: dbGet, all: dbAll } = require('../db');

// ── Holdings ──────────────────────────────────────────────────────────────────

/**
 * Insert or update a holding (upsert by symbol + broker).
 * @param {Object} holding - normalized holding object from parser or broker
 * @returns {number} holding id
 */
function upsertHolding(holding) {
  const existing = holding.symbol
    ? dbGet(
        `SELECT id FROM holdings
         WHERE symbol = ? AND broker = ? AND asset_type = ?`,
        [holding.symbol, holding.broker || 'manual', holding.asset_type]
      )
    : dbGet(
        `SELECT id FROM holdings
         WHERE name = ? AND broker = ? AND asset_type = ?`,
        [holding.name, holding.broker || 'manual', holding.asset_type]
      );

  const investedAmount = holding.invested_amount ||
    (holding.quantity && holding.avg_buy_price
      ? holding.quantity * holding.avg_buy_price
      : 0);

  if (existing) {
    run(
      `UPDATE holdings SET
         quantity        = ?,
         avg_buy_price   = ?,
         invested_amount = ?,
         current_price   = COALESCE(?, current_price),
         current_value   = COALESCE(?, current_value),
         unrealized_pnl  = COALESCE(?, unrealized_pnl),
         pnl_percent     = COALESCE(?, pnl_percent),
         units           = COALESCE(?, units),
         nav             = COALESCE(?, nav),
         folio_number    = COALESCE(?, folio_number),
         last_updated    = datetime('now')
       WHERE id = ?`,
      [
        holding.quantity,
        holding.avg_buy_price,
        investedAmount,
        holding.current_price   || null,
        holding.current_value   || null,
        holding.unrealized_pnl  || null,
        holding.pnl_percent     || null,
        holding.units           || null,
        holding.nav             || null,
        holding.folio_number    || null,
        existing.id,
      ]
    );
    logger.debug(`[Portfolio] Updated holding: ${holding.symbol || holding.name}`);
    return existing.id;
  } else {
    const result = run(
      `INSERT INTO holdings
         (asset_type, symbol, name, exchange, quantity, avg_buy_price,
          current_price, current_value, invested_amount, unrealized_pnl, pnl_percent,
          sector, broker, folio_number, units, nav, maturity_date, interest_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        holding.asset_type     || 'equity',
        holding.symbol         || null,
        holding.name,
        holding.exchange       || 'NSE',
        holding.quantity,
        holding.avg_buy_price  || 0,
        holding.current_price  || null,
        holding.current_value  || null,
        investedAmount,
        holding.unrealized_pnl || null,
        holding.pnl_percent    || null,
        holding.sector         || null,
        holding.broker         || 'manual',
        holding.folio_number   || null,
        holding.units          || null,
        holding.nav            || null,
        holding.maturity_date  || null,
        holding.interest_rate  || null,
      ]
    );
    logger.debug(`[Portfolio] Inserted holding: ${holding.symbol || holding.name}`);
    return result.lastInsertRowid;
  }
}

/**
 * Bulk upsert an array of holdings (from parser or broker sync).
 */
function upsertHoldings(holdings) {
  const results = { inserted: 0, updated: 0, errors: 0 };
  for (const h of holdings) {
    try {
      upsertHolding(h);
      results.inserted++;
    } catch (err) {
      logger.error(`[Portfolio] upsert error for ${h.name}: ${err.message}`);
      results.errors++;
    }
  }
  logger.info(`[Portfolio] Bulk upsert: ${results.inserted} ok, ${results.errors} errors`);
  return results;
}

/** Get all holdings. */
function getAllHoldings() {
  return dbAll(`SELECT * FROM holdings ORDER BY asset_type, name`);
}

/** Get holdings by asset type. */
function getHoldingsByType(assetType) {
  return dbAll(`SELECT * FROM holdings WHERE asset_type = ? ORDER BY name`, [assetType]);
}

/** Get a single holding by id. */
function getHolding(id) {
  return dbGet(`SELECT * FROM holdings WHERE id = ?`, [id]);
}

/** Delete a holding. */
function deleteHolding(id) {
  run(`DELETE FROM holdings WHERE id = ?`, [id]);
}

// ── Transactions ──────────────────────────────────────────────────────────────

function addTransaction(tx) {
  return run(
    `INSERT INTO transactions (holding_id, type, quantity, price, amount, fees, date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.holding_id || null,
      tx.type,
      tx.quantity,
      tx.price,
      tx.amount || tx.quantity * tx.price,
      tx.fees || 0,
      tx.date || new Date().toISOString(),
      tx.notes || null,
    ]
  ).lastInsertRowid;
}

function getTransactions(holdingId = null) {
  if (holdingId) {
    return dbAll(`SELECT * FROM transactions WHERE holding_id = ? ORDER BY date DESC`, [holdingId]);
  }
  return dbAll(`SELECT * FROM transactions ORDER BY date DESC`);
}

// ── SIP Plans ──────────────────────────────────────────────────────────────────

function addSipPlan(plan) {
  return run(
    `INSERT INTO sip_plans
      (holding_id, fund_name, folio_number, amount, frequency, sip_day, next_due_date,
       start_date, end_date, auto_reminder, reminder_days_before, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      plan.holding_id || null,
      plan.fund_name,
      plan.folio_number || null,
      plan.amount,
      plan.frequency || 'monthly',
      plan.sip_day,
      plan.next_due_date,
      plan.start_date || null,
      plan.end_date || null,
      plan.auto_reminder === undefined ? 1 : (plan.auto_reminder ? 1 : 0),
      plan.reminder_days_before ?? 2,
      plan.notes || null,
    ]
  ).lastInsertRowid;
}

function updateSipPlan(id, plan) {
  run(
    `UPDATE sip_plans SET
       holding_id           = COALESCE(?, holding_id),
       fund_name            = COALESCE(?, fund_name),
       folio_number         = COALESCE(?, folio_number),
       amount               = COALESCE(?, amount),
       frequency            = COALESCE(?, frequency),
       sip_day              = COALESCE(?, sip_day),
       next_due_date        = COALESCE(?, next_due_date),
       start_date           = COALESCE(?, start_date),
       end_date             = COALESCE(?, end_date),
       auto_reminder        = COALESCE(?, auto_reminder),
       reminder_days_before = COALESCE(?, reminder_days_before),
       is_active            = COALESCE(?, is_active),
       notes                = COALESCE(?, notes),
       updated_at           = datetime('now')
     WHERE id = ?`,
    [
      plan.holding_id,
      plan.fund_name,
      plan.folio_number,
      plan.amount,
      plan.frequency,
      plan.sip_day,
      plan.next_due_date,
      plan.start_date,
      plan.end_date,
      plan.auto_reminder === undefined ? null : (plan.auto_reminder ? 1 : 0),
      plan.reminder_days_before,
      plan.is_active === undefined ? null : (plan.is_active ? 1 : 0),
      plan.notes,
      id,
    ]
  );
  return id;
}

function getSipPlans(activeOnly = true) {
  const where = activeOnly ? 'WHERE s.is_active = 1' : '';
  return dbAll(
    `SELECT s.*, h.name AS holding_name, h.symbol AS holding_symbol
     FROM sip_plans s
     LEFT JOIN holdings h ON h.id = s.holding_id
     ${where}
     ORDER BY s.next_due_date ASC, s.fund_name ASC`
  );
}

function getSipPlan(id) {
  return dbGet(
    `SELECT s.*, h.name AS holding_name, h.symbol AS holding_symbol
     FROM sip_plans s
     LEFT JOIN holdings h ON h.id = s.holding_id
     WHERE s.id = ?`,
    [id]
  );
}

function deactivateSipPlan(id) {
  run(`UPDATE sip_plans SET is_active = 0, updated_at = datetime('now') WHERE id = ?`, [id]);
}

function getUpcomingSipReminders(daysAhead = 3) {
  return dbAll(
    `SELECT s.*,
            h.name AS holding_name,
            h.symbol AS holding_symbol,
            CAST(julianday(date(s.next_due_date)) - julianday(date('now', 'localtime')) AS INTEGER) AS days_until_due
     FROM sip_plans s
     LEFT JOIN holdings h ON h.id = s.holding_id
     WHERE s.is_active = 1
       AND s.auto_reminder = 1
       AND date(s.next_due_date) BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+' || ? || ' day')
     ORDER BY date(s.next_due_date) ASC, s.fund_name ASC`,
    [daysAhead]
  );
}

function getSipPerformance() {
  const rows = dbAll(
    `SELECT s.id, s.fund_name, s.amount,
            COUNT(t.id) AS installment_count,
            COALESCE(SUM(CASE WHEN t.type = 'sip' THEN t.amount ELSE 0 END), 0) AS total_invested,
            MAX(CASE WHEN t.type = 'sip' THEN t.date ELSE NULL END) AS last_installment_date,
            s.holding_id, h.current_value, h.invested_amount, h.unrealized_pnl, h.pnl_percent
     FROM sip_plans s
     LEFT JOIN holdings h ON h.id = s.holding_id
     LEFT JOIN transactions t ON t.holding_id = s.holding_id
     WHERE s.is_active = 1
     GROUP BY s.id
     ORDER BY s.next_due_date ASC`
  );

  let totalInvested = 0;
  let totalCurrent = 0;

  const plans = rows.map((row) => {
    const invested = row.total_invested || row.invested_amount || 0;
    const current = row.current_value || 0;
    totalInvested += invested;
    totalCurrent += current;

    return {
      ...row,
      total_invested: invested,
      current_value: current,
      unrealized_pnl: current - invested,
      pnl_percent: invested > 0 ? ((current - invested) / invested) * 100 : 0,
    };
  });

  const totalPnl = totalCurrent - totalInvested;
  return {
    totalPlans: plans.length,
    totalInvested,
    totalCurrent,
    totalPnl,
    totalPnlPercent: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
    plans,
  };
}

// ── Goals ─────────────────────────────────────────────────────────────────────

function upsertGoal(goal) {
  if (goal.id) {
    run(
      `UPDATE goals SET
         type           = ?,
         title          = ?,
         description    = ?,
         target_amount  = ?,
         target_date    = ?,
         risk_tolerance = ?,
         priority       = ?,
         is_active      = ?,
         updated_at     = datetime('now')
       WHERE id = ?`,
      [
        goal.type,
        goal.title,
        goal.description || null,
        goal.target_amount || null,
        goal.target_date   || null,
        goal.risk_tolerance || 'moderate',
        goal.priority       || 5,
        goal.is_active !== undefined ? (goal.is_active ? 1 : 0) : 1,
        goal.id,
      ]
    );
    return goal.id;
  } else {
    return run(
      `INSERT INTO goals (type, title, description, target_amount, target_date, risk_tolerance, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.type,
        goal.title,
        goal.description || null,
        goal.target_amount || null,
        goal.target_date   || null,
        goal.risk_tolerance || 'moderate',
        goal.priority       || 5,
      ]
    ).lastInsertRowid;
  }
}

function getGoals(activeOnly = true) {
  if (activeOnly) {
    return dbAll(`SELECT * FROM goals WHERE is_active = 1 ORDER BY priority, type`);
  }
  return dbAll(`SELECT * FROM goals ORDER BY priority, type`);
}

function deleteGoal(id) {
  run(`UPDATE goals SET is_active = 0 WHERE id = ?`, [id]);
}

// ── User Profile ──────────────────────────────────────────────────────────────

function getProfile() {
  return dbGet(`SELECT * FROM user_profile WHERE id = 1`);
}

function upsertProfile(profile) {
  const existing = getProfile();
  if (existing) {
    run(
      `UPDATE user_profile SET
         name         = ?,
         email        = COALESCE(?, email),
         telegram_id  = COALESCE(?, telegram_id),
         whatsapp     = COALESCE(?, whatsapp),
         timezone     = COALESCE(?, timezone),
         morning_time = COALESCE(?, morning_time),
         evening_time = COALESCE(?, evening_time),
         updated_at   = datetime('now')
       WHERE id = 1`,
      [
        profile.name || existing.name,
        profile.email        || null,
        profile.telegram_id  || null,
        profile.whatsapp     || null,
        profile.timezone     || null,
        profile.morning_time || null,
        profile.evening_time || null,
      ]
    );
  } else {
    run(
      `INSERT INTO user_profile (id, name, email, telegram_id, whatsapp, timezone, morning_time, evening_time)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.name         || 'Investor',
        profile.email        || null,
        profile.telegram_id  || null,
        profile.whatsapp     || null,
        profile.timezone     || 'Asia/Kolkata',
        profile.morning_time || '08:00',
        profile.evening_time || '20:00',
      ]
    );
  }
}

// ── Analytics Helpers ─────────────────────────────────────────────────────────

/**
 * Compute portfolio summary: total invested, current value, P&L, allocation.
 */
function getPortfolioSummary() {
  const holdings = getAllHoldings();
  if (!holdings.length) return null;

  let totalInvested = 0;
  let totalCurrent  = 0;
  const byType      = {};
  const bySector    = {};

  for (const h of holdings) {
    const invested = h.invested_amount || 0;
    const current  = h.current_value   || h.invested_amount || 0;

    totalInvested += invested;
    totalCurrent  += current;

    // By asset type
    if (!byType[h.asset_type]) byType[h.asset_type] = { invested: 0, current: 0, count: 0 };
    byType[h.asset_type].invested += invested;
    byType[h.asset_type].current  += current;
    byType[h.asset_type].count++;

    // By sector
    if (h.sector) {
      if (!bySector[h.sector]) bySector[h.sector] = { invested: 0, current: 0 };
      bySector[h.sector].invested += invested;
      bySector[h.sector].current  += current;
    }
  }

  const unrealizedPnl = totalCurrent - totalInvested;
  const pnlPercent    = totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0;

  return {
    totalInvested,
    totalCurrent,
    unrealizedPnl,
    pnlPercent,
    holdingsCount: holdings.length,
    byType,
    bySector,
    holdings,
  };
}

/**
 * Calculate XIRR for equity holdings using transaction history.
 * Falls back to simple CAGR if XIRR package fails.
 */
function calculateXIRR() {
  try {
    const xirr = require('xirr');
    const transactions = dbAll(
      `SELECT t.amount, t.type, t.date
       FROM transactions t
       ORDER BY t.date ASC`
    );

    if (transactions.length < 2) return null;

    const cashflows = transactions.map(t => ({
      amount: t.type === 'buy' || t.type === 'sip' ? -t.amount : t.amount,
      when:   new Date(t.date),
    }));

    // Add current portfolio value as final positive cashflow
    const summary = getPortfolioSummary();
    if (summary) {
      cashflows.push({
        amount: summary.totalCurrent,
        when:   new Date(),
      });
    }

    return xirr(cashflows) * 100; // as percentage
  } catch (err) {
    logger.debug(`[Portfolio] XIRR failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  upsertHolding,
  upsertHoldings,
  getAllHoldings,
  getHoldingsByType,
  getHolding,
  deleteHolding,
  addTransaction,
  getTransactions,
  addSipPlan,
  updateSipPlan,
  getSipPlans,
  getSipPlan,
  deactivateSipPlan,
  getUpcomingSipReminders,
  getSipPerformance,
  upsertGoal,
  getGoals,
  deleteGoal,
  getProfile,
  upsertProfile,
  getPortfolioSummary,
  calculateXIRR,
};
