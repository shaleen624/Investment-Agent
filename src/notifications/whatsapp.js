'use strict';

/**
 * WhatsApp notification channel.
 * Uses whatsapp-web.js (open source, no cost).
 * https://github.com/pedroslopez/whatsapp-web.js
 *
 * First run: scans a QR code to link the WhatsApp account.
 * Session is persisted in .wwebjs_auth/ directory.
 *
 * NOTE: Set WHATSAPP_ENABLED=true and WHATSAPP_RECIPIENT in .env to activate.
 */

const path   = require('path');
const logger = require('../config/logger');
const { config } = require('../config');

let client       = null;
let isReady      = false;
let messageQueue = [];

/**
 * Initialize WhatsApp client and authenticate.
 * Shows QR code in terminal on first run.
 *
 * @param {Function} onReady - called when client is authenticated
 */
async function initialize(onReady = null) {
  if (!config.notifications.whatsapp.enabled) {
    logger.info('[WhatsApp] Disabled in config. Set WHATSAPP_ENABLED=true to activate.');
    return;
  }

  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcode = require('qrcode-terminal');

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.resolve('.wwebjs_auth'),
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    client.on('qr', (qr) => {
      logger.info('[WhatsApp] Scan the QR code below to authenticate:');
      qrcode.generate(qr, { small: true });
      console.log('\n[WhatsApp] Open WhatsApp → Linked Devices → Link a Device → scan the QR above\n');
    });

    client.on('ready', async () => {
      isReady = true;
      logger.info('[WhatsApp] Client ready and authenticated');

      // Flush queued messages
      for (const msg of messageQueue) {
        await _send(msg.number, msg.text).catch(e =>
          logger.error(`[WhatsApp] Queue flush error: ${e.message}`)
        );
      }
      messageQueue = [];

      if (onReady) onReady();
    });

    client.on('auth_failure', (msg) => {
      logger.error(`[WhatsApp] Auth failed: ${msg}`);
      isReady = false;
    });

    client.on('disconnected', (reason) => {
      logger.warn(`[WhatsApp] Disconnected: ${reason}`);
      isReady = false;
    });

    await client.initialize();
  } catch (err) {
    logger.error(`[WhatsApp] Initialization failed: ${err.message}`);
    logger.info('[WhatsApp] Make sure whatsapp-web.js is installed: npm install whatsapp-web.js');
  }
}

/**
 * Internal send function.
 */
async function _send(number, text) {
  if (!client || !isReady) throw new Error('WhatsApp client not ready');

  // Format number: 919876543210@c.us
  const chatId = number.includes('@') ? number : `${number}@c.us`;

  // WhatsApp has no hard char limit but very long messages may fail
  // Split into 4000-char chunks just in case
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000));
  }

  for (const chunk of chunks) {
    await client.sendMessage(chatId, chunk);
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 800));
  }
}

/**
 * Send a message to the configured recipient.
 * Queues if client is not yet ready.
 *
 * @param {string} text   - message text
 * @param {string} number - optional override number (international format, no +)
 */
async function sendMessage(text, number = null) {
  const cfg = config.notifications.whatsapp;
  if (!cfg.enabled) throw new Error('WhatsApp not enabled (WHATSAPP_ENABLED=false)');

  const recipient = number || cfg.recipient;
  if (!recipient) throw new Error('WHATSAPP_RECIPIENT not configured');

  if (!isReady) {
    logger.warn('[WhatsApp] Client not ready — queueing message');
    messageQueue.push({ number: recipient, text });
    return;
  }

  await _send(recipient, text);
  logger.info('[WhatsApp] Message sent');
}

/**
 * Send a brief to the configured WhatsApp number.
 */
async function sendBrief(content) {
  if (!config.notifications.whatsapp.enabled) {
    logger.warn('[WhatsApp] Not enabled — skipping');
    return false;
  }

  // WhatsApp doesn't render Markdown — strip most formatting
  const plain = content
    .replace(/#{1,6}\s/g, '*')    // headings → bold
    .replace(/\*\*/g, '*')         // bold
    .replace(/`[^`]+`/g, (m) => m.replace(/`/g, ''))  // inline code
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .trim();

  try {
    await sendMessage(plain);
    return true;
  } catch (err) {
    logger.error(`[WhatsApp] sendBrief failed: ${err.message}`);
    return false;
  }
}

function isConnected() {
  return isReady;
}

async function destroy() {
  if (client) {
    await client.destroy().catch(() => {});
    client  = null;
    isReady = false;
  }
}

module.exports = { initialize, sendMessage, sendBrief, isConnected, destroy };
