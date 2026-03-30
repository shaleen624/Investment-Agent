'use strict';

/**
 * Groww broker adapter.
 *
 * NOTE: Groww does not have an official public API as of early 2026.
 * This adapter is a STUB ready to be activated when Groww releases its API.
 *
 * In the meantime, users can:
 *  - Export portfolio from Groww app (CSV)
 *  - Use the CSV parser in src/portfolio/parser.js
 *
 * When Groww API is available:
 *  1. Set GROWW_API_KEY in .env
 *  2. Implement the _get() method below with the actual endpoints
 *
 * Groww API updates: https://groww.in/open-api (when available)
 */

const axios  = require('axios');
const logger = require('../../config/logger');
const { config } = require('../../config');
const BaseBroker = require('./base');

// Placeholder base URL — update when official API is released
const BASE = 'https://api.groww.in/v1';

class GrowwBroker extends BaseBroker {
  constructor() {
    super('groww');
    this.cfg = config.brokers.groww;
  }

  isConfigured() {
    return !!this.cfg.apiKey;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.cfg.apiKey}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    };
  }

  async _get(endpoint, params = {}) {
    if (!this.isConfigured()) throw new Error('Groww API key not configured');
    try {
      const res = await axios.get(`${BASE}${endpoint}`, {
        headers: this._headers(),
        params,
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 501) {
        throw new Error('Groww API not yet available. Use CSV export instead.');
      }
      throw err;
    }
  }

  /**
   * Fetch equity holdings.
   * TODO: implement with actual Groww API endpoints
   */
  async getHoldings() {
    if (!this.isConfigured()) throw new Error('Groww API key not set');

    logger.warn('[Groww] Official API not available yet. Returning empty. Use CSV export.');
    // When API is available, implement:
    // const data = await this._get('/portfolio/stocks');
    // return data.map(h => ({ ... }));
    return [];
  }

  /**
   * Fetch mutual fund holdings.
   * TODO: implement with actual Groww API endpoints
   */
  async getMFHoldings() {
    if (!this.isConfigured()) throw new Error('Groww API key not set');

    logger.warn('[Groww] Official API not available yet. Returning empty. Use CSV export.');
    // When API is available, implement:
    // const data = await this._get('/portfolio/mutual-funds');
    // return data.map(h => ({ ... }));
    return [];
  }

  async getTransactions(fromDate, toDate) {
    logger.warn('[Groww] getTransactions: API not available yet.');
    return [];
  }

  async getProfile() {
    logger.warn('[Groww] getProfile: API not available yet.');
    return { broker: 'groww' };
  }
}

module.exports = new GrowwBroker();
