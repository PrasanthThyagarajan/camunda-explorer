import { rawApi } from '../api-client.js';
import { state } from '../state.js';

/**
 * Shared "Node" filter helper used by Incidents and Process Instances panels.
 *
 * Loads the BPMN activities (tasks, gateways, events) for a given
 * process definition key and renders them as <option> elements inside
 * the supplied <select>. Results are cached in state.bpmnNodeCache so
 * repeated panel reloads don't re-fetch the BPMN XML.
 */

const TYPE_LABELS = {
  serviceTask: 'Service Task',
  callActivity: 'Call Activity',
  userTask: 'User Task',
  sendTask: 'Send Task',
  receiveTask: 'Receive Task',
  scriptTask: 'Script Task',
  businessRuleTask: 'Business Rule',
  manualTask: 'Manual Task',
  task: 'Task',
  exclusiveGateway: 'Gateway',
  parallelGateway: 'Parallel Gateway',
  inclusiveGateway: 'Inclusive Gateway',
  eventBasedGateway: 'Event Gateway',
  complexGateway: 'Complex Gateway',
  subProcess: 'Sub-Process',
  startEvent: 'Start Event',
  endEvent: 'End Event',
  intermediateCatchEvent: 'Catch Event',
  intermediateThrowEvent: 'Throw Event',
  boundaryEvent: 'Boundary Event',
};

const GROUP_FOR_TYPE = {
  startEvent: 'Events',
  endEvent: 'Events',
  intermediateCatchEvent: 'Events',
  intermediateThrowEvent: 'Events',
  boundaryEvent: 'Events',
  exclusiveGateway: 'Gateways',
  parallelGateway: 'Gateways',
  inclusiveGateway: 'Gateways',
  eventBasedGateway: 'Gateways',
  complexGateway: 'Gateways',
};
const GROUP_ORDER = ['Tasks', 'Gateways', 'Events'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchActivities(procDefKey) {
  if (state.bpmnNodeCache[procDefKey]) return state.bpmnNodeCache[procDefKey];
  const data = await rawApi(`/actions/bpmn-activities-by-key/${encodeURIComponent(procDefKey)}`);
  const activities = Array.isArray(data?.activities) ? data.activities : [];
  state.bpmnNodeCache[procDefKey] = activities;
  return activities;
}

function renderEmpty(sel, message) {
  sel.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
  sel.disabled = true;
}

function renderOptions(sel, activities, previousValue) {
  if (!activities || activities.length === 0) {
    renderEmpty(sel, 'No nodes found');
    return;
  }

  const groups = { Tasks: [], Gateways: [], Events: [] };
  for (const act of activities) {
    const group = GROUP_FOR_TYPE[act.type] || 'Tasks';
    groups[group].push(act);
  }

  let html = '<option value="">All Nodes</option>';
  for (const groupName of GROUP_ORDER) {
    const items = groups[groupName];
    if (!items || items.length === 0) continue;
    html += `<optgroup label="${groupName}">`;
    for (const act of items) {
      const typeLabel = TYPE_LABELS[act.type] || act.type;
      const display = act.name && act.name !== act.id ? `${act.name} (${act.id})` : act.id;
      html += `<option value="${escapeHtml(act.id)}" title="${escapeHtml(typeLabel)}">[${escapeHtml(typeLabel)}] ${escapeHtml(display)}</option>`;
    }
    html += '</optgroup>';
  }

  sel.innerHTML = html;
  sel.disabled = false;

  if (previousValue && [...sel.querySelectorAll('option')].some(o => o.value === previousValue)) {
    sel.value = previousValue;
  }
}

/**
 * Populate a <select> with BPMN activity options for the given process key.
 *
 * @param {string} selectId - DOM id of the target <select>
 * @param {string} procDefKey - process definition key (empty string clears the filter)
 * @param {{ preserveSelection?: boolean }} [opts]
 */
export async function populateNodeFilter(selectId, procDefKey, opts = {}) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  if (!procDefKey) {
    renderEmpty(sel, 'Select a process first');
    return;
  }

  const previous = opts.preserveSelection ? sel.value : '';

  sel.innerHTML = '<option value="">Loading nodes…</option>';
  sel.disabled = true;

  try {
    const activities = await fetchActivities(procDefKey);
    renderOptions(sel, activities, previous);
  } catch (e) {
    console.warn('[node-filter] Failed to load BPMN activities:', e);
    renderEmpty(sel, 'Failed to load nodes');
  }
}

/**
 * Clear the node filter and disable it (e.g. when switching to "All Processes").
 */
export function clearNodeFilter(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  renderEmpty(sel, 'Select a process first');
}
