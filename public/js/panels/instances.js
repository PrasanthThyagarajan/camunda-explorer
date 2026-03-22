import { api } from '../api-client.js';
import { esc, shortId, fmtDate, copyBtn, buildTable, toast } from '../utils.js';
import { panelLoaders } from '../state.js';
import { openDetail, closeDetail } from '../detail-panel.js';

/* ── Populate BPMN Process <select> with active definitions ───── */

async function buildProcDefFilter() {
  const sel = document.getElementById('pi-filter-procdef');
  if (!sel) return;

  const currentValue = sel.value;

  try {
    const stats = await api('/process-definition/statistics?failedJobs=true&incidents=true');

    // Latest version per key with running instances
    const byKey = new Map();
    for (const s of stats) {
      const key = s.definition?.key || s.id?.split(':')[0];
      const ver = s.definition?.version ?? 0;
      const existing = byKey.get(key);
      if (!existing || ver > existing.ver) {
        byKey.set(key, {
          key,
          name: s.definition?.name || key,
          count: s.instances || 0,
          ver,
        });
      }
    }

    const sorted = [...byKey.values()]
      .filter(d => d.count > 0)
      .sort((a, b) => b.count - a.count);

    sel.innerHTML = '<option value="">All Processes</option>';
    sorted.forEach(d => {
      sel.innerHTML += `<option value="${d.key}">${d.name} (${d.count})</option>`;
    });

    if (currentValue && [...sel.options].some(o => o.value === currentValue)) {
      sel.value = currentValue;
    }
  } catch {
    sel.innerHTML = '<option value="">All Processes</option>';
  }
}

/* ── Init filters & event wiring ─────────────────────────────── */

export function initInstanceFilters() {
  const idsInput = document.getElementById('pi-filter-ids');
  if (idsInput) {
    idsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); loadInstances(); }
    });
  }

  const bkInput = document.getElementById('pi-filter-bk');
  if (bkInput) {
    bkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); loadInstances(); }
    });
  }
}

/* ── Load Instances ──────────────────────────────────────────── */

export async function loadInstances() {
  await buildProcDefFilter();

  try {
    const idsRaw = (document.getElementById('pi-filter-ids')?.value || '').trim();
    const defKey = (document.getElementById('pi-filter-procdef')?.value || '').trim();
    const bk     = (document.getElementById('pi-filter-bk')?.value || '').trim();
    const st     = (document.getElementById('pi-filter-state')?.value || '');

    const ids = idsRaw
      ? idsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    let data;

    if (ids.length > 0) {
      const body = { processInstanceIds: ids };
      if (defKey) body.processDefinitionKey = defKey;
      if (bk) body.businessKeyLike = '%' + bk + '%';
      if (st === 'active')       body.active = true;
      if (st === 'suspended')    body.suspended = true;
      if (st === 'withIncident') body.withIncident = true;
      data = await api('/process-instance', { method: 'POST', body });
    } else {
      const params = new URLSearchParams();
      if (defKey) params.set('processDefinitionKey', defKey);
      if (bk) params.set('businessKeyLike', '%' + bk + '%');
      if (st === 'active')       params.set('active', 'true');
      if (st === 'suspended')    params.set('suspended', 'true');
      if (st === 'withIncident') params.set('withIncident', 'true');
      params.set('maxResults', '100');
      data = await api('/process-instance?' + params);
    }

    let instancesWithJobs = new Set();
    try {
      const jobs = await api('/job?maxResults=500');
      for (const j of jobs) {
        if (j.processInstanceId) instancesWithJobs.add(j.processInstanceId);
      }
    } catch (_) { /* jobs lookup is best-effort */ }

    const cols = [
      { key: 'id', label: 'Instance ID', render: r => `<a href="#" onclick="showInstanceDetail('${r.id}');return false">${shortId(r.id)}</a>`, copyVal: r => r.id },
      { key: 'definitionId', label: 'Definition', render: r => shortId(r.definitionId), copyVal: r => r.definitionId },
      { key: 'businessKey', label: 'Business Key' },
      { key: 'suspended', label: 'State', render: r => r.suspended ? '<span class="tag tag-yellow">Suspended</span>' : '<span class="tag tag-green">Active</span>', noCopy: true },
    ];
    const actions = r => `
      <button class="btn btn-outline btn-sm" onclick="showInstanceDetail('${r.id}')">Details</button>
      ${instancesWithJobs.has(r.id) ? `<button class="btn btn-outline btn-sm" onclick="openJobsPopup('${r.id}')">🔄 Jobs</button>` : ''}
      <button class="btn btn-sm ${r.suspended ? 'btn-success' : 'btn-outline'}" onclick="toggleSuspend('${r.id}', ${r.suspended})">${r.suspended ? '▶ Activate' : '⏸ Suspend'}</button>
      <button class="btn btn-outline btn-sm" style="border-color:var(--primary);color:var(--primary)" onclick="openDiagnosis('${r.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7a7 7 0 0 0-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg> Diagnose</button>
    `;
    document.getElementById('instances-table').innerHTML = buildTable(cols, data, actions);
  } catch (e) { document.getElementById('instances-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

/* ── Parsed activity tree rendering ───────────────────────────── */


function flattenActivityTree(node, depth = 0) {
  const items = [];
  const children = node.childActivityInstances || [];
  const transitions = node.childTransitionInstances || [];

  // skip root, go to children
  if (node.activityType !== 'processDefinition') {
    items.push({
      id: node.id,
      activityId: node.activityId,
      activityName: node.activityName || node.activityId,
      activityType: node.activityType,
      depth,
      hasChildren: children.length > 0,
    });
  }

  for (const child of children) {
    items.push(...flattenActivityTree(child, node.activityType === 'processDefinition' ? depth : depth + 1));
  }
  for (const trans of transitions) {
    items.push({
      id: trans.id,
      activityId: trans.activityId,
      activityName: trans.activityName || trans.activityId,
      activityType: 'transition',
      depth: node.activityType === 'processDefinition' ? depth : depth + 1,
      hasChildren: false,
    });
  }

  return items;
}

function renderParsedActivityTree(activityTree, incidents) {
  const items = flattenActivityTree(activityTree);
  if (items.length === 0) return '<div class="empty">No active activities.</div>';

  const incidentMap = {};
  (incidents || []).forEach(inc => { incidentMap[inc.activityId] = inc.incidentMessage || inc.incidentType; });

  let html = '<div class="activity-tree">';
  items.forEach(item => {
    const indent = item.depth * 20;
    const hasIncident = incidentMap[item.activityId];
    const statusClass = hasIncident ? 'tree-status-incident' : 'tree-status-running';
    const rowClass = hasIncident ? 'tree-node tree-node-incident' : 'tree-node';

    html += `<div class="${rowClass}" style="padding-left:${indent + 12}px">
      <span class="tree-status ${statusClass}"></span>
      <span class="tree-name">${esc(item.activityName)}</span>
      <span class="tree-type">${esc(item.activityType)}</span>
      <span class="tree-id">${esc(item.activityId)}${copyBtn(item.activityId)}</span>
    </div>`;
    if (hasIncident) {
      html += `<div class="tree-error" style="padding-left:${indent + 36}px">${esc(incidentMap[item.activityId])}</div>`;
    }
  });
  html += '</div>';
  return html;
}

/* ── Instance detail ──────────────────────────────────────────── */

export async function showInstanceDetail(id) {
  try {
    const [inst, activities, vars, jobs] = await Promise.all([
      api(`/process-instance/${id}`),
      api(`/process-instance/${id}/activity-instances`).catch(() => null),
      api(`/process-instance/${id}/variables?deserializeValues=true`).catch(() => null),
      api(`/job?processInstanceId=${id}&maxResults=1`).catch(() => []),
    ]);
    const hasJobs = jobs && jobs.length > 0;

    let incidents = [];
    try { incidents = await api(`/incident?processInstanceId=${id}`); } catch { /* ok */ }

    let html = `<div class="detail-section"><h4>Instance</h4><div class="kv-grid">
      <span class="k">ID</span><span class="v">${inst.id}${copyBtn(inst.id)}</span>
      <span class="k">Definition</span><span class="v">${inst.definitionId}${copyBtn(inst.definitionId)}</span>
      <span class="k">Business Key</span><span class="v">${inst.businessKey || '—'}${copyBtn(inst.businessKey)}</span>
      <span class="k">Suspended</span><span class="v">${inst.suspended ? '<span class="tag tag-yellow">Yes</span>' : '<span class="tag tag-green">No</span>'}</span>
      <span class="k">Incidents</span><span class="v">${incidents.length > 0 ? '<span class="tag tag-red">' + incidents.length + '</span>' : '<span class="tag tag-green">0</span>'}</span>
    </div></div>`;

    if (activities) {
      html += `<div class="detail-section"><h4>Execution State</h4>`;
      html += renderParsedActivityTree(activities, incidents);
      html += `</div>`;
    }

    if (vars && Object.keys(vars).length > 0) {
      html += `<div class="detail-section"><h4>Variables (${Object.keys(vars).length})</h4>`;
      html += '<div class="var-table"><table><thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead><tbody>';
      for (const [name, def] of Object.entries(vars)) {
        const val = def.value !== undefined ? JSON.stringify(def.value) : '—';
        const displayVal = val.length > 80 ? val.substring(0, 77) + '…' : val;
        html += `<tr>
          <td><strong>${esc(name)}</strong>${copyBtn(name)}</td>
          <td><span class="tag">${esc(def.type || '—')}</span></td>
          <td>${esc(displayVal)}${copyBtn(val)}</td>
        </tr>`;
      }
      html += '</tbody></table></div></div>';
    } else if (vars) {
      html += `<div class="detail-section"><h4>Variables</h4><div class="empty">No variables.</div></div>`;
    }

    html += `<div class="detail-section"><h4>Process Control</h4>
      <div class="btn-group" style="margin-top:8px">
        <button class="btn btn-primary" onclick="modifyInstanceFromPanel('${inst.id}')">⇄ Modify Instance</button>
        ${hasJobs ? `<button class="btn btn-outline" onclick="openJobsPopup('${inst.id}')">🔄 Jobs</button>` : ''}
        <button class="btn btn-outline" style="border-color:var(--primary);color:var(--primary)" onclick="closeDetail();openDiagnosis('${inst.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7a7 7 0 0 0-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg> Diagnose</button>
        <button class="btn btn-sm ${inst.suspended ? 'btn-success' : 'btn-outline'}" onclick="toggleSuspend('${inst.id}', ${inst.suspended})">${inst.suspended ? '▶ Activate' : '⏸ Suspend'}</button>
        <button class="btn btn-danger" onclick="deleteInstance('${inst.id}')">🗑 Delete</button>
      </div>
    </div>`;

    if (activities) {
      html += `<div class="detail-section"><details>
        <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text3)">▶ Raw Activity Instance Tree (JSON)</summary>
        <pre class="json" style="margin-top:8px">${esc(JSON.stringify(activities, null, 2))}</pre>
      </details></div>`;
    }

    openDetail('Instance: ' + shortId(id), html);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

/* ── Manual Modify (fallback) ─────────────────────────────────── */

export async function modifyInstance(id) {
  const cancelActivity = document.getElementById('mod-cancel')?.value?.trim();
  const startActivity = document.getElementById('mod-start')?.value?.trim();
  if (!cancelActivity && !startActivity) { toast('Enter at least one activity ID', 'error'); return; }
  const instructions = [];
  if (cancelActivity) instructions.push({ type: 'cancel', activityId: cancelActivity, cancelCurrentActiveActivityInstances: true });
  if (startActivity) instructions.push({ type: 'startBeforeActivity', activityId: startActivity });
  try {
    await api(`/process-instance/${id}/modification`, {
      method: 'POST',
      body: { skipCustomListeners: false, skipIoMappings: false, instructions, annotation: 'Modified via Camunda Explorer' }
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

panelLoaders.instances = loadInstances;
