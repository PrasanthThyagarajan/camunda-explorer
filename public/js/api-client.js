const API_PREFIX = '/api';

/** Fetch from Camunda REST API via the proxy (/api/...). */
export async function api(path, opts = {}) {
  return _fetch(API_PREFIX + path, opts);
}

/** Fetch from the dashboard server directly (no /api prefix). */
export async function rawApi(path, opts = {}) {
  return _fetch(path, opts);
}

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
