'use strict';

/**
 * Portfolio CLI — view, add, edit, delete holdings.
 * Also handles importing from files.
 */

const inquirer = require('inquirer');
const chalk    = require('chalk');
const path     = require('path');
const fs       = require('fs');
const pm       = require('../portfolio/manager');
const market   = require('../sources/market');

async function portfolioCLI() {
  while (true) {
    const summary = pm.getPortfolioSummary();

    // Header
    console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║         Portfolio Manager            ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════╝'));

    if (summary) {
      const pnlColor = summary.unrealizedPnl >= 0 ? chalk.green : chalk.red;
      console.log(`\n  Total Invested: ${chalk.white('₹' + summary.totalInvested.toLocaleString('en-IN'))}`);
      console.log(`  Current Value:  ${chalk.white('₹' + summary.totalCurrent.toLocaleString('en-IN'))}`);
      console.log(`  Unrealized P&L: ${pnlColor('₹' + summary.unrealizedPnl.toLocaleString('en-IN') + ' (' + summary.pnlPercent.toFixed(2) + '%)')}`);
      console.log(`  Holdings:       ${summary.holdingsCount}\n`);
    } else {
      console.log(chalk.yellow('\n  No holdings yet.\n'));
    }

    const { action } = await inquirer.prompt([{
      type:    'list',
      name:    'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📋 View all holdings',          value: 'view'    },
        { name: '📊 View allocation breakdown',   value: 'alloc'   },
        { name: '➕ Add holding manually',        value: 'add'     },
        { name: '📁 Import from file (CSV/PDF)',  value: 'import'  },
        { name: '🔄 Sync from broker (Kite/Groww)', value: 'sync'    },
        { name: '✏️  Edit holding',               value: 'edit'    },
        { name: '🗑️  Delete holding',             value: 'delete'  },
        { name: '💰 Refresh prices',              value: 'refresh' },
        { name: '🔙 Back',                        value: 'back'    },
      ],
    }]);

    if (action === 'back') break;
    await handlePortfolioAction(action, summary);
  }
}

async function handlePortfolioAction(action, summary) {
  switch (action) {

    case 'view': {
      const holdings = pm.getAllHoldings();
      if (!holdings.length) { console.log(chalk.yellow('\nNo holdings.\n')); break; }

      console.log(chalk.bold('\n' + [
        'Symbol/Name'.padEnd(22),
        'Type'.padEnd(14),
        'Qty'.padStart(8),
        'Avg Price'.padStart(12),
        'Curr Value'.padStart(14),
        'P&L%'.padStart(8),
      ].join('  ')));
      console.log('─'.repeat(90));

      holdings.forEach(h => {
        const pnlStr = h.pnl_percent != null
          ? (h.pnl_percent >= 0 ? chalk.green('+' + h.pnl_percent.toFixed(1) + '%') : chalk.red(h.pnl_percent.toFixed(1) + '%'))
          : '   N/A';

        console.log([
          (h.symbol || h.name).slice(0, 22).padEnd(22),
          h.asset_type.slice(0, 14).padEnd(14),
          String(h.quantity).padStart(8),
          ('₹' + (h.avg_buy_price || 0).toFixed(2)).padStart(12),
          ('₹' + Math.round(h.current_value || h.invested_amount || 0).toLocaleString('en-IN')).padStart(14),
          pnlStr.padStart(8),
        ].join('  '));
      });
      console.log('');
      break;
    }

    case 'alloc': {
      if (!summary) { console.log(chalk.yellow('\nNo data.\n')); break; }
      console.log(chalk.bold('\n── Allocation by Asset Type ──'));
      for (const [type, data] of Object.entries(summary.byType)) {
        const pct = (data.invested / summary.totalInvested * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`  ${type.padEnd(15)} ${bar.padEnd(25)} ${pct}%`);
      }
      if (Object.keys(summary.bySector).length) {
        console.log(chalk.bold('\n── Allocation by Sector ──'));
        Object.entries(summary.bySector)
          .sort((a, b) => b[1].invested - a[1].invested)
          .forEach(([sector, data]) => {
            const pct = (data.invested / summary.totalInvested * 100).toFixed(1);
            console.log(`  ${sector.padEnd(25)} ${pct}%`);
          });
      }
      console.log('');
      break;
    }

    case 'add': {
      await addHoldingManually();
      break;
    }

    case 'import': {
      await importFromFile();
      break;
    }

    case 'sync': {
      await syncFromBroker();
      break;
    }

    case 'refresh': {
      console.log(chalk.gray('\nRefreshing prices (this may take a moment)...'));
      const result = await market.updateAllPrices();
      console.log(chalk.green(`\n✓ Updated: ${result.updated}, Failed: ${result.failed}, Skipped: ${result.skipped}\n`));
      break;
    }

    case 'edit': {
      await editHolding();
      break;
    }

    case 'delete': {
      await deleteHolding();
      break;
    }
  }
}

async function addHoldingManually() {
  const { asset_type } = await inquirer.prompt([{
    type:    'list',
    name:    'asset_type',
    message: 'Asset type:',
    choices: ['equity', 'mutual_fund', 'etf', 'bond', 'fd', 'nps', 'crypto', 'us_stock', 'other'],
  }]);

  const questions = [
    {
      type:     'input',
      name:     'symbol',
      message:  'Symbol/Ticker (e.g. RELIANCE, TCS):',
      when:     a => !['mutual_fund', 'fd', 'nps', 'other'].includes(a.asset_type || asset_type),
    },
    {
      type:     'input',
      name:     'name',
      message:  'Full name:',
      validate: v => v.trim().length > 0 || 'Required',
    },
    {
      type:     'list',
      name:     'exchange',
      message:  'Exchange:',
      choices:  ['NSE', 'BSE', 'NYSE', 'NASDAQ', 'OTHER'],
      default:  'NSE',
      when:     a => !['mutual_fund', 'fd', 'nps'].includes(a.asset_type || asset_type),
    },
    {
      type:     'number',
      name:     'quantity',
      message:  'Quantity / Units:',
      validate: v => v > 0 || 'Must be > 0',
    },
    {
      type:     'number',
      name:     'avg_buy_price',
      message:  'Average buy price / NAV:',
      validate: v => v > 0 || 'Must be > 0',
    },
    {
      type:     'input',
      name:     'sector',
      message:  'Sector (optional):',
      default:  '',
    },
  ];

  const answers = await inquirer.prompt(questions);
  const holding = {
    ...answers,
    asset_type,
    broker: 'manual',
    invested_amount: answers.quantity * answers.avg_buy_price,
  };

  pm.upsertHolding(holding);
  console.log(chalk.green(`\n✓ ${answers.name} added\n`));
}

async function importFromFile() {
  const { parseFile } = require('../portfolio/parser');

  const { filePath } = await inquirer.prompt([{
    type:     'input',
    name:     'filePath',
    message:  'File path (CSV or PDF):',
    validate: v => fs.existsSync(path.resolve(v)) || 'File not found',
  }]);

  try {
    const holdings = await parseFile(path.resolve(filePath));
    if (!holdings.length) {
      console.log(chalk.yellow('\n⚠ No holdings parsed. Check file format.\n'));
      return;
    }

    console.log(chalk.cyan(`\nParsed ${holdings.length} holdings. First 5:`));
    holdings.slice(0, 5).forEach(h =>
      console.log(`  • ${(h.symbol || h.name).padEnd(20)} Qty: ${h.quantity}`)
    );

    const { confirm } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirm',
      message: `Import all ${holdings.length} holdings?`,
      default: true,
    }]);

    if (confirm) {
      pm.upsertHoldings(holdings);
      console.log(chalk.green(`\n✓ Imported ${holdings.length} holdings\n`));
    }
  } catch (err) {
    console.log(chalk.red(`\n✗ Error: ${err.message}\n`));
  }
}

async function syncFromBroker() {
  const kite = require('../sources/brokers/kite');
  const groww = require('../sources/brokers/groww');

  const { broker } = await inquirer.prompt([{
    type: 'list',
    name: 'broker',
    message: 'Select broker to sync from:',
    choices: [
      { name: 'Kite', value: 'kite' },
      { name: 'Groww', value: 'groww' },
    ],
  }]);

  if (broker === 'kite') {
    if (!kite.isConfigured()) {
      console.log(chalk.yellow('\n⚠ Kite not configured. Set KITE_API_KEY and KITE_ACCESS_TOKEN in .env\n'));
      console.log('Steps:');
      console.log('  1. Enable Kite Connect API at: https://kite.trade/');
      console.log('  2. Add KITE_API_KEY and KITE_API_SECRET to .env');
      console.log('  3. Login URL: ' + chalk.cyan(kite.getLoginUrl()));
      console.log('  4. After login, pass request_token to kite.generateSession()\n');
      return;
    }

    console.log(chalk.gray('\nFetching from Kite...'));
    try {
      const [equities, mfHoldings] = await Promise.allSettled([
        kite.getHoldings(),
        kite.getMFHoldings(),
      ]);

      const all = [
        ...(equities.status === 'fulfilled' ? equities.value : []),
        ...(mfHoldings.status === 'fulfilled' ? mfHoldings.value : []),
      ];

      if (!all.length) { console.log(chalk.yellow('\n⚠ No holdings returned\n')); return; }

      pm.upsertHoldings(all);
      console.log(chalk.green(`\n✓ Synced ${all.length} holdings from Kite\n`));
    } catch (err) {
      console.log(chalk.red(`\n✗ Kite sync failed: ${err.message}\n`));
    }
    return;
  }

  if (!groww.isConfigured()) {
    console.log(chalk.yellow('\n⚠ Groww not configured. Set GROWW_API_KEY in .env\n'));
    console.log('Steps:');
    console.log('  1. Create or access your Groww Trade API token');
    console.log('  2. Add GROWW_API_KEY to .env');
    console.log('  3. Retry broker sync from portfolio menu\n');
    return;
  }

  console.log(chalk.gray('\nFetching from Groww...'));
  try {
    const holdings = await groww.getHoldings();
    if (!holdings.length) { console.log(chalk.yellow('\n⚠ No holdings returned\n')); return; }

    pm.upsertHoldings(holdings);
    console.log(chalk.green(`\n✓ Synced ${holdings.length} holdings from Groww\n`));
  } catch (err) {
    console.log(chalk.red(`\n✗ Groww sync failed: ${err.message}\n`));
  }
}

async function editHolding() {
  const holdings = pm.getAllHoldings();
  if (!holdings.length) { console.log(chalk.yellow('\nNo holdings.\n')); return; }

  const { id } = await inquirer.prompt([{
    type:    'list',
    name:    'id',
    message: 'Select holding to edit:',
    choices: holdings.map(h => ({
      name:  `${(h.symbol || h.name).padEnd(20)} | ${h.asset_type.padEnd(12)} | Qty: ${h.quantity}`,
      value: h.id,
    })),
  }]);

  const h = pm.getHolding(id);
  const answers = await inquirer.prompt([
    { type: 'number', name: 'quantity',       message: 'Quantity:',       default: h.quantity },
    { type: 'number', name: 'avg_buy_price',  message: 'Avg buy price:',  default: h.avg_buy_price },
    { type: 'input',  name: 'sector',         message: 'Sector:',         default: h.sector || '' },
  ]);

  pm.upsertHolding({ ...h, ...answers });
  console.log(chalk.green('\n✓ Updated\n'));
}

async function deleteHolding() {
  const holdings = pm.getAllHoldings();
  if (!holdings.length) { console.log(chalk.yellow('\nNo holdings.\n')); return; }

  const { id } = await inquirer.prompt([{
    type:    'list',
    name:    'id',
    message: 'Select holding to delete:',
    choices: holdings.map(h => ({
      name:  `${(h.symbol || h.name).padEnd(20)} | Qty: ${h.quantity}`,
      value: h.id,
    })),
  }]);

  const { confirm } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirm',
    message: chalk.red('Delete this holding? This cannot be undone.'),
    default: false,
  }]);

  if (confirm) {
    pm.deleteHolding(id);
    console.log(chalk.green('\n✓ Deleted\n'));
  }
}

module.exports = { portfolioCLI };
