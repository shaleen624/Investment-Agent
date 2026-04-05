'use strict';

/**
 * OpenRouter LLM provider.
 * OpenAI-compatible API giving access to 100+ models from one endpoint.
 * API key: https://openrouter.ai/keys
 * Model list: https://openrouter.ai/models
 */

const logger     = require('../config/logger');
const { config } = require('../config');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let _client;
function getClient() {
  if (_client) return _client;
  const { OpenAI } = require('openai');
  _client = new OpenAI({
    apiKey:   config.llm.openrouter.apiKey,
    baseURL:  OPENROUTER_BASE_URL,
    timeout:  90000,
    maxRetries: 1,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/shaleen624/investment-agent',
      'X-Title':      'Investment Agent',
    },
  });
  return _client;
}

/**
 * Chat with any OpenRouter model.
 * @param {Array}  messages - OpenAI-format message array
 * @param {object} options  - { model, maxTokens, temperature }
 */
async function chat(messages, options = {}) {
  if (!config.llm.openrouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const client    = getClient();
  const model     = options.model     || config.llm.openrouter.model;
  const maxTokens = options.maxTokens || 4096;

  logger.debug(`[OpenRouter] Request → model=${model} max_tokens=${maxTokens} messages=${messages.length}`);

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature: options.temperature ?? 0.7,
      stream:      false,
    });

    const content = response.choices?.[0]?.message?.content || '';
    if (!content.trim()) throw new Error('OpenRouter returned empty response');
    logger.debug(`[OpenRouter] Response → ${content.length} chars via ${model}`);
    return content;
  } catch (err) {
    logger.error(`[OpenRouter] API error: ${err.message}`);
    const msg = err.status
      ? `OpenRouter API error ${err.status}: ${err.message}`
      : `OpenRouter API error: ${err.message}`;
    throw new Error(msg);
  }
}

function isConfigured() {
  return !!config.llm.openrouter.apiKey;
}

// Well-known OpenRouter models grouped by capability
const POPULAR_MODELS = [
  { id: 'deepseek/deepseek-r1',                   name: 'DeepSeek R1',          free: true  },
  { id: 'deepseek/deepseek-chat-v3-0324:free',     name: 'DeepSeek V3 (free)',   free: true  },
  { id: 'google/gemini-2.5-pro-preview-03-25',     name: 'Gemini 2.5 Pro',       free: false },
  { id: 'meta-llama/llama-4-maverick:free',        name: 'Llama 4 Maverick',     free: true  },
  { id: 'anthropic/claude-sonnet-4-5',             name: 'Claude Sonnet 4.5',    free: false },
  { id: 'openai/gpt-4o',                           name: 'GPT-4o',               free: false },
  { id: 'openai/gpt-4.1-mini',                     name: 'GPT-4.1 Mini',         free: false },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small', free: true  },
  { id: 'qwen/qwen3-235b-a22b:free',               name: 'Qwen3 235B',           free: true  },
];

module.exports = { chat, isConfigured, POPULAR_MODELS };
