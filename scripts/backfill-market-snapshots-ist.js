#!/usr/bin/env node
'use strict';

const { all, run, close } = require('../src/db');

function toIstDate(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function getBestTimestamp(row) {
  // 1) Prefer original source fetch timestamp, if available.
  try {
    const raw = JSON.parse(row.raw_data || '{}');
    if (raw && typeof raw.fetchedAt === 'string' && !Number.isNaN(new Date(raw.fetchedAt).getTime())) {
      return raw.fetchedAt;
    }
  } catch {}

  // 2) Fallback to SQLite created_at (stored in UTC by datetime('now')).
  if (row.created_at) {
    const iso = row.created_at.replace(' ', 'T') + 'Z';
    if (!Number.isNaN(new Date(iso).getTime())) return iso;
  }

  // 3) Last fallback to existing date+time interpreted as UTC.
  if (row.date && row.time) {
    const iso = `${row.date}T${row.time}:00Z`;
    if (!Number.isNaN(new Date(iso).getTime())) return iso;
  }

  return null;
}

function main() {
  const isApply = process.argv.includes('--apply');
  const rows = all(`SELECT id, date, time, created_at, raw_data FROM market_snapshots ORDER BY id ASC`);

  if (!rows.length) {
    console.log('No market_snapshots rows found.');
    return;
  }

  const changes = [];
  for (const row of rows) {
    const ts = getBestTimestamp(row);
    if (!ts) continue;

    const istDate = toIstDate(ts);
    if (!istDate) continue;

    if (istDate !== row.date) {
      changes.push({ id: row.id, oldDate: row.date, newDate: istDate, timestamp: ts });
    }
  }

  console.log(`Rows scanned: ${rows.length}`);
  console.log(`Rows needing IST date update: ${changes.length}`);

  if (!changes.length) return;

  for (const c of changes.slice(0, 20)) {
    console.log(`  id=${c.id} ${c.oldDate} -> ${c.newDate} (${c.timestamp})`);
  }
  if (changes.length > 20) {
    console.log(`  ...and ${changes.length - 20} more`);
  }

  if (!isApply) {
    console.log('\nDry run only. Re-run with --apply to write changes.');
    return;
  }

  const tx = run.bind(null);
  run('BEGIN');
  try {
    for (const c of changes) {
      tx(`UPDATE market_snapshots SET date = ? WHERE id = ?`, [c.newDate, c.id]);
    }
    run('COMMIT');
    console.log(`\nApplied updates: ${changes.length}`);
  } catch (err) {
    run('ROLLBACK');
    throw err;
  } finally {
    close();
  }
}

try {
  main();
} catch (err) {
  console.error('Backfill failed:', err.message || err);
  close();
  process.exit(1);
}
