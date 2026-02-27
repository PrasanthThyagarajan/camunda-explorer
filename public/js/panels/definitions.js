/**
 * Process Definitions Panel — Presentation layer.
 *
 * SRP: Listing definitions, viewing BPMN XML, starting instances.
 */

import { api } from '../api-client.js';
import { esc, shortId, buildTable, toast } from '../utils.js';
import { panelLoaders } from '../state.js';
import { openDetail } from '../detail-panel.js';

export async function loadDefinitions() {
  try {
    const data = await api('/process-definition?latestVersion=true&sortBy=key&sortOrder=asc&maxResults=200');
    const cols = [
      { key: 'key', label: 'Key' },
      { key: 'name', label: 'Name' },
      { key: 'version', label: 'Version', noCopy: true },
      { key: 'suspended', label: 'State', render: r => r.suspended ? '<span class="tag tag-yellow">Suspended</span>' : '<span class="tag tag-green">Active</span>', noCopy: true },
      { key: 'deploymentId', label: 'Deployment', render: r => shortId(r.deploymentId), copyVal: r => r.deploymentId },
    ];
    const actions = r => `
      <button class="btn btn-outline btn-sm" onclick="showBpmnXml('${r.id}')">XML</button>
      <button class="btn btn-primary btn-sm" onclick="promptStartInstance('${r.key}')">▶ Start</button>
    `;
    document.getElementById('definitions-table').innerHTML = buildTable(cols, data, actions);
  } catch (e) { document.getElementById('definitions-table').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

export async function showBpmnXml(defId) {
  try {
    const res = await api(`/process-definition/${defId}/xml`);
    openDetail('BPMN XML', `<pre class="json">${esc(res.bpmn20Xml)}</pre>`);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export async function promptStartInstance(key) {
  const vars = prompt('Variables JSON (or leave empty):', '{}');
  if (vars === null) return;
  try {
    const variables = JSON.parse(vars || '{}');
    const res = await api(`/process-definition/key/${key}/start`, {
      method: 'POST', body: { variables, withVariablesInReturn: true }
    });
    toast(`Instance started: ${res.id}`, 'success');
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

panelLoaders.definitions = loadDefinitions;
