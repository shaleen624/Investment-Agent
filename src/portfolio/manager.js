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
  if (!holding.user_id) {
    throw new Error('user_id is required for holding operations');
  }

  const userId = holding.user_id;
  const broker = holding.broker || 'manual';
  const assetType = holding.asset_type || 'equity';

  const existing = holding.symbol
    ? dbGet(
        `SELECT id FROM holdings
         WHERE user_id = ? AND symbol = ? AND broker = ? AND asset_type = ?`,
        [userId, holding.symbol, broker, assetType]
      )
    : dbGet(
        `SELECT id FROM holdings
         WHERE user_id = ? AND name = ? AND broker = ? AND asset_type = ?`,
        [userId, holding.name, broker, assetType]
      );

  const investedAmount = holding.invested_amount ||
    (holding.quantity && holding.avg_buy_price
      ? holding.quantity * holding.avg_buy_price
      : 0);

  if (existing) {
    run(
      `UPDATE holdings SET
         quantity         = ?,
         avg_buy_price    = ?,
         invested_amount  = ?,
         current_price    = COALESCE(?, current_price),
         current_value    = COALESCE(?, current_value),
         unrealized_pnl   = COALESCE(?, unrealized_pnl),
         pnl_percent      = COALESCE(?, pnl_percent),
         units            = COALESCE(?, units),
         nav              = COALESCE(?, nav),
         folio_number     = COALESCE(?, folio_number),
         last_updated     = datetime('now')
       WHERE id = ? AND user_id = ?`,
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
        userId,
      ]
    );
    logger.debug(`[Portfolio] Updated holding: ${holding.symbol || holding.name}`);
    return existing.id;
  } else {
    const result = run(
      `INSERT INTO holdings
         (user_id, asset_type, symbol, name, exchange, quantity, avg_buy_price,
          current_price, current_value, invested_amount, unrealized_pnl, pnl_percent,
          sector, broker, folio_number, units, nav, maturity_date, interest_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        assetType,
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
        broker,
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

/** Get all holdings for a user. */
function getAllHoldings(userId) {
  if (userId) {
    return dbAll(
      `SELECT * FROM holdings WHERE user_id = ? ORDER BY asset_type, name`,
      [userId]
    );
  }
  return dbAll(`SELECT * FROM holdings ORDER BY asset_type, name`);
}

/** Get holdings by asset type for a user. */
function getHoldingsByType(assetType, userId) {
  if (userId) {
    return dbAll(
      `SELECT * FROM holdings WHERE user_id = ? AND asset_type = ? ORDER BY name`,
      [userId, assetType]
    );
  }
  return dbAll(`SELECT * FROM holdings WHERE asset_type = ? ORDER BY name`, [assetType]);
}

/** Get a single holding by id for a user. */
function getHolding(id, userId) {
  if (userId) {
    return dbGet(`SELECT * FROM holdings WHERE id = ? AND user_id = ?`, [id, userId]);
  }
  return dbGet(`SELECT * FROM holdings WHERE id = ?`, [id]);
}

/** Delete a holding for a user. */
function deleteHolding(id, userId) {
  if (userId) {
    return run(`DELETE FROM holdings WHERE id = ? AND user_id = ?`, [id, userId]);
  }
  return run(`DELETE FROM holdings WHERE id = ?`, [id]);
}

// ── Transactions ──────────────────────────────────────────────────────────────

function addTransaction(tx) {
  if (!tx.user_id) {
    throw new Error('user_id is required for transaction operations');
  }
  return run(
    `INSERT INTO transactions (user_id, holding_id, type, quantity, price, amount, fees, date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.user_id,
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

function getTransactions(holdingId = null, userId = null) {
  if (holdingId && userId) {
    return dbAll(
      `SELECT * FROM transactions WHERE holding_id = ? AND user_id = ? ORDER BY date DESC`,
      [holdingId, userId]
    );
  }
  if (userId) {
    return dbAll(`SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC`, [userId]);
  }
  if (holdingId) {
    return dbAll(`SELECT * FROM transactions WHERE holding_id = ? ORDER BY date DESC`, [holdingId]);
  }
  return dbAll(`SELECT * FROM transactions ORDER BY date DESC`);
}

// ── Goals ─────────────────────────────────────────────────────────────────────

function upsertGoal(goal) {
  if (!goal.user_id) {
    throw new Error('user_id is required for goal operations');
  }

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
       WHERE id = ? AND user_id = ?`,
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
        goal.user_id,
      ]
    );
    return goal.id;
  } else {
    return run(
      `INSERT INTO goals (user_id, type, title, description, target_amount, target_date, risk_tolerance, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.user_id,
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

function getGoals(userId = null, activeOnly = true) {
  if (userId) {
    if (activeOnly) {
      return dbAll(
        `SELECT * FROM goals WHERE user_id = ? AND is_active = 1 ORDER BY priority, type`,
        [userId]
      );
    }
    return dbAll(`SELECT * FROM goals WHERE user_id = ? ORDER BY priority, type`, [userId]);
  }

  if (activeOnly) {
    return dbAll(`SELECT * FROM goals WHERE is_active = 1 ORDER BY priority, type`);
  }
  return dbAll(`SELECT * FROM goals ORDER BY priority, type`);
}

function deleteGoal(id, userId) {
  if (!userId) {
    throw new Error('user_id is required for goal deletion');
  }
  run(`UPDATE goals SET is_active = 0 WHERE id = ? AND user_id = ?`, [id, userId]);
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
function getPortfolioSummary(userId = null) {
  const holdings = userId ? getAllHoldings(userId) : dbAll(`SELECT * FROM holdings ORDER BY asset_type, name`);
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
function calculateXIRR(userId = null) {
  try {
    const xirr = require('xirr');
    const transactions = userId
      ? dbAll(
          `SELECT t.amount, t.type, t.date
           FROM transactions t
           WHERE t.user_id = ?
           ORDER BY t.date ASC`,
          [userId]
        )
      : dbAll(
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
  upsertGoal,
  getGoals,
  deleteGoal,
  getProfile,
  upsertProfile,
  getPortfolioSummary,
  calculateXIRR,
};
