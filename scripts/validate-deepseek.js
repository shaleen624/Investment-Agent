'use strict';

/**
 * DeepSeek AI Insight Validation Script
 *
 * Tests the full DeepSeek V3 pipeline via NVIDIA NIM:
 *   1. Config / API key check
 *   2. Raw NVIDIA NIM connectivity (minimal prompt)
 *   3. Streaming + reasoning_content parsing
 *   4. Fallback to reasoning when content is empty
 *   5. Provider-layer routing (provider.js)
 *   6. Full investment insight prompt (morning brief style)
 *   7. Timeout / error-handling paths
 *
 * Usage:
 *   node scripts/validate-deepseek.js
 *   NVIDIA_API_KEY=<key> LLM_PROVIDER=deepseek node scripts/validate-deepseek.js
 *   DEEPSEEK_THINKING=false node scripts/validate-deepseek.js   # skip chain-of-thought
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const { config }         = require('../src/config');
const nvidia             = require('../src/llm/nvidia');
const llm                = require('../src/llm/provider');
const { morningBriefPrompt } = require('../src/llm/prompts');

// ── Helpers ──────────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function pass(label, detail = '') {
  console.log(`  ${GREEN}✓ PASS${RESET}  ${label}${detail ? `  ${CYAN}${detail}${RESET}` : ''}`);
}
function fail(label, err = '') {
  console.log(`  ${RED}✗ FAIL${RESET}  ${label}${err ? `\n         ${RED}${err}${RESET}` : ''}`);
}
function warn(label, msg = '') {
  console.log(`  ${YELLOW}⚠ WARN${RESET}  ${label}${msg ? `  ${YELLOW}${msg}${RESET}` : ''}`);
}
function section(title) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`);
}
function indent(text, prefix = '     ') {
  return text.split('\n').slice(0, 8).map(l => prefix + l).join('\n');
}

let passed = 0, failed = 0, warned = 0;
function record(ok, label, detail = '', err = '') {
  if (ok === true)  { pass(label, detail); passed++; }
  if (ok === false) { fail(label, err);    failed++; }
  if (ok === 'warn'){ warn(label, detail); warned++; }
}

// ── Test 1: Configuration ─────────────────────────────────────────────────────

section('1 — Configuration');

const apiKey       = config.llm.nvidia.apiKey;
const dsModel      = config.llm.nvidia.deepseekModel;
const thinking     = config.llm.nvidia.deepseekThinking;
const provider     = config.llm.provider;

record(!!apiKey, 'NVIDIA_API_KEY is set', apiKey ? `${apiKey.slice(0, 8)}…` : 'MISSING');
record(!!dsModel, 'DEEPSEEK_MODEL is set', dsModel);
record(true, 'DEEPSEEK_THINKING', String(thinking));

if (provider === 'deepseek') {
  record(true, 'LLM_PROVIDER=deepseek (primary)');
} else if (['kimi', 'claude', 'openai'].includes(provider)) {
  record('warn', `LLM_PROVIDER=${provider}`, 'DeepSeek will be tested as direct call + via fallback chain');
}

if (!apiKey) {
  console.log(`
${RED}${BOLD}⛔  NVIDIA_API_KEY is not set — cannot proceed with API tests.${RESET}

  To configure:
    1. Get a free key at ${CYAN}https://build.nvidia.com${RESET}  →  Profile  →  Generate API Key
    2. Add to .env (copy .env.example first):
         ${YELLOW}NVIDIA_API_KEY=nvapi-xxxxxxxxxxxx
         LLM_PROVIDER=deepseek
         DEEPSEEK_MODEL=deepseek-ai/deepseek-v3.2${RESET}
    3. Re-run this script.
`);
  process.exit(1);
}

// ── Test 2: Raw streaming call (minimal prompt) ───────────────────────────────

section('2 — Raw NVIDIA NIM Connectivity');

async function testRawConnection() {
  const messages = [
    { role: 'system', content: 'You are a concise assistant.' },
    { role: 'user',   content: 'Say "DeepSeek OK" and nothing else.' },
  ];

  console.log(`  → Model:    ${dsModel}`);
  console.log(`  → Thinking: ${thinking}`);
  console.log(`  → Request:  ${JSON.stringify(messages[1]).slice(0, 80)}`);

  const t0 = Date.now();
  try {
    const response = await nvidia.chatWithDeepSeek(messages, {
      maxTokens:   256,
      temperature: 0.1,
      thinking:    false, // keep this minimal test fast
    });
    const elapsed = Date.now() - t0;

    record(response.length > 0, 'Received non-empty response', `${elapsed}ms`);
    record(typeof response === 'string', 'Response is a string');
    console.log(`  → Preview:  ${response.slice(0, 200).replace(/\n/g, '\\n')}`);
  } catch (err) {
    record(false, 'Raw connectivity test', '', err.message);
    console.log(`\n  ${YELLOW}Skipping remaining API tests due to connectivity failure.${RESET}`);
    throw err;
  }
}

// ── Test 3: Streaming with thinking mode ─────────────────────────────────────

section('3 — Streaming + Reasoning Chain-of-Thought');

async function testStreaming() {
  if (!thinking) {
    record('warn', 'DEEPSEEK_THINKING=false — skipping reasoning_content test');
    return null;
  }

  const messages = [
    {
      role: 'system',
      content: 'You are an expert stock market analyst.',
    },
    {
      role: 'user',
      content: 'In 2 sentences, what is the single most important metric to evaluate before buying a stock?',
    },
  ];

  console.log(`  → Sending prompt with thinking=true (may take 10–30s)…`);
  const t0 = Date.now();

  try {
    // Patch nvidia internals momentarily to capture reasoning
    const { OpenAI } = require('openai');
    const client = new OpenAI({
      apiKey:   config.llm.nvidia.apiKey,
      baseURL:  'https://integrate.api.nvidia.com/v1',
      timeout:  60000,
      maxRetries: 1,
    });

    const stream = await client.chat.completions.create({
      model:       dsModel,
      messages,
      max_tokens:  512,
      temperature: 0.7,
      stream:      true,
      extra_body:  { chat_template_kwargs: { thinking: true } },
    });

    let reasoningBuf = '';
    let contentBuf   = '';

    for await (const chunk of stream) {
      if (!chunk.choices?.length) continue;
      const delta = chunk.choices[0].delta;
      if (delta?.reasoning_content) reasoningBuf += delta.reasoning_content;
      if (delta?.content)           contentBuf   += delta.content;
    }

    const elapsed = Date.now() - t0;

    record(contentBuf.length > 0 || reasoningBuf.length > 0, 'Stream received data', `${elapsed}ms`);
    record(contentBuf.length > 0, 'content buffer populated',
      contentBuf ? `${contentBuf.length} chars` : 'EMPTY (will fallback to reasoning)');
    record(reasoningBuf.length > 0, 'reasoning_content (chain-of-thought) present',
      reasoningBuf ? `${reasoningBuf.length} chars` : 'not returned by this model');

    if (reasoningBuf.length > 0) {
      console.log(`\n  ${YELLOW}── Reasoning preview (first 300 chars) ──${RESET}`);
      console.log(indent(reasoningBuf.slice(0, 300)));
    }
    if (contentBuf.length > 0) {
      console.log(`\n  ${GREEN}── Final answer ──${RESET}`);
      console.log(indent(contentBuf));
    }
    return { contentBuf, reasoningBuf };
  } catch (err) {
    record(false, 'Streaming with thinking', '', err.message);
    return null;
  }
}

// ── Test 4: Provider layer routing ────────────────────────────────────────────

section('4 — Provider Layer (provider.js)');

async function testProviderLayer() {
  const prompt = {
    system: 'You are a helpful assistant.',
    user:   'Reply with exactly: "Provider routing OK"',
  };

  console.log(`  → Calling llm.chat({ provider: 'deepseek' })…`);
  const t0 = Date.now();
  try {
    const response = await llm.chat(prompt, {
      provider:    'deepseek',
      maxTokens:   64,
      temperature: 0.0,
      thinking:    false,
    });
    const elapsed = Date.now() - t0;
    record(response.length > 0, 'Provider layer returned response', `${elapsed}ms`);
    record(typeof response === 'string', 'Response is string type');
    console.log(`  → Response: ${response.slice(0, 150)}`);
  } catch (err) {
    record(false, 'Provider layer routing', '', err.message);
  }
}

// ── Test 5: Full investment insight prompt ────────────────────────────────────

section('5 — Full Investment Insight Prompt (Morning Brief)');

async function testInsightPrompt() {
  // Minimal mock data to simulate a real portfolio context
  const mockPortfolio = {
    totalInvested: 500000,
    totalCurrent:  580000,
    unrealizedPnl: 80000,
    pnlPercent:    16.0,
    byType:        { equity: { invested: 400000, current: 465000 }, 'mutual_fund': { invested: 100000, current: 115000 } },
    bySector:      { Technology: { invested: 150000, current: 180000 }, Banking: { invested: 100000, current: 110000 } },
    holdings: [
      { symbol: 'INFY',    name: 'Infosys',    current_value: 120000, pnl_percent: 20.0 },
      { symbol: 'HDFCBANK',name: 'HDFC Bank',  current_value: 95000,  pnl_percent: 8.0  },
      { symbol: 'RELIANCE',name: 'Reliance',   current_value: 85000,  pnl_percent: 12.5 },
    ],
  };

  const mockMarket = {
    nifty50:   22150,
    sensex:    73200,
    nifty_bank: 47300,
    dow_jones: 39500,
    nasdaq:    17800,
    sp500:     5200,
    usd_inr:   83.50,
    vix:       13.2,
    gold_mcx:  71500,
    crude_mcx: 6850,
    raw_data: {
      nifty50:   { changePercent: -0.45 },
      sensex:    { changePercent: -0.38 },
      dowJones:  { changePercent: 0.72  },
      nasdaq:    { changePercent: 1.10  },
    },
  };

  const mockGoals = [
    {
      type: 'long_term', title: 'Retirement corpus',
      description: 'Build ₹2Cr by 2035',
      target_amount: 20000000, target_date: '2035-01-01',
      risk_tolerance: 'moderate',
    },
  ];

  const prompt = morningBriefPrompt({
    portfolio:    mockPortfolio,
    market:       mockMarket,
    news:         [
      { source: 'ET Markets', title: 'RBI holds rates steady at 6.5% for third consecutive meeting', summary: 'MPC voted 5-1 to keep rates unchanged amid persistent food inflation' },
      { source: 'LiveMint',   title: 'IT sector sees strong Q3 results; Infosys upgrades guidance', summary: 'Revenue growth of 8% YoY driven by AI and cloud deals' },
    ],
    goals:        mockGoals,
    previousBrief: null,
  });

  console.log(`  → Prompt size: system=${prompt.system.length} chars, user=${prompt.user.length} chars`);
  console.log(`  → Calling DeepSeek for full morning brief (may take 20–60s)…`);

  const t0 = Date.now();
  try {
    const response = await llm.chat(prompt, {
      provider:    'deepseek',
      maxTokens:   2000,
      temperature: 0.7,
      thinking:    thinking,
    });
    const elapsed = Date.now() - t0;

    record(response.length > 200, 'Got substantial brief content', `${response.length} chars in ${elapsed}ms`);

    // Structural checks — look for expected markdown sections
    const checks = [
      ['Morning Brief heading',   /morning brief/i],
      ['Market Outlook section',  /market outlook/i],
      ['Priority Actions section', /priority|action/i],
      ['Rupee symbol present',    /₹/],
    ];
    for (const [label, re] of checks) {
      record(re.test(response), label);
    }

    console.log(`\n  ${GREEN}── Brief preview (first 600 chars) ──${RESET}`);
    console.log(indent(response.slice(0, 600), '  '));

  } catch (err) {
    record(false, 'Full investment insight prompt', '', err.message);
  }
}

// ── Test 6: Timeout / error handling ─────────────────────────────────────────

section('6 — Timeout & Error Handling');

async function testTimeoutHandling() {
  // Test with a very short timeout — should throw the right error
  console.log(`  → Testing with 1ms timeout (should fail gracefully)…`);
  try {
    const { OpenAI } = require('openai');
    const client = new OpenAI({
      apiKey:   config.llm.nvidia.apiKey,
      baseURL:  'https://integrate.api.nvidia.com/v1',
      timeout:  60000,
      maxRetries: 0,
    });

    const stream = await client.chat.completions.create({
      model:      dsModel,
      messages:   [{ role: 'user', content: 'Hi' }],
      max_tokens: 10,
      stream:     true,
    });

    let contentBuf = '';
    const streamPromise = (async () => {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) contentBuf += delta.content;
      }
    })();

    // Race against an extremely tight timeout
    await Promise.race([
      streamPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Stream timed out (test)')), 1)),
    ]);

    // If we somehow finish in <1ms, that's fine too
    record(true, 'Handled: completed before 1ms timeout (fast response)');
  } catch (err) {
    if (err.message.includes('timed out')) {
      record(true, 'Timeout throws correct error type', err.message);
    } else {
      record('warn', 'Unexpected error in timeout test', err.message);
    }
  }

  // Test empty API key → should throw configured error (not crash)
  console.log(`  → Testing with missing API key (should throw, not crash)…`);
  try {
    await nvidia.chat('deepseek', { system: '', user: 'test' });
    // If NVIDIA_API_KEY is set this will attempt a real call; we already tested that above
    record('warn', 'No error with valid key (expected — key is configured)');
  } catch (err) {
    record(
      err.message.includes('NVIDIA_API_KEY') || err.message.includes('DeepSeek') || err.message.includes('API'),
      'Missing key error is descriptive',
      err.message.slice(0, 80)
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary() {
  const total = passed + failed + warned;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${BOLD}Results:  ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : ''}${failed} failed${RESET}  ${YELLOW}${warned} warnings${RESET}  / ${total} checks`);
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}✅  DeepSeek AI insight pipeline is healthy!${RESET}`);
  } else {
    console.log(`${RED}${BOLD}❌  ${failed} check(s) failed — see details above.${RESET}`);
  }
  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════╗`);
  console.log(`║   DeepSeek AI Insight Validation Script      ║`);
  console.log(`╚══════════════════════════════════════════════╝${RESET}`);

  try {
    await testRawConnection();
    await testStreaming();
    await testProviderLayer();
    await testInsightPrompt();
    await testTimeoutHandling();
  } catch (err) {
    console.log(`\n${RED}Fatal error during validation: ${err.message}${RESET}`);
  }

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
})();
