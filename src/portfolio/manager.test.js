'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadManagerWithMockDb({ holdings, earliestBuyByHoldingId = {} }) {
  const dbPath = require.resolve('../db');
  const managerPath = require.resolve('./manager');

  delete require.cache[managerPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      run: () => ({ lastInsertRowid: 1 }),
      get: (sql, params = []) => {
        if (sql.includes('FROM transactions') && sql.includes('LIMIT 1')) {
          const date = earliestBuyByHoldingId[params[0]];
          return date ? { date } : undefined;
        }
        return undefined;
      },
      all: () => holdings,
    },
  };

  return require('./manager');
}

test('calculateRebalancingPlan computes drift and buy/sell trades', () => {
  const holdings = [
    {
      id: 1,
      asset_type: 'equity',
      symbol: 'ABC',
      name: 'ABC Ltd',
      current_price: 120,
      current_value: 1200,
      invested_amount: 1000,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      asset_type: 'mutual_fund',
      name: 'Balanced MF',
      current_price: 40,
      current_value: 800,
      invested_amount: 1000,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];

  const pm = loadManagerWithMockDb({ holdings });
  const plan = pm.calculateRebalancingPlan({ equity: 50, mutual_fund: 50 });

  assert.equal(Math.round(plan.totalCurrent), 2000);
  assert.ok(plan.driftByType.equity.currentPct > 50);
  assert.ok(plan.driftByType.mutual_fund.currentPct < 50);
  assert.ok(plan.trades.some(t => t.action === 'sell' && t.assetType === 'equity'));
  assert.ok(plan.trades.some(t => t.action === 'buy' && t.assetType === 'mutual_fund'));
  assert.ok(plan.totals.sellAmount > 0);
  assert.ok(plan.totals.buyAmount > 0);
});

test('calculateRebalancingPlan estimates STCG tax for short-term gains', () => {
  const holdings = [
    {
      id: 10,
      asset_type: 'equity',
      symbol: 'TAX',
      name: 'Taxable Equity',
      current_price: 120,
      current_value: 12000,
      invested_amount: 10000,
      created_at: '2026-03-01T00:00:00.000Z',
    },
  ];

  const pm = loadManagerWithMockDb({
    holdings,
    earliestBuyByHoldingId: { 10: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
  });

  const plan = pm.calculateRebalancingPlan({ equity: 20, other: 80 });
  const sellTrade = plan.trades.find(t => t.action === 'sell' && t.assetType === 'equity');

  assert.ok(sellTrade);
  assert.equal(sellTrade.taxType, 'stcg');
  assert.equal(Number(sellTrade.taxRate.toFixed(2)), 0.15);
  assert.ok(sellTrade.estimatedTax > 0);
});

test('calculateRebalancingPlan rejects empty target allocation', () => {
  const holdings = [
    {
      id: 1,
      asset_type: 'equity',
      symbol: 'ONE',
      name: 'One Asset',
      current_price: 100,
      current_value: 1000,
      invested_amount: 1000,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];

  const pm = loadManagerWithMockDb({ holdings });

  assert.throws(
    () => pm.calculateRebalancingPlan({ equity: 0, mutual_fund: 0 }),
    /Target allocation must include at least one positive percentage/
  );
});
