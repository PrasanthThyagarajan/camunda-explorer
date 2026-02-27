/**
 * Process Instances Panel — Presentation layer.
 *
 * SRP: Listing, filtering, detail view, suspend/modify/delete.
 */

import { api } from '../api-client.js';
import { esc, shortId, fmtDate, copyBtn, buildTable, toast } from '../utils.js';
import { panelLoaders } from '../state.js';
import { openDetail, closeDetail } from '../detail-panel.js';

// ── Load Instances ──────────────────────────────────────────────────

export async function loadInstances() {
  try {
    const params = new URLSearchParams();
    const key = document.getElementById('pi-filter-key').value;
    const bk = document.getElementById('pi-filter-bk').value;
    const st = document.getElementById('pi-filter-state').value;
    if (key) params.set('processDefinitionKey', key);
    if (bk) params.set('businessKeyLike', '%' + bk + '%');
    if (st === 'active') params.set('active', 'true');
    if (st === 'suspended') params.set('suspended', 'true');
    if (st === 'withIncident') params.set('withIncident', 'true');
    params.set('maxResults', '100');

    const data = await api('/process-instance?' + params);
    const cols = [
      { key: 'id', label: 'Instance ID', render: r => `<a href="#" onclick="showInstanceDetail('${r.id}');return false">${shortId(r.id)}</a>`, copyVal: r => r.id },
      { key: 'definitionId', label: 'Definition', render: r => shortId(r.definitionId), copyVal: r => r.definitionId },
      { key: 'businessKey', label: 'Business Key' },
      { key: 'suspended', label: 'State', render: r => r.suspended ? '<span class="tag tag-yellow">Suspended</span>' : '<span class="tag tag-green">Active</span>', noCopy: true },
    ];
    const actions = r => `
      <button class="btn btn-outline btn-sm" onclick="showInstanceDetail('${r.id}')">Details</button>
      <button class="btn btn-sm ${r.suspended ? 'btn-success' : 'btn-outline'}" onclick="toggleSuspend('${r.id}', ${r.suspended})">${r.suspended ? '▶ Activate' : '⏸ Suspend'}</button>
    `;
    document.getElementById('instances-table').innerHTML = buildTable(cols, data, actions);
  } catch (e) { document.getElementById('instances-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

// ── Instance Detail ─────────────────────────────────────────────────

export async function showInstanceDetail(id) {
  try {
    const [inst, activities, vars] = await Promise.all([
      api(`/process-instance/${id}`),
      api(`/process-instance/${id}/activity-instances`).catch(() => null),
      api(`/process-instance/${id}/variables?deserializeValues=true`).catch(() => null),
    ]);
    let html = `<div class="detail-section"><h4>Instance</h4><div class="kv-grid">
      <span class="k">ID</span><span class="v">${inst.id}${copyBtn(inst.id)}</span>
      <span class="k">Definition</span><span class="v">${inst.definitionId}${copyBtn(inst.definitionId)}</span>
      <span class="k">Business Key</span><span class="v">${inst.businessKey || '—'}${copyBtn(inst.businessKey)}</span>
      <span class="k">Suspended</span><span class="v">${inst.suspended ? '<span class="tag tag-yellow">Yes</span>' : '<span class="tag tag-green">No</span>'}</span>
    </div></div>`;

    if (activities) {
      html += `<div class="detail-section"><h4>Activity Instance Tree</h4><pre class="json">${esc(JSON.stringify(activities, null, 2))}</pre></div>`;
    }
    if (vars) {
      html += `<div class="detail-section"><h4>Variables</h4><pre class="json">${esc(JSON.stringify(vars, null, 2))}</pre></div>`;
    }

    html += `<div class="detail-section"><h4>Modify Instance</h4>
      <p style="font-size:12px;color:var(--text3);margin-bottom:8px">Move the token to a different activity. Get activity IDs from the tree above.</p>
      <div class="form-group mb-16"><label>Cancel Activity ID</label><input type="text" id="mod-cancel" placeholder="e.g. ServiceTask_1" style="min-width:100%"/></div>
      <div class="form-group mb-16"><label>Start Before Activity ID</label><input type="text" id="mod-start" placeholder="e.g. StartEvent_1" style="min-width:100%"/></div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="modifyInstance('${inst.id}')">Execute Modification</button>
        <button class="btn btn-danger" onclick="deleteInstance('${inst.id}')">Delete Instance</button>
      </div>
    </div>`;

    openDetail('Instance: ' + shortId(id), html);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

// ── Instance Actions ────────────────────────────────────────────────

export async function modifyInstance(id) {
  const cancelActivity = document.getElementById('mod-cancel').value.trim();
  const startActivity = document.getElementById('mod-start').value.trim();
  if (!cancelActivity && !startActivity) { toast('Enter at least one activity ID', 'error'); return; }
  const instructions = [];
  if (cancelActivity) instructions.push({ type: 'cancel', activityId: cancelActivity, cancelCurrentActiveActivityInstances: true });
  if (startActivity) instructions.push({ type: 'startBeforeActivity', activityId: startActivity });
  try {
    await api(`/process-instance/${id}/modification`, {
      method: 'POST',
      body: { skipCustomListeners: false, skipIoMappings: false, instructions, annotation: 'Modified via Camunda Dashboard' }
    });
    toast('Instance modified successfully!', 'success');
    closeDetail();
    setTimeout(loadInstances, 500);
  } catch (e) { toast('Modification failed: ' + e.message, 'error'); }
}

export async function toggleSuspend(id, currentlySuspended) {
  try {
    await api(`/process-instance/${id}/suspended`, { method: 'PUT', body: { suspended: !currentlySuspended } });
    toast(currentlySuspended ? 'Instance activated' : 'Instance suspended', 'success');
    setTimeout(loadInstances, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export async function deleteInstance(id) {
  if (!confirm('DELETE this process instance? This cannot be undone!')) return;
  try {
    await api(`/process-instance/${id}`, { method: 'DELETE' });
    toast('Instance deleted', 'success');
    closeDetail();
    setTimeout(loadInstances, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

// Register in panel loader registry
panelLoaders.instances = loadInstances;
