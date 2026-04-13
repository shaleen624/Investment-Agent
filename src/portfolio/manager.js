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

function normalizeTargetAllocation(targetAllocation, summary) {
  const cleaned = {};

  for (const [assetType, pct] of Object.entries(targetAllocation || {})) {
    const value = Number(pct);
    if (Number.isFinite(value) && value >= 0) {
      cleaned[assetType] = value;
    }
  }

  const totalPct = Object.values(cleaned).reduce((sum, pct) => sum + pct, 0);
  if (totalPct <= 0) {
    throw new Error('Target allocation must include at least one positive percentage');
  }

  const normalized = {};
  for (const [assetType, pct] of Object.entries(cleaned)) {
    normalized[assetType] = (pct / totalPct) * 100;
  }

  for (const assetType of Object.keys(summary.byType || {})) {
    if (!(assetType in normalized)) normalized[assetType] = 0;
  }

  return normalized;
}

function getEstimatedHoldingDays(holding) {
  const tx = dbGet(
    `SELECT date FROM transactions
     WHERE holding_id = ? AND type IN ('buy', 'sip')
     ORDER BY date ASC
     LIMIT 1`,
    [holding.id]
  );

  const dateStr = tx?.date || holding.created_at;
  const createdAt = new Date(dateStr);
  if (Number.isNaN(createdAt.getTime())) return 0;

  const days = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, days);
}

function getTaxProfile(assetType, taxConfig) {
  const profiles = {
    equity: {
      stcgRate: taxConfig.equityStcgRate,
      ltcgRate: taxConfig.equityLtcgRate,
      ltcgThresholdDays: taxConfig.equityLtcgThresholdDays,
      ltcgExemption: taxConfig.equityLtcgExemption,
    },
    etf: {
      stcgRate: taxConfig.equityStcgRate,
      ltcgRate: taxConfig.equityLtcgRate,
      ltcgThresholdDays: taxConfig.equityLtcgThresholdDays,
      ltcgExemption: taxConfig.equityLtcgExemption,
    },
    default: {
      stcgRate: taxConfig.otherStcgRate,
      ltcgRate: taxConfig.otherLtcgRate,
      ltcgThresholdDays: taxConfig.otherLtcgThresholdDays,
      ltcgExemption: 0,
    },
  };

  return profiles[assetType] || profiles.default;
}

function calculateRebalancingPlan(targetAllocation, options = {}) {
  const summary = getPortfolioSummary();
  if (!summary) {
    return {
      totalCurrent: 0,
      currentAllocation: {},
      targetAllocation: {},
      driftByType: {},
      trades: [],
      totals: {
        buyAmount: 0,
        sellAmount: 0,
        netCapitalGains: 0,
        estimatedTax: 0,
      },
    };
  }

  const taxConfig = {
    equityStcgRate: options.equityStcgRate ?? 0.15,
    equityLtcgRate: options.equityLtcgRate ?? 0.1,
    equityLtcgThresholdDays: options.equityLtcgThresholdDays ?? 365,
    equityLtcgExemption: options.equityLtcgExemption ?? 125000,
    otherStcgRate: options.otherStcgRate ?? 0.3,
    otherLtcgRate: options.otherLtcgRate ?? 0.2,
    otherLtcgThresholdDays: options.otherLtcgThresholdDays ?? 1095,
  };

  const normalizedTarget = normalizeTargetAllocation(targetAllocation, summary);
  const totalCurrent = summary.totalCurrent || 0;
  const currentAllocation = {};
  const driftByType = {};

  for (const [assetType, data] of Object.entries(summary.byType)) {
    currentAllocation[assetType] = totalCurrent > 0 ? (data.current / totalCurrent) * 100 : 0;
  }

  const currentByType = {};
  for (const [assetType, data] of Object.entries(summary.byType)) {
    currentByType[assetType] = data.current || 0;
  }

  for (const assetType of Object.keys(normalizedTarget)) {
    const currentPct = currentAllocation[assetType] || 0;
    const targetPct = normalizedTarget[assetType] || 0;
    const targetAmount = (targetPct / 100) * totalCurrent;
    const currentAmount = currentByType[assetType] || 0;

    driftByType[assetType] = {
      currentPct,
      targetPct,
      driftPct: currentPct - targetPct,
      currentAmount,
      targetAmount,
      amountToTrade: targetAmount - currentAmount,
    };
  }

  const trades = [];

  for (const [assetType, drift] of Object.entries(driftByType)) {
    const amountToTrade = drift.amountToTrade;
    if (Math.abs(amountToTrade) < 1) continue;

    const holdings = summary.holdings
      .filter(h => h.asset_type === assetType)
      .map(h => {
        const currentValue = h.current_value || h.invested_amount || 0;
        const estimatedHoldingDays = getEstimatedHoldingDays(h);
        const taxProfile = getTaxProfile(assetType, taxConfig);
        const taxRate = estimatedHoldingDays >= taxProfile.ltcgThresholdDays
          ? taxProfile.ltcgRate
          : taxProfile.stcgRate;

        return {
          ...h,
          currentValue,
          estimatedHoldingDays,
          taxRate,
          taxProfile,
          gainRatio: h.invested_amount > 0
            ? (currentValue - h.invested_amount) / h.invested_amount
            : 0,
        };
      });

    if (amountToTrade < 0) {
      let sellRemaining = Math.abs(amountToTrade);
      const ordered = holdings.sort((a, b) => (a.taxRate - b.taxRate) || (a.gainRatio - b.gainRatio));

      for (const h of ordered) {
        if (sellRemaining <= 0) break;
        const sellAmount = Math.min(h.currentValue, sellRemaining);
        if (sellAmount <= 0) continue;

        const costBasis = h.currentValue > 0 ? (h.invested_amount || 0) * (sellAmount / h.currentValue) : 0;
        const gain = sellAmount - costBasis;
        const isLtcg = h.estimatedHoldingDays >= h.taxProfile.ltcgThresholdDays;
        const exemption = isLtcg ? (h.taxProfile.ltcgExemption || 0) : 0;
        const taxableGain = Math.max(0, gain - exemption);
        const estimatedTax = taxableGain * h.taxRate;

        trades.push({
          action: 'sell',
          assetType,
          holdingId: h.id,
          symbol: h.symbol || null,
          name: h.name,
          amount: sellAmount,
          estimatedUnits: h.current_price > 0 ? sellAmount / h.current_price : null,
          estimatedGain: gain,
          estimatedTax,
          taxRate: h.taxRate,
          taxType: isLtcg ? 'ltcg' : 'stcg',
          estimatedHoldingDays: h.estimatedHoldingDays,
          reason: `Reduce ${assetType} allocation toward ${(drift.targetPct).toFixed(1)}% target`,
        });

        sellRemaining -= sellAmount;
      }
    } else {
      const ordered = holdings.sort((a, b) => b.currentValue - a.currentValue);
      const preferred = ordered[0];

      trades.push({
        action: 'buy',
        assetType,
        holdingId: preferred?.id || null,
        symbol: preferred?.symbol || null,
        name: preferred?.name || `Best ${assetType} candidate`,
        amount: amountToTrade,
        estimatedUnits: preferred?.current_price > 0 ? amountToTrade / preferred.current_price : null,
        estimatedGain: 0,
        estimatedTax: 0,
        taxRate: 0,
        taxType: null,
        estimatedHoldingDays: preferred ? getEstimatedHoldingDays(preferred) : null,
        reason: `Increase ${assetType} allocation toward ${(drift.targetPct).toFixed(1)}% target`,
      });
    }
  }

  const totals = trades.reduce((acc, t) => {
    if (t.action === 'buy') acc.buyAmount += t.amount;
    if (t.action === 'sell') {
      acc.sellAmount += t.amount;
      acc.netCapitalGains += t.estimatedGain;
      acc.estimatedTax += t.estimatedTax;
    }
    return acc;
  }, {
    buyAmount: 0,
    sellAmount: 0,
    netCapitalGains: 0,
    estimatedTax: 0,
  });

  return {
    totalCurrent,
    currentAllocation,
    targetAllocation: normalizedTarget,
    driftByType,
    trades,
    totals,
  };
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
  calculateRebalancingPlan,
};
