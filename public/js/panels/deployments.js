/**
 * Deployments Panel — Presentation layer.
 *
 * SRP: Listing deployments and viewing resources.
 */

import { api } from '../api-client.js';
import { esc, shortId, fmtDate, buildTable, toast } from '../utils.js';
import { panelLoaders } from '../state.js';
import { openDetail } from '../detail-panel.js';

export async function loadDeployments() {
  try {
    const data = await api('/deployment?sortBy=deploymentTime&sortOrder=desc&maxResults=100');
    const cols = [
      { key: 'id', label: 'ID', render: r => shortId(r.id), copyVal: r => r.id },
      { key: 'name', label: 'Name' },
      { key: 'deploymentTime', label: 'Deployed', render: r => fmtDate(r.deploymentTime), noCopy: true },
      { key: 'source', label: 'Source' },
    ];
    const actions = r => `<button class="btn btn-outline btn-sm" onclick="showDeploymentResources('${r.id}')">Resources</button>`;
    document.getElementById('deployments-table').innerHTML = buildTable(cols, data, actions);
  } catch (e) { document.getElementById('deployments-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

export async function showDeploymentResources(id) {
  try {
    const res = await api(`/deployment/${id}/resources`);
    openDetail('Deployment Resources', `<pre class="json">${esc(JSON.stringify(res, null, 2))}</pre>`);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

panelLoaders.deployments = loadDeployments;
