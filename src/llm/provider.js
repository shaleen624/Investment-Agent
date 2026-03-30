'use strict';

/**
 * LLM Provider abstraction layer.
 * Supports Claude (Anthropic) and OpenAI.
 * Configured via LLM_PROVIDER env var. Can be switched at runtime.
 *
 * Usage:
 *   const llm = require('./provider');
 *   const response = await llm.chat({ system: '...', user: '...' });
 */

const logger   = require('../config/logger');
const { config } = require('../config');
const nvidia   = require('./nvidia');

// ── Claude (Anthropic) ────────────────────────────────────────────────────────

let anthropicClient;
function getAnthropicClient() {
  if (!anthropicClient) {
    const { Anthropic } = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: config.llm.claude.apiKey });
  }
  return anthropicClient;
}

async function chatWithClaude(messages, options = {}) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model:      options.model      || config.llm.claude.model,
    max_tokens: options.maxTokens  || 4096,
    system:     options.system     || '',
    messages,
  });
  return response.content?.[0]?.text || '';
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

let openaiClient;
function getOpenAIClient() {
  if (!openaiClient) {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: config.llm.openai.apiKey });
  }
  return openaiClient;
}

async function chatWithOpenAI(messages, options = {}) {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model:      options.model     || config.llm.openai.model,
    max_tokens: options.maxTokens || 4096,
    messages,
  });
  return response.choices?.[0]?.message?.content || '';
}

// ── Unified interface ─────────────────────────────────────────────────────────

/**
 * Send a chat request to the configured LLM provider.
 *
 * @param {{ system: string, user: string }} prompt
 * @param {object} options - { provider, model, maxTokens }
 * @returns {Promise<string>} LLM response text
 */
// ── Fallback chain ────────────────────────────────────────────────────────────
// Priority order tried when a provider fails (or has no key).
// First provider with a configured key wins.
const FALLBACK_ORDER = ['claude', 'kimi', 'deepseek', 'openai'];

function _hasKey(provider) {
  if (provider === 'claude')    return !!config.llm.claude.apiKey;
  if (provider === 'openai')    return !!config.llm.openai.apiKey;
  if (provider === 'kimi')      return !!config.llm.nvidia.apiKey;
  if (provider === 'deepseek')  return !!config.llm.nvidia.apiKey;
  return false;
}

async function chat(prompt, options = {}) {
  const provider = options.provider || config.llm.provider;

  if (provider === 'none') {
    throw new Error(
      'LLM provider is "none". Set LLM_PROVIDER and the matching API key in .env.'
    );
  }

  logger.debug(`[LLM] Sending request via ${provider}`);

  try {
    if (provider === 'claude') {
      const messages = [{ role: 'user', content: prompt.user }];
      return await chatWithClaude(messages, { ...options, system: prompt.system });
    }

    if (provider === 'openai') {
      const messages = prompt.system
        ? [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]
        : [{ role: 'user', content: prompt.user }];
      return await chatWithOpenAI(messages, options);
    }

    if (provider === 'kimi' || provider === 'deepseek') {
      return await nvidia.chat(provider, prompt, {
        ...options,
        thinking: provider === 'deepseek'
          ? (options.thinking ?? config.llm.nvidia.deepseekThinking)
          : undefined,
      });
    }

    throw new Error(`Unknown LLM provider: "${provider}"`);

  } catch (err) {
    // Auto-fallback to the next available provider in the chain
    if (!options._isFallback) {
      const currentIdx = FALLBACK_ORDER.indexOf(provider);
      const next = FALLBACK_ORDER
        .slice(currentIdx + 1)
        .find(p => _hasKey(p) && p !== provider);

      if (next) {
        logger.warn(`[LLM] ${provider} failed (${err.message}). Falling back to ${next}`);
        return chat(prompt, { ...options, provider: next, _isFallback: true });
      }
    }
    throw err;
  }
}

/**
 * Parse JSON from an LLM response, with retry.
 * The LLM is asked to return JSON — this extracts it reliably.
 */
function extractJSON(text) {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {}

  // Try extracting from markdown code block
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (codeMatch) {
    try {
      return JSON.parse(codeMatch[1]);
    } catch {}
  }

  // Try finding JSON-like content
  const jsonMatch = text.match(/(\[[\s\S]+\]|\{[\s\S]+\})/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {}
  }

  throw new Error('Could not extract JSON from LLM response');
}

/**
 * Check if any LLM provider is configured.
 */
function isAvailable() {
  if (config.llm.provider === 'none') return false;
  // Primary provider has a key?
  if (_hasKey(config.llm.provider)) return true;
  // Any fallback provider has a key?
  return FALLBACK_ORDER.some(p => _hasKey(p));
}

module.exports = { chat, extractJSON, isAvailable };
