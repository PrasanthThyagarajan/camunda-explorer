/**
 * History Track Popup — shows the complete execution story of any process instance.
 * Works for both running and completed instances by using the history API.
 */
import { rawApi } from '../api-client.js';
import { esc, copyBtn, toast, fmtDuration, relativeTime } from '../utils.js';

// ── Helpers ──────────────────────────────────────────────────────

const TYPE_LABELS = {
  serviceTask: 'Service Task',
  userTask: 'User Task',
  sendTask: 'Send Task',
  receiveTask: 'Receive Task',
  scriptTask: 'Script Task',
  businessRuleTask: 'Business Rule',
  manualTask: 'Manual Task',
  callActivity: 'Call Activity',
  subProcess: 'Sub Process',
  startEvent: 'Start Event',
  endEvent: 'End Event',
  intermediateThrowEvent: 'Throw Event',
  intermediateCatchEvent: 'Catch Event',
  exclusiveGateway: 'XOR Gateway',
  parallelGateway: 'AND Gateway',
  inclusiveGateway: 'OR Gateway',
  eventBasedGateway: 'Event Gateway',
  boundaryEvent: 'Boundary Event',
  multiInstanceBody: 'Multi Instance',
};

const STATUS_ICONS = {
  completed: '<svg class="track-icon track-icon-completed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  active: '<span class="track-dot track-dot-active"></span>',
  failed: '<svg class="track-icon track-icon-failed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  canceled: '<svg class="track-icon track-icon-canceled" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
};

// Timeline event icons (inline SVGs instead of emojis for theme consistency)
const TL_ICONS = {
  play: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  cross: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  slash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  alert: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  user: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  file: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
};

// fmtDuration now imported from shared utils

function fmtTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

// relativeTime now imported from shared utils

/** Truncate variable values for display */
function fmtVarValue(val) {
  if (val === null || val === undefined) return '<span class="text-muted">null</span>';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.length > 80) return esc(str.substring(0, 77)) + '…';
  return esc(str);
}

// ── Track State ──────────────────────────────────────────────────

let currentTrack = null;
let expandedSteps = new Set();
let activeTab = 'steps'; // 'steps' | 'timeline' | 'variables' | 'audit'
let stepFilter = 'all';  // 'all' | 'completed' | 'failed' | 'active'

// ── Public API ───────────────────────────────────────────────────

export async function showHistoryTrack(instanceId) {
  const overlay = document.getElementById('history-track-overlay');
  if (!overlay) {
    toast('Track popup not found in DOM', 'error');
    return;
  }

  // Show loading state
  overlay.classList.add('open');
  document.getElementById('track-title').textContent = 'Loading…';
  document.getElementById('track-subtitle').textContent = instanceId;
  document.getElementById('track-header-info').innerHTML = '';
  document.getElementById('track-tabs-content').innerHTML =
    '<div class="track-loading"><span class="track-spinner"></span> Loading execution track…</div>';

  // Reset state
  expandedSteps = new Set();
  activeTab = 'steps';
  stepFilter = 'all';

  try {
    currentTrack = await rawApi(`/actions/history-track/${instanceId}`);
    renderTrack();
  } catch (e) {
    document.getElementById('track-tabs-content').innerHTML =
      `<div class="track-error">Failed to load history track: ${esc(e.message)}</div>`;
  }
}

export function closeHistoryTrack() {
  document.getElementById('history-track-overlay').classList.remove('open');
  currentTrack = null;
  expandedSteps.clear();
}

export function switchTrackTab(tab) {
  activeTab = tab;
  renderTabs();
  renderTabContent();
}

export function toggleTrackStep(stepIndex) {
  if (expandedSteps.has(stepIndex)) {
    expandedSteps.delete(stepIndex);
  } else {
    expandedSteps.add(stepIndex);
  }
  renderTabContent();
}

export function filterTrackSteps(filter) {
  stepFilter = filter;
  renderTabContent();
}

export function expandAllSteps() {
  if (!currentTrack) return;
  const steps = getFilteredSteps();
  steps.forEach((_, i) => expandedSteps.add(i));
  renderTabContent();
}

export function collapseAllSteps() {
  expandedSteps.clear();
  renderTabContent();
}

// ── Rendering ────────────────────────────────────────────────────

function renderTrack() {
  const t = currentTrack;
  const inst = t.instance;
  const s = t.summary;

  // Title
  const defLabel = inst.definitionName || inst.definitionKey || 'Process';
  document.getElementById('track-title').textContent = defLabel;
  document.getElementById('track-subtitle').innerHTML =
    `Instance: <span class="track-id">${esc(inst.id)}${copyBtn(inst.id)}</span>`;

  // Header stats
  const stateMap = {
    'COMPLETED': ['track-state-completed', 'Completed'],
    'ACTIVE': ['track-state-active', 'Active'],
    'SUSPENDED': ['track-state-active', 'Suspended'],
    'EXTERNALLY_TERMINATED': ['track-state-failed', 'Terminated'],
    'INTERNALLY_TERMINATED': ['track-state-failed', 'Terminated'],
  };
  const [stateCls, stateLabel] = stateMap[inst.state] || ['', inst.state];

  let headerHtml = `<div class="track-stats">
    <div class="track-stat">
      <span class="track-stat-label">State</span>
      <span class="track-stat-value ${stateCls}">${stateLabel}</span>
    </div>
    <div class="track-stat">
      <span class="track-stat-label">Duration</span>
      <span class="track-stat-value">${fmtDuration(inst.durationMs)}</span>
    </div>
    <div class="track-stat">
      <span class="track-stat-label">Steps</span>
      <span class="track-stat-value">${s.totalSteps}</span>
    </div>
    <div class="track-stat">
      <span class="track-stat-label">Completed</span>
      <span class="track-stat-value track-state-completed">${s.completedSteps}</span>
    </div>`;

  if (s.failedSteps > 0) {
    headerHtml += `<div class="track-stat">
      <span class="track-stat-label">Failed</span>
      <span class="track-stat-value track-state-failed">${s.failedSteps}</span>
    </div>`;
  }
  if (s.activeSteps > 0) {
    headerHtml += `<div class="track-stat">
      <span class="track-stat-label">Active</span>
      <span class="track-stat-value track-state-active">${s.activeSteps}</span>
    </div>`;
  }
  if (s.totalIncidents > 0) {
    headerHtml += `<div class="track-stat">
      <span class="track-stat-label">Incidents</span>
      <span class="track-stat-value track-state-failed">${s.totalIncidents - s.resolvedIncidents} open / ${s.resolvedIncidents} resolved</span>
    </div>`;
  }

  headerHtml += `<div class="track-stat">
    <span class="track-stat-label">Started</span>
    <span class="track-stat-value" title="${fmtDateTime(inst.startTime)}">${relativeTime(inst.startTime)}</span>
  </div>`;

  if (inst.businessKey) {
    headerHtml += `<div class="track-stat">
      <span class="track-stat-label">Business Key</span>
      <span class="track-stat-value">${esc(inst.businessKey)}${copyBtn(inst.businessKey)}</span>
    </div>`;
  }

  headerHtml += '</div>';
  document.getElementById('track-header-info').innerHTML = headerHtml;

  // Render tabs and content
  renderTabs();
  renderTabContent();
}

function renderTabs() {
  const tabsEl = document.getElementById('track-tabs-bar');
  if (!tabsEl) return;

  const t = currentTrack;
  const varCount = t.variables.length;
  const opsCount = t.userOperations.length;

  tabsEl.innerHTML = `
    <button class="track-tab ${activeTab === 'steps' ? 'track-tab-active' : ''}" onclick="switchTrackTab('steps')">Execution Steps</button>
    <button class="track-tab ${activeTab === 'timeline' ? 'track-tab-active' : ''}" onclick="switchTrackTab('timeline')">Timeline</button>
    <button class="track-tab ${activeTab === 'variables' ? 'track-tab-active' : ''}" onclick="switchTrackTab('variables')">Variables${varCount > 0 ? ` (${varCount})` : ''}</button>
    <button class="track-tab ${activeTab === 'audit' ? 'track-tab-active' : ''}" onclick="switchTrackTab('audit')">Audit Log${opsCount > 0 ? ` (${opsCount})` : ''}</button>
  `;
}

function getFilteredSteps() {
  if (!currentTrack) return [];
  if (stepFilter === 'all') return currentTrack.steps;
  return currentTrack.steps.filter(s => {
    if (stepFilter === 'failed') return s.status === 'failed' || s.status === 'canceled';
    return s.status === stepFilter;
  });
}

function renderTabContent() {
  const content = document.getElementById('track-tabs-content');
  if (!content || !currentTrack) return;

  switch (activeTab) {
    case 'steps': content.innerHTML = renderStepsTab(); break;
    case 'timeline': content.innerHTML = renderTimelineTab(); break;
    case 'variables': content.innerHTML = renderVariablesTab(); break;
    case 'audit': content.innerHTML = renderAuditTab(); break;
  }
}

// ── Steps Tab ────────────────────────────────────────────────────

function renderStepsTab() {
  const steps = getFilteredSteps();
  const total = currentTrack.steps.length;

  // Filter bar
  let html = '<div class="track-filter-bar">';
  html += `<div class="track-filters">`;
  html += renderFilterBtn('all', `All (${total})`);

  const completed = currentTrack.steps.filter(s => s.status === 'completed').length;
  const failed = currentTrack.steps.filter(s => s.status === 'failed' || s.status === 'canceled').length;
  const active = currentTrack.steps.filter(s => s.status === 'active').length;
  if (completed > 0) html += renderFilterBtn('completed', `Completed (${completed})`);
  if (failed > 0) html += renderFilterBtn('failed', `Failed (${failed})`);
  if (active > 0) html += renderFilterBtn('active', `Active (${active})`);
  html += '</div>';

  html += `<div class="track-expand-btns">
    <button class="btn btn-xs btn-outline" onclick="expandAllSteps()" title="Expand all">Expand All</button>
    <button class="btn btn-xs btn-outline" onclick="collapseAllSteps()" title="Collapse all">Collapse All</button>
  </div>`;
  html += '</div>';

  if (steps.length === 0) {
    html += '<div class="track-empty">No steps match the current filter.</div>';
    return html;
  }

  // Duration range for proportional bars
  const maxDuration = Math.max(...steps.map(s => s.durationMs || 0), 1);

  html += '<div class="track-steps">';
  steps.forEach((step, i) => {
    const isExpanded = expandedSteps.has(i);
    const icon = STATUS_ICONS[step.status] || '';
    const typeLabel = TYPE_LABELS[step.activityType] || step.activityType;
    const dur = fmtDuration(step.durationMs);
    const durPct = step.durationMs ? Math.max(2, (step.durationMs / maxDuration) * 100) : 0;

    // connector line between steps
    const isLast = (i === steps.length - 1);

    html += `<div class="track-step track-step-${step.status}">
      <div class="track-step-gutter">
        <div class="track-step-icon">${icon}</div>
        ${!isLast ? '<div class="track-step-line"></div>' : ''}
      </div>
      <div class="track-step-content" onclick="toggleTrackStep(${i})">
        <div class="track-step-header">
          <div class="track-step-name">${esc(step.activityName)}</div>
          <div class="track-step-meta">
            <span class="track-step-type">${esc(typeLabel)}</span>
            <span class="track-step-time" title="${fmtDateTime(step.startTime)}">${fmtTime(step.startTime)}</span>
            ${step.durationMs !== null ? `<span class="track-step-dur">${dur}</span>` : ''}
          </div>
        </div>`;

    // Duration bar
    if (step.durationMs !== null && step.durationMs > 0) {
      html += `<div class="track-dur-bar"><div class="track-dur-fill track-dur-${step.status}" style="width:${durPct}%"></div></div>`;
    }

    // Incidents inline preview
    if (step.incidents.length > 0) {
      step.incidents.forEach(inc => {
        html += `<div class="track-step-incident">
          <span class="track-inc-badge ${inc.resolved ? 'track-inc-resolved' : 'track-inc-open'}">${inc.resolved ? 'Resolved' : 'Open'}</span>
          <span class="track-inc-msg">${esc(inc.message || inc.type)}</span>
        </div>`;
      });
    }

    // Call activity link
    if (step.calledProcessInstanceId) {
      html += `<div class="track-step-child">
        <a href="#" onclick="event.stopPropagation();event.preventDefault();showHistoryTrack('${esc(step.calledProcessInstanceId)}')" class="track-child-link" title="Open child process">
          ↳ Child process: ${esc(step.calledProcessInstanceId.substring(0, 14))}…
        </a>
      </div>`;
    }

    // Expanded details
    if (isExpanded) {
      html += renderStepDetails(step);
    }

    html += '</div></div>';
  });
  html += '</div>';

  return html;
}

function renderFilterBtn(filter, label) {
  const active = stepFilter === filter;
  return `<button class="track-filter-btn ${active ? 'track-filter-active' : ''}" onclick="filterTrackSteps('${filter}')">${label}</button>`;
}

function renderStepDetails(step) {
  let html = '<div class="track-step-details">';

  html += '<div class="track-detail-grid">';
  html += `<span class="track-dk">Activity ID</span><span class="track-dv">${esc(step.activityId)}${copyBtn(step.activityId)}</span>`;
  html += `<span class="track-dk">Instance ID</span><span class="track-dv">${esc(step.activityInstanceId)}${copyBtn(step.activityInstanceId)}</span>`;
  html += `<span class="track-dk">Type</span><span class="track-dv">${esc(TYPE_LABELS[step.activityType] || step.activityType)}</span>`;
  html += `<span class="track-dk">Started</span><span class="track-dv">${fmtDateTime(step.startTime)}</span>`;
  html += `<span class="track-dk">Ended</span><span class="track-dv">${step.endTime ? fmtDateTime(step.endTime) : '<span class="text-muted">still running</span>'}</span>`;
  html += `<span class="track-dk">Duration</span><span class="track-dv">${fmtDuration(step.durationMs)}</span>`;

  if (step.taskId) {
    html += `<span class="track-dk">Task ID</span><span class="track-dv">${esc(step.taskId)}${copyBtn(step.taskId)}</span>`;
  }
  if (step.calledProcessInstanceId) {
    html += `<span class="track-dk">Called Instance</span><span class="track-dv">${esc(step.calledProcessInstanceId)}${copyBtn(step.calledProcessInstanceId)}</span>`;
  }
  html += '</div>';

  // Incidents detail
  if (step.incidents.length > 0) {
    html += '<div class="track-detail-section"><strong>Incidents</strong>';
    step.incidents.forEach(inc => {
      html += `<div class="track-inc-detail">
        <div class="track-inc-row">
          <span class="track-inc-badge ${inc.resolved ? 'track-inc-resolved' : 'track-inc-open'}">${inc.resolved ? 'Resolved' : 'Open'}</span>
          <span class="track-inc-type">${esc(inc.type)}</span>
          <span class="track-inc-time">${fmtDateTime(inc.createTime)}${inc.endTime ? ' → ' + fmtDateTime(inc.endTime) : ''}</span>
        </div>
        <div class="track-inc-message">${esc(inc.message)}</div>
      </div>`;
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ── Timeline Tab ─────────────────────────────────────────────────

function renderTimelineTab() {
  const steps = currentTrack.steps;
  const incidents = currentTrack.steps.flatMap((s, i) =>
    s.incidents.map(inc => ({ ...inc, stepIndex: i, activityName: s.activityName }))
  );
  const ops = currentTrack.userOperations;

  // Merge all events into a single timeline
  const events = [];

  steps.forEach((step, idx) => {
    events.push({
      time: step.startTime,
      type: 'step-start',
      icon: TL_ICONS.play,
      label: step.activityName,
      detail: TYPE_LABELS[step.activityType] || step.activityType,
      status: step.status,
      stepIdx: idx,
    });
    if (step.endTime) {
      const endIcon = step.status === 'completed' ? TL_ICONS.check
                    : step.status === 'canceled' ? TL_ICONS.slash
                    : TL_ICONS.cross;
      events.push({
        time: step.endTime,
        type: 'step-end',
        icon: endIcon,
        label: step.activityName,
        detail: `${step.status} — ${fmtDuration(step.durationMs)}`,
        status: step.status,
        stepIdx: idx,
      });
    }
  });

  incidents.forEach(inc => {
    events.push({
      time: inc.createTime,
      type: 'incident',
      icon: TL_ICONS.alert,
      label: `Incident at ${inc.activityName}`,
      detail: inc.message || inc.type,
      status: 'failed',
    });
    if (inc.endTime) {
      events.push({
        time: inc.endTime,
        type: 'incident-resolve',
        icon: TL_ICONS.check,
        label: `Incident resolved at ${inc.activityName}`,
        detail: inc.type,
        status: 'completed',
      });
    }
  });

  ops.forEach(op => {
    events.push({
      time: op.timestamp,
      type: 'operation',
      icon: TL_ICONS.user,
      label: op.operationType,
      detail: `${op.userId || 'system'}${op.property ? ': ' + op.property + ' ' + (op.orgValue || '') + ' → ' + (op.newValue || '') : ''}`,
      status: 'info',
    });
  });

  // Sort chronologically
  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  if (events.length === 0) {
    return '<div class="track-empty">No timeline events found.</div>';
  }

  let html = '<div class="track-timeline">';
  let lastDate = '';

  events.forEach(evt => {
    const evtDate = new Date(evt.time).toLocaleDateString();
    if (evtDate !== lastDate) {
      html += `<div class="track-tl-date">${evtDate}</div>`;
      lastDate = evtDate;
    }

    const statusCls = evt.status === 'completed' ? 'tl-completed' :
                      evt.status === 'failed' ? 'tl-failed' :
                      evt.status === 'active' ? 'tl-active' : 'tl-info';

    html += `<div class="track-tl-event ${statusCls}">
      <span class="track-tl-time">${fmtTime(evt.time)}</span>
      <span class="track-tl-icon">${evt.icon}</span>
      <div class="track-tl-body">
        <span class="track-tl-label">${esc(evt.label)}</span>
        <span class="track-tl-detail">${esc(evt.detail)}</span>
      </div>
    </div>`;
  });

  html += '</div>';
  return html;
}

// ── Variables Tab ────────────────────────────────────────────────

function renderVariablesTab() {
  const vars = currentTrack.variables;
  if (vars.length === 0) {
    return '<div class="track-empty">No variables recorded for this instance.</div>';
  }

  let html = '<table class="track-var-table"><thead><tr>';
  html += '<th>Name</th><th>Type</th><th>Value</th>';
  html += '</tr></thead><tbody>';

  // De-duplicate: keep latest value per variable name
  const varMap = new Map();
  vars.forEach(v => { varMap.set(v.name, v); });

  const sorted = [...varMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach(v => {
    html += `<tr>
      <td><strong>${esc(v.name)}</strong>${copyBtn(v.name)}</td>
      <td><span class="tag tag-gray">${esc(v.type)}</span></td>
      <td><code class="track-var-val">${fmtVarValue(v.value)}</code>${copyBtn(typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value ?? ''))}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  return html;
}

// ── Audit Tab ────────────────────────────────────────────────────

function renderAuditTab() {
  const ops = currentTrack.userOperations;
  if (ops.length === 0) {
    return '<div class="track-empty">No user operations recorded.<br><span class="text-muted" style="font-size:12px">The engine may not have user-operation-log enabled, or no manual actions were taken on this instance.</span></div>';
  }

  let html = '<div class="track-audit">';
  ops.forEach(op => {
    html += `<div class="track-audit-entry">
      <span class="track-audit-time">${fmtDateTime(op.timestamp)}</span>
      <span class="track-audit-user">${esc(op.userId || 'system')}</span>
      <span class="track-audit-op">${esc(op.operationType)}</span>
      ${op.property ? `<span class="track-audit-change">${esc(op.property)}: ${esc(op.orgValue || '—')} → ${esc(op.newValue || '—')}</span>` : ''}
    </div>`;
  });
  html += '</div>';

  return html;
}

// ── Export ────────────────────────────────────────────────────────

export function exportTrackJson() {
  if (!currentTrack) return;
  const blob = new Blob([JSON.stringify(currentTrack, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `track-${currentTrack.instance.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Track exported as JSON', 'info');
}
