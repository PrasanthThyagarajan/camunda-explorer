import { api, rawApi } from '../api-client.js';
import { esc, shortId, toast } from '../utils.js';
import { state } from '../state.js';
import { refreshCurrentPanel } from '../navigation.js';
import { showProgress, updateProgress, finishProgress } from '../progress.js';
import { BATCH_PRESETS, renderBatchSizeField, syncBatchSizeHint } from './batch-size-field.js';

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
  startEventId: null,
  firstActivityId: null,
  batchSize: null,
};

const MODIFY_BATCH_FIELD_ID = 'modify-batch-size';

/**
 * A long-running dashboard server keeps serving its old build while the browser
 * picks up new static files on reload. Fail with something actionable rather
 * than an opaque "undefined is not a function" further down.
 */
export function assertBatchModifyShape(result) {
  const required = ['alreadyProcessed', 'notFound', 'batches', 'failedGroups'];
  if (!result || required.some(key => !Array.isArray(result[key]))) {
    throw new Error(
      'Unexpected response shape from the dashboard server. It is probably running an older build — restart it and retry.'
    );
  }
}

/** Flattens the server's two skip buckets into progress rows. */
export function toSkippedResults(result) {
  return [
    ...result.alreadyProcessed.map(item => ({
      incidentId: item.instanceId, status: 'skipped', message: item.reason,
    })),
    ...result.notFound.map(instanceId => ({
      incidentId: instanceId, status: 'skipped', message: 'Skipped — unknown to the engine',
    })),
  ];
}
const BATCH_MODES = new Set(['batch', 'batch-instance']);

/** Preset and work total for the batch-size field, per dialog mode. */
function batchContext() {
  const { mode, instanceIds, incidentIds } = state.modifyDialog;
  return mode === 'batch-instance'
    ? { preset: 'instance', total: instanceIds.length }
    : { preset: 'incident', total: incidentIds.length };
}

/** Single-item modes carry no batch size, so they must not be gated on one. */
function batchSizeAccepted() {
  const { mode, batchSize } = state.modifyDialog;
  return !BATCH_MODES.has(mode) || batchSize !== null;
}
let batchSubmissionUncertain = false;

export function openModifyDialog() {
  document.getElementById('modify-dialog-overlay').classList.add('visible');
}

export function closeModifyDialog() {
  document.getElementById('modify-dialog-overlay').classList.remove('visible');
  // deep-reset: spread creates a shallow copy, but arrays inside would share
  // references with DEFAULT_DIALOG_STATE — causing mutation bugs on next open
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
  if (state.modifyDialog.mode === 'batch-instance' && actId === state.modifyDialog.startEventId) {
    toast(`A start event is not a safe wait state. Select ${state.modifyDialog.firstActivityId || 'the first activity'} instead.`, 'error');
    return;
  }
  state.modifyDialog.selectedTargetId = actId;
  document.querySelectorAll('#modify-dialog-body .act-card').forEach(el => {
    const match = el.dataset.actId === actId;
    el.classList.toggle('act-card-selected', match);
    const radio = el.querySelector('input[type="radio"]');
    if (radio) radio.checked = match;
  });
  document.getElementById('modify-dialog-confirm').disabled = !batchSizeAccepted();
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

export function setModifyBatchSize() {
  const { preset, total } = batchContext();
  state.modifyDialog.batchSize = syncBatchSizeHint(MODIFY_BATCH_FIELD_ID, preset, total);
  document.getElementById('modify-dialog-confirm').disabled =
    !batchSizeAccepted() || !state.modifyDialog.selectedTargetId;
}

/** Markup for the batch-size field in whichever batch mode is open. */
function modifyBatchSizeField() {
  const { preset, total } = batchContext();
  return renderBatchSizeField({
    id: MODIFY_BATCH_FIELD_ID,
    preset,
    total,
    value: state.modifyDialog.batchSize,
    onInput: 'setModifyBatchSize()',
  });
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

  // multiple tokens — checkboxes
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

/* ══════════════════════════════════════════════════════════════════
   INCIDENT MODE — existing functionality (unchanged behavior)
   ══════════════════════════════════════════════════════════════════ */

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
    batchSize: BATCH_PRESETS.incident.default,
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
    `;

    const bpmnData = await rawApi(`/actions/bpmn-activities/${firstInc.processDefinitionId}`);
    state.modifyDialog.activities = bpmnData.activities;

    document.getElementById('modify-dialog-body').innerHTML =
      renderActivityList(bpmnData.activities, firstInc.activityId) + modifyBatchSizeField();
    document.getElementById('modify-dialog-confirm').disabled = !state.modifyDialog.selectedTargetId;
  } catch (e) {
    document.getElementById('modify-dialog-body').innerHTML = `<div class="error-box">Failed to load: ${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════════════
   INSTANCE MODE — new process-level modify
   ══════════════════════════════════════════════════════════════════ */

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

    // find stuck activity (first token with incident, or first active token)
    const stuckToken = ctx.activeTokens.find(t => t.hasIncident) || ctx.activeTokens[0];
    state.modifyDialog.stuckActivityId = stuckToken?.activityId || null;

    document.getElementById('modify-dialog-subtitle').textContent = 'Select source token(s) to cancel and target activity to move to';

    // build info grid
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

    // render the dialog body: source selector + enriched activity list + options
    let bodyHtml = '';

    // sub-process warning
    if (ctx.hasSubProcesses) {
      bodyHtml += `<div class="modify-warning">⚠ This instance has sub-process scopes. Modifying across sub-process boundaries may affect variable scope.</div>`;
    }

    // source token selector
    bodyHtml += renderSourceTokens(ctx.activeTokens);

    // enriched target activity list (with status markers)
    bodyHtml += renderActivityList(ctx.activities, stuckToken?.activityId);

    // advanced options
    bodyHtml += renderOptionsSection();

    document.getElementById('modify-dialog-body').innerHTML = bodyHtml;
    document.getElementById('modify-dialog-confirm').disabled = !state.modifyDialog.selectedTargetId;
  } catch (e) {
    document.getElementById('modify-dialog-body').innerHTML = `<div class="error-box">Failed to load: ${esc(e.message)}</div>`;
  }
}

export async function modifyFilteredInstances() {
  if (batchSubmissionUncertain) {
    toast('A previous batch submission has an unknown outcome. Check Camunda batches before retrying.', 'error');
    return;
  }
  const { getLastInstanceSearch } = await import('../panels/instances.js');
  const search = getLastInstanceSearch();
  if (!search?.scoped || !search.processDefinitionKey) {
    toast('Select a BPMN process and run a scoped search first', 'error');
    return;
  }
  if (search.truncated) {
    toast('Narrow the search before modifying; the matched set is truncated', 'error');
    return;
  }
  if (!search.matchedIds?.length) {
    toast('No matched process instances to modify', 'error');
    return;
  }
  if (search.definitionIdCount !== 1) {
    toast('Narrow the search to one process definition version before modifying', 'error');
    return;
  }

  state.modifyDialog = {
    ...DEFAULT_DIALOG_STATE,
    mode: 'batch-instance',
    instanceIds: [...search.matchedIds],
    batchSize: BATCH_PRESETS.instance.default,
  };
  document.getElementById('modify-dialog-title').textContent =
    `⇄ Modify Filtered (${search.matchedIds.length} instances)`;
  document.getElementById('modify-dialog-subtitle').textContent =
    'Select one target activity. Camunda will submit one asynchronous batch per definition version.';
  document.getElementById('modify-dialog-info').innerHTML = `
    <span class="k">Matched</span><span class="v">${search.matchedIds.length} instance(s)</span>
    <span class="k">Definitions</span><span class="v">${search.definitionIdCount}</span>
    <span class="k">Current Nodes</span><span class="v">${search.byActivity?.length || 'Computed at submit'}</span>
  `;
  document.getElementById('modify-dialog-body').innerHTML =
    '<div class="modify-loading">Loading BPMN activities…</div>';
  document.getElementById('modify-dialog-confirm').disabled = true;
  openModifyDialog();

  try {
    const bpmn = await rawApi(`/actions/bpmn-activities/${encodeURIComponent(search.processDefinitionId)}`);
    state.modifyDialog.activities = bpmn.activities;
    state.modifyDialog.processDefinitionId = bpmn.processDefinitionId;
    state.modifyDialog.startEventId = bpmn.startEventId;
    state.modifyDialog.firstActivityId = bpmn.firstActivityId;
    const warning = `<div class="modify-warning">This operation cancels active tokens at all BPMN nodes before starting the target. Cancelling a call activity also cancels its in-flight child process instances.</div>`;
    document.getElementById('modify-dialog-body').innerHTML =
      warning + renderActivityList(bpmn.activities, null)
      + modifyBatchSizeField() + renderOptionsSection();
    document.getElementById('modify-dialog-confirm').disabled = !state.modifyDialog.selectedTargetId;
  } catch (e) {
    document.getElementById('modify-dialog-body').innerHTML =
      `<div class="error-box">Failed to load: ${esc(e.message)}</div>`;
  }
}

async function pollModificationBatches(batches) {
  const deadline = Date.now() + 5 * 60 * 1000;
  const completed = new Set();
  const failedByBatch = new Map();
  while (completed.size < batches.length && Date.now() < deadline) {
    await Promise.all(batches.map(async (batch) => {
      if (completed.has(batch.batchId)) return;
      const status = await rawApi(`/actions/batch-status/${encodeURIComponent(batch.batchId)}`);
      failedByBatch.set(batch.batchId, status.failedJobs || 0);
      if (status.status === 'completed' || status.status === 'failed') {
        completed.add(batch.batchId);
      }
    }));
    updateProgress(completed.size, batches.length,
      `${completed.size}/${batches.length} engine batches complete`);
    if (completed.size < batches.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return {
    completed: completed.size,
    failedJobs: [...failedByBatch.values()].reduce((sum, count) => sum + count, 0),
    failedByBatch,
    timedOut: completed.size < batches.length,
  };
}

/* ══════════════════════════════════════════════════════════════════
   CONFIRM — handles all modes
   ══════════════════════════════════════════════════════════════════ */

export async function confirmModify() {
  // Captured before closeModifyDialog() below, which resets the dialog state.
  const { mode, incidentIds, selectedTargetId, batchSize } = state.modifyDialog;

  // ── Incident modes (existing behavior) ──
  if (mode === 'single' || mode === 'batch') {
    if (!selectedTargetId || incidentIds.length === 0) return;
    if (mode === 'batch' && batchSize === null) {
      toast(`Incidents per wave must be between ${BATCH_PRESETS.incident.min} and ${BATCH_PRESETS.incident.max}`, 'error');
      return;
    }
    closeModifyDialog();

    if (mode === 'single') {
      try {
        const result = await rawApi('/actions/batch-modify-to-start', {
          method: 'POST',
          body: { incidentIds, batchSize: 1, targetActivityId: selectedTargetId }
        });
        if (result.succeeded > 0) {
          toast(`✅ ${result.results[0].message}`, 'success');
        } else if (result.skipped > 0) {
          toast(`⊘ ${result.results[0].message}`, 'info');
        } else {
          toast(`❌ ${result.results[0].message}`, 'error');
        }
        setTimeout(refreshCurrentPanel, 1000);
      } catch (e) { toast('Modify failed: ' + e.message, 'error'); }
    } else {
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
      } else if (result.status === 'already_processed') {
        toast(`⊘ ${result.message}`, 'info');
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
    const {
      instanceIds, instructionType, skipCustomListeners,
      skipIoMappings, annotation,
    } = state.modifyDialog;
    if (!selectedTargetId || instanceIds.length === 0) return;
    if (batchSize === null) {
      toast(`Instances per Camunda batch must be between ${BATCH_PRESETS.instance.min} and ${BATCH_PRESETS.instance.max}`, 'error');
      return;
    }
    const confirmButton = document.getElementById('modify-dialog-confirm');
    confirmButton.disabled = true;
    closeModifyDialog();

    showProgress(`Submitting ${instanceIds.length} instances to Camunda in batches of ${batchSize}`);
    updateProgress(0, 1, 'Discovering current wait states…');

    try {
      const result = await rawApi('/actions/batch-instance-modify', {
        method: 'POST',
        body: {
          instanceIds,
          targetActivityId: selectedTargetId,
          instructionType,
          skipCustomListeners,
          skipIoMappings,
          annotation: annotation || undefined,
          batchSize,
        },
      });
      assertBatchModifyShape(result);
      const skippedResults = toSkippedResults(result);
      const skippedCount = skippedResults.length;

      if (result.batches.length === 0) {
        finishProgress({
          succeeded: 0,
          skipped: skippedCount,
          failed: result.totalInstances - skippedCount,
          statusText: skippedCount === result.totalInstances
            ? `Nothing to modify — all ${skippedCount} instance(s) were already processed`
            : undefined,
          results: [
            ...skippedResults,
            ...result.failedGroups.map(group => ({
              incidentId: group.processDefinitionId,
              status: 'error',
              message: `${group.instanceCount} instance(s): ${group.message}`,
            })),
          ],
        });
        return;
      }
      showProgress(`Applying ${result.batches.length} Camunda engine batch(es)`);
      const poll = await pollModificationBatches(result.batches);
      const skipNote = skippedCount > 0 ? `; ⊘ ${skippedCount} already processed` : '';
      finishProgress({
        succeeded: !poll.timedOut && poll.failedJobs === 0 ? result.submittedInstances : 0,
        skipped: skippedCount,
        failed: result.failedGroups.reduce((n, g) => n + g.instanceCount, 0) + poll.failedJobs,
        statusText: poll.timedOut
          ? `${result.submittedInstances} submitted; Camunda batches are still running${skipNote}`
          : poll.failedJobs > 0
            ? `Batch stopped with ${poll.failedJobs} failed job(s); affected instance count is unknown${skipNote}`
            : `${result.submittedInstances} instance(s) completed${skipNote}`,
        results: [
          ...result.batches.map(batch => ({
            incidentId: batch.batchId,
            status: poll.timedOut || (poll.failedByBatch.get(batch.batchId) || 0) > 0
              ? 'error' : 'success',
            message: poll.timedOut
              ? `Still running. Track Camunda batch ${batch.batchId}`
              : (poll.failedByBatch.get(batch.batchId) || 0) > 0
                ? `${poll.failedByBatch.get(batch.batchId)} failed batch job(s)`
                : `${batch.instanceCount} instance(s) submitted`,
          })),
          ...skippedResults,
          ...result.failedGroups.map(group => ({
            incidentId: group.processDefinitionId,
            status: 'error',
            message: `${group.instanceCount} instance(s): ${group.message}`,
          })),
        ],
      });
    } catch (e) {
      if (e.message.includes('outcome is unknown')) batchSubmissionUncertain = true;
      finishProgress({
        succeeded: 0,
        failed: instanceIds.length,
        results: [{ incidentId: '—', status: 'error', message: e.message }],
      });
    }
  }
}
