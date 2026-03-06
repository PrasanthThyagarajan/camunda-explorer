import { api, rawApi } from '../api-client.js';
import { esc, shortId, fmtDate, toast } from '../utils.js';
import { state, panelLoaders } from '../state.js';
import { showProgress, updateProgress, finishProgress } from '../progress.js';

export function refreshMaintenance() {
  state.duplicateData = null;
  state.resolvePreviewIds = [];
  state.resolvePreviewData = [];
  state.staleIncidentIds = [];
  document.getElementById('dup-stats').style.display = 'none';
  document.getElementById('dup-groups-list').innerHTML = '';
  document.getElementById('resolve-preview-stats').style.display = 'none';
  document.getElementById('resolve-result-log').innerHTML = '';
  document.getElementById('maint-resolve-btn').style.display = 'none';
  document.getElementById('stale-stats').style.display = 'none';
  document.getElementById('stale-list').innerHTML = '';
  document.getElementById('stale-resolve-btn').style.display = 'none';
  toast('Maintenance panel refreshed — run scans again', 'info');
}

export async function scanDuplicates() {
  try {
    toast('Scanning for duplicate incidents…', 'info');
    state.duplicateData = await rawApi('/actions/find-duplicates');

    document.getElementById('dup-stats').style.display = 'flex';
    document.getElementById('dup-total-incidents').textContent = state.duplicateData.totalIncidents;
    document.getElementById('dup-total-duplicates').textContent = state.duplicateData.totalDuplicates;
    document.getElementById('dup-total-groups').textContent = state.duplicateData.groups.length;

    if (state.duplicateData.totalDuplicates === 0) {
      document.getElementById('dup-groups-list').innerHTML =
        '<div style="text-align:center;padding:20px;color:var(--green)">✅ No duplicate incidents found!</div>';
      document.getElementById('dup-remove-all-btn').style.display = 'none';
      return;
    }

    document.getElementById('dup-remove-all-btn').style.display = '';

    let html = '';
    state.duplicateData.groups.forEach((g, idx) => {
      html += `<div class="dup-group">
        <div class="dup-group-header">
          <div>
            <span class="tag tag-red">${g.incidentType}</span>
            <strong>${g.activityId}</strong>
            <span style="color:var(--text3);font-size:11px;margin-left:8px">${shortId(g.processDefinitionId)}</span>
          </div>
          <div class="dup-group-actions">
            <span style="font-size:12px;color:var(--text3)">${g.total} total, <strong style="color:var(--red)">${g.duplicates.length}</strong> duplicates</span>
            <button class="btn btn-danger btn-sm" onclick="removeDuplicateGroup(${idx})">Remove ${g.duplicates.length}</button>
          </div>
        </div>
        <div class="dup-group-meta">
          Keeping: ${shortId(g.keep.id)} (${fmtDate(g.keep.incidentTimestamp)})
        </div>
      </div>`;
    });
    document.getElementById('dup-groups-list').innerHTML = html;

    toast(`Found ${state.duplicateData.totalDuplicates} duplicates in ${state.duplicateData.groups.length} groups`, 'info');
  } catch (e) {
    toast('Scan failed: ' + e.message, 'error');
  }
}

export async function removeDuplicateGroup(groupIdx) {
  if (!state.duplicateData || !state.duplicateData.groups[groupIdx]) return;
  const group = state.duplicateData.groups[groupIdx];
  if (!confirm(`Remove ${group.duplicates.length} duplicate incidents for activity "${group.activityId}"?\n\nKeeping: ${shortId(group.keep.id)} (newest)\n\nThis sets retries=1 on the duplicate jobs/tasks so the engine can re-evaluate them.`)) return;

  const ids = group.duplicates.map(d => d.id);
  showProgress(`Resolving ${ids.length} duplicate incidents…`);
  updateProgress(0, ids.length, 'Resolving duplicates (retry strategy)…');

  try {
    const result = await rawApi('/actions/batch-resolve', {
      method: 'POST', body: { incidentIds: ids, batchSize: 10, strategy: 'retry' }
    });
    finishProgress(result);
    setTimeout(scanDuplicates, 2000);
  } catch (e) {
    finishProgress({ succeeded: 0, failed: ids.length, results: [{ incidentId: '—', status: 'error', message: e.message }] });
  }
}

export async function removeAllDuplicates() {
  if (!state.duplicateData || state.duplicateData.totalDuplicates === 0) return;
  if (!confirm(`Resolve ALL ${state.duplicateData.totalDuplicates} duplicate incidents across ${state.duplicateData.groups.length} groups?\n\nThis keeps the newest incident in each group and resolves the rest by setting retries=1.\n\nProceed?`)) return;

  const allIds = state.duplicateData.groups.flatMap(g => g.duplicates.map(d => d.id));
  showProgress(`Resolving ${allIds.length} duplicate incidents…`);
  updateProgress(0, allIds.length, 'Batch resolving duplicates…');

  try {
    const result = await rawApi('/actions/batch-resolve', {
      method: 'POST', body: { incidentIds: allIds, batchSize: 10, strategy: 'retry' }
    });
    finishProgress(result);
    setTimeout(scanDuplicates, 2000);
  } catch (e) {
    finishProgress({ succeeded: 0, failed: allIds.length, results: [{ incidentId: '—', status: 'error', message: e.message }] });
  }
}

export async function previewResolve() {
  try {
    const params = new URLSearchParams({ maxResults: '2000' });
    const type = document.getElementById('maint-resolve-type').value;
    const key = document.getElementById('maint-resolve-key').value;
    if (type) params.set('incidentType', type);
    if (key) params.set('processDefinitionKey', key);

    state.resolvePreviewData = await api('/incident?' + params);
    state.resolvePreviewIds = state.resolvePreviewData.map(d => d.id);
    const orphanCount = state.resolvePreviewData.filter(d => !d.processInstanceId).length;

    document.getElementById('resolve-preview-stats').style.display = 'flex';
    document.getElementById('resolve-preview-count').textContent = state.resolvePreviewIds.length;
    document.getElementById('resolve-preview-orphans').textContent = orphanCount;

    if (state.resolvePreviewIds.length > 0) {
      document.getElementById('maint-resolve-btn').style.display = '';
    } else {
      document.getElementById('maint-resolve-btn').style.display = 'none';
    }
    document.getElementById('resolve-result-log').innerHTML = '';

    toast(`Found ${state.resolvePreviewIds.length} incidents (${orphanCount} orphaned)`, 'info');
  } catch (e) {
    toast('Preview failed: ' + e.message, 'error');
  }
}

export async function executeBatchResolve() {
  if (state.resolvePreviewIds.length === 0) { toast('No incidents to resolve', 'info'); return; }
  const strategy = document.getElementById('maint-resolve-strategy').value;
  const strategyLabel = strategy === 'delete' ? 'DELETE process instances' : 'set retries=1 (retry)';

  if (strategy === 'delete') {
    if (!confirm(`⚠️ DESTRUCTIVE: This will DELETE the process instances for ${state.resolvePreviewIds.length} incidents.\n\nThis permanently removes the process instances and all their data.\n\nAre you absolutely sure?`)) return;
  } else {
    if (!confirm(`Retry ${state.resolvePreviewIds.length} incidents? This sets retries=1 so the engine re-attempts execution.\n\nStrategy: ${strategyLabel}`)) return;
  }

  showProgress(`Resolving ${state.resolvePreviewIds.length} incidents (${strategyLabel})…`);
  updateProgress(0, state.resolvePreviewIds.length, 'Processing…');

  try {
    const result = await rawApi('/actions/batch-resolve', {
      method: 'POST', body: { incidentIds: state.resolvePreviewIds, batchSize: 10, strategy }
    });
    finishProgress(result);
    state.resolvePreviewIds = [];
    state.resolvePreviewData = [];
    document.getElementById('maint-resolve-btn').style.display = 'none';
  } catch (e) {
    finishProgress({ succeeded: 0, failed: state.resolvePreviewIds.length, results: [{ incidentId: '—', status: 'error', message: e.message }] });
  }
}

export async function findStaleIncidents() {
  try {
    const days = parseInt(document.getElementById('maint-stale-days').value) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({ maxResults: '2000' });
    const data = await api('/incident?' + params);

    const stale = data.filter(inc => inc.incidentTimestamp && new Date(inc.incidentTimestamp) < new Date(cutoff));
    state.staleIncidentIds = stale.map(s => s.id);

    document.getElementById('stale-stats').style.display = 'flex';
    document.getElementById('stale-count').textContent = state.staleIncidentIds.length;

    if (state.staleIncidentIds.length === 0) {
      document.getElementById('stale-list').innerHTML =
        `<div style="text-align:center;padding:16px;color:var(--green)">✅ No incidents older than ${days} days</div>`;
      document.getElementById('stale-resolve-btn').style.display = 'none';
      return;
    }

    document.getElementById('stale-resolve-btn').style.display = '';

    let html = '<table><thead><tr><th>ID</th><th>Type</th><th>Activity</th><th>Age</th></tr></thead><tbody>';
    stale.slice(0, 50).forEach(inc => {
      const age = Math.round((Date.now() - new Date(inc.incidentTimestamp).getTime()) / (1000 * 60 * 60 * 24));
      html += `<tr>
        <td>${shortId(inc.id)}</td>
        <td><span class="tag tag-red">${inc.incidentType}</span></td>
        <td>${inc.activityId || '—'}</td>
        <td><strong>${age}</strong> days</td>
      </tr>`;
    });
    if (stale.length > 50) html += `<tr><td colspan="4" style="text-align:center;color:var(--text3)">… and ${stale.length - 50} more</td></tr>`;
    html += '</tbody></table>';
    document.getElementById('stale-list').innerHTML = html;

    toast(`Found ${state.staleIncidentIds.length} incidents older than ${days} days`, 'info');
  } catch (e) {
    toast('Scan failed: ' + e.message, 'error');
  }
}

export async function resolveStaleIncidents() {
  if (state.staleIncidentIds.length === 0) return;
  if (!confirm(`Resolve ${state.staleIncidentIds.length} stale incidents by setting retries=1? The engine will re-attempt execution.`)) return;

  showProgress(`Resolving ${state.staleIncidentIds.length} stale incidents…`);
  updateProgress(0, state.staleIncidentIds.length, 'Resolving stale incidents (retry strategy)…');

  try {
    const result = await rawApi('/actions/batch-resolve', {
      method: 'POST', body: { incidentIds: state.staleIncidentIds, batchSize: 10, strategy: 'retry' }
    });
    finishProgress(result);
    state.staleIncidentIds = [];
    document.getElementById('stale-resolve-btn').style.display = 'none';
  } catch (e) {
    finishProgress({ succeeded: 0, failed: state.staleIncidentIds.length, results: [{ incidentId: '—', status: 'error', message: e.message }] });
  }
}

panelLoaders.maintenance = refreshMaintenance;
