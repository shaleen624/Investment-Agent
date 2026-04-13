'use strict';
const { Router } = require('express');
const { config, validate } = require('../../config');
const pm       = require('../../portfolio/manager');
const analysis = require('../../analysis/engine');
const llm      = require('../../llm/provider');

const r = Router();

r.get('/', (_req, res) => {
  const summary    = pm.getPortfolioSummary();
  const goals      = pm.getGoals();
  const profile    = pm.getProfile();
  const warnings   = validate();
  const lastMorn   = analysis.getLatestBrief('morning');
  const lastEven   = analysis.getLatestBrief('evening');

  res.json({
    ok: true,
    llm: {
      provider:    config.llm.provider,
      available:   llm.isAvailable(),
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
      ? {
          holdings: summary.holdingsCount,
          totalInvested: summary.totalInvested,
          totalCurrent: summary.totalCurrent,
          pnlPercent: summary.pnlPercent,
          taxPnl: summary.taxPnl,
        }
      : null,
    goals:    goals.length,
    warnings,
    briefs: {
      lastMorning: lastMorn?.date || null,
      lastEvening: lastEven?.date || null,
    },
  });
});

module.exports = r;
