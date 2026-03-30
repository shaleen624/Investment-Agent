#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const apiPort = process.env.SMOKE_API_PORT || '4018';
if (!process.env.API_PORT) process.env.API_PORT = apiPort;
if (!process.env.DB_PATH) {
  process.env.DB_PATH = process.env.SMOKE_DB_PATH || path.join(os.tmpdir(), `investment-smoke-${Date.now()}.db`);
}

const { app } = require('../src/api/server');
const { close: closeDb } = require('../src/db');

function print(msg = '') { process.stdout.write(`${msg}\n`); }

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function request(base, method, route, opts = {}) {
  const { token, json, formData, timeoutMs = 70000 } = opts;
  const headers = {};
  let body;

  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (formData) {
    body = formData;
  }

  const res = await fetch(base + route, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  const server = app.listen(Number(apiPort), '127.0.0.1');
  const base = `http://127.0.0.1:${apiPort}`;
  const results = [];

  async function run(name, fn, check) {
    try {
      const res = await fn();
      const ok = check(res);
      results.push({
        name,
        ok,
        status: res.status,
        detail: ok ? '' : JSON.stringify(res.data).slice(0, 220),
      });
      return res;
    } catch (err) {
      results.push({ name, ok: false, status: 0, detail: err.message || String(err) });
      return null;
    }
  }

  const tempFiles = [];
  try {
    const username = `smoke_${Date.now()}`;

    const reg = await run(
      'POST /api/auth/register',
      () => request(base, 'POST', '/api/auth/register', { json: { username, password: 'secret123' } }),
      (r) => r.status === 201 && !!r.data?.token && !!r.data?.user?.id
    );
    if (!reg?.data?.token) throw new Error('Cannot continue without auth token from register');
    const token = reg.data.token;

    await run(
      'POST /api/auth/login',
      () => request(base, 'POST', '/api/auth/login', { json: { username, password: 'secret123' } }),
      (r) => r.status === 200 && !!r.data?.token
    );

    await run(
      'GET /api/auth/verify',
      () => request(base, 'GET', '/api/auth/verify', { token }),
      (r) => r.status === 200 && r.data?.valid === true
    );

    await run(
      'GET /api/status',
      () => request(base, 'GET', '/api/status'),
      (r) => r.status === 200 && r.data?.ok === true
    );

    await run(
      'GET /api/portfolio/summary',
      () => request(base, 'GET', '/api/portfolio/summary', { token }),
      (r) => r.status === 200 && typeof r.data?.holdingsCount === 'number'
    );

    const addHolding = await run(
      'POST /api/portfolio/holdings',
      () => request(base, 'POST', '/api/portfolio/holdings', {
        token,
        json: {
          name: 'Reliance Industries',
          symbol: 'RELIANCE',
          asset_type: 'equity',
          quantity: 10,
          avg_buy_price: 2500,
          exchange: 'NSE',
          broker: 'manual',
        },
      }),
      (r) => r.status === 201 && !!r.data?.id
    );
    const holdingId = addHolding?.data?.id;

    await run(
      'GET /api/portfolio/holdings',
      () => request(base, 'GET', '/api/portfolio/holdings', { token }),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'GET /api/portfolio/holdings/:id',
      () => request(base, 'GET', `/api/portfolio/holdings/${holdingId}`, { token }),
      (r) => r.status === 200 && r.data?.id === holdingId
    );

    await run(
      'PUT /api/portfolio/holdings/:id',
      () => request(base, 'PUT', `/api/portfolio/holdings/${holdingId}`, { token, json: { quantity: 12 } }),
      (r) => r.status === 200
    );

    await run(
      'POST /api/portfolio/import/text',
      () => request(base, 'POST', '/api/portfolio/import/text', { token, json: { text: 'TCS 5 @ 3500' } }),
      (r) => r.status === 200 && r.data?.parsed >= 1
    );

    const csvPath = path.join(os.tmpdir(), `smoke-${Date.now()}.csv`);
    tempFiles.push(csvPath);
    fs.writeFileSync(csvPath, 'Symbol,Name,Quantity,Avg Price,Exchange\nINFY,Infosys,2,1500,NSE\n');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(csvPath)], { type: 'text/csv' }), 'holdings.csv');
    await run(
      'POST /api/portfolio/import/file',
      () => request(base, 'POST', '/api/portfolio/import/file', { token, formData: form }),
      (r) => r.status === 200 && r.data?.parsed >= 1
    );

    await run(
      'POST /api/portfolio/prices/refresh',
      () => request(base, 'POST', '/api/portfolio/prices/refresh', { timeoutMs: 70000 }),
      (r) => r.status === 200 && typeof r.data?.updated === 'number'
    );

    await run(
      'POST /api/portfolio/sync/:broker',
      () => request(base, 'POST', '/api/portfolio/sync/unknown', { token }),
      (r) => r.status === 400 && !!r.data?.error
    );

    const addGoal = await run(
      'POST /api/goals',
      () => request(base, 'POST', '/api/goals', {
        token,
        json: { type: 'long_term', title: 'Retirement Corpus', target_amount: 10000000, risk_tolerance: 'moderate', priority: 3 },
      }),
      (r) => r.status === 201 && !!r.data?.id
    );
    const goalId = addGoal?.data?.id;

    await run(
      'GET /api/goals',
      () => request(base, 'GET', '/api/goals', { token }),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'PUT /api/goals/:id',
      () => request(base, 'PUT', `/api/goals/${goalId}`, {
        token,
        json: { type: 'long_term', title: 'Retirement Corpus Updated', risk_tolerance: 'moderate', priority: 2 },
      }),
      (r) => r.status === 200
    );

    await run(
      'DELETE /api/goals/:id',
      () => request(base, 'DELETE', `/api/goals/${goalId}`, { token }),
      (r) => r.status === 200 && r.data?.deleted === true
    );

    await run(
      'GET /api/briefs',
      () => request(base, 'GET', '/api/briefs?limit=10', { token }),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    const genBrief = await run(
      'POST /api/briefs/generate',
      () => request(base, 'POST', '/api/briefs/generate', { token, json: { type: 'morning', send: false }, timeoutMs: 120000 }),
      (r) => r.status === 200 && !!r.data?.briefId
    );
    const briefId = genBrief?.data?.briefId;

    await run(
      'GET /api/briefs/latest',
      () => request(base, 'GET', '/api/briefs/latest?type=morning', { token }),
      (r) => r.status === 200 && !!r.data?.id
    );

    await run(
      'GET /api/briefs/:id',
      () => request(base, 'GET', `/api/briefs/${briefId}`, { token }),
      (r) => r.status === 200 && r.data?.id === briefId
    );

    await run(
      'GET /api/briefs/:id/recommendations',
      () => request(base, 'GET', `/api/briefs/${briefId}/recommendations`, { token }),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'POST /api/market/refresh',
      () => request(base, 'POST', '/api/market/refresh'),
      (r) => r.status === 200 && typeof r.data === 'object'
    );

    await run(
      'GET /api/market/snapshot',
      () => request(base, 'GET', '/api/market/snapshot'),
      (r) => r.status === 200 || r.status === 404
    );

    await run(
      'GET /api/market/snapshot/previous',
      () => request(base, 'GET', '/api/market/snapshot/previous'),
      (r) => r.status === 200
    );

    await run(
      'GET /api/market/snapshots',
      () => request(base, 'GET', '/api/market/snapshots?days=7'),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'GET /api/market/recommendations',
      () => request(base, 'GET', '/api/market/recommendations?limit=10'),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'POST /api/news/fetch',
      () => request(base, 'POST', '/api/news/fetch', { json: {} }),
      (r) => r.status === 200 && typeof r.data?.fetched === 'number'
    );

    await run(
      'GET /api/news',
      () => request(base, 'GET', '/api/news?limit=10&hours=24'),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'POST /api/notifications/test',
      () => request(base, 'POST', '/api/notifications/test'),
      (r) => r.status === 200 && typeof r.data === 'object'
    );

    await run(
      'POST /api/notifications/alert',
      () => request(base, 'POST', '/api/notifications/alert', { json: { message: 'API smoke alert' } }),
      (r) => r.status === 200 && typeof r.data === 'object'
    );

    await run(
      'GET /api/notifications/log',
      () => request(base, 'GET', '/api/notifications/log?limit=10'),
      (r) => r.status === 200 && Array.isArray(r.data)
    );

    await run(
      'GET /api/notifications/profile',
      () => request(base, 'GET', '/api/notifications/profile'),
      (r) => r.status === 200 && typeof r.data === 'object'
    );

    await run(
      'PUT /api/notifications/profile',
      () => request(base, 'PUT', '/api/notifications/profile', {
        json: { name: 'Smoke Tester', morning_time: '09:10', evening_time: '21:10', timezone: 'Asia/Kolkata' },
      }),
      (r) => r.status === 200 && r.data?.updated === true
    );

    await run(
      'POST /api/auth/logout',
      () => request(base, 'POST', '/api/auth/logout', { token }),
      (r) => r.status === 200 && !!r.data?.message
    );
  } finally {
    server.close();
    closeDb();
    for (const file of tempFiles) {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  const failed = results.filter((r) => !r.ok);
  print('\nAPI ENDPOINT CHECKS');
  for (const r of results) {
    print(`${r.ok ? 'PASS' : 'FAIL'} - ${r.name} [${r.status}]${r.detail ? ` ${r.detail}` : ''}`);
  }
  print(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
main().catch((err) => {
  console.error('SMOKE_FATAL', err.message || err);
  process.exit(1);
});
