'use strict';

/**
 * Groww broker adapter.
 *
 * Official docs:
 * - https://groww.in/trade-api
 * - https://groww.in/trade-api/docs/curl/portfolio
 */

const axios  = require('axios');
const logger = require('../../config/logger');
const { config } = require('../../config');
const BaseBroker = require('./base');

const BASE = 'https://api.groww.in/v1';

function toNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'X-API-VERSION': '1.0',
      Accept: 'application/json',
    };
  }

  _extractPayload(response) {
    if (!response || typeof response !== 'object') return response;
    if (response.status && response.status !== 'SUCCESS') {
      throw new Error(response.message || `Groww API error: ${response.status}`);
    }
    return response.payload ?? response.data ?? response;
  }

  async _get(endpoint, params = {}) {
    if (!this.isConfigured()) throw new Error('Groww not configured. Set GROWW_API_KEY');

    try {
      const res = await axios.get(`${BASE}${endpoint}`, {
        headers: this._headers(),
        params,
        timeout: 15000,
      });
      return this._extractPayload(res.data);
    } catch (err) {
      if (err.response?.status === 401) {
        throw new Error('Groww authentication failed. Verify GROWW_API_KEY / access token.');
      }
      if (err.response?.status === 404) {
        throw new Error('Groww endpoint unavailable for this account/plan.');
      }
      if (err.response?.data?.message) {
        throw new Error(`Groww: ${err.response.data.message}`);
      }
      throw err;
    }
  }

  async getHoldings() {
    const payload = await this._get('/holdings/user');
    const rows = payload?.holdings || [];

    return rows
      .map(h => {
        const quantity = toNumber(h.quantity || h.demat_free_quantity || h.available_quantity);
        const avgPrice = toNumber(h.average_price);
        const lastPrice = toNumber(h.last_price || h.ltp || h.close_price);

        return {
          asset_type: 'equity',
          symbol: h.trading_symbol || h.symbol || h.isin || null,
          name: h.company_name || h.trading_symbol || h.symbol || h.isin || 'Unknown',
          exchange: h.exchange || 'NSE',
          quantity,
          avg_buy_price: avgPrice,
          current_price: lastPrice || avgPrice,
          current_value: quantity * (lastPrice || avgPrice),
          invested_amount: quantity * avgPrice,
          unrealized_pnl: quantity * ((lastPrice || avgPrice) - avgPrice),
          pnl_percent: avgPrice > 0 ? (((lastPrice || avgPrice) - avgPrice) / avgPrice) * 100 : 0,
          isin: h.isin || null,
          broker: 'groww',
        };
      })
      .filter(h => h.quantity > 0 && (h.symbol || h.name));
  }

  async getMFHoldings() {
    logger.info('[Groww] Mutual fund holdings endpoint not integrated yet in this adapter.');
    return [];
  }

  async getTransactions(fromDate, toDate) {
    const payload = await this._get('/positions/user', { from_date: fromDate, to_date: toDate });
    const positions = payload?.positions || [];
    return positions.map(p => ({
      type: toNumber(p.buy_quantity) > toNumber(p.sell_quantity) ? 'buy' : 'sell',
      symbol: p.trading_symbol || p.symbol || null,
      exchange: p.exchange || 'NSE',
      quantity: Math.abs(toNumber(p.net_quantity || p.quantity)),
      price: toNumber(p.net_average_price || p.average_price),
      amount: Math.abs(toNumber(p.net_quantity || p.quantity)) * toNumber(p.net_average_price || p.average_price),
      fees: 0,
      date: new Date().toISOString(),
    }));
  }

  async getProfile() {
    return { broker: 'groww' };
  }
}

module.exports = new GrowwBroker();
