/**
 * DMN Panel — Presentation layer.
 *
 * SRP: DMN decision search, input form, evaluation, XML view.
 */

import { api, rawApi } from '../api-client.js';
import { esc, copyBtn, toast } from '../utils.js';
import { state, panelLoaders } from '../state.js';

// ── Load Decision List ──────────────────────────────────────────────

export async function loadDmnList() {
  try {
    state.dmnDecisions = await api('/decision-definition?latestVersion=true&sortBy=key&sortOrder=asc') || [];
    document.getElementById('dmn-key').value = '';
    document.getElementById('dmn-search').value = '';
  } catch (e) { toast('Failed to load decisions: ' + e.message, 'error'); }
}

// ── Dropdown Search ─────────────────────────────────────────────────

export function filterDmnList() {
  const query = document.getElementById('dmn-search').value.toLowerCase();
  const dropdown = document.getElementById('dmn-dropdown');
  const filtered = state.dmnDecisions.filter(d =>
    (d.key || '').toLowerCase().includes(query) ||
    (d.name || '').toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:13px;text-align:center">No decisions found</div>';
  } else {
    dropdown.innerHTML = filtered.map(d =>
      `<div class="dmn-dropdown-item" onclick="selectDmn('${esc(d.key)}','${esc(d.name || 'Untitled')}',${d.version})" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;font-size:13px"
        onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
        <div style="font-weight:600">${esc(d.key)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(d.name || 'Untitled')} — v${d.version}</div>
      </div>`
    ).join('');
  }
  dropdown.style.display = '';
}

export function showDmnDropdown() {
  filterDmnList();
}

export function selectDmn(key, name, version) {
  document.getElementById('dmn-key').value = key;
  document.getElementById('dmn-search').value = `${key} — ${name} (v${version})`;
  document.getElementById('dmn-dropdown').style.display = 'none';
  loadDmnDetail();
}

// ── Close dropdown on outside click ─────────────────────────────────
export function initDmnDropdownClose() {
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('dmn-dropdown');
    const search = document.getElementById('dmn-search');
    if (dd && !dd.contains(e.target) && e.target !== search) {
      dd.style.display = 'none';
    }
  });
}

// ── Load DMN Detail ─────────────────────────────────────────────────

async function loadDmnDetail() {
  const key = document.getElementById('dmn-key').value;
  const info = document.getElementById('dmn-info');
  const inputsSection = document.getElementById('dmn-inputs-section');
  const outputsSection = document.getElementById('dmn-outputs-section');

  if (!key) {
    info.style.display = 'none';
    inputsSection.style.display = 'none';
    outputsSection.style.display = 'none';
    state.dmnInputsMeta = [];
    return;
  }

  try {
    const d = await api(`/decision-definition/key/${key}`);
    info.style.display = '';
    document.getElementById('dmn-info-grid').innerHTML = `
      <span class="k">Key</span><span class="v">${d.key}${copyBtn(d.key)}</span>
      <span class="k">Name</span><span class="v">${d.name || '—'}</span>
      <span class="k">Version</span><span class="v">${d.version}</span>
      <span class="k">ID</span><span class="v">${d.id}${copyBtn(d.id)}</span>
      <span class="k">Deployment</span><span class="v">${d.deploymentId}${copyBtn(d.deploymentId)}</span>
      <span class="k">Category</span><span class="v">${d.category || '—'}</span>
    `;

    try {
      const dmnMeta = await rawApi(`/actions/dmn-inputs/${key}`);
      state.dmnInputsMeta = dmnMeta.inputs || [];
      state.dmnGroupedVars = dmnMeta.groupedVariables || {};

      document.getElementById('dmn-hit-policy').textContent = `Hit Policy: ${dmnMeta.hitPolicy}`;

      let fieldsHtml = '';
      for (const [rootVar, group] of Object.entries(state.dmnGroupedVars)) {
        if (group.isNested) {
          fieldsHtml += `<div style="grid-column:1/-1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <span style="font-weight:700;font-size:14px">${esc(rootVar)}</span>
              <span class="tag tag-blue" style="font-size:10px">Object (${group.fields.length} properties)</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">`;
          group.fields.forEach(field => {
            const placeholder = field.camundaType === 'Boolean' ? 'true / false' : 'Enter value…';
            fieldsHtml += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-weight:600;font-size:12px">${esc(field.path)}</span>
                <span class="tag" style="font-size:9px;background:var(--bg)">${esc(field.camundaType)}</span>
              </div>
              <input type="text" class="dmn-input-field" data-root="${esc(rootVar)}" data-prop="${esc(field.path)}" data-type="${esc(field.camundaType)}" data-nested="true"
                placeholder="${placeholder}" value="${esc(String(field.sampleValue))}"
                oninput="regenerateDmnPayload()"
                style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:13px" />
            </div>`;
          });
          fieldsHtml += `</div></div>`;
        } else {
          const field = group.fields[0];
          const placeholder = field.camundaType === 'String' ? 'Enter text…'
            : field.camundaType === 'Boolean' ? 'true / false'
            : field.camundaType === 'Date' ? '2026-01-01T00:00:00.000+0000'
            : 'Enter number…';
          fieldsHtml += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-weight:600;font-size:13px">${esc(rootVar)}</span>
              <span class="tag" style="font-size:10px;background:var(--surface2)">${esc(field.camundaType)}</span>
            </div>
            <input type="text" class="dmn-input-field" data-root="${esc(rootVar)}" data-prop="" data-type="${esc(field.camundaType)}" data-nested="false"
              placeholder="${placeholder}" value="${esc(String(field.sampleValue))}"
              oninput="regenerateDmnPayload()"
              style="width:100%;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px" />
          </div>`;
        }
      }
      document.getElementById('dmn-input-fields').innerHTML = fieldsHtml;

      let outHtml = '';
      (dmnMeta.outputs || []).forEach(out => {
        outHtml += `<span class="tag tag-green" style="font-size:12px">${esc(out.label || out.name)} <span style="opacity:.6">(${esc(out.typeRef)})</span></span>`;
      });
      document.getElementById('dmn-output-tags').innerHTML = outHtml;

      inputsSection.style.display = '';
      outputsSection.style.display = dmnMeta.outputs?.length ? '' : 'none';
      document.getElementById('dmn-variables').value = JSON.stringify(dmnMeta.samplePayload, null, 2);

    } catch (parseErr) {
      console.warn('Could not parse DMN inputs:', parseErr);
      inputsSection.style.display = 'none';
      outputsSection.style.display = 'none';
    }
  } catch (e) {
    info.style.display = 'none';
    inputsSection.style.display = 'none';
    outputsSection.style.display = 'none';
  }
}

// ── Regenerate Payload from Fields ──────────────────────────────────

export function regenerateDmnPayload() {
  const fields = document.querySelectorAll('.dmn-input-field');
  const rootGroups = {};

  fields.forEach(f => {
    const rootVar = f.dataset.root;
    const prop = f.dataset.prop;
    const isNested = f.dataset.nested === 'true';
    const type = f.dataset.type;
    const val = f.value;

    if (isNested) {
      if (!rootGroups[rootVar]) rootGroups[rootVar] = { isNested: true, props: {} };
      rootGroups[rootVar].props[prop] = val;
    } else {
      rootGroups[rootVar] = { isNested: false, value: val, type: type };
    }
  });

  const payload = {};
  for (const [rootVar, group] of Object.entries(rootGroups)) {
    if (group.isNested) {
      payload[rootVar] = { value: group.props };
    } else {
      let val = group.value;
      const type = group.type;
      if (type === 'Integer' || type === 'Long') val = parseInt(val) || 0;
      else if (type === 'Double') val = parseFloat(val) || 0.0;
      else if (type === 'Boolean') val = (val === 'true');
      payload[rootVar] = { value: val, type: type };
    }
  }

  document.getElementById('dmn-variables').value = JSON.stringify(payload, null, 2);
}

// ── Evaluate DMN ────────────────────────────────────────────────────

export async function evaluateDmn() {
  const key = document.getElementById('dmn-key').value;
  if (!key) { toast('Select a decision first', 'error'); return; }
  let payload;
  try {
    payload = JSON.parse(document.getElementById('dmn-variables').value || '{}');
  } catch (e) { toast('Invalid JSON in variables', 'error'); return; }

  let body;
  if (payload.variables && typeof payload.variables === 'object' && !payload.value) {
    body = payload;
  } else {
    body = { variables: payload };
  }

  const resultDiv = document.getElementById('dmn-result');
  resultDiv.innerHTML = `<div class="section-title">⏳ Evaluating…</div>
    <div class="detail-section"><h4>Request Sent</h4>
    <pre class="json">POST /decision-definition/key/${esc(key)}/evaluate\n\n${esc(JSON.stringify(body, null, 2))}</pre></div>`;

  try {
    const result = await rawApi(`/actions/test-dmn-evaluate/${key}`, {
      method: 'POST', body
    });

    if (result.success) {
      const data = result.data;
      const count = Array.isArray(data) ? data.length : 0;
      resultDiv.innerHTML =
        `<div class="section-title" style="color:var(--green)">✅ ${count} Rule(s) Matched</div>
        <div class="detail-section"><h4>Request Sent</h4>
        <pre class="json">POST /decision-definition/key/${esc(key)}/evaluate\n\n${esc(JSON.stringify(body, null, 2))}</pre></div>
        <div class="detail-section"><h4>Response</h4>
        <pre class="json">${esc(JSON.stringify(data, null, 2))}</pre></div>`;
      toast(`DMN evaluated: ${count} rules matched`, 'success');
    } else {
      resultDiv.innerHTML =
        `<div class="section-title" style="color:var(--red)">❌ Evaluation Failed</div>
        <div class="detail-section"><h4>Request Sent</h4>
        <pre class="json">POST /decision-definition/key/${esc(key)}/evaluate\n\n${esc(JSON.stringify(body, null, 2))}</pre></div>
        <div class="detail-section"><h4>Error Response (HTTP ${result.status || '?'})</h4>
        <pre class="json">${esc(JSON.stringify(result.error, null, 2))}</pre></div>`;
    }
  } catch (e) {
    resultDiv.innerHTML =
      `<div class="section-title" style="color:var(--red)">❌ Error</div>
      <div class="detail-section"><h4>Request Sent</h4>
      <pre class="json">POST /decision-definition/key/${esc(key)}/evaluate\n\n${esc(JSON.stringify(body, null, 2))}</pre></div>
      <div class="error-box">${esc(e.message)}</div>`;
  }
}

export async function loadDmnXml() {
  const key = document.getElementById('dmn-key').value;
  if (!key) { toast('Select a decision first', 'error'); return; }
  try {
    const res = await api(`/decision-definition/key/${key}/xml`);
    document.getElementById('dmn-result').innerHTML =
      `<div class="section-title">DMN XML</div><pre class="json">${esc(res.dmnXml || JSON.stringify(res, null, 2))}</pre>`;
  } catch (e) { document.getElementById('dmn-result').innerHTML = `<div class="error-box">${e.message}</div>`; }
}

// Register in panel loader registry
panelLoaders.dmn = loadDmnList;
