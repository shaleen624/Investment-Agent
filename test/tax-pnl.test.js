'use strict';

const assert = require('assert');

const {
  computeTaxPnlFromTransactions,
} = require('../src/portfolio/manager');

function testFifoStcgLtcgSplit() {
  const txns = [
    { id: 1, holding_id: 1, type: 'buy', quantity: 10, price: 100, amount: 1000, fees: 0, date: '2024-01-01T00:00:00.000Z' },
    { id: 2, holding_id: 1, type: 'buy', quantity: 5, price: 120, amount: 600, fees: 0, date: '2024-07-01T00:00:00.000Z' },
    { id: 3, holding_id: 1, type: 'sell', quantity: 12, price: 150, amount: 1800, fees: 0, date: '2025-01-15T00:00:00.000Z' },
  ];

  const tax = computeTaxPnlFromTransactions(txns);

  assert.strictEqual(Math.round(tax.realizedLtcg), 500, 'LTCG should include first lot gain');
  assert.strictEqual(Math.round(tax.realizedStcg), 60, 'STCG should include second lot gain');
  assert.strictEqual(Math.round(tax.realizedTotal), 560, 'Total gain should match STCG + LTCG');
  assert.strictEqual(tax.events.length, 2, 'FIFO sell should be split into two matched lot events');
  assert.strictEqual(tax.openLots.length, 1, 'One lot should remain partially open');
  assert.strictEqual(Math.round(tax.openLots[0].quantity_remaining), 3, 'Remaining open quantity should be 3');
  assert.strictEqual(tax.events[0].gain_type, 'ltcg', 'First matched lot should be LTCG');
  assert.strictEqual(tax.events[1].gain_type, 'stcg', 'Second matched lot should be STCG');
}

function testBoundaryOneYearClassifiedAsStcg() {
  const txns = [
    { id: 11, holding_id: 2, type: 'buy', quantity: 1, price: 100, amount: 100, fees: 0, date: '2024-01-01T00:00:00.000Z' },
    { id: 12, holding_id: 2, type: 'sell', quantity: 1, price: 130, amount: 130, fees: 0, date: '2024-12-31T00:00:00.000Z' },
  ];

  const tax = computeTaxPnlFromTransactions(txns);

  assert.strictEqual(Math.round(tax.realizedStcg), 30, 'Exactly 365 days should remain STCG');
  assert.strictEqual(Math.round(tax.realizedLtcg), 0, 'Exactly 365 days should not become LTCG');
}

function testSellAndRedemptionAliasesAndFees() {
  const txns = [
    { id: 21, holding_id: 3, type: 'sip', quantity: 10, price: 100, amount: 1000, fees: 10, date: '2023-01-01T00:00:00.000Z' },
    { id: 22, holding_id: 3, type: 'redemption', quantity: 4, price: 130, amount: 520, fees: 20, date: '2025-02-01T00:00:00.000Z' },
  ];

  const tax = computeTaxPnlFromTransactions(txns);

  const expectedUnitCost = 101;
  const expectedUnitProceeds = 125;
  const expectedGain = (expectedUnitProceeds - expectedUnitCost) * 4;

  assert.strictEqual(Math.round(tax.realizedLtcg), Math.round(expectedGain), 'Fees should adjust cost and proceeds in gain calculation');
  assert.strictEqual(Math.round(tax.realizedStcg), 0, 'Long holding period should classify as LTCG');
}

function run() {
  const tests = [
    testFifoStcgLtcgSplit,
    testBoundaryOneYearClassifiedAsStcg,
    testSellAndRedemptionAliasesAndFees,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }

  console.log(`\n${tests.length} tax P&L tests passed.`);
}

run();
