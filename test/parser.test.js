'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseGrowwCSV,
  parseGenericCSV,
  parseFile,
} = require('../src/portfolio/parser');

test('parseGrowwCSV parses valid equity and mutual fund rows', () => {
  const csv = [
    'Type,Symbol,Company Name,Shares,Avg. Buy Price,Exchange',
    'Equity,RELIANCE,Reliance Industries,10,2500.5,NSE',
    'Mutual Fund,,Axis Bluechip Fund,25.55,42.1,',
  ].join('\n');

  const holdings = parseGrowwCSV(csv);
  assert.equal(holdings.length, 2);

  assert.equal(holdings[0].asset_type, 'equity');
  assert.equal(holdings[0].symbol, 'RELIANCE');
  assert.equal(holdings[0].quantity, 10);
  assert.equal(holdings[0].avg_buy_price, 2500.5);

  assert.equal(holdings[1].asset_type, 'mutual_fund');
  assert.equal(holdings[1].name, 'Axis Bluechip Fund');
  assert.equal(holdings[1].quantity, 25.55);
  assert.equal(holdings[1].units, 25.55);
});

test('parseGrowwCSV skips invalid rows', () => {
  const csv = [
    'Type,Symbol,Company Name,Shares,Avg. Buy Price,Exchange',
    'Equity,TCS,Tata Consultancy Services,0,3500,NSE',
    'Equity,,,12,3500,NSE',
  ].join('\n');

  const holdings = parseGrowwCSV(csv);
  assert.equal(holdings.length, 0);
});

test('parseGenericCSV validates required columns', () => {
  const csv = [
    'name,exchange',
    'Reliance,NSE',
  ].join('\n');

  assert.throws(() => parseGenericCSV(csv), /missing required columns/i);
});

test('parseGenericCSV handles currency/commas and computes invested amount fallback', () => {
  const csv = [
    'name,qty,avg price,exchange',
    'HDFC Bank,"1,200","₹1,650.50",NSE',
  ].join('\n');

  const holdings = parseGenericCSV(csv);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].quantity, 1200);
  assert.equal(holdings[0].avg_buy_price, 1650.5);
  assert.equal(holdings[0].invested_amount, 1200 * 1650.5);
});

test('parseFile rejects empty csv files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-'));
  const filePath = path.join(dir, 'empty.csv');
  fs.writeFileSync(filePath, '   \n');

  await assert.rejects(() => parseFile(filePath), /CSV file is empty/i);

  fs.rmSync(dir, { recursive: true, force: true });
});
