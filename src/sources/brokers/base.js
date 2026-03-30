'use strict';

/**
 * Base broker adapter interface.
 * All broker adapters must implement these methods.
 */
class BaseBroker {
  constructor(name) {
    this.name = name;
  }

  /** @returns {boolean} */
  isConfigured() { throw new Error(`${this.name}: isConfigured() not implemented`); }

  /**
   * Fetch all current holdings from the broker.
   * @returns {Promise<Array>} normalized holding objects
   */
  async getHoldings() { throw new Error(`${this.name}: getHoldings() not implemented`); }

  /**
   * Fetch transaction history.
   * @param {string} fromDate - YYYY-MM-DD
   * @param {string} toDate   - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async getTransactions(fromDate, toDate) { throw new Error(`${this.name}: getTransactions() not implemented`); }

  /**
   * Fetch mutual fund holdings (if supported).
   * @returns {Promise<Array>}
   */
  async getMFHoldings() { return []; }

  /**
   * Get profile info (name, PAN, etc.).
   * @returns {Promise<Object>}
   */
  async getProfile() { throw new Error(`${this.name}: getProfile() not implemented`); }
}

module.exports = BaseBroker;
