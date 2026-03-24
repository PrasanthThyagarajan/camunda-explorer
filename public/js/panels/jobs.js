import { api } from '../api-client.js';
import { esc, shortId, shortMsg, fmtDate, copyBtn, buildTable, toast } from '../utils.js';
import { openDetail } from '../detail-panel.js';

/* ── Popup state ─────────────────────────────────────────────── */

let currentInstanceId = null;

/* ── Open / Close ────────────────────────────────────────────── */

export function openJobsPopup(instanceId) {
  currentInstanceId = instanceId || null;
  const title = document.getElementById('jobs-dialog-title');
  title.textContent = instanceId
    ? `🔄 Jobs — ${shortId(instanceId)}`
    : '🔄 Jobs';
  document.getElementById('jobs-overlay').classList.add('visible');
  refreshJobsPopup();
}

export function closeJobsPopup() {
  document.getElementById('jobs-overlay').classList.remove('visible');
  currentInstanceId = null;
}

/* ── Refresh / Load ──────────────────────────────────────────── */

export async function refreshJobsPopup() {
  const body = document.getElementById('jobs-popup-body');
  body.innerHTML = '<div class="empty">Loading…</div>';

  try {
    const params = new URLSearchParams();
    const filter = document.getElementById('jobs-popup-filter').value;
    if (filter === 'noRetries') params.set('noRetriesLeft', 'true');
    if (filter === 'withException') params.set('withException', 'true');
    if (currentInstanceId) params.set('processInstanceId', currentInstanceId);
    params.set('maxResults', '100');

    const data = await api('/job?' + params);

    if (data.length === 0) {
      body.innerHTML = '<div class="empty">No jobs found.</div>';
      return;
    }

    // Build a compact card list instead of a full table
    let html = `<div class="jobs-count">${data.length} job${data.length !== 1 ? 's' : ''}</div>`;
    html += '<div class="jobs-list">';

    for (const job of data) {
      const hasError = job.exceptionMessage;
      const retriesTag = job.retries === 0
        ? '<span class="tag tag-red">0 retries</span>'
        : `<span class="tag">${job.retries} retries</span>`;
      const statusTag = job.suspended
        ? '<span class="tag tag-yellow">Suspended</span>'
        : hasError
          ? '<span class="tag tag-red">Failed</span>'
          : '<span class="tag tag-green">Active</span>';

      html += `<div class="jobs-card ${hasError ? 'jobs-card-error' : ''}">
        <div class="jobs-card-header">
          <div class="jobs-card-id">
            <a href="#" onclick="showJobDetail('${job.id}');return false">${shortId(job.id)}</a>
            ${copyBtn(job.id)}
          </div>
          <div class="jobs-card-tags">${statusTag} ${retriesTag}</div>
        </div>
        ${job.activityId ? `<div class="jobs-card-activity">${esc(job.activityId)}</div>` : ''}
        ${hasError ? `<div class="jobs-card-error-msg" title="${esc(job.exceptionMessage)}">${esc(shortMsg(job.exceptionMessage, 100))}</div>` : ''}
        ${job.dueDate ? `<div class="jobs-card-due">Due: ${fmtDate(job.dueDate)}</div>` : ''}
        <div class="jobs-card-actions">
          <button class="btn btn-success btn-sm" onclick="retryJob('${job.id}')">↻ Retry</button>
          <button class="btn btn-primary btn-sm" onclick="executeJob('${job.id}')">▶ Execute</button>
          <button class="btn btn-outline btn-sm" onclick="showJobDetail('${job.id}')">Details</button>
        </div>
      </div>`;
    }

    html += '</div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

/* ── Job Actions ─────────────────────────────────────────────── */

export async function retryJob(jobId) {
  try {
    await api(`/job/${jobId}/retries`, { method: 'PUT', body: { retries: 1 } });
    toast('Job retries set to 1', 'success');
    setTimeout(refreshJobsPopup, 800);
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
    setTimeout(refreshJobsPopup, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export async function executeJob(id) {
  try {
    await api(`/job/${id}/execute`, { method: 'POST', body: {} });
    toast('Job executed', 'success');
    setTimeout(refreshJobsPopup, 500);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}
