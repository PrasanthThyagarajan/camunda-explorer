import { rawApi } from '../api-client.js';
import { esc, toast } from '../utils.js';
import { state, panelLoaders } from '../state.js';
import { refreshEnvIndicator, refreshCurrentPanel } from '../navigation.js';

export async function loadEnvironments() {
  try {
    const envs = await rawApi('/environments');
    const container = document.getElementById('env-cards');
    if (!envs || envs.length === 0) {
      container.innerHTML = '<div class="empty">No environments configured yet. Add one below.</div>';
      return;
    }
    let html = '';
    for (const env of envs) {
      const isActive = env.isActive;
      html += `
        <div class="env-card ${isActive ? 'active-env' : ''}">
          <div class="env-card-header">
            <div class="env-card-dot" style="background:${env.color}"></div>
            <div class="env-card-name">${esc(env.name)}</div>
            ${isActive ? '<div class="env-card-active">✓ Active</div>' : ''}
          </div>
          <div class="env-card-body">
            <div class="kv"><span class="k">URL</span><span class="v">${esc(env.baseUrl)}</span></div>
            <div class="kv"><span class="k">Auth</span><span class="v">${env.username ? esc(env.username) + ' / ' + (env.hasPassword ? '••••••' : 'no password') : '<span style="color:var(--text3)">None</span>'}</span></div>
          </div>
          <div class="env-card-status">
            <div class="status-indicator unknown" id="env-status-${env.id}"></div>
            <span id="env-status-text-${env.id}">Click Test to check</span>
          </div>
          <div class="env-card-actions">
            ${!isActive ? `<button class="btn btn-success btn-sm" onclick="activateEnv('${env.id}')">⚡ Activate</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="testEnvById('${env.id}')">🔌 Test</button>
            <button class="btn btn-outline btn-sm" onclick="editEnv('${env.id}')">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteEnv('${env.id}', '${esc(env.name)}')">🗑️</button>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;

    for (const env of envs) {
      testEnvById(env.id, true);
    }
  } catch (e) {
    document.getElementById('env-cards').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

export async function saveEnvironment() {
  const editId = document.getElementById('env-edit-id').value;
  const name = document.getElementById('env-name').value.trim();
  const baseUrl = document.getElementById('env-url').value.trim();
  const username = document.getElementById('env-user').value.trim();
  const password = document.getElementById('env-pass').value;
  const color = state.envSelectedColor;

  if (!name) { toast('Please enter an environment name', 'error'); return; }
  if (!baseUrl) { toast('Please enter the Camunda REST API URL', 'error'); return; }

  try {
    if (editId) {
      await rawApi(`/environments/${editId}`, {
        method: 'PUT', body: { name, baseUrl, username, password, color }
      });
      toast(`Environment "${name}" updated`, 'success');
    } else {
      await rawApi('/environments', {
        method: 'POST', body: { name, baseUrl, username, password, color }
      });
      toast(`Environment "${name}" added`, 'success');
    }
    cancelEnvEdit();
    loadEnvironments();
    refreshEnvIndicator();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

export async function activateEnv(id) {
  try {
    const result = await rawApi(`/environments/${id}/activate`, { method: 'PUT' });
    toast(result.message || 'Environment switched', 'success');
    state.procDefNameCache = {};
    state.procDefFilterBuilt = false;
    loadEnvironments();
    await refreshEnvIndicator();
    refreshCurrentPanel();
  } catch (e) {
    toast('Failed to switch: ' + e.message, 'error');
  }
}

export async function deleteEnv(id, name) {
  if (!confirm(`Delete environment "${name}"? This cannot be undone.`)) return;
  try {
    await rawApi(`/environments/${id}`, { method: 'DELETE' });
    toast(`"${name}" deleted`, 'success');
    state.procDefNameCache = {};
    state.procDefFilterBuilt = false;
    loadEnvironments();
    await refreshEnvIndicator();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

export async function editEnv(id) {
  try {
    const envs = await rawApi('/environments');
    const env = envs.find(e => e.id === id);
    if (!env) return;

    document.getElementById('env-edit-id').value = env.id;
    document.getElementById('env-name').value = env.name;
    document.getElementById('env-url').value = env.baseUrl;
    document.getElementById('env-user').value = env.username || '';
    document.getElementById('env-pass').value = '';
    document.getElementById('env-pass').placeholder = env.hasPassword ? 'Leave empty to keep current' : 'Enter password';

    state.envSelectedColor = env.color;
    document.querySelectorAll('.color-opt').forEach(o => {
      o.classList.toggle('selected', o.dataset.color === env.color);
    });

    document.getElementById('env-form-title').textContent = '✏️ Edit Environment: ' + env.name;
    document.getElementById('env-save-btn').textContent = 'Save Changes';
    document.getElementById('env-cancel-btn').style.display = '';

    document.getElementById('env-add-form').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

export function cancelEnvEdit() {
  document.getElementById('env-edit-id').value = '';
  document.getElementById('env-name').value = '';
  document.getElementById('env-url').value = '';
  document.getElementById('env-user').value = '';
  document.getElementById('env-pass').value = '';
  document.getElementById('env-pass').placeholder = 'Leave empty if no auth';
  document.getElementById('env-form-title').textContent = '➕ Add New Environment';
  document.getElementById('env-save-btn').textContent = 'Add Environment';
  document.getElementById('env-cancel-btn').style.display = 'none';
  document.getElementById('env-test-result').innerHTML = '';
  state.envSelectedColor = '#3b82f6';
  document.querySelectorAll('.color-opt').forEach(o => {
    o.classList.toggle('selected', o.dataset.color === '#3b82f6');
  });
}

export function selectEnvColor(el) {
  document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  state.envSelectedColor = el.dataset.color;
}

export async function testEnvConnection() {
  const baseUrl = document.getElementById('env-url').value.trim();
  const username = document.getElementById('env-user').value.trim();
  const password = document.getElementById('env-pass').value;
  if (!baseUrl) { toast('Enter a URL first', 'error'); return; }

  document.getElementById('env-test-result').innerHTML = '<span style="color:var(--text3)">Testing connection…</span>';

  try {
    const result = await rawApi('/environments/test', {
      method: 'POST', body: { baseUrl, username, password }
    });
    if (result.success) {
      const engines = result.engines || [];
      document.getElementById('env-test-result').innerHTML =
        `<span style="color:var(--green)">✅ Connected! Engine(s): ${engines.map(e => e.name || 'default').join(', ')}</span>`;
    } else {
      document.getElementById('env-test-result').innerHTML =
        `<span style="color:var(--red)">❌ Failed: ${esc(result.message)}${result.status ? ' (HTTP ' + result.status + ')' : ''}</span>`;
    }
  } catch (e) {
    document.getElementById('env-test-result').innerHTML =
      `<span style="color:var(--red)">❌ Error: ${esc(e.message)}</span>`;
  }
}

export async function testEnvById(id, silent) {
  const dot = document.getElementById('env-status-' + id);
  const text = document.getElementById('env-status-text-' + id);
  if (!dot || !text) return;

  text.textContent = 'Testing…';
  dot.className = 'status-indicator unknown';

  try {
    const envs = await rawApi('/environments');
    const env = envs.find(e => e.id === id);
    if (!env) return;

    const result = await rawApi('/environments/test', {
      method: 'POST',
      body: { baseUrl: env.baseUrl, username: env.username, password: env.hasPassword ? undefined : '' }
    });

    if (result.success) {
      dot.className = 'status-indicator ok';
      text.textContent = 'Connected';
      text.style.color = 'var(--green)';
    } else {
      dot.className = 'status-indicator err';
      text.textContent = result.message || 'Connection failed';
      text.style.color = 'var(--red)';
    }
  } catch (e) {
    dot.className = 'status-indicator err';
    text.textContent = 'Error';
    text.style.color = 'var(--red)';
  }
}

panelLoaders.environments = loadEnvironments;
