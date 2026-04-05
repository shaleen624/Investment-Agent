'use strict';
const { Router } = require('express');
const { config, validate } = require('../../config');
const pm         = require('../../portfolio/manager');
const analysis   = require('../../analysis/engine');
const llm        = require('../../llm/provider');
const openrouter = require('../../llm/openrouter');
const { authenticateToken } = require('../middleware/auth');

const r = Router();

// GET /api/status — agent health overview (public, no auth needed)
r.get('/', (_req, res) => {
  try {
    const summary    = pm.getPortfolioSummary();
    const goals      = pm.getGoals();
    const profile    = pm.getProfile();
    const warnings   = validate();
    const lastMorn   = analysis.getLatestBrief('morning');
    const lastEven   = analysis.getLatestBrief('evening');
    const override   = llm.getProviderOverride();

    res.json({
      ok: true,
      llm: {
        provider:   override.provider || config.llm.provider,
        model:      override.model    || null,
        available:  llm.isAvailable(),
      },
      notifications: {
        channels: config.notifications.channels,
        telegram: config.notifications.telegram.enabled,
        email:    config.notifications.email.enabled,
        whatsapp: config.notifications.whatsapp.enabled,
      },
      schedule: {
        morningTime: profile?.morning_time || config.scheduler.morningTime,
        eveningTime: profile?.evening_time || config.scheduler.eveningTime,
        timezone:    profile?.timezone     || config.scheduler.timezone,
      },
      portfolio: summary
        ? { holdings: summary.holdingsCount, totalInvested: summary.totalInvested,
            totalCurrent: summary.totalCurrent, pnlPercent: summary.pnlPercent }
        : null,
      goals:    goals.length,
      warnings,
      briefs: {
        lastMorning: lastMorn?.date || null,
        lastEvening: lastEven?.date || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch status' });
  }
});

// GET /api/status/llm — LLM providers + available models
r.get('/llm', authenticateToken, (_req, res) => {
  const override = llm.getProviderOverride();

  const providers = {
    claude:      { configured: !!config.llm.claude.apiKey,      model: config.llm.claude.model },
    openai:      { configured: !!config.llm.openai.apiKey,      model: config.llm.openai.model },
    kimi:        { configured: !!config.llm.nvidia.apiKey,       model: config.llm.nvidia.kimiModel },
    deepseek:    { configured: !!config.llm.nvidia.apiKey,       model: config.llm.nvidia.deepseekModel },
    openrouter:  { configured: !!config.llm.openrouter?.apiKey,  model: config.llm.openrouter?.model },
  };

  res.json({
    active:    override.provider || config.llm.provider,
    model:     override.model    || null,
    providers,
    openrouterModels: openrouter.POPULAR_MODELS,
  });
});

// PUT /api/status/llm — switch active LLM provider at runtime (no restart needed)
r.put('/llm', authenticateToken, (req, res) => {
  const { provider, model } = req.body;

  const validProviders = ['claude', 'openai', 'kimi', 'deepseek', 'openrouter', 'none'];
  if (!provider || !validProviders.includes(provider)) {
    return res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
  }

  // Validate the provider has a key configured
  if (provider !== 'none' && !llm._hasKey(provider)) {
    return res.status(400).json({
      error: `Provider "${provider}" has no API key configured. Add it to your .env file.`,
    });
  }

  llm.setProviderOverride(provider, model || null);
  res.json({ ok: true, active: provider, model: model || null });
});

module.exports = r;
