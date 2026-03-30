'use strict';

const path    = require('path');
const fs      = require('fs');
const winston = require('winston');
const { config } = require('./index');

const logsPath = config.storage.logsPath;
if (!fs.existsSync(logsPath)) fs.mkdirSync(logsPath, { recursive: true });

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${extra}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: path.join(logsPath, 'agent.log'),
      maxsize:  5 * 1024 * 1024,  // 5 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logsPath, 'error.log'),
      level:    'error',
      maxsize:  5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
