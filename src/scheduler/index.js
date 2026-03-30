'use strict';

/**
 * Scheduler — runs morning and evening briefs on a cron schedule.
 * Uses node-cron with IST (Asia/Kolkata) timezone.
 *
 * Times are read from user profile in DB (set during setup).
 * Falls back to .env MORNING_BRIEF_TIME / EVENING_BRIEF_TIME.
 */

const cron      = require('node-cron');
const logger    = require('../config/logger');
const { config }= require('../config');
const portfolio = require('../portfolio/manager');
const analysis  = require('../analysis/engine');
const notify    = require('../notifications');

let morningTask = null;
let eveningTask = null;

// ── Cron expression builder ────────────────────────────────────────────────────

/**
 * Convert "HH:MM" to cron expression "m h * * *".
 */
function timeToCron(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) throw new Error(`Invalid time format: ${timeStr}`);
  return `${m} ${h} * * *`;
}

// ── Brief runners ─────────────────────────────────────────────────────────────

async function runMorningBrief() {
  logger.info('[Scheduler] Running morning brief...');
  try {
    const { content, briefId } = await analysis.generateMorningBrief();
    const sent = await notify.sendBriefToAll(content, 'morning', briefId);
    analysis.markBriefSent(briefId, sent);
    logger.info(`[Scheduler] Morning brief complete. Sent via: ${sent.join(', ') || 'none'}`);
  } catch (err) {
    logger.error(`[Scheduler] Morning brief failed: ${err.message}`);
    await notify.sendAlert(`⚠️ Morning brief failed: ${err.message}`, 'error').catch(() => {});
  }
}

async function runEveningBrief() {
  logger.info('[Scheduler] Running evening brief...');
  try {
    const { content, briefId } = await analysis.generateEveningBrief();
    const sent = await notify.sendBriefToAll(content, 'evening', briefId);
    analysis.markBriefSent(briefId, sent);
    logger.info(`[Scheduler] Evening brief complete. Sent via: ${sent.join(', ') || 'none'}`);
  } catch (err) {
    logger.error(`[Scheduler] Evening brief failed: ${err.message}`);
    await notify.sendAlert(`⚠️ Evening brief failed: ${err.message}`, 'error').catch(() => {});
  }
}

// ── Scheduler management ──────────────────────────────────────────────────────

/**
 * Start the morning and evening brief schedulers.
 * Times are read from the user profile (DB) if available, else from .env.
 */
function start() {
  const userProfile = portfolio.getProfile();
  const timezone    = (userProfile?.timezone || config.scheduler.timezone || 'Asia/Kolkata');
  const morningTime = userProfile?.morning_time || config.scheduler.morningTime || '08:00';
  const eveningTime = userProfile?.evening_time || config.scheduler.eveningTime || '20:00';

  const morningCron = timeToCron(morningTime);
  const eveningCron = timeToCron(eveningTime);

  // Stop existing tasks before restarting
  stop();

  morningTask = cron.schedule(morningCron, runMorningBrief, {
    scheduled: true,
    timezone,
  });

  eveningTask = cron.schedule(eveningCron, runEveningBrief, {
    scheduled: true,
    timezone,
  });

  logger.info(`[Scheduler] Started — Morning: ${morningTime}, Evening: ${eveningTime} (${timezone})`);
  return { morningTime, eveningTime, timezone };
}

function stop() {
  if (morningTask) { morningTask.stop(); morningTask = null; }
  if (eveningTask) { eveningTask.stop(); eveningTask = null; }
  logger.info('[Scheduler] Stopped');
}

/**
 * Restart scheduler with updated times (call after user updates profile).
 */
function restart() {
  stop();
  return start();
}

function isRunning() {
  return !!(morningTask || eveningTask);
}

module.exports = { start, stop, restart, isRunning, runMorningBrief, runEveningBrief, timeToCron };
