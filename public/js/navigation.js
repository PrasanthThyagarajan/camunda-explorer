/**
 * Navigation — Presentation layer.
 *
 * SRP: Panel switching, sidebar refresh, environment indicator.
 * Uses the panelLoaders registry to avoid circular dependencies.
 */

import { state, panelLoaders, sidebarRefreshers, PANEL_TITLES } from './state.js';
import { api, rawApi } from './api-client.js';

// ── Panel Switching ─────────────────────────────────────────────────

/**
 * Switch to a panel by ID.
 * Updates navigation state, DOM classes, topbar title, and loads data.
 * @param {string} id — panel identifier (e.g., 'health', 'incidents')
 */
export function switchPanel(id) {
  state.currentPanel = id;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.panel === id)
  );
  document.getElementById('topbar-title').textContent = PANEL_TITLES[id] || id;
  refreshCurrentPanel();
}

/**
 * Refresh the current panel by calling its registered loader.
 * Also refreshes sidebar badges and environment indicator.
 */
export function refreshCurrentPanel() {
  // Clear caches so fresh data is fetched
  state.procDefNameCache = {};
  state.procDefFilterBuilt = false;

  // Always refresh sidebar: env indicator + badges + engine status
  refreshEnvIndicator();
  if (state.currentPanel !== 'health') refreshSidebarBadges();

  const loader = panelLoaders[state.currentPanel];
  if (loader) loader();
}

// ── Sidebar Badges & Status ─────────────────────────────────────────

/**
 * Refresh sidebar badge counts and engine connection status.
 * Lightweight health check that doesn't reload the full health panel.
 */
export async function refreshSidebarBadges() {
  try {
    const stats = await api('/process-definition/statistics?failedJobs=true&incidents=true');
    let totalFailed = 0, totalIncidents = 0;
    stats.forEach(s => {
      totalFailed += s.failedJobs || 0;
      (s.incidents || []).forEach(i => totalIncidents += i.incidentCount || 0);
    });
    updateBadge('incidents', totalIncidents);
    updateBadge('jobs', totalFailed);
    setEngineStatus(true);
  } catch (_) {
    setEngineStatus(false);
  }
}

/**
 * Update a sidebar badge count.
 * @param {string} id — badge identifier ('incidents' or 'jobs')
 * @param {number} count
 */
export function updateBadge(id, count) {
  const el = document.getElementById('badge-' + id);
  if (count > 0) { el.style.display = ''; el.textContent = count; }
  else { el.style.display = 'none'; }
}

/**
 * Set the engine connection status indicator.
 * @param {boolean} ok
 */
export function setEngineStatus(ok) {
  const dot = document.getElementById('engine-status');
  const label = document.getElementById('engine-label');
  dot.className = 'status-dot ' + (ok ? 'ok' : 'err');
  label.textContent = ok ? 'Engine connected' : 'Engine unreachable';
}

// ── Environment Indicator ───────────────────────────────────────────

/**
 * Refresh the sidebar and topbar environment indicators.
 */
export async function refreshEnvIndicator() {
  try {
    const cfg = await rawApi('/config');
    document.getElementById('sidebar-env-name').textContent = cfg.envName || 'None';
    document.getElementById('sidebar-env-url').textContent = cfg.camundaBaseUrl || '';
    document.getElementById('sidebar-env-dot').style.background = cfg.envColor || '#64748b';
    document.getElementById('topbar-env-name').textContent = cfg.envName || '—';
    document.getElementById('topbar-env-dot').style.background = cfg.envColor || '#64748b';
    document.getElementById('topbar-url').textContent = cfg.camundaBaseUrl || '';
  } catch (_) {}
}

// ── Register in sidebar refresher registry ──────────────────────────
sidebarRefreshers.envIndicator = refreshEnvIndicator;
sidebarRefreshers.badges = refreshSidebarBadges;
