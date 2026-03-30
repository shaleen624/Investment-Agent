'use strict';

/**
 * Email notification channel.
 * Uses Nodemailer — supports any SMTP provider (Gmail, Outlook, Zoho, etc.)
 *
 * For Gmail: use App Passwords (2FA must be enabled)
 *   https://myaccount.google.com/apppasswords
 *
 * Free SMTP alternatives: Brevo (300/day), Mailjet (200/day), Zoho (free tier)
 */

const nodemailer = require('nodemailer');
const logger     = require('../config/logger');
const { config } = require('../config');

let _transporter;

function getTransporter() {
  if (_transporter) return _transporter;

  const cfg = config.notifications.email;
  _transporter = nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    auth:   { user: cfg.user, pass: cfg.pass },
    tls:    { rejectUnauthorized: false },
  });

  return _transporter;
}

/**
 * Send an email.
 * @param {{ to, subject, text, html }} opts
 */
async function sendEmail({ to, subject, text, html }) {
  const cfg = config.notifications.email;
  if (!cfg.enabled) throw new Error('Email not configured. Set EMAIL_USER, EMAIL_PASS, EMAIL_TO.');

  const transporter = getTransporter();

  const info = await transporter.sendMail({
    from:    cfg.from || cfg.user,
    to:      to || cfg.to,
    subject,
    text:    text || '',
    html:    html || markdownToHtml(text || ''),
  });

  logger.info(`[Email] Sent: ${info.messageId}`);
  return info;
}

/**
 * Send a brief via email with HTML formatting.
 */
async function sendBrief(content, type = 'morning') {
  const cfg = config.notifications.email;
  if (!cfg.enabled) {
    logger.warn('[Email] Not configured — skipping');
    return false;
  }

  const today    = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const emoji    = type === 'morning' ? '🌅' : '🌙';
  const subject  = `${emoji} ${type === 'morning' ? 'Morning Brief' : 'Evening Brief'} — ${today}`;

  try {
    await sendEmail({
      subject,
      text: content,
      html: wrapInEmailTemplate(content, subject),
    });
    return true;
  } catch (err) {
    logger.error(`[Email] sendBrief failed: ${err.message}`);
    return false;
  }
}

/**
 * Verify SMTP connection.
 */
async function verify() {
  const cfg = config.notifications.email;
  if (!cfg.enabled) return { ok: false, reason: 'Email not configured' };

  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** Very basic Markdown → HTML converter for emails. */
function markdownToHtml(md) {
  return md
    .replace(/^#{4} (.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---+$/gm, '<hr/>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) =>
      line.startsWith('<') ? line : `<p>${line}</p>`
    );
}

function wrapInEmailTemplate(content, title) {
  const html = markdownToHtml(content);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         line-height: 1.6; color: #1a1a1a; background: #f5f5f5; margin: 0; padding: 20px; }
  .container { max-width: 720px; margin: 0 auto; background: #fff;
               border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  h1 { color: #0d47a1; border-bottom: 2px solid #e3f2fd; padding-bottom: 8px; }
  h2 { color: #1565c0; margin-top: 24px; }
  h3 { color: #1976d2; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  blockquote { border-left: 4px solid #90caf9; margin: 12px 0; padding: 8px 16px;
               background: #e3f2fd; border-radius: 0 8px 8px 0; color: #555; }
  li { margin: 4px 0; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 20px 0; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;
            font-size: 12px; color: #9e9e9e; text-align: center; }
</style>
</head>
<body>
<div class="container">
${html}
<div class="footer">Investment Agent • Generated ${new Date().toLocaleString('en-IN')}</div>
</div>
</body>
</html>`;
}

module.exports = { sendEmail, sendBrief, verify };
