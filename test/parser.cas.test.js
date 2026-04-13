'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCASStatement } = require('../src/portfolio/parser');
const { mapCasResponseToHoldings } = require('../src/sources/brokers/casparser');

test('parseCASStatement extracts equity and mutual fund holdings', () => {
  const text = [
    'Consolidated Account Statement',
    'CAS ID: ABCD1234',
    'INE002A01018 RELIANCE INDUSTRIES LTD 10 2,450.50 24,505.00',
    'Folio No: 123456/01',
    'HDFC Flexi Cap Fund Direct Growth units: 12.5 NAV: 150.25 value: 1,878.13',
  ].join('\n');

  const holdings = parseCASStatement(text);
  assert.equal(holdings.length, 2);

  const equity = holdings.find(h => h.asset_type === 'equity');
  const mf = holdings.find(h => h.asset_type === 'mutual_fund');

  assert.ok(equity);
  assert.equal(equity.symbol, 'INE002A01018');
  assert.equal(equity.quantity, 10);
  assert.equal(equity.avg_buy_price, 2450.5);

  assert.ok(mf);
  assert.equal(mf.name, 'HDFC Flexi Cap Fund Direct Growth');
  assert.equal(mf.quantity, 12.5);
  assert.equal(mf.nav, 150.25);
  assert.equal(mf.folio_number, '123456/01');
});

test('mapCasResponseToHoldings maps demat and mutual funds', () => {
  const payload = {
    meta: { cas_type: 'CDSL' },
    demat_accounts: [
      {
        demat_type: 'CDSL',
        holdings: [
          {
            isin: 'INE009A01021',
            security_name: 'INFOSYS LTD',
            quantity: '5',
            average_price: '1300',
            market_price: '1500',
          },
        ],
      },
    ],
    mutual_funds: [
      {
        folio_number: '1111/22',
        schemes: [
          {
            scheme_name: 'Axis Bluechip Fund',
            units: '100.5',
            nav: '52.1',
            avg_nav: '48.0',
          },
        ],
      },
    ],
  };

  const holdings = mapCasResponseToHoldings(payload);
  assert.equal(holdings.length, 2);

  const equity = holdings.find(h => h.asset_type === 'equity');
  const mf = holdings.find(h => h.asset_type === 'mutual_fund');

  assert.ok(equity);
  assert.equal(equity.symbol, 'INE009A01021');
  assert.equal(equity.broker, 'cdsl');
  assert.equal(equity.quantity, 5);
  assert.equal(equity.current_price, 1500);

  assert.ok(mf);
  assert.equal(mf.name, 'Axis Bluechip Fund');
  assert.equal(mf.quantity, 100.5);
  assert.equal(mf.folio_number, '1111/22');
});

test('parseCASStatement de-duplicates duplicate lines', () => {
  const line = 'INE002A01018 RELIANCE INDUSTRIES LTD 10 2450.50 24505.00';
  const text = [
    'CDSL Consolidated Account Statement',
    line,
    line,
  ].join('\n');

  const holdings = parseCASStatement(text);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].symbol, 'INE002A01018');
});
