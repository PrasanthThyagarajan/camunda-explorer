import { api } from '../api-client.js';
import { shortId, fmtDate, buildTable, toast } from '../utils.js';
import { panelLoaders } from '../state.js';

export async function loadTasks() {
  try {
    const params = new URLSearchParams();
    const assignee = document.getElementById('task-filter-assignee').value;
    const st = document.getElementById('task-filter-state').value;
    if (assignee) params.set('assignee', assignee);
    if (st === 'unassigned') params.set('unassigned', 'true');
    params.set('maxResults', '100');
    params.set('sortBy', 'created');
    params.set('sortOrder', 'desc');

    const data = await api('/task?' + params);
    const cols = [
      { key: 'id', label: 'Task ID', render: r => shortId(r.id), copyVal: r => r.id },
      { key: 'name', label: 'Name' },
      { key: 'assignee', label: 'Assignee', render: r => r.assignee || '<span class="tag tag-gray">Unassigned</span>' },
      { key: 'processInstanceId', label: 'Instance', render: r => `<a href="#" onclick="showInstanceDetail('${r.processInstanceId}');return false">${shortId(r.processInstanceId)}</a>`, copyVal: r => r.processInstanceId },
      { key: 'created', label: 'Created', render: r => fmtDate(r.created), noCopy: true },
    ];
    const actions = r => `<button class="btn btn-success btn-sm" onclick="completeTask('${r.id}')">✓ Complete</button>`;
    document.getElementById('tasks-table').innerHTML = buildTable(cols, data, actions);
  } catch (e) { document.getElementById('tasks-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

export async function completeTask(id) {
  try {
    await api(`/task/${id}/complete`, { method: 'POST', body: {} });
    toast('Task completed', 'success');
    setTimeout(loadTasks, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

panelLoaders.tasks = loadTasks;
