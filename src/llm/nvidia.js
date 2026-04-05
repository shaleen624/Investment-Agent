'use strict';

/**
 * NVIDIA NIM LLM provider.
 * Hosts Kimi K2 and DeepSeek V3 via an OpenAI-compatible API.
 *
 * Both models share the same base URL and NVIDIA_API_KEY.
 * DeepSeek V3 supports an extended "thinking" mode via reasoning_content.
 *
 * API reference: https://build.nvidia.com/explore/reasoning
 */

const logger     = require('../config/logger');
const { config } = require('../config');

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

let _nvidiaClient;
function getNvidiaClient() {
  if (_nvidiaClient) return _nvidiaClient;
  const { OpenAI } = require('openai');
  _nvidiaClient = new OpenAI({
    apiKey:  config.llm.nvidia.apiKey,
    baseURL: NVIDIA_BASE_URL,
    timeout: 60000,       // 60 s connection timeout
    maxRetries: 1,        // 1 retry on transient failures
  });
  return _nvidiaClient;
}

// ── Kimi K2 ───────────────────────────────────────────────────────────────────

/**
 * Chat with Kimi K2 (moonshotai/kimi-k2.5) via NVIDIA NIM.
 *
 * @param {Array}  messages - OpenAI-format message array
 * @param {object} options
 * @returns {Promise<string>}
 */
async function chatWithKimi(messages, options = {}) {
  const client = getNvidiaClient();

  const model     = options.model     || config.llm.nvidia.kimiModel;
  const maxTokens = options.maxTokens || 16384;

  logger.debug(`[Kimi] Request → model=${model} max_tokens=${maxTokens} messages=${messages.length}`);

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature: options.temperature ?? 1.0,
      top_p:       options.topP       ?? 1.0,
      stream:      false,
    });

    const content = response.choices?.[0]?.message?.content || '';
    if (!content.trim()) throw new Error('Kimi returned empty response');
    logger.debug(`[Kimi] Response → ${content.length} chars`);
    return content;
  } catch (err) {
    logger.error(`[Kimi] API error: ${err.message}`);
    const msg = err.status
      ? `Kimi API error ${err.status}: ${err.message}`
      : `Kimi API error: ${err.message}`;
    throw new Error(msg);
  }
}

// ── DeepSeek V3 ───────────────────────────────────────────────────────────────

/**
 * Chat with DeepSeek V3.2 via NVIDIA NIM.
 * Supports extended thinking mode (reasoning_content stream).
 *
 * When thinking=true (default), the reasoning chain is logged at debug level
 * and the final answer is returned as the response string.
 *
 * @param {Array}  messages
 * @param {object} options  - { thinking: bool, maxTokens, temperature }
 * @returns {Promise<string>}
 */
async function chatWithDeepSeek(messages, options = {}) {
  const client  = getNvidiaClient();
  const thinking = options.thinking !== false; // enabled by default
  // DeepSeek with chain-of-thought can take 60–90s for complex prompts.
  // This must stay < the caller's outer timeout (engine.js uses 75s).
  const STREAM_TIMEOUT_MS = 70000; // 70s max for streaming

  const model     = options.model     || config.llm.nvidia.deepseekModel;
  const maxTokens = options.maxTokens || 8192;

  logger.debug(`[DeepSeek] Request → model=${model} max_tokens=${maxTokens} thinking=${thinking} messages=${messages.length}`);

  let stream;
  try {
    stream = await client.chat.completions.create({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature: options.temperature ?? 1.0,
      top_p:       options.topP       ?? 0.95,
      stream:      true,
      ...(thinking ? { extra_body: { chat_template_kwargs: { thinking: true } } } : {}),
    });
  } catch (err) {
    logger.error(`[DeepSeek] Stream creation failed: ${err.message}`);
    const isTimeout = err.message?.includes('timed out') || err.message?.includes('ETIMEDOUT') || err.code === 'ETIMEDOUT';
    // If thinking mode caused a timeout, retry once without it (much faster)
    if (isTimeout && thinking && !options._deepseekRetried) {
      logger.warn('[DeepSeek] Timeout with thinking=true, retrying without chain-of-thought');
      return chatWithDeepSeek(messages, { ...options, thinking: false, _deepseekRetried: true });
    }
    const msg = err.status
      ? `DeepSeek API error ${err.status}: ${err.message}`
      : `DeepSeek API error: ${err.message}`;
    throw new Error(msg);
  }

  let reasoningBuf = '';
  let contentBuf   = '';

  // Guard against hanging streams
  const streamPromise = (async () => {
    for await (const chunk of stream) {
      if (!chunk.choices?.length) continue;

      const delta = chunk.choices[0].delta;

      // Reasoning / chain-of-thought (only present when thinking=true)
      const reasoning = delta?.reasoning_content;
      if (reasoning) reasoningBuf += reasoning;

      // Final answer content
      if (delta?.content) contentBuf += delta.content;
    }
  })();

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('DeepSeek stream timed out')), STREAM_TIMEOUT_MS);
  });

  try {
    await Promise.race([streamPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }

  if (reasoningBuf) {
    logger.debug(`[DeepSeek] Reasoning (${reasoningBuf.length} chars): ${reasoningBuf.slice(0, 300)}…`);
  }

  if (!contentBuf.trim()) {
    // Sometimes DeepSeek returns everything in reasoning with no content
    if (reasoningBuf.trim()) {
      logger.warn('[DeepSeek] No content returned, falling back to reasoning output');
      return reasoningBuf;
    }
    throw new Error('DeepSeek returned empty response');
  }

  return contentBuf;
}

// ── Shared dispatcher ─────────────────────────────────────────────────────────

/**
 * Unified entry point. Routes to Kimi or DeepSeek based on provider name.
 *
 * @param {'kimi'|'deepseek'} provider
 * @param {{ system: string, user: string }} prompt
 * @param {object} options
 * @returns {Promise<string>}
 */
async function chat(provider, prompt, options = {}) {
  if (!config.llm.nvidia.apiKey) {
    throw new Error('NVIDIA_API_KEY not configured');
  }

  const messages = [];
  if (prompt.system) messages.push({ role: 'system', content: prompt.system });
  messages.push({ role: 'user', content: prompt.user });

  if (provider === 'kimi') {
    return chatWithKimi(messages, options);
  }
  if (provider === 'deepseek') {
    return chatWithDeepSeek(messages, options);
  }

  throw new Error(`Unknown NVIDIA provider: ${provider}`);
}

/**
 * Returns true if NVIDIA_API_KEY is set.
 */
function isConfigured() {
  return !!config.llm.nvidia.apiKey;
}

module.exports = { chat, chatWithKimi, chatWithDeepSeek, isConfigured };
