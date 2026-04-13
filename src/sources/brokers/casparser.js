'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../../config/logger');
const { config } = require('../../config');

const DEFAULT_BASE = 'https://api.casparser.in';

function normalizeNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapCasResponseToHoldings(payload) {
  const holdings = [];
  if (!payload || typeof payload !== 'object') return holdings;

  const dematAccounts = Array.isArray(payload.demat_accounts) ? payload.demat_accounts : [];
  for (const account of dematAccounts) {
    const accountType = String(account?.demat_type || payload?.meta?.cas_type || '').toLowerCase();
    const broker = accountType.includes('nsdl') ? 'nsdl' : 'cdsl';
    const entries = Array.isArray(account?.holdings)
      ? account.holdings
      : Array.isArray(account?.securities)
        ? account.securities
        : [];

    for (const entry of entries) {
      const quantity = normalizeNumber(entry.quantity || entry.balance || entry.units);
      if (quantity <= 0) continue;
      const avg = normalizeNumber(entry.avg_price || entry.average_price || entry.cost_price || entry.rate);
      const current = normalizeNumber(entry.market_price || entry.last_price || entry.nav);
      const symbol = entry.symbol || entry.isin || entry.scrip || null;
      const name = entry.name || entry.security_name || entry.company_name || symbol;
      if (!name) continue;

      holdings.push({
        asset_type: 'equity',
        symbol,
        name,
        exchange: entry.exchange || 'NSE',
        quantity,
        avg_buy_price: avg || current || 0,
        current_price: current || null,
        current_value: normalizeNumber(entry.market_value) || (current > 0 ? quantity * current : null),
        invested_amount: normalizeNumber(entry.invested_value) || (avg > 0 ? quantity * avg : 0),
        isin: entry.isin || null,
        broker,
      });
    }
  }

  const mutualFunds = Array.isArray(payload.mutual_funds) ? payload.mutual_funds : [];
  for (const folio of mutualFunds) {
    const schemes = Array.isArray(folio?.schemes)
      ? folio.schemes
      : Array.isArray(folio?.holdings)
        ? folio.holdings
        : [];

    for (const scheme of schemes) {
      const units = normalizeNumber(scheme.units || scheme.quantity);
      if (units <= 0) continue;
      const nav = normalizeNumber(scheme.nav || scheme.current_nav || scheme.current_price);
      const cost = normalizeNumber(scheme.average_cost || scheme.avg_nav || scheme.avg_price);
      const name = scheme.name || scheme.scheme_name || scheme.fund_name;
      if (!name) continue;

      holdings.push({
        asset_type: 'mutual_fund',
        symbol: scheme.isin || scheme.amfi_code || null,
        name,
        exchange: '',
        quantity: units,
        units,
        nav: nav || null,
        avg_buy_price: cost || nav || 0,
        invested_amount: normalizeNumber(scheme.invested_amount) || (cost > 0 ? units * cost : (nav > 0 ? units * nav : 0)),
        current_price: nav || null,
        current_value: normalizeNumber(scheme.current_value) || (nav > 0 ? units * nav : null),
        folio_number: scheme.folio || folio.folio_number || null,
        broker: 'cas',
      });
    }
  }

  return holdings;
}

class CasParserBroker {
  constructor() {
    this.cfg = config.brokers.casParser;
  }

  isConfigured() {
    return !!this.cfg.apiKey;
  }

  _headers(extra = {}) {
    return {
      'x-api-key': this.cfg.apiKey,
      ...extra,
    };
  }

  _base() {
    return this.cfg.baseUrl || DEFAULT_BASE;
  }

  async _parsePdfBuffer(buffer, filename = 'statement.pdf') {
    if (!this.isConfigured()) throw new Error('CAS parser API key not configured');

    const form = new FormData();
    const blob = new Blob([buffer], { type: 'application/pdf' });
    form.append('file', blob, filename);

    const res = await axios.post(`${this._base()}/v4/smart/parse`, form, {
      headers: this._headers(),
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return mapCasResponseToHoldings(res.data);
  }

  async parseCasPdf(filePath) {
    const buffer = fs.readFileSync(filePath);
    return this._parsePdfBuffer(buffer, path.basename(filePath));
  }

  async startCdslFetch({ boId, pan }) {
    if (!this.isConfigured()) throw new Error('CAS parser API key not configured');
    if (!boId) throw new Error('CDSL BO ID is required');

    const payload = { bo_id: boId };
    if (pan) payload.pan = pan;

    const res = await axios.post(`${this._base()}/v4/cdsl/fetch`, payload, {
      headers: this._headers({ 'Content-Type': 'application/json' }),
      timeout: 30000,
    });

    return res.data;
  }

  async verifyCdslFetch({ sessionId, otp }) {
    if (!this.isConfigured()) throw new Error('CAS parser API key not configured');
    if (!sessionId || !otp) throw new Error('sessionId and otp are required');

    const res = await axios.post(`${this._base()}/v4/cdsl/fetch/${encodeURIComponent(sessionId)}/verify`, { otp }, {
      headers: this._headers({ 'Content-Type': 'application/json' }),
      timeout: 30000,
    });

    const data = res.data || {};
    const urls = [
      ...(Array.isArray(data.download_urls) ? data.download_urls : []),
      ...(Array.isArray(data.pdf_urls) ? data.pdf_urls : []),
    ].filter(Boolean);

    const holdings = [];
    for (const [idx, url] of urls.entries()) {
      try {
        const pdf = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        const parsed = await this._parsePdfBuffer(Buffer.from(pdf.data), `cdsl_${idx + 1}.pdf`);
        holdings.push(...parsed);
      } catch (err) {
        logger.warn(`[CAS] Failed parsing fetched CAS URL: ${err.message}`);
      }
    }

    return { data, holdings };
  }
}

module.exports = { casParserBroker: new CasParserBroker(), mapCasResponseToHoldings };
