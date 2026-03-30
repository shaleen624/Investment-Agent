'use strict';

/**
 * Zerodha Kite Connect broker adapter.
 *
 * Setup:
 *  1. Enable API access on Kite: https://kite.trade/
 *  2. Set KITE_API_KEY, KITE_API_SECRET in .env
 *  3. Generate access token daily:
 *     - Open login URL from getLoginUrl()
 *     - After login, pass the `request_token` to generateSession()
 *     - The access token is valid for 1 trading day
 *
 * API Docs: https://kite.trade/docs/connect/v3/
 */

const axios  = require('axios');
const logger = require('../../config/logger');
const { config } = require('../../config');
const BaseBroker = require('./base');

const BASE = 'https://api.kite.trade';

class KiteBroker extends BaseBroker {
  constructor() {
    super('kite');
    this.cfg = config.brokers.kite;
  }

  isConfigured() {
    return !!(this.cfg.apiKey && this.cfg.accessToken);
  }

  _headers() {
    return {
      'X-Kite-Version': '3',
      'Authorization':  `token ${this.cfg.apiKey}:${this.cfg.accessToken}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    };
  }

  async _get(endpoint, params = {}) {
    try {
      const res = await axios.get(`${BASE}${endpoint}`, {
        headers: this._headers(),
        params,
        timeout: 15000,
      });
      if (res.data?.status !== 'success') {
        throw new Error(res.data?.message || 'Unknown Kite error');
      }
      return res.data.data;
    } catch (err) {
      if (err.response?.data?.message) throw new Error(`Kite: ${err.response.data.message}`);
      throw err;
    }
  }

  /**
   * Generate the login URL for the user to open in a browser.
   */
  getLoginUrl() {
    return `https://kite.zerodha.com/connect/login?api_key=${this.cfg.apiKey}&v=3`;
  }

  /**
   * Exchange request_token for access_token.
   * Call this once after user completes the login flow.
   * @param {string} requestToken
   * @returns {string} access_token
   */
  async generateSession(requestToken) {
    const crypto = require('crypto');
    const checksum = crypto
      .createHash('sha256')
      .update(this.cfg.apiKey + requestToken + this.cfg.apiSecret)
      .digest('hex');

    const res = await axios.post(`${BASE}/session/token`, null, {
      headers: this._headers(),
      params:  {
        api_key:       this.cfg.apiKey,
        request_token: requestToken,
        checksum,
      },
    });

    const token = res.data?.data?.access_token;
    if (!token) throw new Error('Kite: failed to generate access token');
    return token;
  }

  /**
   * Fetch equity holdings.
   */
  async getHoldings() {
    if (!this.isConfigured()) throw new Error('Kite not configured. Set KITE_API_KEY and KITE_ACCESS_TOKEN');

    const data = await this._get('/portfolio/holdings');
    return (data || []).map(h => ({
      asset_type:     'equity',
      symbol:         h.tradingsymbol,
      name:           h.tradingsymbol,
      exchange:       h.exchange || 'NSE',
      quantity:       h.quantity,
      avg_buy_price:  h.average_price,
      current_price:  h.last_price,
      current_value:  h.quantity * h.last_price,
      invested_amount:h.quantity * h.average_price,
      unrealized_pnl: h.pnl,
      pnl_percent:    h.average_price > 0
        ? ((h.last_price - h.average_price) / h.average_price) * 100
        : 0,
      isin:           h.isin,
      broker:         'kite',
    }));
  }

  /**
   * Fetch mutual fund holdings.
   */
  async getMFHoldings() {
    if (!this.isConfigured()) throw new Error('Kite not configured');
    try {
      const data = await this._get('/mf/holdings');
      return (data || []).map(h => ({
        asset_type:     'mutual_fund',
        symbol:         h.tradingsymbol || h.fund,
        name:           h.fund || h.tradingsymbol,
        exchange:       '',
        quantity:       h.quantity,
        avg_buy_price:  h.average_price,
        current_price:  h.last_price,
        current_value:  h.quantity * (h.last_price || h.average_price),
        invested_amount:h.quantity * h.average_price,
        units:          h.quantity,
        nav:            h.last_price,
        broker:         'kite',
      }));
    } catch (err) {
      logger.warn(`[Kite] getMFHoldings failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetch transaction (tradebook) history.
   */
  async getTransactions(fromDate, toDate) {
    if (!this.isConfigured()) throw new Error('Kite not configured');
    try {
      const data = await this._get('/orders/trades');
      return (data || []).map(t => ({
        type:       t.transaction_type === 'BUY' ? 'buy' : 'sell',
        symbol:     t.tradingsymbol,
        exchange:   t.exchange,
        quantity:   t.quantity,
        price:      t.average_price || t.price,
        amount:     t.quantity * (t.average_price || t.price),
        fees:       0,
        date:       t.fill_timestamp || t.exchange_timestamp,
      }));
    } catch (err) {
      logger.warn(`[Kite] getTransactions failed: ${err.message}`);
      return [];
    }
  }

  async getProfile() {
    if (!this.isConfigured()) throw new Error('Kite not configured');
    const data = await this._get('/user/profile');
    return {
      name:  data.user_name,
      email: data.email,
      pan:   data.pan,
      broker:'kite',
    };
  }
}

module.exports = new KiteBroker();
