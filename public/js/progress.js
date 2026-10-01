import { shortId, esc } from './utils.js';
import { state, panelLoaders, sidebarRefreshers } from './state.js';

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

export function updateProgress(current, total, detail) {
  const pct = Math.round((current / total) * 100);
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-status').textContent = `${current} / ${total} (${pct}%)`;
  if (detail) document.getElementById('progress-detail').textContent = detail;
}

const RESULT_STYLE = {
  success: { cls: 'result-ok', icon: '✅' },
  skipped: { cls: 'result-skip', icon: '⊘' },
  error: { cls: 'result-err', icon: '❌' },
};

export function finishProgress(result) {
  const skipped = result.skipped || 0;
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('progress-status').textContent = result.statusText ||
    `Done! ✅ ${result.succeeded} succeeded` +
    (skipped > 0 ? `, ⊘ ${skipped} already processed` : '') +
    `, ❌ ${result.failed} failed`;
  document.getElementById('progress-close-btn').style.display = '';

  const container = document.getElementById('progress-results');
  container.style.display = '';
  let html = '';
  (result.results || []).forEach(r => {
    const { cls, icon } = RESULT_STYLE[r.status] || RESULT_STYLE.error;
    html += `<div class="result-item"><span class="${cls}">${icon}</span><span>${shortId(r.incidentId)}</span><span class="${cls}">${esc(r.message)}</span></div>`;
  });
  container.innerHTML = html;
}

export function closeProgress() {
  document.getElementById('progress-overlay').classList.remove('visible');
  _refreshCurrentPanel();
}

function _refreshCurrentPanel() {
  state.procDefNameCache = {};
  state.procDefFilterBuilt = false;
  if (sidebarRefreshers.envIndicator) sidebarRefreshers.envIndicator();
  if (state.currentPanel !== 'health' && sidebarRefreshers.badges) sidebarRefreshers.badges();
  const loader = panelLoaders[state.currentPanel];
  if (loader) loader();
}
