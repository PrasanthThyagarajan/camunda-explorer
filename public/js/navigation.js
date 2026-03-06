import { state, panelLoaders, sidebarRefreshers, PANEL_TITLES } from './state.js';
import { api, rawApi } from './api-client.js';

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
    updateBadge('jobs', totalFailed);
    setEngineStatus(true);
  } catch (_) {
    setEngineStatus(false);
  }
}

export function updateBadge(id, count) {
  const el = document.getElementById('badge-' + id);
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
