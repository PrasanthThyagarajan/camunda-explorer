/**
 * Incidents Panel — Presentation layer.
 *
 * SRP: Incident listing, filtering, batch selection, single-incident actions.
 */

import { api, rawApi } from '../api-client.js';
import { esc, shortId, shortMsg, fmtDate, copyBtn, toast } from '../utils.js';
import { state, panelLoaders } from '../state.js';
import { refreshCurrentPanel } from '../navigation.js';
import { openDetail, closeDetail } from '../detail-panel.js';
import { showProgress, updateProgress, finishProgress } from '../progress.js';
import { openModifyDialog, modifyIncidentToStart, batchModifyToStart } from '../components/modify-dialog.js';

// ── Process Definition Name Helpers ─────────────────────────────────

async function loadProcDefNames() {
  if (Object.keys(state.procDefNameCache).length > 0) return;
  try {
    const defs = await api('/process-definition?latestVersion=true&sortBy=name&sortOrder=asc&maxResults=500');
    (defs || []).forEach(d => {
      state.procDefNameCache[d.id] = d.name || d.key;
      state.procDefNameCache[d.key] = d.name || d.key;
    });
  } catch (e) { console.warn('Failed to load proc def names:', e); }
}

export function getProcDefName(processDefinitionId) {
  if (!processDefinitionId) return '—';
  if (state.procDefNameCache[processDefinitionId]) return state.procDefNameCache[processDefinitionId];
  const key = processDefinitionId.split(':')[0];
  if (state.procDefNameCache[key]) return state.procDefNameCache[key];
  return key || '—';
}

async function buildProcDefFilterFromIncidents(incidents) {
  await loadProcDefNames();

  const sel = document.getElementById('inc-filter-procdef');
  const currentValue = sel.value;

  const procDefKeys = new Map();
  (incidents || []).forEach(inc => {
    if (inc.processDefinitionId) {
      const key = inc.processDefinitionId.split(':')[0];
      if (!procDefKeys.has(key)) {
        procDefKeys.set(key, { name: getProcDefName(inc.processDefinitionId), count: 0 });
      }
      procDefKeys.get(key).count++;
    }
  });

  const sorted = [...procDefKeys.entries()].sort((a, b) => b[1].count - a[1].count);

  sel.innerHTML = '<option value="">All Processes</option>';
  sorted.forEach(([key, info]) => {
    sel.innerHTML += `<option value="${key}">${info.name} (${info.count})</option>`;
  });

  if (currentValue && [...sel.options].some(o => o.value === currentValue)) {
    sel.value = currentValue;
  }
}

// ── Load Incidents ──────────────────────────────────────────────────

export async function loadIncidents() {
  await loadProcDefNames();

  try {
    const allParams = new URLSearchParams();
    const type = document.getElementById('inc-filter-type').value;
    const pi = document.getElementById('inc-filter-pi').value;
    const procDefKey = document.getElementById('inc-filter-procdef').value;
    if (type) allParams.set('incidentType', type);
    if (pi) allParams.set('processInstanceId', pi);
    allParams.set('sortBy', 'incidentTimestamp');
    allParams.set('sortOrder', 'desc');
    allParams.set('maxResults', '500');

    const allIncidents = await api('/incident?' + allParams) || [];

    await buildProcDefFilterFromIncidents(allIncidents);

    let incidents = allIncidents;
    if (procDefKey) {
      incidents = allIncidents.filter(inc =>
        inc.processDefinitionId && inc.processDefinitionId.startsWith(procDefKey + ':')
      );
    }
    state.currentIncidents = incidents;
    const count = incidents.length;

    document.getElementById('incident-stats').innerHTML = `
      <div class="stat-card"><div class="label">Total Incidents</div><div class="value red">${count}</div></div>
    `;

    if (!incidents || incidents.length === 0) {
      document.getElementById('incidents-table').innerHTML = '<div class="empty">No incidents found.</div>';
      hideBatchBar();
      return;
    }

    let html = '<table><thead><tr>';
    html += '<th><input type="checkbox" id="inc-select-all" onchange="toggleAllIncidents(this.checked)" /></th>';
    html += '<th>ID</th><th>Process</th><th>Type</th><th>Message</th><th>Activity</th><th>Instance</th><th>Time</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    incidents.forEach(r => {
      const procName = getProcDefName(r.processDefinitionId);
      html += `<tr>`;
      html += `<td><input type="checkbox" class="inc-checkbox" value="${r.id}" onchange="updateBatchBar()" /></td>`;
      html += `<td><a href="#" onclick="showIncidentDetail('${r.id}');return false">${shortId(r.id)}</a>${copyBtn(r.id)}</td>`;
      html += `<td><span class="tag tag-blue" style="font-size:11px" title="${esc(r.processDefinitionId)}">${esc(procName)}</span>${copyBtn(r.processDefinitionId)}</td>`;
      html += `<td><span class="tag tag-red">${r.incidentType}</span>${copyBtn(r.incidentType)}</td>`;
      html += `<td><span title="${esc(r.incidentMessage)}">${shortMsg(r.incidentMessage, 50)}</span>${copyBtn(r.incidentMessage)}</td>`;
      html += `<td>${r.activityId || '—'}${copyBtn(r.activityId)}</td>`;
      html += `<td><a href="#" onclick="showInstanceDetail('${r.processInstanceId}');return false">${shortId(r.processInstanceId)}</a>${copyBtn(r.processInstanceId)}</td>`;
      html += `<td>${fmtDate(r.incidentTimestamp)}${copyBtn(r.incidentTimestamp)}</td>`;
      html += `<td>
        <button class="btn btn-success btn-sm" onclick="retryIncident('${r.id}','${r.processInstanceId}','${r.configuration}')">↻ Retry</button>
        <button class="btn btn-primary btn-sm" onclick="modifyIncidentToStart('${r.id}')">🔄 Modify</button>
      </td>`;
      html += `</tr>`;
    });

    html += '</tbody></table>';
    document.getElementById('incidents-table').innerHTML = html;
    updateBatchBar();
  } catch (e) {
    document.getElementById('incidents-table').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

// ── Single Incident Actions ─────────────────────────────────────────

export async function retryIncident(incidentId, processInstanceId, jobId) {
  try {
    if (jobId) {
      await api(`/job/${jobId}/retries`, { method: 'PUT', body: { retries: 1 } });
      toast('Job retries set to 1 — engine will re-attempt execution', 'success');
    } else {
      toast('No associated job found. Use Modify instead.', 'info');
    }
    setTimeout(refreshCurrentPanel, 1000);
  } catch (e) { toast('Retry failed: ' + e.message, 'error'); }
}

export async function showIncidentDetail(id) {
  try {
    const inc = await api(`/incident/${id}`);

    let firstActInfo = '';
    try {
      const fa = await rawApi(`/actions/first-activity/${inc.processDefinitionId}`);
      firstActInfo = `<span class="k">First Activity</span><span class="v"><span class="tag tag-blue">${fa.firstActivityId}</span> (${esc(fa.firstActivityName)})</span>`;
    } catch (_) {}

    let html = `<div class="detail-section"><h4>Incident Details</h4><div class="kv-grid">
      <span class="k">ID</span><span class="v">${inc.id}${copyBtn(inc.id)}</span>
      <span class="k">Type</span><span class="v"><span class="tag tag-red">${inc.incidentType}</span>${copyBtn(inc.incidentType)}</span>
      <span class="k">Message</span><span class="v">${esc(inc.incidentMessage || '—')}${copyBtn(inc.incidentMessage)}</span>
      <span class="k">Stuck At</span><span class="v"><span class="tag tag-yellow">${inc.activityId || '—'}</span>${copyBtn(inc.activityId)}</span>
      ${firstActInfo}
      <span class="k">Failed Activity</span><span class="v">${inc.failedActivityId || '—'}${copyBtn(inc.failedActivityId)}</span>
      <span class="k">Process Instance</span><span class="v"><a href="#" onclick="showInstanceDetail('${inc.processInstanceId}');return false">${inc.processInstanceId}</a>${copyBtn(inc.processInstanceId)}</span>
      <span class="k">Process Def</span><span class="v">${inc.processDefinitionId || '—'}${copyBtn(inc.processDefinitionId)}</span>
      <span class="k">Execution</span><span class="v">${inc.executionId || '—'}${copyBtn(inc.executionId)}</span>
      <span class="k">Configuration</span><span class="v">${inc.configuration || '—'}${copyBtn(inc.configuration)}</span>
      <span class="k">Timestamp</span><span class="v">${fmtDate(inc.incidentTimestamp)}</span>
      <span class="k">Cause Incident</span><span class="v">${inc.causeIncidentId || '—'}${copyBtn(inc.causeIncidentId)}</span>
      <span class="k">Root Cause</span><span class="v">${inc.rootCauseIncidentId || '—'}${copyBtn(inc.rootCauseIncidentId)}</span>
      <span class="k">Annotation</span><span class="v">${inc.annotation || '—'}</span>
    </div></div>`;

    if (inc.configuration) {
      try {
        const st = await fetch('/api' + `/job/${inc.configuration}/stacktrace`);
        if (st.ok) {
          const trace = await st.text();
          html += `<div class="detail-section"><h4>Stacktrace</h4><pre class="json">${esc(trace)}</pre></div>`;
        }
      } catch (_) {}
    }

    html += `<div class="btn-group" style="flex-wrap:wrap">
      <button class="btn btn-success" onclick="retryIncident('${inc.id}','${inc.processInstanceId}','${inc.configuration}')">↻ Retry Job</button>
      <button class="btn btn-primary" onclick="closeDetail();modifyIncidentToStart('${inc.id}')">🔄 Modify</button>
    </div>`;

    openDetail('Incident: ' + shortId(inc.id), html);
  } catch (e) { toast('Failed to load: ' + e.message, 'error'); }
}

// ── Batch Selection ─────────────────────────────────────────────────

export function getSelectedIncidentIds() {
  return [...document.querySelectorAll('.inc-checkbox:checked')].map(cb => cb.value);
}

export function updateBatchBar() {
  const selected = getSelectedIncidentIds();
  const bar = document.getElementById('batch-bar');
  if (selected.length > 0) {
    bar.classList.add('visible');
    document.getElementById('batch-selected-count').textContent = selected.length;
  } else {
    bar.classList.remove('visible');
  }
}

function hideBatchBar() {
  document.getElementById('batch-bar').classList.remove('visible');
}

export function toggleAllIncidents(checked) {
  document.querySelectorAll('.inc-checkbox').forEach(cb => cb.checked = checked);
  updateBatchBar();
}

export function selectAllIncidents() {
  document.querySelectorAll('.inc-checkbox').forEach(cb => cb.checked = true);
  const selectAll = document.getElementById('inc-select-all');
  if (selectAll) selectAll.checked = true;
  updateBatchBar();
}

export function deselectAllIncidents() {
  document.querySelectorAll('.inc-checkbox').forEach(cb => cb.checked = false);
  const selectAll = document.getElementById('inc-select-all');
  if (selectAll) selectAll.checked = false;
  updateBatchBar();
}

// ── Batch Operations ────────────────────────────────────────────────

export async function batchRetry() {
  const ids = getSelectedIncidentIds();
  if (ids.length === 0) { toast('Select incidents first', 'error'); return; }
  if (!confirm(`Retry ${ids.length} incident(s)? This will set job retries to 1.`)) return;

  const batchSize = parseInt(document.getElementById('batch-size').value) || 10;
  showProgress(`Retrying ${ids.length} incidents (batch size: ${batchSize})`);
  updateProgress(0, ids.length, 'Sending request…');

  try {
    const result = await rawApi('/actions/batch-retry', {
      method: 'POST', body: { incidentIds: ids, batchSize }
    });
    finishProgress(result);
  } catch (e) {
    finishProgress({ succeeded: 0, failed: ids.length, results: [{ incidentId: '—', status: 'error', message: e.message }] });
  }
}

// Register in panel loader registry
panelLoaders.incidents = loadIncidents;
