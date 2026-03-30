'use strict';

/**
 * Notification manager — routes messages to all configured channels.
 * Logs each send attempt to notification_log table.
 */

const logger    = require('../config/logger');
const { run }   = require('../db');
const { config }= require('../config');
const telegram  = require('./telegram');
const whatsapp  = require('./whatsapp');
const email     = require('./email');

const CHANNELS = { telegram, whatsapp, email };

/**
 * Send a brief to all configured and enabled channels.
 *
 * @param {string} content   - full brief text (Markdown)
 * @param {'morning'|'evening'} type
 * @param {number} briefId   - DB id for logging
 * @returns {string[]} list of channels that succeeded
 */
async function sendBriefToAll(content, type = 'morning', briefId = null) {
  const channels = config.notifications.channels;
  const succeeded = [];

  for (const channel of channels) {
    const handler = CHANNELS[channel];
    if (!handler) {
      logger.warn(`[Notifications] Unknown channel: ${channel}`);
      continue;
    }

    try {
      const ok = await handler.sendBrief(content, type);

      logNotification({
        channel,
        type:         `brief_${type}`,
        status:       ok ? 'sent' : 'failed',
        reference_id: briefId,
      });

      if (ok) succeeded.push(channel);
    } catch (err) {
      logger.error(`[Notifications] ${channel} send failed: ${err.message}`);
      logNotification({
        channel,
        type:         `brief_${type}`,
        status:       'failed',
        reference_id: briefId,
        error:        err.message,
      });
    }
  }

  logger.info(`[Notifications] Brief sent via: ${succeeded.join(', ') || 'none'}`);
  return succeeded;
}

/**
 * Send a quick alert/message to all channels.
 */
async function sendAlert(message, type = 'alert') {
  const channels = config.notifications.channels;
  const results  = {};

  for (const channel of channels) {
    try {
      if (channel === 'telegram') {
        await telegram.sendMessage(message);
        results[channel] = true;
      } else if (channel === 'email') {
        await email.sendEmail({
          subject: `[Investment Agent] ${type}`,
          text:    message,
        });
        results[channel] = true;
      } else if (channel === 'whatsapp') {
        await whatsapp.sendMessage(message);
        results[channel] = true;
      }
    } catch (err) {
      logger.error(`[Notifications] Alert via ${channel} failed: ${err.message}`);
      results[channel] = false;
    }
  }

  return results;
}

/**
 * Test all configured channels by sending a test message.
 */
async function testChannels() {
  const msg     = `✅ Investment Agent test message\n${new Date().toLocaleString('en-IN')}`;
  const results = {};

  for (const channel of config.notifications.channels) {
    try {
      if (channel === 'telegram') {
        await telegram.sendMessage(msg);
        results[channel] = { ok: true };
      } else if (channel === 'email') {
        const verify = await email.verify();
        if (verify.ok) {
          await email.sendEmail({ subject: '[Investment Agent] Test', text: msg });
          results[channel] = { ok: true };
        } else {
          results[channel] = { ok: false, error: verify.reason };
        }
      } else if (channel === 'whatsapp') {
        if (!whatsapp.isConnected()) {
          results[channel] = { ok: false, error: 'WhatsApp not connected. Run setup first.' };
        } else {
          await whatsapp.sendMessage(msg);
          results[channel] = { ok: true };
        }
      } else {
        results[channel] = { ok: false, error: 'Unknown channel' };
      }
    } catch (err) {
      results[channel] = { ok: false, error: err.message };
    }
  }

  return results;
}

// ── Logging ───────────────────────────────────────────────────────────────────

function logNotification({ channel, type, status, reference_id = null, error = null }) {
  try {
    run(
      `INSERT INTO notification_log (channel, type, status, reference_id, error)
       VALUES (?, ?, ?, ?, ?)`,
      [channel, type, status, reference_id, error]
    );
  } catch (err) {
    logger.debug(`[Notifications] Failed to log notification: ${err.message}`);
  }
}

module.exports = { sendBriefToAll, sendAlert, testChannels, logNotification };
