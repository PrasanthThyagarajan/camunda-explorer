import { state, panelLoaders, sidebarRefreshers, PANEL_TITLES } from './state.js';
import { api, rawApi } from './api-client.js';

export function switchPanel(id) {
  // Close all open overlays, popups, and dialogs before switching
  closeAllOverlays();

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
 * Closes every overlay, popup, dialog, and side panel so the user
 * starts with a clean slate when navigating to a new section.
 */
function closeAllOverlays() {
  // Class-toggled overlays  (remove the class that makes them visible)
  const classOverlays = [
    { id: 'detail-panel',             cls: 'open' },
    { id: 'jobs-overlay',             cls: 'visible' },
    { id: 'progress-overlay',         cls: 'visible' },
    { id: 'modify-dialog-overlay',    cls: 'visible' },
    { id: 'start-dialog-overlay',     cls: 'visible' },
    { id: 'history-track-overlay',    cls: 'open' },
    { id: 'migration-overlay',        cls: 'open' },
    { id: 'migration-confirm-overlay',cls: 'open' },
  ];
  for (const { id, cls } of classOverlays) {
    const el = document.getElementById(id);
    if (el) el.classList.remove(cls);
  }

  // Style-toggled overlays  (set display to none)
  const styleOverlays = ['diagnosis-overlay', 'stacktrace-overlay', 'dx-confirm-overlay'];
  for (const id of styleOverlays) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // Restore body scroll in case an overlay locked it
  document.body.style.overflow = '';
}

export function refreshCurrentPanel() {
  state.procDefNameCache = {};
  state.procDefFilterBuilt = false;

  refreshEnvIndicator();
  if (state.currentPanel !== 'health') refreshSidebarBadges();

  const loader = panelLoaders[state.currentPanel];
  if (loader) loader();
}

export async function refreshSidebarBadges() {
  try {
    const stats = await api('/process-definition/statistics?failedJobs=true&incidents=true');
    let totalFailed = 0, totalIncidents = 0;
    stats.forEach(s => {
      totalFailed += s.failedJobs || 0;
      (s.incidents || []).forEach(i => totalIncidents += i.incidentCount || 0);
    });
    updateBadge('incidents', totalIncidents);
    setEngineStatus(true);
  } catch (_) {
    setEngineStatus(false);
  }
}

export function updateBadge(id, count) {
  const el = document.getElementById('badge-' + id);
  if (!el) return;
  if (count > 0) { el.style.display = ''; el.textContent = count; }
  else { el.style.display = 'none'; }
}

export function setEngineStatus(ok) {
  const dot = document.getElementById('engine-status');
  const label = document.getElementById('engine-label');
  dot.className = 'status-dot ' + (ok ? 'ok' : 'err');
  label.textContent = ok ? 'Engine connected' : 'Engine unreachable';
}

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

sidebarRefreshers.envIndicator = refreshEnvIndicator;
sidebarRefreshers.badges = refreshSidebarBadges;
