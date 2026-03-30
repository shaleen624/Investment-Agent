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
async function chat(prompt, options = {}) {
  const provider = options.provider || config.llm.provider;

  if (provider === 'none') {
    throw new Error('LLM provider is set to "none". Configure ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  }

  const messages = [{ role: 'user', content: prompt.user }];

  logger.debug(`[LLM] Sending request via ${provider}`);

  try {
    if (provider === 'claude') {
      return await chatWithClaude(messages, { ...options, system: prompt.system });
    }

    if (provider === 'openai') {
      const oaiMessages = prompt.system
        ? [{ role: 'system', content: prompt.system }, ...messages]
        : messages;
      return await chatWithOpenAI(oaiMessages, options);
    }

    throw new Error(`Unknown LLM provider: ${provider}`);
  } catch (err) {
    // Auto-fallback: if primary fails and fallback is configured, try the other
    if (!options._isFallback) {
      const fallback = provider === 'claude' ? 'openai' : 'claude';
      const fallbackKey = fallback === 'claude' ? config.llm.claude.apiKey : config.llm.openai.apiKey;

      if (fallbackKey) {
        logger.warn(`[LLM] ${provider} failed (${err.message}). Falling back to ${fallback}`);
        return chat(prompt, { ...options, provider: fallback, _isFallback: true });
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
  if (config.llm.provider === 'claude' && config.llm.claude.apiKey) return true;
  if (config.llm.provider === 'openai' && config.llm.openai.apiKey) return true;
  // Check if either key is set (for fallback)
  return !!(config.llm.claude.apiKey || config.llm.openai.apiKey);
}

module.exports = { chat, extractJSON, isAvailable };
