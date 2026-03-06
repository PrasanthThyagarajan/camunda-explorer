import { api, rawApi } from '../api-client.js';
import { esc, shortId, toast } from '../utils.js';
import { state } from '../state.js';
import { refreshCurrentPanel } from '../navigation.js';
import { showProgress, updateProgress, finishProgress } from '../progress.js';

export function openModifyDialog() {
  document.getElementById('modify-dialog-overlay').classList.add('visible');
}

export function closeModifyDialog() {
  document.getElementById('modify-dialog-overlay').classList.remove('visible');
  state.modifyDialog = {
    mode: 'single', incidentIds: [], processDefinitionId: null,
    stuckActivityId: null, selectedTargetId: null, activities: [],
  };
}

export function selectModifyTarget(actId) {
  state.modifyDialog.selectedTargetId = actId;
  document.querySelectorAll('#modify-dialog-body .activity-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.actId === actId);
    const radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = (el.dataset.actId === actId);
  });
  document.getElementById('modify-dialog-confirm').disabled = false;
}

function renderActivityList(activities, stuckActivityId) {
  if (!activities || activities.length === 0) {
    return '<div class="modify-loading">No activities found in the BPMN.</div>';
  }
  let html = '<label>Choose target activity:</label><div class="activity-list">';
  activities.forEach((act, idx) => {
    const isSelected = act.isFirst;
    const isStuck = (act.id === stuckActivityId);
    html += `<div class="activity-item ${isSelected ? 'selected' : ''}" data-act-id="${esc(act.id)}" onclick="selectModifyTarget('${esc(act.id)}')">
      <input type="radio" name="modify-target" value="${esc(act.id)}" ${isSelected ? 'checked' : ''} />
      <span style="font-size:11px;color:var(--text3);min-width:22px;text-align:center">${idx + 1}</span>
      <span class="act-name">${esc(act.name)}</span>
      <span class="act-type">${esc(act.type)}</span>
      ${act.isFirst ? '<span class="act-first">★ FIRST</span>' : ''}
      ${isStuck ? '<span class="act-stuck">⚠ STUCK</span>' : ''}
    </div>`;
    if (isSelected) state.modifyDialog.selectedTargetId = act.id;
  });
  html += '</div>';
  html += '<div class="target-hint">Activities are listed in BPMN flow order. The first activity after start is pre-selected (★). The stuck activity is marked (⚠).</div>';
  return html;
}

export async function modifyIncidentToStart(incidentId) {
  state.modifyDialog = {
    mode: 'single', incidentIds: [incidentId], processDefinitionId: null,
    stuckActivityId: null, selectedTargetId: null, activities: [],
  };

  document.getElementById('modify-dialog-title').textContent = '⇄ Modify Incident';
  document.getElementById('modify-dialog-subtitle').textContent = 'Loading incident details…';
  document.getElementById('modify-dialog-info').innerHTML = '';
  document.getElementById('modify-dialog-body').innerHTML = '<div class="modify-loading">Loading BPMN activities…</div>';
  document.getElementById('modify-dialog-confirm').disabled = true;
  openModifyDialog();

  try {
    const inc = await api(`/incident/${incidentId}`);
    state.modifyDialog.processDefinitionId = inc.processDefinitionId;
    state.modifyDialog.stuckActivityId = inc.activityId;

    document.getElementById('modify-dialog-subtitle').textContent = 'Select which activity to move this process instance to';
    document.getElementById('modify-dialog-info').innerHTML = `
      <span class="k">Incident ID</span><span class="v">${shortId(inc.id)}</span>
      <span class="k">Process Instance</span><span class="v">${shortId(inc.processInstanceId)}</span>
      <span class="k">Stuck At</span><span class="v"><span class="tag tag-yellow">${esc(inc.activityId || '—')}</span></span>
      <span class="k">Process Def</span><span class="v">${shortId(inc.processDefinitionId)}</span>
    `;

    const bpmnData = await rawApi(`/actions/bpmn-activities/${inc.processDefinitionId}`);
    state.modifyDialog.activities = bpmnData.activities;

    document.getElementById('modify-dialog-body').innerHTML = renderActivityList(bpmnData.activities, inc.activityId);
    document.getElementById('modify-dialog-confirm').disabled = !state.modifyDialog.selectedTargetId;
  } catch (e) {
    document.getElementById('modify-dialog-body').innerHTML = `<div class="error-box">Failed to load: ${esc(e.message)}</div>`;
  }
}

export async function batchModifyToStart() {
  // Dynamic import to avoid circular dependency
  const { getSelectedIncidentIds } = await import('../panels/incidents.js');
  const ids = getSelectedIncidentIds();
  if (ids.length === 0) { toast('Select incidents first', 'error'); return; }

  state.modifyDialog = {
    mode: 'batch', incidentIds: ids, processDefinitionId: null,
    stuckActivityId: null, selectedTargetId: null, activities: [],
  };

  document.getElementById('modify-dialog-title').textContent = `⇄ Batch Modify (${ids.length} incidents)`;
  document.getElementById('modify-dialog-subtitle').textContent = 'Loading process info from first selected incident…';
  document.getElementById('modify-dialog-info').innerHTML = '';
  document.getElementById('modify-dialog-body').innerHTML = '<div class="modify-loading">Loading BPMN activities…</div>';
  document.getElementById('modify-dialog-confirm').disabled = true;
  openModifyDialog();

  try {
    const firstInc = await api(`/incident/${ids[0]}`);
    state.modifyDialog.processDefinitionId = firstInc.processDefinitionId;
    state.modifyDialog.stuckActivityId = firstInc.activityId;

    document.getElementById('modify-dialog-subtitle').textContent = `Select target activity for ${ids.length} incident(s)`;
    document.getElementById('modify-dialog-info').innerHTML = `
      <span class="k">Selected</span><span class="v">${ids.length} incident(s)</span>
      <span class="k">Sample Stuck At</span><span class="v"><span class="tag tag-yellow">${esc(firstInc.activityId || '—')}</span></span>
      <span class="k">Process Def</span><span class="v">${shortId(firstInc.processDefinitionId)}</span>
      <span class="k">Batch Size</span><span class="v">${document.getElementById('batch-size')?.value || 10}</span>
    `;

    const bpmnData = await rawApi(`/actions/bpmn-activities/${firstInc.processDefinitionId}`);
    state.modifyDialog.activities = bpmnData.activities;

    document.getElementById('modify-dialog-body').innerHTML = renderActivityList(bpmnData.activities, firstInc.activityId);
    document.getElementById('modify-dialog-confirm').disabled = !state.modifyDialog.selectedTargetId;
  } catch (e) {
    document.getElementById('modify-dialog-body').innerHTML = `<div class="error-box">Failed to load: ${esc(e.message)}</div>`;
  }
}

export async function confirmModify() {
  const { mode, incidentIds, selectedTargetId } = state.modifyDialog;
  if (!selectedTargetId || incidentIds.length === 0) return;

  closeModifyDialog();

  if (mode === 'single') {
    try {
      const result = await rawApi('/actions/batch-modify-to-start', {
        method: 'POST',
        body: { incidentIds, batchSize: 1, targetActivityId: selectedTargetId }
      });
      if (result.succeeded > 0) {
        toast(`✅ ${result.results[0].message}`, 'success');
      } else {
        toast(`❌ ${result.results[0].message}`, 'error');
      }
      setTimeout(refreshCurrentPanel, 1000);
    } catch (e) { toast('Modify failed: ' + e.message, 'error'); }
  } else {
    const batchSize = parseInt(document.getElementById('batch-size')?.value) || 10;
    showProgress(`Processing ${incidentIds.length} incidents (batch size: ${batchSize})`);
    updateProgress(0, incidentIds.length, 'Processing…');
    try {
      const result = await rawApi('/actions/batch-modify-to-start', {
        method: 'POST',
        body: { incidentIds, batchSize, targetActivityId: selectedTargetId }
      });
      finishProgress(result);
    } catch (e) {
      finishProgress({ succeeded: 0, failed: incidentIds.length, results: [{ incidentId: '—', status: 'error', message: e.message }] });
    }
  }
}
