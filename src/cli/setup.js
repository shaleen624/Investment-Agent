'use strict';

/**
 * First-time setup wizard.
 * Walks the user through configuring their profile, notification channels,
 * and initial portfolio input.
 */

const inquirer = require('inquirer');
const chalk    = require('chalk');
const fs       = require('fs');
const path     = require('path');
const logger   = require('../config/logger');
const pm       = require('../portfolio/manager');

async function runSetup() {
  console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║   Investment Agent — Setup Wizard    ║'));
  console.log(chalk.bold.blue('╚══════════════════════════════════════╝\n'));

  // ── Step 1: Profile ────────────────────────────────────────────────────────
  console.log(chalk.cyan('Step 1/4: Your Profile\n'));

  const profileAnswers = await inquirer.prompt([
    {
      type:    'input',
      name:    'name',
      message: 'Your name:',
      default: 'Investor',
      validate: v => v.trim().length > 0 || 'Name is required',
    },
    {
      type:    'input',
      name:    'email',
      message: 'Your email (for email notifications):',
      default: '',
    },
    {
      type:    'input',
      name:    'telegram_id',
      message: 'Your Telegram Chat ID (leave blank to skip):',
      default: '',
    },
    {
      type:    'input',
      name:    'whatsapp',
      message: 'Your WhatsApp number (international, e.g. 919876543210, blank to skip):',
      default: '',
    },
  ]);

  // ── Step 2: Brief Times ────────────────────────────────────────────────────
  console.log(chalk.cyan('\nStep 2/4: Brief Schedule (IST)\n'));

  const timeAnswers = await inquirer.prompt([
    {
      type:    'input',
      name:    'morning_time',
      message: 'Morning brief time (HH:MM, 24h):',
      default: '08:00',
      validate: v => /^\d{1,2}:\d{2}$/.test(v) || 'Enter time as HH:MM',
    },
    {
      type:    'input',
      name:    'evening_time',
      message: 'Evening brief time (HH:MM, 24h):',
      default: '20:00',
      validate: v => /^\d{1,2}:\d{2}$/.test(v) || 'Enter time as HH:MM',
    },
  ]);

  pm.upsertProfile({
    ...profileAnswers,
    ...timeAnswers,
    timezone: 'Asia/Kolkata',
  });

  console.log(chalk.green('\n✓ Profile saved\n'));

  // ── Step 3: Notification Channels ─────────────────────────────────────────
  console.log(chalk.cyan('Step 3/4: Notification Channels\n'));

  console.log(chalk.yellow('To configure notifications, edit your .env file:'));
  console.log('  ' + chalk.gray('Telegram:  Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID'));
  console.log('  ' + chalk.gray('Email:     Set EMAIL_USER + EMAIL_PASS + EMAIL_TO'));
  console.log('  ' + chalk.gray('WhatsApp:  Set WHATSAPP_ENABLED=true + WHATSAPP_RECIPIENT\n'));

  const envExists = fs.existsSync(path.resolve('.env'));
  if (!envExists) {
    const { createEnv } = await inquirer.prompt([{
      type:    'confirm',
      name:    'createEnv',
      message: '.env file not found. Copy from .env.example?',
      default: true,
    }]);
    if (createEnv) {
      fs.copyFileSync(
        path.resolve('.env.example'),
        path.resolve('.env')
      );
      console.log(chalk.green('✓ .env file created. Edit it to add your API keys.\n'));
    }
  }

  // ── Step 4: Initial Portfolio ──────────────────────────────────────────────
  console.log(chalk.cyan('Step 4/4: Portfolio Input\n'));

  const { inputMethod } = await inquirer.prompt([{
    type:    'list',
    name:    'inputMethod',
    message: 'How would you like to add your portfolio?',
    choices: [
      { name: 'Import from CSV file (Kite/Groww export)',    value: 'csv'    },
      { name: 'Import from PDF (CDSL/NSDL CAS statement)',   value: 'pdf'    },
      { name: 'Enter manually (text)',                        value: 'text'   },
      { name: 'Skip for now (add later with: node index.js portfolio)', value: 'skip' },
    ],
  }]);

  if (inputMethod !== 'skip') {
    await handlePortfolioImport(inputMethod);
  }

  console.log(chalk.bold.green('\n✅ Setup complete!\n'));
  console.log('Next steps:');
  console.log('  ' + chalk.cyan('node index.js goals') + '       — Set your investment goals');
  console.log('  ' + chalk.cyan('node index.js start') + '       — Start the agent (silent + Telegram bot)');
  console.log('  ' + chalk.cyan('node index.js brief morning') + ' — Generate a brief now');
  console.log('  ' + chalk.cyan('node index.js portfolio') + '   — Manage portfolio\n');
}

async function handlePortfolioImport(method) {
  const { parseFile, parseText } = require('../portfolio/parser');
  const pm = require('../portfolio/manager');

  if (method === 'text') {
    console.log(chalk.gray('\nEnter holdings one per line. Format examples:'));
    console.log(chalk.gray('  RELIANCE 100 @ 2450.50'));
    console.log(chalk.gray('  TCS 50 shares 3200'));
    console.log(chalk.gray('  HDFC MF - 1250.345 units, NAV 48.23, folio 123456'));
    console.log(chalk.gray('  (Type END on a new line when done)\n'));

    const lines = [];
    const rl    = require('readline').createInterface({ input: process.stdin, output: process.stdout });

    await new Promise(resolve => {
      rl.on('line', line => {
        if (line.trim().toUpperCase() === 'END') { rl.close(); return; }
        lines.push(line);
      });
      rl.once('close', resolve);
    });

    const holdings = parseText(lines.join('\n'));
    if (holdings.length) {
      pm.upsertHoldings(holdings);
      console.log(chalk.green(`\n✓ ${holdings.length} holding(s) added\n`));
    } else {
      console.log(chalk.yellow('No holdings detected. Try the CSV import for better accuracy.\n'));
    }
    return;
  }

  // CSV or PDF
  const { filePath } = await inquirer.prompt([{
    type:     'input',
    name:     'filePath',
    message:  `Enter path to your ${method.toUpperCase()} file:`,
    validate: v => {
      const resolved = path.resolve(v);
      return fs.existsSync(resolved) || `File not found: ${resolved}`;
    },
  }]);

  try {
    console.log(chalk.gray('Parsing...'));
    const holdings = await parseFile(path.resolve(filePath));
    if (!holdings.length) {
      console.log(chalk.yellow('⚠ No holdings could be parsed. Check file format.'));
      return;
    }

    console.log(chalk.cyan(`\nFound ${holdings.length} holdings:`));
    holdings.slice(0, 10).forEach(h =>
      console.log(`  • ${(h.symbol || h.name).padEnd(20)} Qty: ${h.quantity}  Avg: ₹${h.avg_buy_price}`)
    );
    if (holdings.length > 10) console.log(`  ... and ${holdings.length - 10} more`);

    const { confirm } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirm',
      message: 'Import these holdings?',
      default: true,
    }]);

    if (confirm) {
      pm.upsertHoldings(holdings);
      console.log(chalk.green(`\n✓ ${holdings.length} holding(s) imported\n`));
    }
  } catch (err) {
    console.log(chalk.red(`\n✗ Parse error: ${err.message}\n`));
  }
}

module.exports = { runSetup };
