import { api } from '../api-client.js';
import { shortId, fmtDate, buildTable } from '../utils.js';
import { panelLoaders } from '../state.js';

export async function loadHistory() {
  try {
    const params = new URLSearchParams();
    const pi = document.getElementById('hist-filter-pi').value;
    const st = document.getElementById('hist-filter-state').value;
    if (pi) params.set('processInstanceId', pi);
    if (st === 'finished') params.set('finished', 'true');
    if (st === 'unfinished') params.set('unfinished', 'true');
    params.set('sortBy', 'startTime');
    params.set('sortOrder', 'desc');
    params.set('maxResults', '100');

    const data = await api('/history/process-instance?' + params);
    const cols = [
      { key: 'id', label: 'Instance', render: r => shortId(r.id), copyVal: r => r.id },
      { key: 'processDefinitionKey', label: 'Def Key' },
      { key: 'state', label: 'State', render: r => {
        if (r.state === 'COMPLETED') return '<span class="tag tag-green">Completed</span>';
        if (r.state === 'ACTIVE') return '<span class="tag tag-blue">Active</span>';
        if (r.state === 'EXTERNALLY_TERMINATED') return '<span class="tag tag-red">Terminated</span>';
        if (r.state === 'INTERNALLY_TERMINATED') return '<span class="tag tag-red">Terminated</span>';
        return `<span class="tag tag-gray">${r.state || '—'}</span>`;
      }, noCopy: true },
      { key: 'startTime', label: 'Started', render: r => fmtDate(r.startTime), noCopy: true },
      { key: 'endTime', label: 'Ended', render: r => fmtDate(r.endTime), noCopy: true },
      { key: 'durationInMillis', label: 'Duration', render: r => r.durationInMillis ? (r.durationInMillis / 1000).toFixed(1) + 's' : '—', noCopy: true },
    ];
    document.getElementById('history-table').innerHTML = buildTable(cols, data);
  } catch (e) { document.getElementById('history-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

panelLoaders.history = loadHistory;
