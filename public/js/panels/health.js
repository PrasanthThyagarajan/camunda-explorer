import { api } from '../api-client.js';
import { buildTable } from '../utils.js';
import { panelLoaders } from '../state.js';
import { updateBadge, setEngineStatus } from '../navigation.js';

export async function loadHealth() {
  try {
    const stats = await api('/process-definition/statistics?failedJobs=true&incidents=true');
    let totalInstances = 0, totalFailed = 0, totalIncidents = 0;
    stats.forEach(s => {
      totalInstances += s.instances || 0;
      totalFailed += s.failedJobs || 0;
      (s.incidents || []).forEach(i => totalIncidents += i.incidentCount || 0);
    });

    document.getElementById('health-stats').innerHTML = `
      <div class="stat-card"><div class="label">Running Instances</div><div class="value blue">${totalInstances}</div></div>
      <div class="stat-card"><div class="label">Failed Jobs</div><div class="value ${totalFailed > 0 ? 'red' : 'green'}">${totalFailed}</div></div>
      <div class="stat-card"><div class="label">Open Incidents</div><div class="value ${totalIncidents > 0 ? 'red' : 'green'}">${totalIncidents}</div></div>
      <div class="stat-card"><div class="label">Process Definitions</div><div class="value">${stats.length}</div></div>
    `;

    const cols = [
      { key: 'id', label: 'Definition', render: r => r.definition?.key || r.id, copyVal: r => r.id },
      { label: 'Name', render: r => r.definition?.name || '—', copyVal: r => r.definition?.name },
      { key: 'instances', label: 'Instances', noCopy: true },
      { key: 'failedJobs', label: 'Failed Jobs', render: r => r.failedJobs > 0 ? `<span class="tag tag-red">${r.failedJobs}</span>` : '0', noCopy: true },
      { label: 'Incidents', render: r => { const c = (r.incidents||[]).reduce((a,i) => a + i.incidentCount, 0); return c > 0 ? `<span class="tag tag-red">${c}</span>` : '0'; }, noCopy: true },
    ];
    document.getElementById('health-table').innerHTML = buildTable(cols, stats);

    updateBadge('incidents', totalIncidents);
    updateBadge('jobs', totalFailed);
    setEngineStatus(true);
  } catch (e) {
    document.getElementById('health-stats').innerHTML = `<div class="error-box">Cannot connect to Camunda engine: ${e.message}</div>`;
    setEngineStatus(false);
  }
}

panelLoaders.health = loadHealth;
