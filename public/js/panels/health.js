import { api } from '../api-client.js';
import { buildTable, esc } from '../utils.js';
import { panelLoaders } from '../state.js';
import { updateBadge, setEngineStatus, switchPanel } from '../navigation.js';

export async function loadHealth() {
  try {
    const allStats = await api('/process-definition/statistics?failedJobs=true&incidents=true');

    // Latest version per definition key
    const latestByKey = new Map();
    for (const s of allStats) {
      const key = s.definition?.key || s.id.split(':')[0];
      const ver = s.definition?.version ?? 0;
      const existing = latestByKey.get(key);
      if (!existing || ver > (existing.definition?.version ?? 0)) {
        latestByKey.set(key, s);
      }
    }
    const stats = [...latestByKey.values()];

    let totalInstances = 0, totalFailed = 0, totalIncidents = 0;
    let defsWithFailed = 0, defsWithIncidents = 0;
    stats.forEach(s => {
      totalInstances += s.instances || 0;
      totalFailed += s.failedJobs || 0;
      if (s.failedJobs > 0) defsWithFailed++;
      const incCount = (s.incidents || []).reduce((a, i) => a + (i.incidentCount || 0), 0);
      totalIncidents += incCount;
      if (incCount > 0) defsWithIncidents++;
    });

    const totalDefs = stats.length;
    const failRatePct = totalInstances > 0 ? ((totalFailed / totalInstances) * 100).toFixed(1) : '0.0';

    /* ── Fetch waiting-state counts — scoped to latest definitions ── */
    const latestKeys = [...latestByKey.keys()];
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const [timerRes, suspRes, idleRes, msgSubs] = await Promise.all([
      // Timer jobs
      api('/job/count', {
        method: 'POST',
        body: { timers: true, processDefinitionKeyIn: latestKeys },
      }).catch(() => ({ count: 0 })),

      // Suspended jobs
      api('/job/count', {
        method: 'POST',
        body: { suspended: true, processDefinitionKeyIn: latestKeys },
      }).catch(() => ({ count: 0 })),

      // Idle instances (>5m)
      api('/history/process-instance/count', {
        method: 'POST',
        body: { unfinished: true, active: true, startedBefore: fiveMinAgo, processDefinitionKeyIn: latestKeys },
      }).catch(() => ({ count: 0 })),

      // Message subscriptions
      api('/event-subscription?eventType=message&maxResults=500').catch(() => []),
    ]);

    const timers    = timerRes.count  || 0;
    const suspended = suspRes.count   || 0;
    const idle      = idleRes.count   || 0;

    // Filter subscriptions to latest definitions
    let messages = 0;
    if (Array.isArray(msgSubs) && msgSubs.length > 0) {
      const piIds = [...new Set(msgSubs.map(s => s.processInstanceId).filter(Boolean))];
      if (piIds.length > 0) {
        try {
          const piList = await api('/process-instance', {
            method: 'POST',
            body: { processInstanceIds: piIds, maxResults: 500 },
          });
          const keySet = new Set(latestKeys);
          const validPiIds = new Set(
            (piList || [])
              .filter(i => keySet.has((i.definitionId || '').split(':')[0]))
              .map(i => i.id)
          );
          messages = msgSubs.filter(s => validPiIds.has(s.processInstanceId)).length;
        } catch { messages = msgSubs.length; }
      }
    }

    // Top definitions by instance count
    const topByInstances = [...stats]
      .filter(s => s.instances > 0)
      .sort((a, b) => b.instances - a.instances)
      .slice(0, 4);

    // Top definitions by failed jobs
    const topByFailed = [...stats]
      .filter(s => s.failedJobs > 0)
      .sort((a, b) => b.failedJobs - a.failedJobs)
      .slice(0, 4);

    // Top definitions by incidents
    const topByIncidents = [...stats]
      .map(s => ({ ...s, _incCount: (s.incidents || []).reduce((a, i) => a + (i.incidentCount || 0), 0) }))
      .filter(s => s._incCount > 0)
      .sort((a, b) => b._incCount - a._incCount)
      .slice(0, 4);

    const instanceBreakdownHtml = topByInstances.length > 0
      ? `<div class="stat-breakdown">${topByInstances.map(s => {
          const name = s.definition?.name || s.definition?.key || s.id.split(':')[0];
          const pct = totalInstances > 0 ? Math.round((s.instances / totalInstances) * 100) : 0;
          return `<div class="stat-bd-row">
            <span class="stat-bd-name" title="${esc(name)}">${esc(name)}</span>
            <span class="stat-bd-bar"><span class="stat-bd-fill blue-bg" style="width:${pct}%"></span></span>
            <span class="stat-bd-val">${s.instances}</span>
          </div>`;
        }).join('')}</div>`
      : '';

    const failedBreakdownHtml = topByFailed.length > 0
      ? `<div class="stat-breakdown">${topByFailed.map(s => {
          const name = s.definition?.name || s.definition?.key || s.id.split(':')[0];
          const pct = totalFailed > 0 ? Math.round((s.failedJobs / totalFailed) * 100) : 0;
          return `<div class="stat-bd-row">
            <span class="stat-bd-name" title="${esc(name)}">${esc(name)}</span>
            <span class="stat-bd-bar"><span class="stat-bd-fill red-bg" style="width:${pct}%"></span></span>
            <span class="stat-bd-val">${s.failedJobs}</span>
          </div>`;
        }).join('')}</div>`
      : '';

    const incidentBreakdownHtml = topByIncidents.length > 0
      ? `<div class="stat-breakdown">${topByIncidents.map(s => {
          const name = s.definition?.name || s.definition?.key || s.id.split(':')[0];
          const pct = totalIncidents > 0 ? Math.round((s._incCount / totalIncidents) * 100) : 0;
          return `<div class="stat-bd-row">
            <span class="stat-bd-name" title="${esc(name)}">${esc(name)}</span>
            <span class="stat-bd-bar"><span class="stat-bd-fill red-bg" style="width:${pct}%"></span></span>
            <span class="stat-bd-val">${s._incCount}</span>
          </div>`;
        }).join('')}</div>`
      : '';

    document.getElementById('health-stats').innerHTML = `
      <div class="stat-card stat-card-clickable" onclick="healthNavigate('activeInstances')">
        <div class="label">Active Instances</div>
        <div class="value blue">${totalInstances}</div>
        <div class="stat-sub">across ${totalDefs} definition${totalDefs !== 1 ? 's' : ''}</div>
        ${instanceBreakdownHtml}
        <div class="stat-action">View all instances →</div>
      </div>
      <div class="stat-card stat-card-clickable" onclick="healthNavigate('failedJobs')">
        <div class="label">Failed Jobs</div>
        <div class="value ${totalFailed > 0 ? 'red' : 'green'}">${totalFailed}</div>
        <div class="stat-sub">${totalFailed > 0
          ? `${failRatePct}% failure rate · ${defsWithFailed} definition${defsWithFailed !== 1 ? 's' : ''} affected`
          : 'All systems normal'}</div>
        ${failedBreakdownHtml}
        <div class="stat-action">${totalFailed > 0 ? 'View failed job incidents →' : ''}</div>
      </div>
      <div class="stat-card stat-card-clickable" onclick="healthNavigate('openIncidents')">
        <div class="label">Open Incidents</div>
        <div class="value ${totalIncidents > 0 ? 'red' : 'green'}">${totalIncidents}</div>
        <div class="stat-sub">${totalIncidents > 0
          ? `${defsWithIncidents} definition${defsWithIncidents !== 1 ? 's' : ''} affected · needs attention`
          : 'No incidents detected'}</div>
        ${incidentBreakdownHtml}
        <div class="stat-action">${totalIncidents > 0 ? 'View all incidents →' : ''}</div>
      </div>
      <div class="stat-card stat-card-grid">
        <div class="label">Waiting &amp; Queued</div>
        <div class="stat-grid">
          <div class="stat-grid-item stat-grid-clickable" onclick="healthNavigate('timers')">
            <span class="stat-grid-val ${timers > 0 ? 'yellow' : ''}">${timers}</span>
            <span class="stat-grid-lbl">⏱ Timers</span>
          </div>
          <div class="stat-grid-item stat-grid-clickable" onclick="healthNavigate('messages')">
            <span class="stat-grid-val ${messages > 0 ? 'blue' : ''}">${messages}</span>
            <span class="stat-grid-lbl">📨 Messages</span>
          </div>
          <div class="stat-grid-item stat-grid-clickable" onclick="healthNavigate('idle')">
            <span class="stat-grid-val ${idle > 0 ? 'yellow' : ''}">${idle}</span>
            <span class="stat-grid-lbl">⏳ Idle &gt;5m</span>
          </div>
          <div class="stat-grid-item stat-grid-clickable" onclick="healthNavigate('suspended')">
            <span class="stat-grid-val ${suspended > 0 ? 'red' : ''}">${suspended}</span>
            <span class="stat-grid-lbl">⏸ Suspended</span>
          </div>
        </div>
      </div>
    `;

    /* ── Old-version instances detection ────────────────────────── */
    let oldVerTotal = 0;
    const oldVerBreakdown = [];
    for (const s of allStats) {
      const key = s.definition?.key;
      if (!key) continue;
      const ver = s.definition?.version ?? 0;
      const latest = latestByKey.get(key);
      if (latest && ver < (latest.definition?.version ?? 0) && s.instances > 0) {
        const inc = (s.incidents || []).reduce((a, i) => a + (i.incidentCount || 0), 0);
        oldVerTotal += s.instances;
        oldVerBreakdown.push({
          key,
          name: s.definition?.name || key,
          defId: s.definition?.id || s.id,
          ver,
          latestVer: latest.definition?.version ?? 0,
          latestDefId: latest.definition?.id || latest.id,
          count: s.instances,
          failed: s.failedJobs || 0,
          incidents: inc,
        });
      }
    }
    oldVerBreakdown.sort((a, b) => b.count - a.count);

    window.__oldVerBreakdown = oldVerBreakdown;

    const oldVerEl = document.getElementById('health-old-version');
    if (oldVerEl) {
      if (oldVerTotal > 0) {
        oldVerEl.style.display = '';
        oldVerEl.innerHTML = `
          <div class="old-ver-banner ${oldVerTotal > 10 ? 'old-ver-critical' : 'old-ver-warn'}">
            <div class="old-ver-icon">⚠️</div>
            <div class="old-ver-info">
              <div class="old-ver-title">
                <span class="old-ver-count">${oldVerTotal}</span>
                instance${oldVerTotal !== 1 ? 's' : ''} running on old BPMN versions
              </div>
              <div class="old-ver-sub">
                ${oldVerBreakdown.length} definition${oldVerBreakdown.length !== 1 ? 's' : ''} affected —
                ${oldVerBreakdown.slice(0, 3).map(b =>
                  `<strong>${b.name}</strong> v${b.ver}→v${b.latestVer} (${b.count})`
                ).join(', ')}${oldVerBreakdown.length > 3 ? ` and ${oldVerBreakdown.length - 3} more…` : ''}
              </div>
            </div>
            <button class="btn btn-sm old-ver-btn" onclick="openMigrationOverlay()">
              Review &amp; Migrate →
            </button>
          </div>
        `;
      } else {
        oldVerEl.style.display = 'none';
        oldVerEl.innerHTML = '';
      }
    }

    const cols = [
      { key: 'id', label: 'Definition', render: r => r.definition?.key || r.id, copyVal: r => r.id },
      { label: 'Name', render: r => r.definition?.name || '—', copyVal: r => r.definition?.name },
      { key: 'instances', label: 'Instances', noCopy: true },
      { key: 'failedJobs', label: 'Failed Jobs', render: r => r.failedJobs > 0 ? `<span class="tag tag-red">${r.failedJobs}</span>` : '0', noCopy: true },
      { label: 'Incidents', render: r => { const c = (r.incidents||[]).reduce((a,i) => a + i.incidentCount, 0); return c > 0 ? `<span class="tag tag-red">${c}</span>` : '0'; }, noCopy: true },
    ];
    document.getElementById('health-table').innerHTML = buildTable(cols, stats);

    updateBadge('incidents', totalIncidents);
    setEngineStatus(true);
  } catch (e) {
    document.getElementById('health-stats').innerHTML = `<div class="error-box">Cannot connect to Camunda engine: ${e.message}</div>`;
    setEngineStatus(false);
  }
}

/* ── Health Card Navigation ────────────────────────────────────── */

export function healthNavigate(action) {
  switch (action) {

    /* ── First 3 cards: cross-panel navigation ──────────────── */

    case 'activeInstances':
      switchPanel('instances');
      setTimeout(() => {
        document.getElementById('pi-filter-state').value = 'active';
        window.loadInstances();
      }, 80);
      break;

    case 'failedJobs':
      switchPanel('incidents');
      setTimeout(() => {
        document.getElementById('inc-filter-type').value = 'failedJob';
        window.loadIncidents();
      }, 80);
      break;

    case 'openIncidents':
      switchPanel('incidents');
      break;

    /* ── Waiting & Queued: drill into Query Explorer ────────── */

    case 'timers':
      drillIntoQueryExplorer(
        'GET',
        '/job?timers=true&sortBy=jobDueDate&sortOrder=asc&maxResults=100',
        'Timer Jobs',
        'Jobs waiting for a scheduled timer to fire. Shows due date, process instance, and retry state.'
      );
      break;

    case 'messages':
      drillIntoQueryExplorer(
        'GET',
        '/event-subscription?eventType=message&sortBy=created&sortOrder=desc&maxResults=100',
        'Message Subscriptions',
        'Instances waiting for an incoming message or signal before they can continue.'
      );
      break;

    case 'idle':
      switchPanel('instances');
      setTimeout(() => {
        document.getElementById('pi-filter-state').value = 'active';
        window.loadInstances();
      }, 80);
      break;

    case 'suspended':
      switchPanel('instances');
      setTimeout(() => {
        document.getElementById('pi-filter-state').value = 'suspended';
        window.loadInstances();
      }, 80);
      break;
  }
}

function drillIntoQueryExplorer(method, path, title, hint) {
  const qeBody = document.getElementById('qe-body');
  if (!qeBody.classList.contains('open')) {
    window.toggleQueryExplorer();
  }

  const qeContainer = document.getElementById('qe-body');
  qeContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('qe-method').value = method;
  const badge = document.getElementById('qe-method-badge');
  badge.textContent = method;
  badge.className = 'qe-method-badge ' + method.toLowerCase();

  document.getElementById('qe-path').value = path;
  document.getElementById('qe-body-input').value = '';

  const selectEl = document.getElementById('qe-query-select');
  if (selectEl) selectEl.value = 'custom';

  const hintEl = document.getElementById('qe-hint');
  hintEl.innerHTML = `<strong>${title}</strong><br>${hint}`;
  hintEl.style.display = 'block';

  document.getElementById('qe-results').style.display = 'none';
  document.getElementById('qe-status').textContent = '';
  window.executeQuery();
}

panelLoaders.health = loadHealth;
