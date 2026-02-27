/**
 * API Client — Infrastructure layer.
 *
 * SRP: Only responsible for making HTTP requests.
 * Provides two methods:
 *   - api()    → prefixes with /api (proxied to Camunda)
 *   - rawApi() → calls server endpoints directly (no /api prefix)
 */

const API_PREFIX = '/api';

/**
 * Fetch from Camunda REST API via the proxy (/api/...).
 * @param {string} path  — e.g. "/incident?maxResults=100"
 * @param {object} opts  — { method, body }
 * @returns {Promise<any>}
 */
export async function api(path, opts = {}) {
  return _fetch(API_PREFIX + path, opts);
}

/**
 * Fetch from the dashboard server directly (no /api prefix).
 * Used for /environments, /actions, /config, etc.
 * @param {string} path
 * @param {object} opts
 * @returns {Promise<any>}
 */
export async function rawApi(path, opts = {}) {
  return _fetch(path, opts);
}

/**
 * Internal fetch wrapper with error handling and JSON parsing.
 */
async function _fetch(url, opts) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.type || `HTTP ${res.status}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
