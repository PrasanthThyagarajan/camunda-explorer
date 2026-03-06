import { api } from '../api-client.js';
import { esc, shortId, shortMsg, fmtDate, copyBtn, buildTable, toast } from '../utils.js';
import { panelLoaders } from '../state.js';
import { openDetail } from '../detail-panel.js';

export async function loadJobs() {
  try {
    const params = new URLSearchParams();
    const filter = document.getElementById('job-filter').value;
    const pi = document.getElementById('job-filter-pi').value;
    if (filter === 'noRetries') params.set('noRetriesLeft', 'true');
    if (filter === 'withException') params.set('withException', 'true');
    if (pi) params.set('processInstanceId', pi);
    params.set('maxResults', '100');

    const data = await api('/job?' + params);
    const cols = [
      { key: 'id', label: 'Job ID', render: r => `<a href="#" onclick="showJobDetail('${r.id}');return false">${shortId(r.id)}</a>`, copyVal: r => r.id },
      { key: 'processInstanceId', label: 'Instance', render: r => shortId(r.processInstanceId), copyVal: r => r.processInstanceId },
      { key: 'activityId', label: 'Activity' },
      { key: 'retries', label: 'Retries', render: r => r.retries === 0 ? '<span class="tag tag-red">0</span>' : r.retries, noCopy: true },
      { key: 'exceptionMessage', label: 'Error', render: r => `<span title="${esc(r.exceptionMessage)}">${shortMsg(r.exceptionMessage, 50)}</span>`, copyVal: r => r.exceptionMessage },
      { key: 'dueDate', label: 'Due', render: r => fmtDate(r.dueDate), noCopy: true },
    ];
    const actions = r => `
      <button class="btn btn-success btn-sm" onclick="retryJob('${r.id}')">↻ Retry</button>
    `;
    document.getElementById('jobs-table').innerHTML = buildTable(cols, data, actions);
  } catch (e) { document.getElementById('jobs-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

export async function retryJob(jobId) {
  try {
    await api(`/job/${jobId}/retries`, { method: 'PUT', body: { retries: 1 } });
    toast('Job retries set to 1', 'success');
    setTimeout(loadJobs, 1000);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export async function showJobDetail(id) {
  try {
    const job = await api(`/job/${id}`);
    let html = `<div class="detail-section"><h4>Job Details</h4><div class="kv-grid">
      <span class="k">ID</span><span class="v">${job.id}${copyBtn(job.id)}</span>
      <span class="k">Process Instance</span><span class="v"><a href="#" onclick="showInstanceDetail('${job.processInstanceId}');return false">${job.processInstanceId}</a>${copyBtn(job.processInstanceId)}</span>
      <span class="k">Process Def</span><span class="v">${job.processDefinitionId || '—'}${copyBtn(job.processDefinitionId)}</span>
      <span class="k">Activity</span><span class="v">${job.activityId || '—'}${copyBtn(job.activityId)}</span>
      <span class="k">Retries</span><span class="v">${job.retries}</span>
      <span class="k">Exception</span><span class="v">${esc(job.exceptionMessage || '—')}${copyBtn(job.exceptionMessage)}</span>
      <span class="k">Due Date</span><span class="v">${fmtDate(job.dueDate)}</span>
      <span class="k">Suspended</span><span class="v">${job.suspended}</span>
      <span class="k">Priority</span><span class="v">${job.priority}</span>
      <span class="k">Job Def ID</span><span class="v">${job.jobDefinitionId || '—'}${copyBtn(job.jobDefinitionId)}</span>
    </div></div>`;

    try {
      const st = await fetch('/api' + `/job/${id}/stacktrace`);
      if (st.ok) { const t = await st.text(); html += `<div class="detail-section"><h4>Stacktrace</h4><pre class="json">${esc(t)}</pre></div>`; }
    } catch (_) {}

    html += `<div class="detail-section"><h4>Set Retries</h4>
      <div class="form-row"><div class="form-group"><label>Retries</label><input type="number" id="job-retries-val" value="1" min="0" style="min-width:100px"/></div></div>
      <div class="btn-group">
        <button class="btn btn-success" onclick="setJobRetries('${id}')">Set Retries</button>
        <button class="btn btn-primary" onclick="executeJob('${id}')">▶ Execute Now</button>
      </div>
    </div>`;

    openDetail('Job: ' + shortId(id), html);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export async function setJobRetries(id) {
  const retries = parseInt(document.getElementById('job-retries-val').value);
  try {
    await api(`/job/${id}/retries`, { method: 'PUT', body: { retries } });
    toast(`Retries set to ${retries}`, 'success');
    setTimeout(loadJobs, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export async function executeJob(id) {
  try {
    await api(`/job/${id}/execute`, { method: 'POST', body: {} });
    toast('Job executed', 'success');
    setTimeout(loadJobs, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

panelLoaders.jobs = loadJobs;
