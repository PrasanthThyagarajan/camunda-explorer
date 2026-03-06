import { api, rawApi } from '../api-client.js';
import { esc, shortId, toast } from '../utils.js';
import { refreshCurrentPanel } from '../navigation.js';

let startDialogState = {
  processKey: null,
  formFields: [],
  hasFormFields: false,
};

export function openStartDialog() {
  document.getElementById('start-dialog-overlay').classList.add('visible');
}

export function closeStartDialog() {
  document.getElementById('start-dialog-overlay').classList.remove('visible');
  startDialogState = { processKey: null, formFields: [], hasFormFields: false };
}

function renderFormFields(formFields) {
  if (!formFields || formFields.length === 0) {
    return '<div class="start-no-fields">No form fields defined in the BPMN start event.<br>You can still type variables in the JSON editor below.</div>';
  }

  let html = '<label style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Input Variables</label>';
  html += '<div class="start-fields-grid">';

  formFields.forEach(field => {
    html += '<div class="start-field-card">';
    html += `<div class="field-header">
      <span class="field-name">${esc(field.label)}</span>
      <span class="field-type">${esc(field.type)}</span>
    </div>`;

    if (field.type === 'enum' && field.enumValues.length > 0) {
      html += `<select class="start-input-field" data-field-id="${esc(field.id)}" data-field-type="${esc(field.type)}" onchange="regenerateStartPayload()">`;
      field.enumValues.forEach(ev => {
        const selected = ev.id === field.defaultValue ? 'selected' : '';
        html += `<option value="${esc(ev.id)}" ${selected}>${esc(ev.name)}</option>`;
      });
      html += '</select>';
    } else if (field.type === 'boolean') {
      html += `<select class="start-input-field" data-field-id="${esc(field.id)}" data-field-type="boolean" onchange="regenerateStartPayload()">
        <option value="true" ${field.defaultValue === 'true' ? 'selected' : ''}>true</option>
        <option value="false" ${field.defaultValue !== 'true' ? 'selected' : ''}>false</option>
      </select>`;
    } else {
      const placeholder = field.type === 'long' || field.type === 'integer' ? 'Enter number…'
        : field.type === 'double' ? 'Enter decimal…'
        : field.type === 'date' ? '2026-01-01T00:00:00.000+0000'
        : 'Enter value…';
      html += `<input type="text" class="start-input-field" data-field-id="${esc(field.id)}" data-field-type="${esc(field.type)}"
        placeholder="${placeholder}" value="${esc(field.defaultValue)}" oninput="regenerateStartPayload()" />`;
    }

    html += '</div>';
  });

  html += '</div>';
  return html;
}

export function regenerateStartPayload() {
  const fields = document.querySelectorAll('.start-input-field');
  const payload = {};

  fields.forEach(f => {
    const id = f.dataset.fieldId;
    const type = f.dataset.fieldType;
    let val = f.value;

    let camundaType, castValue;
    switch (type) {
      case 'long':
        castValue = parseInt(val) || 0;
        camundaType = 'Long';
        break;
      case 'integer':
        castValue = parseInt(val) || 0;
        camundaType = 'Integer';
        break;
      case 'double':
        castValue = parseFloat(val) || 0.0;
        camundaType = 'Double';
        break;
      case 'boolean':
        castValue = val === 'true';
        camundaType = 'Boolean';
        break;
      case 'date':
        castValue = val || '2026-01-01T00:00:00.000+0000';
        camundaType = 'Date';
        break;
      case 'enum':
        castValue = val;
        camundaType = 'String';
        break;
      default:
        castValue = val;
        camundaType = 'String';
        break;
    }

    payload[id] = { value: castValue, type: camundaType };
  });

  document.getElementById('start-dialog-payload').value = JSON.stringify(payload, null, 2);
}

export async function promptStartInstance(key) {
  startDialogState.processKey = key;

  document.getElementById('start-dialog-title').textContent = '▶ Start Process Instance';
  document.getElementById('start-dialog-subtitle').textContent = 'Loading form fields…';
  document.getElementById('start-dialog-info').innerHTML = '';
  document.getElementById('start-dialog-fields').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Loading…</div>';
  document.getElementById('start-dialog-payload').value = '{ }';
  document.getElementById('start-dialog-bkey').value = '';
  openStartDialog();

  try {
    const formData = await rawApi(`/actions/start-form/${key}`);
    startDialogState.formFields = formData.formFields || [];
    startDialogState.hasFormFields = formData.hasFormFields;

    document.getElementById('start-dialog-subtitle').textContent = formData.hasFormFields
      ? `${formData.formFields.length} input field(s) detected from the BPMN`
      : 'No form fields defined — enter variables manually below';

    document.getElementById('start-dialog-info').innerHTML = `
      <span class="k">Process Key</span><span class="v">${esc(key)}</span>
      <span class="k">Process Name</span><span class="v">${esc(formData.processDefinitionName || '—')}</span>
    `;

    document.getElementById('start-dialog-fields').innerHTML = renderFormFields(formData.formFields);
    document.getElementById('start-dialog-payload').value = JSON.stringify(formData.samplePayload || {}, null, 2);
  } catch (e) {
    document.getElementById('start-dialog-subtitle').textContent = 'Could not load form fields — enter variables manually';
    document.getElementById('start-dialog-info').innerHTML = `
      <span class="k">Process Key</span><span class="v">${esc(key)}</span>
    `;
    document.getElementById('start-dialog-fields').innerHTML = '';
    document.getElementById('start-dialog-payload').value = '{ }';
  }
}

export async function confirmStartInstance() {
  const key = startDialogState.processKey;
  if (!key) return;

  let variables;
  try {
    variables = JSON.parse(document.getElementById('start-dialog-payload').value || '{}');
  } catch (e) {
    toast('Invalid JSON in variables', 'error');
    return;
  }

  const businessKey = document.getElementById('start-dialog-bkey').value.trim() || undefined;

  closeStartDialog();

  try {
    const body = { variables, withVariablesInReturn: true };
    if (businessKey) body.businessKey = businessKey;

    const res = await api(`/process-definition/key/${key}/start`, {
      method: 'POST',
      body,
    });
    toast(`Instance started: ${shortId(res.id)}`, 'success');
    setTimeout(refreshCurrentPanel, 500);
  } catch (e) {
    toast('Failed to start: ' + e.message, 'error');
  }
}
