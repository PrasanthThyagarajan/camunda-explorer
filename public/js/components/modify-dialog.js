import { api, rawApi } from '../api-client.js';
import { esc, shortId, toast } from '../utils.js';
import { state } from '../state.js';
import { refreshCurrentPanel } from '../navigation.js';
import { showProgress, updateProgress, finishProgress } from '../progress.js';

/* ── Dialog open / close ──────────────────────────────────────── */

const DEFAULT_DIALOG_STATE = {
  mode: 'single',
  incidentIds: [],
  instanceIds: [],
  processInstanceId: null,
  processDefinitionId: null,
  stuckActivityId: null,
  activeTokens: [],
  selectedSourceIds: [],
  selectedTargetId: null,
  instructionType: 'startBeforeActivity',
  activities: [],
  skipCustomListeners: false,
  skipIoMappings: false,
  annotation: '',
};

export function openModifyDialog() {
  document.getElementById('modify-dialog-overlay').classList.add('visible');
}

export function closeModifyDialog() {
  document.getElementById('modify-dialog-overlay').classList.remove('visible');
  // deep-reset to avoid shared references
  state.modifyDialog = {
    ...DEFAULT_DIALOG_STATE,
    incidentIds: [],
    instanceIds: [],
    activeTokens: [],
    selectedSourceIds: [],
    activities: [],
  };
}

/* ── Target selection ─────────────────────────────────────────── */

export function selectModifyTarget(actId) {
  state.modifyDialog.selectedTargetId = actId;
  document.querySelectorAll('#modify-dialog-body .act-card').forEach(el => {
    const match = el.dataset.actId === actId;
    el.classList.toggle('act-card-selected', match);
    const radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = match;
  });
  document.getElementById('modify-dialog-confirm').disabled = false;
  updateAnnotationPreview();
}

/* ── Source selection (instance mode — checkboxes) ────────────── */

export function toggleSourceToken(actId) {
  const ids = state.modifyDialog.selectedSourceIds;
  const idx = ids.indexOf(actId);
  if (idx >= 0) ids.splice(idx, 1); else ids.push(actId);

  document.querySelectorAll('#modify-source-list .source-card').forEach(el => {
    const isChecked = ids.includes(el.dataset.actId);
    el.classList.toggle('source-card-checked', isChecked);
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = isChecked;
  });
  updateAnnotationPreview();
}

/* ── Options toggles ──────────────────────────────────────────── */

export function toggleSkipListeners() {
  state.modifyDialog.skipCustomListeners = !state.modifyDialog.skipCustomListeners;
}

export function toggleSkipIoMappings() {
  state.modifyDialog.skipIoMappings = !state.modifyDialog.skipIoMappings;
}

export function setInstructionType(type) {
  if (type !== 'startBeforeActivity' && type !== 'startAfterActivity') return;
  state.modifyDialog.instructionType = type;
  updateAnnotationPreview();
}

export function updateAnnotationValue(value) {
  state.modifyDialog.annotation = value;
}

function updateAnnotationPreview() {
  const el = document.getElementById('modify-annotation');
  if (!el) return;
  const { selectedSourceIds, selectedTargetId, instructionType } = state.modifyDialog;
  const action = instructionType === 'startAfterActivity' ? 'skip past' : 'move to';
  const sources = selectedSourceIds.length > 0 ? selectedSourceIds.join(', ') : '…';
  el.value = `Modified via Camunda Explorer: ${sources} → ${action} ${selectedTargetId || '…'}`;
  state.modifyDialog.annotation = el.value;
}

/* ── Activity list rendering ──────────────────────────────────── */

const STATUS_ICONS = {
  completed: '✓',
  active: '●',
  failed: '✕',
  not_reached: '○',
};

const STATUS_LABELS = {
  completed: 'Completed',
  active: 'Running',
  failed: 'Failed',
  not_reached: '',
};

const TYPE_LABELS = {
  serviceTask: 'Service Task',
  callActivity: 'Call Activity',
  userTask: 'User Task',
  sendTask: 'Send Task',
  receiveTask: 'Receive Task',
  scriptTask: 'Script Task',
  businessRuleTask: 'Business Rule',
  exclusiveGateway: 'Gateway',
  parallelGateway: 'Parallel Gateway',
  inclusiveGateway: 'Inclusive Gateway',
  eventBasedGateway: 'Event Gateway',
  subProcess: 'Sub-Process',
  startEvent: 'Start Event',
  endEvent: 'End Event',
  intermediateCatchEvent: 'Catch Event',
  intermediateThrowEvent: 'Throw Event',
  boundaryEvent: 'Boundary Event',
};

function renderActivityList(activities, stuckActivityId) {
  if (!activities || activities.length === 0) {
    return '<div class="modify-loading">No activities found in the BPMN definition.</div>';
  }

  let html = `<div class="target-header">
    <label>Choose target activity:</label>
    <span class="target-count">${activities.length} activities</span>
  </div>`;
  html += '<div class="activity-list">';

  activities.forEach((act) => {
    const isStuck = (act.id === stuckActivityId);
    const isSelected = isStuck || act.isFirst;
    const statusClass = act.status || 'not_reached';
    const statusIcon = STATUS_ICONS[statusClass] || '○';
    const statusLabel = STATUS_LABELS[statusClass] || '';
    const typeLabel = TYPE_LABELS[act.type] || act.type;

    html += `<div class="act-card ${isSelected ? 'act-card-selected' : ''} ${isStuck ? 'act-card-stuck' : ''} act-card-${statusClass}"
      data-act-id="${esc(act.id)}" onclick="selectModifyTarget('${esc(act.id)}')">
      <div class="act-card-radio">
        <input type="radio" name="modify-target" id="target-${esc(act.id)}" value="${esc(act.id)}" ${isSelected ? 'checked' : ''} />
      </div>
      <div class="act-card-status act-card-status-${statusClass}">${statusIcon}</div>
      <div class="act-card-body">
        <div class="act-card-title">${esc(act.name || act.id)}</div>
        <div class="act-card-meta">
          <span class="act-card-type">${esc(typeLabel)}</span>
          ${statusLabel ? `<span class="act-card-state act-card-state-${statusClass}">${statusLabel}</span>` : ''}
          ${act.isFirst ? '<span class="act-card-badge act-card-badge-first">★ First</span>' : ''}
          ${isStuck ? '<span class="act-card-badge act-card-badge-stuck">Current</span>' : ''}
        </div>
      </div>
    </div>`;

    if (isSelected && !state.modifyDialog.selectedTargetId) {
      state.modifyDialog.selectedTargetId = act.id;
    }
  });

  html += '</div>';
  html += '<div class="target-hint">Click any activity to select it as the target. The process token will be moved there.</div>';
  return html;
}

/* ── Source token list (instance mode) ────────────────────────── */

function renderSourceTokens(activeTokens) {
  if (!activeTokens || activeTokens.length === 0) return '';

  const typeLabel = (t) => TYPE_LABELS[t] || t;

  if (activeTokens.length === 1) {
    state.modifyDialog.selectedSourceIds = [activeTokens[0].activityId];
    return `<div class="source-section">
      <div class="source-section-header">
        <label>Cancel execution at:</label>
      </div>
      <div class="source-card source-card-single">
        <div class="source-card-icon">${activeTokens[0].hasIncident ? '<span class="source-icon-fail">✕</span>' : '<span class="source-icon-run">●</span>'}</div>
        <div class="source-card-body">
          <div class="source-card-name">${esc(activeTokens[0].activityName)}</div>
          <span class="source-card-type">${esc(typeLabel(activeTokens[0].activityType))}</span>
          ${activeTokens[0].hasIncident ? '<span class="source-card-badge-fail">Has Incident</span>' : '<span class="source-card-badge-run">Running</span>'}
        </div>
      </div>
    </div>`;
  }

  let html = `<div class="source-section">
    <div class="source-section-header">
      <label>Cancel execution at:</label>
      <span class="source-section-hint">Select which tokens to cancel</span>
    </div>
    <div id="modify-source-list" class="source-list">`;

  activeTokens.forEach(token => {
    const preCheck = token.hasIncident;
    if (preCheck && !state.modifyDialog.selectedSourceIds.includes(token.activityId)) {
      state.modifyDialog.selectedSourceIds.push(token.activityId);
    }
    html += `<div class="source-card ${preCheck ? 'source-card-checked' : ''}" data-act-id="${esc(token.activityId)}" onclick="toggleSourceToken('${esc(token.activityId)}')">
      <div class="source-card-check">
        <input type="checkbox" ${preCheck ? 'checked' : ''} />
      </div>
      <div class="source-card-icon">${token.hasIncident ? '<span class="source-icon-fail">✕</span>' : '<span class="source-icon-run">●</span>'}</div>
      <div class="source-card-body">
        <div class="source-card-name">${esc(token.activityName)}</div>
        <span class="source-card-type">${esc(typeLabel(token.activityType))}</span>
        ${token.hasIncident ? '<span class="source-card-badge-fail">Has Incident</span>' : '<span class="source-card-badge-run">Running</span>'}
      </div>
    </div>`;
  });

  html += '</div></div>';
  return html;
}

/* ── Options section ──────────────────────────────────────────── */

function renderOptionsSection() {
  return `<div class="modify-options-section">
    <details>
      <summary class="modify-opts-sublabel" style="cursor:pointer;font-weight:600;text-transform:uppercase;letter-spacing:.4px">
        ▶ Advanced Options
      </summary>
      <div style="padding:8px 0">
        <div class="modify-opts-row">
          <label class="modify-opts-label">
            <input type="checkbox" onchange="toggleSkipListeners()" /> Skip custom listeners
          </label>
          <label class="modify-opts-label">
            <input type="checkbox" onchange="toggleSkipIoMappings()" /> Skip I/O mappings
          </label>
        </div>
        <div style="margin-bottom:10px">
          <span class="modify-opts-sublabel">Instruction type:</span>
          <label class="modify-opts-label" style="margin-bottom:4px">
            <input type="radio" name="mod-instr-type" value="startBeforeActivity" checked onchange="setInstructionType('startBeforeActivity')" /> Execute from this activity
          </label>
          <label class="modify-opts-label">
            <input type="radio" name="mod-instr-type" value="startAfterActivity" onchange="setInstructionType('startAfterActivity')" /> Skip past this activity
          </label>
        </div>
        <div>
          <span class="modify-opts-sublabel">Annotation:</span>
          <input type="text" id="modify-annotation" class="modify-annotation-input"
            value="Modified via Camunda Explorer" oninput="updateAnnotationValue(this.value)" />
        </div>
      </div>
    </details>
  </div>`;
}

/* ── Incident Mode ─────────────────────────────────────────────── */

export async function modifyIncidentToStart(incidentId) {
  state.modifyDialog = {
    ...DEFAULT_DIALOG_STATE,
    mode: 'single', incidentIds: [incidentId],
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
  const { getSelectedIncidentIds } = await import('../panels/incidents.js');
  const ids = getSelectedIncidentIds();
  if (ids.length === 0) { toast('Select incidents first', 'error'); return; }

  state.modifyDialog = {
    ...DEFAULT_DIALOG_STATE,
    mode: 'batch', incidentIds: ids,
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

/* ── Instance Mode ─────────────────────────────────────────────── */

export async function modifyInstanceFromPanel(instanceId) {
  state.modifyDialog = {
    ...DEFAULT_DIALOG_STATE,
    mode: 'instance',
    instanceIds: [instanceId],
    processInstanceId: instanceId,
  };

  document.getElementById('modify-dialog-title').textContent = '⇄ Modify Process Instance';
  document.getElementById('modify-dialog-subtitle').textContent = 'Loading instance context…';
  document.getElementById('modify-dialog-info').innerHTML = '';
  document.getElementById('modify-dialog-body').innerHTML = '<div class="modify-loading">Loading BPMN activities and execution state…</div>';
  document.getElementById('modify-dialog-confirm').disabled = true;
  openModifyDialog();

  try {
    const ctx = await rawApi(`/actions/instance-context/${instanceId}`);
    state.modifyDialog.processDefinitionId = ctx.instance.definitionId;
    state.modifyDialog.activeTokens = ctx.activeTokens;
    state.modifyDialog.activities = ctx.activities;

    const stuckToken = ctx.activeTokens.find(t => t.hasIncident) || ctx.activeTokens[0];
    state.modifyDialog.stuckActivityId = stuckToken?.activityId || null;

    document.getElementById('modify-dialog-subtitle').textContent = 'Select source token(s) to cancel and target activity to move to';

    const incidentBadge = ctx.incidents.length > 0
      ? `<span class="tag tag-red">${ctx.incidents.length}</span>`
      : '<span class="tag tag-green">0</span>';

    document.getElementById('modify-dialog-info').innerHTML = `
      <span class="k">Instance ID</span><span class="v">${shortId(ctx.instance.id)}</span>
      <span class="k">Definition</span><span class="v">${shortId(ctx.instance.definitionId)}</span>
      <span class="k">Business Key</span><span class="v">${esc(ctx.instance.businessKey || '—')}</span>
      <span class="k">Active Tokens</span><span class="v">${ctx.activeTokens.length}</span>
      <span class="k">Incidents</span><span class="v">${incidentBadge}</span>
      <span class="k">Variables</span><span class="v">${ctx.variableCount}</span>
    `;

    let bodyHtml = '';

    if (ctx.hasSubProcesses) {
      bodyHtml += `<div class="modify-warning">⚠ This instance has sub-process scopes. Modifying across sub-process boundaries may affect variable scope.</div>`;
    }

    bodyHtml += renderSourceTokens(ctx.activeTokens);

    bodyHtml += renderActivityList(ctx.activities, stuckToken?.activityId);

    bodyHtml += renderOptionsSection();

    document.getElementById('modify-dialog-body').innerHTML = bodyHtml;
    document.getElementById('modify-dialog-confirm').disabled = !state.modifyDialog.selectedTargetId;
  } catch (e) {
    document.getElementById('modify-dialog-body').innerHTML = `<div class="error-box">Failed to load: ${esc(e.message)}</div>`;
  }
}

/* ── Confirm ──────────────────────────────────────────────────── */

export async function confirmModify() {
  const { mode, incidentIds, selectedTargetId } = state.modifyDialog;

  // ── Incident modes ──
  if (mode === 'single' || mode === 'batch') {
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
    return;
  }

  // ── Instance mode ──
  if (mode === 'instance') {
    const {
      processInstanceId,
      selectedSourceIds,
      instructionType,
      skipCustomListeners,
      skipIoMappings,
      annotation,
    } = state.modifyDialog;

    if (!selectedTargetId || !processInstanceId) return;
    if (selectedSourceIds.length === 0) {
      toast('Select at least one source token to cancel', 'error');
      return;
    }

    closeModifyDialog();

    try {
      const result = await rawApi('/actions/instance-modify', {
        method: 'POST',
        body: {
          instanceId: processInstanceId,
          cancelActivityIds: selectedSourceIds,
          targetActivityId: selectedTargetId,
          instructionType,
          skipCustomListeners,
          skipIoMappings,
          annotation: annotation || undefined,
        },
      });

      if (result.status === 'success') {
        let msg = `✅ ${result.message}`;
        if (result.incidentsCleaned > 0) {
          msg += ` (${result.incidentsCleaned} incident(s) resolved)`;
        }
        toast(msg, 'success');
      } else {
        toast(`❌ ${result.message}`, 'error');
      }
      setTimeout(refreshCurrentPanel, 1000);
    } catch (e) {
      toast('Modification failed: ' + e.message, 'error');
    }
    return;
  }

  // ── Batch instance mode ──
  if (mode === 'batch-instance') {
    const { instanceIds } = state.modifyDialog;
    if (!selectedTargetId || instanceIds.length === 0) return;
    closeModifyDialog();

    const batchSize = parseInt(document.getElementById('batch-size')?.value) || 10;
    showProgress(`Modifying ${instanceIds.length} instances (batch size: ${batchSize})`);
    updateProgress(0, instanceIds.length, 'Processing…');

    try {
      const result = await rawApi('/actions/batch-instance-modify', {
        method: 'POST',
        body: {
          instanceIds,
          targetActivityId: selectedTargetId,
          batchSize,
          instructionType: state.modifyDialog.instructionType,
          skipCustomListeners: state.modifyDialog.skipCustomListeners,
          skipIoMappings: state.modifyDialog.skipIoMappings,
          annotation: state.modifyDialog.annotation || undefined,
        },
      });
      finishProgress({
        succeeded: result.succeeded,
        failed: result.failed,
        results: result.results.map(r => ({
          incidentId: r.instanceId,
          status: r.status,
          message: r.message,
        })),
      });
    } catch (e) {
      finishProgress({
        succeeded: 0,
        failed: instanceIds.length,
        results: [{ incidentId: '—', status: 'error', message: e.message }],
      });
    }
  }
}
