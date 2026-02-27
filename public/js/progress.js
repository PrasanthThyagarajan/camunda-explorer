/**
 * Progress Overlay — Presentation component.
 *
 * SRP: Manages the full-screen progress overlay for batch operations.
 */

import { shortId, esc } from './utils.js';
import { state, panelLoaders, sidebarRefreshers } from './state.js';

/**
 * Show the progress overlay with a title.
 * @param {string} title
 */
export function showProgress(title) {
  document.getElementById('progress-title').textContent = title;
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-status').textContent = 'Starting…';
  document.getElementById('progress-detail').textContent = '';
  document.getElementById('progress-results').style.display = 'none';
  document.getElementById('progress-results').innerHTML = '';
  document.getElementById('progress-close-btn').style.display = 'none';
  document.getElementById('progress-overlay').classList.add('visible');
}

/**
 * Update the progress bar and status text.
 * @param {number} current
 * @param {number} total
 * @param {string} [detail]
 */
export function updateProgress(current, total, detail) {
  const pct = Math.round((current / total) * 100);
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-status').textContent = `${current} / ${total} (${pct}%)`;
  if (detail) document.getElementById('progress-detail').textContent = detail;
}

/**
 * Mark progress as complete and show results.
 * @param {{ succeeded: number, failed: number, results: Array<{incidentId: string, status: string, message: string}> }} result
 */
export function finishProgress(result) {
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('progress-status').textContent =
    `Done! ✅ ${result.succeeded} succeeded, ❌ ${result.failed} failed`;
  document.getElementById('progress-close-btn').style.display = '';

  const container = document.getElementById('progress-results');
  container.style.display = '';
  let html = '';
  (result.results || []).forEach(r => {
    const cls = r.status === 'success' ? 'result-ok' : 'result-err';
    const icon = r.status === 'success' ? '✅' : '❌';
    html += `<div class="result-item"><span class="${cls}">${icon}</span><span>${shortId(r.incidentId)}</span><span class="${cls}">${esc(r.message)}</span></div>`;
  });
  container.innerHTML = html;
}

/**
 * Close the progress overlay and refresh the current panel.
 */
export function closeProgress() {
  document.getElementById('progress-overlay').classList.remove('visible');
  // Trigger a full refresh of the active panel + sidebar
  _refreshCurrentPanel();
}

/** Internal: call refreshCurrentPanel from the registry to avoid circular imports. */
function _refreshCurrentPanel() {
  state.procDefNameCache = {};
  state.procDefFilterBuilt = false;
  if (sidebarRefreshers.envIndicator) sidebarRefreshers.envIndicator();
  if (state.currentPanel !== 'health' && sidebarRefreshers.badges) sidebarRefreshers.badges();
  const loader = panelLoaders[state.currentPanel];
  if (loader) loader();
}
