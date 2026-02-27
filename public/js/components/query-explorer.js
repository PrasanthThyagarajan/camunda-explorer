/**
 * Query Explorer — Presentation component.
 *
 * SRP: API query explorer with curated queries, execution, and results rendering.
 */

import { api } from '../api-client.js';
import { esc, fmtDate, buildTable, toast } from '../utils.js';
import { state } from '../state.js';

// ── 20 Curated Queries ──────────────────────────────────────────────

const QE_QUERIES = {
  // ─── Incident Analysis ────────────────────────────────────────
  'inc-all': {
    method: 'GET', path: '/incident',
    params: 'sortBy=incidentTimestamp&sortOrder=desc',
    hint: 'All active incidents across every process, newest first. Shows <code>incidentType</code>, <code>activityId</code>, <code>processInstanceId</code>, and <code>incidentMessage</code>.',
    description: 'Overview of every active problem in the engine.',
  },
  'inc-failed-job': {
    method: 'GET', path: '/incident',
    params: 'incidentType=failedJob&sortBy=incidentTimestamp&sortOrder=desc',
    hint: 'Only <code>failedJob</code> incidents — the #1 most common incident type.',
    description: 'Failed Job incidents are the most common problem.',
  },
  'inc-failed-ext': {
    method: 'GET', path: '/incident',
    params: 'incidentType=failedExternalTask&sortBy=incidentTimestamp&sortOrder=desc',
    hint: 'Only <code>failedExternalTask</code> incidents — occur when an external worker fails.',
    description: 'External Task failures from worker microservices.',
  },
  'inc-by-procdef': {
    method: 'GET', path: '/incident',
    params: 'processDefinitionKeyIn=PROCESS_KEY_HERE&sortBy=incidentTimestamp&sortOrder=desc',
    hint: 'Filter incidents by process definition key. Change <code>PROCESS_KEY_HERE</code> to your BPMN key.',
    description: 'Narrow incidents to a specific workflow.',
  },
  'inc-hist-open': {
    method: 'GET', path: '/history/incident',
    params: 'open=true&sortBy=createTime&sortOrder=desc',
    hint: 'All historically open incidents with full audit details.',
    description: 'Full incident history with timestamps and chain.',
  },

  // ─── Process Instance Queries ─────────────────────────────────
  'pi-with-incidents': {
    method: 'POST', path: '/process-instance',
    body: { withIncident: true, sortBy: 'definitionId', sortOrder: 'asc' },
    hint: 'All running process instances that have at least one active incident.',
    description: 'Which instances are currently stuck?',
  },
  'pi-suspended': {
    method: 'POST', path: '/process-instance',
    body: { suspended: true, sortBy: 'definitionId', sortOrder: 'asc' },
    hint: 'Suspended instances are paused and will not execute any further until activated.',
    description: 'Find paused instances that may be forgotten.',
  },
  'pi-active': {
    method: 'POST', path: '/process-instance',
    body: { active: true, sortBy: 'definitionId', sortOrder: 'asc' },
    hint: 'All currently active (non-suspended) instances.',
    description: 'All actively running process instances.',
  },
  'pi-by-bkey': {
    method: 'POST', path: '/process-instance',
    body: { businessKeyLike: '%YOUR_KEY%', sortBy: 'definitionId', sortOrder: 'asc' },
    hint: 'Search by business key. Change <code>%YOUR_KEY%</code> to your value.',
    description: 'Lookup by article ID, order number, etc.',
  },
  'pi-by-variable': {
    method: 'POST', path: '/process-instance',
    body: { variables: [{ name: 'articleId', operator: 'eq', value: '12345' }], sortBy: 'definitionId', sortOrder: 'asc' },
    hint: 'Powerful Cockpit-style search! Filter by process variable values.',
    description: 'Cockpit-style search by variable value.',
  },

  // ─── Jobs & External Tasks ────────────────────────────────────
  'job-failed': {
    method: 'GET', path: '/job',
    params: 'noRetriesLeft=true&sortBy=jobDueDate&sortOrder=asc',
    hint: 'Jobs with zero retries remaining — these caused <code>failedJob</code> incidents.',
    description: 'All jobs that have exhausted their retries.',
  },
  'job-with-exception': {
    method: 'GET', path: '/job',
    params: 'withException=true&sortBy=jobDueDate&sortOrder=asc',
    hint: 'Jobs that have an exception message.',
    description: 'Jobs with error messages — debug root cause.',
  },
  'ext-failed': {
    method: 'GET', path: '/external-task',
    params: 'noRetriesLeft=true&sortBy=id&sortOrder=asc',
    hint: 'External tasks with zero retries — workers failed to process these.',
    description: 'External tasks that workers failed to process.',
  },

  // ─── History & Audit ──────────────────────────────────────────
  'hist-last-24h': {
    method: 'POST', path: '/history/process-instance',
    body: { startedAfter: '__LAST_24H__', sortBy: 'startTime', sortOrder: 'desc' },
    hint: 'Process instances started in the last 24 hours.',
    description: 'Throughput check — what started recently?',
  },
  'hist-completed': {
    method: 'POST', path: '/history/process-instance',
    body: { finished: true, finishedAfter: '__LAST_24H__', sortBy: 'endTime', sortOrder: 'desc' },
    hint: 'Recently completed instances.',
    description: 'Confirm processes are completing successfully.',
  },
  'hist-long-running': {
    method: 'POST', path: '/history/process-instance',
    body: { unfinished: true, startedBefore: '__7_DAYS_AGO__', sortBy: 'startTime', sortOrder: 'asc' },
    hint: 'Instances started more than 7 days ago that are still running.',
    description: 'Detect instances stuck for days.',
  },
  'hist-var-search': {
    method: 'POST', path: '/history/variable-instance',
    body: { variableName: 'articleId', sortBy: 'variableName', sortOrder: 'asc' },
    hint: 'Search for a specific variable across all process instances.',
    description: 'Find data flowing through any process.',
  },
  'hist-running-activities': {
    method: 'POST', path: '/history/activity-instance',
    body: { unfinished: true, sortBy: 'startTime', sortOrder: 'desc' },
    hint: 'All currently executing activity instances.',
    description: 'What is the engine actually doing right now?',
  },

  // ─── Definitions & Deployments ────────────────────────────────
  'def-latest': {
    method: 'GET', path: '/process-definition',
    params: 'latestVersion=true&sortBy=name&sortOrder=asc',
    hint: 'Only the latest version of each process definition.',
    description: 'Overview of all deployed workflow definitions.',
  },
  'def-statistics': {
    method: 'GET', path: '/process-definition/statistics',
    params: 'failedJobs=true&incidents=true',
    hint: 'Instance counts, failed jobs, and incident counts per definition. The <b>most informative single query</b>.',
    description: 'The single most informative query — engine-wide stats.',
  },

  // ─── Custom ───────────────────────────────────────────────────
  'custom': {
    method: 'GET', path: '',
    hint: 'Enter any Camunda REST API path manually.',
    description: 'Build your own query from scratch.',
  },
};

// ── Toggle ──────────────────────────────────────────────────────────

export function toggleQueryExplorer() {
  const body = document.getElementById('qe-body');
  const toggle = document.getElementById('qe-toggle');
  const isOpen = body.classList.toggle('open');
  toggle.classList.toggle('open', isOpen);
}

// ── Query Selection ─────────────────────────────────────────────────

function replaceDatePlaceholders(obj) {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      if (obj[key] === '__LAST_24H__') obj[key] = new Date(Date.now() - 86400000).toISOString();
      else if (obj[key] === '__7_DAYS_AGO__') obj[key] = new Date(Date.now() - 7 * 86400000).toISOString();
      else if (obj[key] === '__30_DAYS_AGO__') obj[key] = new Date(Date.now() - 30 * 86400000).toISOString();
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      replaceDatePlaceholders(obj[key]);
    }
  }
}

export function onQeQuerySelect() {
  const selectEl = document.getElementById('qe-query-select');
  const qid = selectEl.value;
  if (!qid) return;

  const q = QE_QUERIES[qid];
  if (!q) return;

  const maxResults = parseInt(document.getElementById('qe-max').value) || 50;

  document.getElementById('qe-method').value = q.method;
  const badge = document.getElementById('qe-method-badge');
  badge.textContent = q.method;
  badge.className = 'qe-method-badge ' + q.method.toLowerCase();

  if (q.method === 'GET' && q.params) {
    document.getElementById('qe-path').value = q.path + '?' + q.params + '&maxResults=' + maxResults;
  } else {
    document.getElementById('qe-path').value = q.path;
  }

  const hintEl = document.getElementById('qe-hint');
  hintEl.innerHTML = (q.description ? '<strong>' + esc(q.description) + '</strong><br>' : '') + q.hint;
  hintEl.style.display = 'block';

  if (q.body) {
    let bodyObj = JSON.parse(JSON.stringify(q.body));
    replaceDatePlaceholders(bodyObj);
    if (!bodyObj.maxResults) bodyObj.maxResults = maxResults;
    document.getElementById('qe-body-input').value = JSON.stringify(bodyObj, null, 2);
  } else {
    document.getElementById('qe-body-input').value = '';
  }

  document.getElementById('qe-results').style.display = 'none';
  document.getElementById('qe-status').textContent = '';
  state.qeResultData = null;
}

// ── Execute Query ───────────────────────────────────────────────────

export async function executeQuery() {
  const method = document.getElementById('qe-method').value;
  let path = document.getElementById('qe-path').value.trim();
  const bodyInput = document.getElementById('qe-body-input').value.trim();
  const maxResults = parseInt(document.getElementById('qe-max').value) || 50;
  const statusEl = document.getElementById('qe-status');

  if (!path) { toast('Enter a path or select a query first', 'error'); return; }
  if (!path.startsWith('/')) path = '/' + path;

  statusEl.textContent = '⏳ Executing…';
  statusEl.className = 'qe-status';

  const start = performance.now();

  try {
    let data;
    if (method === 'POST') {
      let body = {};
      if (bodyInput) {
        try { body = JSON.parse(bodyInput); }
        catch (e) { toast('Invalid JSON in query body', 'error'); statusEl.textContent = '❌ Invalid JSON'; statusEl.className = 'qe-status err'; return; }
      }
      if (!body.maxResults) body.maxResults = maxResults;
      data = await api(path, { method: 'POST', body });
    } else {
      if (!path.includes('maxResults')) {
        path += (path.includes('?') ? '&' : '?') + 'maxResults=' + maxResults;
      }
      data = await api(path);
    }

    const elapsed = Math.round(performance.now() - start);
    state.qeResultData = data;

    if (Array.isArray(data)) {
      statusEl.textContent = `✅ ${data.length} result(s) — ${elapsed}ms`;
      statusEl.className = 'qe-status ok';
      renderQeResults(data);
    } else if (data && typeof data === 'object') {
      statusEl.textContent = `✅ 1 result — ${elapsed}ms`;
      statusEl.className = 'qe-status ok';
      renderQeResults([data]);
    } else {
      statusEl.textContent = `✅ Done — ${elapsed}ms`;
      statusEl.className = 'qe-status ok';
      document.getElementById('qe-results').style.display = 'block';
      document.getElementById('qe-results-title').textContent = 'Response';
      document.getElementById('qe-results-table').innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;color:var(--text);font-family:var(--mono)">${esc(JSON.stringify(data, null, 2))}</pre>`;
    }
  } catch (e) {
    const elapsed = Math.round(performance.now() - start);
    statusEl.textContent = `❌ Error — ${elapsed}ms`;
    statusEl.className = 'qe-status err';
    document.getElementById('qe-results').style.display = 'block';
    document.getElementById('qe-results-title').textContent = 'Error';
    document.getElementById('qe-results-table').innerHTML = `<div style="color:var(--red);font-size:13px;padding:12px;background:var(--bg);border-radius:8px">${esc(e.message)}</div>`;
    state.qeResultData = null;
  }
}

// ── Render Results ──────────────────────────────────────────────────

function renderQeResults(data) {
  if (!data || data.length === 0) {
    document.getElementById('qe-results').style.display = 'block';
    document.getElementById('qe-results-title').textContent = 'Results (0)';
    document.getElementById('qe-results-table').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">No results found.</div>';
    return;
  }

  document.getElementById('qe-results').style.display = 'block';
  document.getElementById('qe-results-title').textContent = `Results (${data.length})`;

  const allKeys = new Set();
  data.slice(0, 20).forEach(item => {
    Object.keys(item).forEach(k => {
      const val = item[k];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) return;
      allKeys.add(k);
    });
  });

  const priorityKeys = ['id', 'key', 'name', 'processInstanceId', 'processDefinitionId', 'processDefinitionKey',
    'incidentType', 'activityId', 'activityName', 'activityType', 'state', 'assignee',
    'startTime', 'endTime', 'incidentTimestamp', 'createTime', 'durationInMillis',
    'incidentMessage', 'exceptionMessage', 'errorMessage', 'retries', 'suspended',
    'dueDate', 'created', 'topicName', 'workerId', 'variableName', 'value', 'type',
    'businessKey', 'version', 'resource', 'deploymentId',
    'instances', 'failedJobs', 'definition'];
  const sortedKeys = [...allKeys].sort((a, b) => {
    const ai = priorityKeys.indexOf(a);
    const bi = priorityKeys.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  const displayKeys = sortedKeys.slice(0, 14);

  const cols = displayKeys.map(k => ({
    key: k,
    label: k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
    render: r => {
      const v = r[k];
      if (v === null || v === undefined) return '<span style="color:var(--text3)">—</span>';
      if (typeof v === 'boolean') return v ? '<span class="tag tag-green">true</span>' : '<span class="tag tag-red">false</span>';
      if (Array.isArray(v)) return '<span style="color:var(--text3)">[' + v.length + ' items]</span>';
      const str = String(v);
      if (str.length > 50) return `<span title="${esc(str)}">${esc(str.substring(0, 47))}…</span>`;
      if (k === 'incidentType') return `<span class="tag tag-red">${esc(str)}</span>`;
      if (k === 'state') {
        if (str === 'ACTIVE') return '<span class="tag tag-blue">ACTIVE</span>';
        if (str === 'COMPLETED') return '<span class="tag tag-green">COMPLETED</span>';
        if (str.includes('TERMINATED') || str.includes('DELETED')) return '<span class="tag tag-red">' + esc(str) + '</span>';
        if (str === 'SUSPENDED') return '<span class="tag tag-yellow">SUSPENDED</span>';
        return '<span class="tag tag-gray">' + esc(str) + '</span>';
      }
      if (k === 'activityType') {
        const colors = { serviceTask: '#3b82f6', userTask: '#22c55e', startEvent: '#14b8a6', endEvent: '#ef4444', exclusiveGateway: '#eab308', parallelGateway: '#eab308' };
        const c = colors[str] || 'var(--text3)';
        return `<span style="color:${c};font-weight:600;font-size:11px">${esc(str)}</span>`;
      }
      if (k === 'suspended') return v ? '<span class="tag tag-yellow">Yes</span>' : '<span class="tag tag-green">No</span>';
      if (k === 'retries' && v === 0) return '<span class="tag tag-red">0</span>';
      if (k === 'durationInMillis' && typeof v === 'number') {
        if (v < 1000) return v + 'ms';
        if (v < 60000) return (v / 1000).toFixed(1) + 's';
        if (v < 3600000) return (v / 60000).toFixed(1) + 'm';
        return (v / 3600000).toFixed(1) + 'h';
      }
      if (k.endsWith('Time') || k.endsWith('Date') || k === 'created' || k === 'dueDate' || k === 'createTime') return fmtDate(v);
      return esc(str);
    },
    copyVal: r => r[k] != null ? String(r[k]) : '',
  }));

  document.getElementById('qe-results-table').innerHTML = buildTable(cols, data);
}

// ── Copy / Reset ────────────────────────────────────────────────────

export function copyQueryResults() {
  if (!state.qeResultData) { toast('No results to copy', 'info'); return; }
  navigator.clipboard.writeText(JSON.stringify(state.qeResultData, null, 2))
    .then(() => toast('Results copied to clipboard', 'success'))
    .catch(() => toast('Failed to copy', 'error'));
}

export function resetQueryExplorer() {
  document.getElementById('qe-query-select').value = '';
  document.getElementById('qe-method').value = 'GET';
  document.getElementById('qe-path').value = '';
  document.getElementById('qe-body-input').value = '';
  document.getElementById('qe-hint').style.display = 'none';
  document.getElementById('qe-results').style.display = 'none';
  document.getElementById('qe-status').textContent = '';
  state.qeResultData = null;
  toast('Query explorer reset', 'info');
}
