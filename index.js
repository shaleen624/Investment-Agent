#!/usr/bin/env node
'use strict';

/**
 * Investment Agent — Entry Point
 *
 * Usage:
 *   node index.js                  — Start silent agent (scheduler + Telegram bot)
 *   node index.js setup            — First-time setup wizard
 *   node index.js portfolio        — Manage portfolio (interactive CLI)
 *   node index.js goals            — Manage investment goals
 *   node index.js brief morning    — Generate + send morning brief now
 *   node index.js brief evening    — Generate + send evening brief now
 *   node index.js analyze          — Run full portfolio analysis
 *   node index.js status           — Show agent status and config summary
 *   node index.js notify test      — Test notification channels
 *   node index.js prices refresh   — Refresh all holding prices
 */

require('dotenv').config();

const chalk = require('chalk');
const args  = process.argv.slice(2);
const cmd   = args[0] || 'start';
const sub   = args[1] || '';

// ── Ensure data/uploads/logs directories exist ─────────────────────────────
const fs   = require('fs');
const path = require('path');
['./data', './uploads', './logs'].forEach(dir => {
  const p = path.resolve(dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

async function main() {
  switch (cmd) {

    // ── Start agent (default) ───────────────────────────────────────────────
    case 'start': {
      const agent = require('./src/agent');
      printBanner();
      await agent.start();
      // Keep process alive
      break;
    }

    // ── Setup wizard ────────────────────────────────────────────────────────
    case 'setup': {
      const { runSetup } = require('./src/cli/setup');
      await runSetup();
      process.exit(0);
      break;
    }

    // ── Portfolio manager ───────────────────────────────────────────────────
    case 'portfolio': {
      const { portfolioCLI } = require('./src/cli/portfolio');
      await portfolioCLI();
      process.exit(0);
      break;
    }

    // ── Goals manager ────────────────────────────────────────────────────────
    case 'goals': {
      const { goalsCLI } = require('./src/cli/goals');
      await goalsCLI();
      process.exit(0);
      break;
    }

    // ── Manual brief trigger ─────────────────────────────────────────────────
    case 'brief': {
      const analysis = require('./src/analysis/engine');
      const notify   = require('./src/notifications');
      const type     = sub === 'evening' ? 'evening' : 'morning';

      console.log(chalk.cyan(`\nGenerating ${type} brief...`));

      const { content, briefId } = type === 'morning'
        ? await analysis.generateMorningBrief()
        : await analysis.generateEveningBrief();

      console.log('\n' + chalk.dim('─'.repeat(70)));
      console.log(content);
      console.log(chalk.dim('─'.repeat(70)) + '\n');

      const { confirm } = await require('inquirer').prompt([{
        type:    'confirm',
        name:    'confirm',
        message: 'Send this brief to notification channels?',
        default: true,
      }]);

      if (confirm) {
        const sent = await notify.sendBriefToAll(content, type, briefId);
        console.log(chalk.green(`\n✓ Sent via: ${sent.join(', ') || 'none'}\n`));
        analysis.markBriefSent(briefId, sent);
      }

      process.exit(0);
      break;
    }

    // ── On-demand analysis ────────────────────────────────────────────────────
    case 'analyze': {
      const analysis = require('./src/analysis/engine');
      console.log(chalk.cyan('\nRunning portfolio analysis (this may take 30-60 seconds)...\n'));
      const result = await analysis.analyzePortfolio();
      console.log(result);
      process.exit(0);
      break;
    }

    // ── Status ────────────────────────────────────────────────────────────────
    case 'status': {
      await showStatus();
      process.exit(0);
      break;
    }

    // ── Notification test ─────────────────────────────────────────────────────
    case 'notify': {
      if (sub === 'test') {
        const notify = require('./src/notifications');
        console.log(chalk.cyan('\nTesting notification channels...\n'));
        const results = await notify.testChannels();
        Object.entries(results).forEach(([ch, r]) => {
          const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${icon} ${ch.padEnd(12)} ${r.ok ? 'OK' : r.error}`);
        });
        console.log('');
      }
      process.exit(0);
      break;
    }

    // ── Price refresh ─────────────────────────────────────────────────────────
    case 'prices': {
      if (sub === 'refresh') {
        const market = require('./src/sources/market');
        console.log(chalk.cyan('\nRefreshing prices...\n'));
        const result = await market.updateAllPrices();
        console.log(chalk.green(`✓ Updated: ${result.updated}  Failed: ${result.failed}  Skipped: ${result.skipped}\n`));
      }
      process.exit(0);
      break;
    }

    default: {
      printHelp();
      process.exit(0);
    }
  }
}

// ── Status display ────────────────────────────────────────────────────────────

async function showStatus() {
  const { config, validate } = require('./src/config');
  const pm = require('./src/portfolio/manager');
  const { getLatestBrief } = require('./src/analysis/engine');

  console.log(chalk.bold('\n═══ Investment Agent Status ═══\n'));

  // Config warnings
  const warnings = validate();
  if (warnings.length) {
    console.log(chalk.yellow('⚠ Configuration warnings:'));
    warnings.forEach(w => console.log('  ' + chalk.yellow(w)));
    console.log('');
  }

  // LLM
  const llmStatus = config.llm.provider === 'none' ? chalk.gray('disabled') :
    (config.llm.claude.apiKey || config.llm.openai.apiKey) ? chalk.green('configured') : chalk.red('no API key');
  console.log(`  LLM provider:   ${config.llm.provider} (${llmStatus})`);

  // Notifications
  const channels = config.notifications.channels;
  console.log(`  Notifications:  ${channels.join(', ')}`);
  console.log(`    Telegram:  ${config.notifications.telegram.enabled ? chalk.green('enabled') : chalk.gray('not configured')}`);
  console.log(`    Email:     ${config.notifications.email.enabled    ? chalk.green('enabled') : chalk.gray('not configured')}`);
  console.log(`    WhatsApp:  ${config.notifications.whatsapp.enabled ? chalk.green('enabled') : chalk.gray('not configured')}`);

  // Portfolio
  const summary = pm.getPortfolioSummary();
  if (summary) {
    console.log(`\n  Portfolio:`);
    console.log(`    Holdings:       ${summary.holdingsCount}`);
    console.log(`    Total invested: ₹${summary.totalInvested.toLocaleString('en-IN')}`);
    console.log(`    Current value:  ₹${summary.totalCurrent.toLocaleString('en-IN')}`);
    const pnlColor = summary.unrealizedPnl >= 0 ? chalk.green : chalk.red;
    console.log(`    P&L:            ${pnlColor('₹' + summary.unrealizedPnl.toLocaleString('en-IN') + ' (' + summary.pnlPercent.toFixed(2) + '%)')}`);
  } else {
    console.log(chalk.yellow('\n  No portfolio data. Run: node index.js portfolio'));
  }

  // Goals
  const goals = pm.getGoals();
  console.log(`\n  Active goals: ${goals.length}`);
  goals.forEach(g => console.log(`    [${g.type}] ${g.title}`));

  // Last briefs
  const lastMorning = getLatestBrief('morning');
  const lastEvening = getLatestBrief('evening');
  console.log(`\n  Last morning brief: ${lastMorning?.date || 'none'}`);
  console.log(`  Last evening brief: ${lastEvening?.date || 'none'}`);

  // Schedule
  const profile     = pm.getProfile();
  console.log(`\n  Brief schedule:`);
  console.log(`    Morning: ${profile?.morning_time || config.scheduler.morningTime} IST`);
  console.log(`    Evening: ${profile?.evening_time || config.scheduler.eveningTime} IST`);
  console.log('');
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

function printBanner() {
  console.log(chalk.bold.blue(''));
  console.log(chalk.bold.blue('  ╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.blue('  ║        Investment Agent  v0.1.0          ║'));
  console.log(chalk.bold.blue('  ║   AI-powered portfolio analysis (India)  ║'));
  console.log(chalk.bold.blue('  ╚══════════════════════════════════════════╝'));
  console.log('');
}

function printHelp() {
  console.log(chalk.bold('\nInvestment Agent — Commands\n'));
  const cmds = [
    ['node index.js',               'Start agent (daemon mode — scheduler + Telegram bot)'],
    ['node index.js setup',         'First-time setup wizard'],
    ['node index.js portfolio',     'Manage your portfolio (interactive)'],
    ['node index.js goals',         'Manage investment goals'],
    ['node index.js brief morning', 'Generate + send morning brief now'],
    ['node index.js brief evening', 'Generate + send evening brief now'],
    ['node index.js analyze',       'Full on-demand portfolio analysis'],
    ['node index.js status',        'Show config and portfolio status'],
    ['node index.js notify test',   'Test notification channels'],
    ['node index.js prices refresh','Refresh all holding prices'],
  ];
  cmds.forEach(([cmd, desc]) =>
    console.log(`  ${chalk.cyan(cmd.padEnd(35))} ${chalk.gray(desc)}`)
  );
  console.log('');
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(chalk.red('\n✗ Fatal error:'), err.message);
  if (process.env.LOG_LEVEL === 'debug') console.error(err.stack);
  process.exit(1);
});
