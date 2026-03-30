'use strict';

/**
 * Goals CLI — manage short-term and long-term investment goals.
 */

const inquirer = require('inquirer');
const chalk    = require('chalk');
const pm       = require('../portfolio/manager');
const llm      = require('../llm/provider');
const prompts  = require('../llm/prompts');
const { config } = require('../config');

function llmSetupHint() {
  if (config.llm.provider === 'deepseek' || config.llm.provider === 'kimi') {
    return 'Set NVIDIA_API_KEY in .env';
  }
  if (config.llm.provider === 'claude') {
    return 'Set ANTHROPIC_API_KEY in .env';
  }
  if (config.llm.provider === 'openai') {
    return 'Set OPENAI_API_KEY in .env';
  }
  return 'Set LLM_PROVIDER and matching API key in .env';
}

async function goalsCLI() {
  while (true) {
    const goals = pm.getGoals(false);

    console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║        Investment Goals              ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════╝\n'));

    if (goals.length) {
      const active   = goals.filter(g => g.is_active);
      const inactive = goals.filter(g => !g.is_active);

      if (active.length) {
        console.log(chalk.cyan('Active Goals:'));
        active.forEach((g, i) => printGoal(g, i + 1));
      }
      if (inactive.length) {
        console.log(chalk.gray('\nArchived Goals:'));
        inactive.forEach((g, i) => printGoal(g, i + 1, true));
      }
      console.log('');
    } else {
      console.log(chalk.yellow('  No goals set yet. Add one to get personalized advice.\n'));
    }

    const { action } = await inquirer.prompt([{
      type:    'list',
      name:    'action',
      message: 'What would you like to do?',
      choices: [
        { name: '➕ Add short-term goal',         value: 'add_short' },
        { name: '➕ Add long-term goal',           value: 'add_long'  },
        { name: '🤖 Get AI-suggested goals',       value: 'suggest'   },
        { name: '✏️  Edit goal',                   value: 'edit'      },
        { name: '🗄️  Archive goal',               value: 'archive'   },
        { name: '🗑️  Delete goal',                value: 'delete'    },
        { name: '🔙 Back',                         value: 'back'      },
      ],
    }]);

    if (action === 'back') break;
    await handleGoalAction(action, goals);
  }
}

function printGoal(g, num, dimmed = false) {
  const printer = dimmed ? chalk.gray : chalk.white;
  const typeTag  = g.type === 'short_term' ? chalk.yellow('[SHORT]') : chalk.blue('[LONG]');
  const risk     = { conservative: '🟢', moderate: '🟡', aggressive: '🔴' }[g.risk_tolerance] || '';

  console.log(`  ${num}. ${typeTag} ${printer(g.title)} ${risk}`);
  if (g.description)    console.log(`     ${chalk.gray(g.description)}`);
  if (g.target_amount)  console.log(`     Target: ${chalk.cyan('₹' + g.target_amount.toLocaleString('en-IN'))}`);
  if (g.target_date)    console.log(`     By: ${chalk.cyan(g.target_date)}`);
  console.log(`     Risk: ${g.risk_tolerance}  |  Priority: ${g.priority}`);
}

async function handleGoalAction(action, goals) {
  switch (action) {

    case 'add_short':
    case 'add_long': {
      const type = action === 'add_short' ? 'short_term' : 'long_term';
      await addGoal(type);
      break;
    }

    case 'suggest': {
      await suggestGoals();
      break;
    }

    case 'edit': {
      const active = goals.filter(g => g.is_active);
      if (!active.length) { console.log(chalk.yellow('\nNo active goals.\n')); break; }
      const { id } = await inquirer.prompt([{
        type:    'list',
        name:    'id',
        message: 'Select goal to edit:',
        choices: active.map(g => ({ name: `[${g.type}] ${g.title}`, value: g.id })),
      }]);
      const goal = active.find(g => g.id === id);
      await editGoal(goal);
      break;
    }

    case 'archive': {
      const active = goals.filter(g => g.is_active);
      if (!active.length) { console.log(chalk.yellow('\nNo active goals.\n')); break; }
      const { id } = await inquirer.prompt([{
        type:    'list',
        name:    'id',
        message: 'Select goal to archive:',
        choices: active.map(g => ({ name: `[${g.type}] ${g.title}`, value: g.id })),
      }]);
      pm.deleteGoal(id); // sets is_active = 0
      console.log(chalk.green('\n✓ Archived\n'));
      break;
    }

    case 'delete': {
      if (!goals.length) { console.log(chalk.yellow('\nNo goals.\n')); break; }
      const { id } = await inquirer.prompt([{
        type:    'list',
        name:    'id',
        message: 'Select goal to delete permanently:',
        choices: goals.map(g => ({ name: `[${g.type}] ${g.title}`, value: g.id })),
      }]);
      const { confirm } = await inquirer.prompt([{
        type:    'confirm',
        name:    'confirm',
        message: chalk.red('Permanently delete this goal?'),
        default: false,
      }]);
      if (confirm) {
        const { run } = require('../db');
        run('DELETE FROM goals WHERE id = ?', [id]);
        console.log(chalk.green('\n✓ Deleted\n'));
      }
      break;
    }
  }
}

async function addGoal(type) {
  const answers = await inquirer.prompt([
    {
      type:     'input',
      name:     'title',
      message:  `Goal title (e.g. "Retire at 50", "Buy house down payment"):`,
      validate: v => v.trim().length > 0 || 'Required',
    },
    {
      type:    'input',
      name:    'description',
      message: 'Brief description (optional):',
      default: '',
    },
    {
      type:    'input',
      name:    'target_amount',
      message: 'Target amount in ₹ (e.g. 5000000, leave blank if no specific target):',
      default: '',
      filter:  v => v ? parseFloat(v.replace(/,/g, '')) : null,
    },
    {
      type:    'input',
      name:    'target_date',
      message: 'Target date (YYYY-MM-DD, leave blank if open-ended):',
      default: '',
      validate: v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) || 'Format: YYYY-MM-DD',
    },
    {
      type:    'list',
      name:    'risk_tolerance',
      message: 'Risk tolerance for this goal:',
      choices: [
        { name: '🟢 Conservative (FDs, debt funds, blue-chip)',   value: 'conservative' },
        { name: '🟡 Moderate (balanced, Nifty 50 stocks)',        value: 'moderate'     },
        { name: '🔴 Aggressive (mid/small cap, sectoral, direct)', value: 'aggressive'  },
      ],
      default: 'moderate',
    },
    {
      type:    'number',
      name:    'priority',
      message: 'Priority (1 = highest, 10 = lowest):',
      default: 5,
      validate: v => (v >= 1 && v <= 10) || 'Enter 1-10',
    },
  ]);

  pm.upsertGoal({ ...answers, type });
  console.log(chalk.green('\n✓ Goal saved\n'));
}

async function editGoal(goal) {
  const answers = await inquirer.prompt([
    { type: 'input',  name: 'title',          message: 'Title:',         default: goal.title },
    { type: 'input',  name: 'description',    message: 'Description:',   default: goal.description || '' },
    { type: 'input',  name: 'target_amount',  message: 'Target amount:', default: goal.target_amount || '' },
    { type: 'input',  name: 'target_date',    message: 'Target date:',   default: goal.target_date  || '' },
    {
      type:    'list',
      name:    'risk_tolerance',
      message: 'Risk tolerance:',
      choices: ['conservative', 'moderate', 'aggressive'],
      default: goal.risk_tolerance,
    },
    { type: 'number', name: 'priority', message: 'Priority (1-10):', default: goal.priority },
  ]);

  pm.upsertGoal({ ...goal, ...answers });
  console.log(chalk.green('\n✓ Goal updated\n'));
}

async function suggestGoals() {
  if (!llm.isAvailable()) {
    console.log(chalk.yellow(`\n⚠ LLM not configured. ${llmSetupHint()} to use this feature.\n`));
    return;
  }

  const { userInput } = await inquirer.prompt([{
    type:    'input',
    name:    'userInput',
    message: 'Describe your financial goals in your own words:',
    validate: v => v.trim().length > 5 || 'Please describe your goals',
  }]);

  console.log(chalk.gray('\nAsking AI for goal suggestions...'));

  try {
    const portfolioSummary = require('../portfolio/manager').getPortfolioSummary();
    const prompt   = prompts.goalSuggestionPrompt({ portfolio: portfolioSummary, userInput });
    const response = await llm.chat(prompt, { maxTokens: 1000 });
    const suggested = llm.extractJSON(response);

    if (!Array.isArray(suggested) || !suggested.length) {
      console.log(chalk.yellow('\n⚠ Could not parse AI suggestions. Try adding goals manually.\n'));
      return;
    }

    console.log(chalk.cyan(`\nAI suggests ${suggested.length} goal(s):\n`));
    suggested.forEach((g, i) => {
      console.log(`  ${i + 1}. [${g.type}] ${chalk.white(g.title)}`);
      if (g.description)    console.log(`     ${chalk.gray(g.description)}`);
      if (g.target_amount)  console.log(`     Target: ₹${Number(g.target_amount).toLocaleString('en-IN')}`);
      if (g.target_date)    console.log(`     By: ${g.target_date}`);
      console.log(`     Risk: ${g.risk_tolerance}`);
    });

    const { saveAll } = await inquirer.prompt([{
      type:    'confirm',
      name:    'saveAll',
      message: 'Save all suggested goals?',
      default: true,
    }]);

    if (saveAll) {
      suggested.forEach(g => pm.upsertGoal(g));
      console.log(chalk.green(`\n✓ ${suggested.length} goal(s) saved\n`));
    }
  } catch (err) {
    console.log(chalk.red(`\n✗ Error: ${err.message}\n`));
  }
}

module.exports = { goalsCLI };
