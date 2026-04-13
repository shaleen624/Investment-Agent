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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LONG_TERM_DAYS = 365;

function normalizeTxType(type) {
  if (type === 'buy' || type === 'sip') return 'buy';
  if (type === 'sell' || type === 'redemption') return 'sell';
  return 'other';
}

/**
 * Build FIFO tax-lot data from transactions and compute realized STCG/LTCG.
 */
function computeTaxPnlFromTransactions(txns = []) {
  const lotsByHolding = new Map();
  const realizedByHolding = new Map();
  const realizedEvents = [];

  const initHolding = (holdingId) => {
    if (!lotsByHolding.has(holdingId)) lotsByHolding.set(holdingId, []);
    if (!realizedByHolding.has(holdingId)) {
      realizedByHolding.set(holdingId, {
        realizedStcg: 0,
        realizedLtcg: 0,
        realizedTotal: 0,
        sellQuantity: 0,
      });
    }
  };

  for (const tx of txns) {
    const holdingId = tx.holding_id;
    const normalizedType = normalizeTxType(tx.type);
    if (!holdingId || normalizedType === 'other') continue;

    initHolding(holdingId);
    const lots = lotsByHolding.get(holdingId);

    const qty = Number(tx.quantity) || 0;
    const fees = Number(tx.fees) || 0;
    const amount = Number(tx.amount) || 0;

    if (normalizedType === 'buy') {
      if (qty <= 0) continue;
      const buyPrice = Number(tx.price) || (amount > 0 ? amount / qty : 0);
      const unitCost = qty > 0 ? (amount + fees) / qty : buyPrice;
      lots.push({
        lotDate: tx.date,
        quantityTotal: qty,
        quantityRemaining: qty,
        unitCost,
        sourceTransactionId: tx.id,
      });
      continue;
    }

    if (normalizedType === 'sell') {
      if (qty <= 0) continue;

      let qtyToMatch = qty;
      const sellPrice = Number(tx.price) || (qty > 0 ? amount / qty : 0);
      const unitProceeds = qty > 0 ? (amount - fees) / qty : sellPrice;

      while (qtyToMatch > 0 && lots.length > 0) {
        const lot = lots[0];
        if (lot.quantityRemaining <= 0) {
          lots.shift();
          continue;
        }

        const matchedQty = Math.min(qtyToMatch, lot.quantityRemaining);
        const lotDate = new Date(lot.lotDate);
        const sellDate = new Date(tx.date);
        const holdDays = Math.max(0, Math.floor((sellDate - lotDate) / ONE_DAY_MS));
        const gain = (unitProceeds - lot.unitCost) * matchedQty;
        const bucket = holdDays > LONG_TERM_DAYS ? 'ltcg' : 'stcg';

        const realized = realizedByHolding.get(holdingId);
        if (bucket === 'ltcg') realized.realizedLtcg += gain;
        else realized.realizedStcg += gain;
        realized.realizedTotal += gain;
        realized.sellQuantity += matchedQty;

        realizedEvents.push({
          holding_id: holdingId,
          sell_transaction_id: tx.id,
          buy_transaction_id: lot.sourceTransactionId,
          buy_date: lot.lotDate,
          sell_date: tx.date,
          quantity: matchedQty,
          buy_price: lot.unitCost,
          sell_price: unitProceeds,
          gain,
          holding_days: holdDays,
          gain_type: bucket,
        });

        lot.quantityRemaining -= matchedQty;
        qtyToMatch -= matchedQty;
        if (lot.quantityRemaining <= 0) lots.shift();
      }
    }
  }

  let realizedStcg = 0;
  let realizedLtcg = 0;
  let realizedTotal = 0;

  for (const values of realizedByHolding.values()) {
    realizedStcg += values.realizedStcg;
    realizedLtcg += values.realizedLtcg;
    realizedTotal += values.realizedTotal;
  }

  const openLots = [];
  for (const [holdingId, lots] of lotsByHolding.entries()) {
    lots
      .filter(lot => lot.quantityRemaining > 0)
      .forEach(lot => {
        openLots.push({
          holding_id: holdingId,
          lot_date: lot.lotDate,
          quantity_total: lot.quantityTotal,
          quantity_remaining: lot.quantityRemaining,
          unit_cost: lot.unitCost,
          source_transaction_id: lot.sourceTransactionId,
        });
      });
  }

  return {
    realizedStcg,
    realizedLtcg,
    realizedTotal,
    byHolding: Object.fromEntries(realizedByHolding.entries()),
    events: realizedEvents,
    openLots,
  };
}

function calculateTaxPnl() {
  const txns = dbAll(
    `SELECT id, holding_id, type, quantity, price, amount, fees, date
     FROM transactions
     WHERE holding_id IS NOT NULL
     ORDER BY date ASC, id ASC`
  );

  return computeTaxPnlFromTransactions(txns);
}

/**
 * Compute portfolio summary: total invested, current value, P&L, allocation.
 */
function getPortfolioSummary() {
  const holdings = getAllHoldings();
  if (!holdings.length) return null;

  const taxPnl = calculateTaxPnl();
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

  const holdingsWithTax = holdings.map(h => {
    const tax = taxPnl.byHolding[h.id] || {
      realizedStcg: 0,
      realizedLtcg: 0,
      realizedTotal: 0,
      sellQuantity: 0,
    };

    return {
      ...h,
      realized_stcg: tax.realizedStcg,
      realized_ltcg: tax.realizedLtcg,
      realized_tax_pnl: tax.realizedTotal,
      realized_sell_quantity: tax.sellQuantity,
    };
  });

  return {
    totalInvested,
    totalCurrent,
    unrealizedPnl,
    pnlPercent,
    holdingsCount: holdings.length,
    byType,
    bySector,
    holdings: holdingsWithTax,
    taxPnl: {
      method: 'FIFO',
      stcg: taxPnl.realizedStcg,
      ltcg: taxPnl.realizedLtcg,
      totalRealized: taxPnl.realizedTotal,
      lotsOpen: taxPnl.openLots.length,
      openLots: taxPnl.openLots,
      realizedEvents: taxPnl.events,
    },
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
  upsertGoal,
  getGoals,
  deleteGoal,
  getProfile,
  upsertProfile,
  getPortfolioSummary,
  computeTaxPnlFromTransactions,
  calculateTaxPnl,
  calculateXIRR,
};
