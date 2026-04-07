/**
 * Migration Overlay Module
 *
 * Full-featured overlay for reviewing and migrating process instances
 * that are running on old BPMN versions.
 *
 * Flow:
 *   1. Health panel detects old-version instances and stores breakdown
 *   2. User clicks "Review & Migrate" → opens this overlay
 *   3. Overlay shows per-definition cards with instance details
 *   4. User can expand a definition to see individual instances
 *   5. Migrate all instances for a definition, or select specific ones
 *   6. Confirmation dialog → execute via backend → show results
 */

import { rawApi } from '../api-client.js';
import { esc, shortId, toast, copyBtn } from '../utils.js';

// ── State ────────────────────────────────────────────────────────

let expandedDef = null;           // definition key currently expanded
let instanceData = {};            // cache: defId → instance list
let versionCache = {};            // cache: defKey → version list
let selectedInstances = new Set(); // IDs selected for migration

// ── Open / Close ─────────────────────────────────────────────────

export function openMigrationOverlay() {
  const overlay = document.getElementById('migration-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  renderOverlayContent();
}

export function closeMigrationOverlay() {
  const overlay = document.getElementById('migration-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  expandedDef = null;
  selectedInstances.clear();
}

// ── Refresh overlay with fresh data from the server ─────────────

async function refreshOverlay() {
  try {
    const summary = await rawApi('/migration/old-version/summary');
    // Normalize backend field names so renderOverlayContent() works
    // regardless of data source.
    window.__oldVerBreakdown = (summary.breakdown || []).map(b => ({
      key:         b.key         ?? b.definitionKey,
      name:        b.name        ?? b.definitionName,
      defId:       b.defId       ?? b.definitionId,
      ver:         b.ver         ?? b.currentVersion,
      latestVer:   b.latestVer   ?? b.latestVersion,
      latestDefId: b.latestDefId ?? b.latestDefinitionId,
      count:       b.count       ?? b.instanceCount,
      failed:      b.failed      ?? b.failedJobs ?? 0,
      incidents:   b.incidents   ?? 0,
    }));
  } catch {
    // If fetch fails, keep existing data
  }
  renderOverlayContent();
  // Also refresh the health panel so the dashboard card stays in sync
  window.refreshCurrentPanel();
}

// ── Main Render ──────────────────────────────────────────────────

function renderOverlayContent() {
  const body = document.getElementById('migration-body');
  if (!body) return;

  const breakdown = window.__oldVerBreakdown || [];

  if (breakdown.length === 0) {
    body.innerHTML = `
      <div class="mig-empty">
        <div class="mig-empty-icon">✅</div>
        <div class="mig-empty-title">All Clear</div>
        <div class="mig-empty-sub">Every running instance is on the latest BPMN version.</div>
      </div>
    `;
    return;
  }

  const totalInstances = breakdown.reduce((s, b) => s + b.count, 0);
  const totalStuck = breakdown.reduce((s, b) => s + b.incidents + b.failed, 0);

  let html = `
    <div class="mig-summary">
      <div class="mig-summary-stat">
        <span class="mig-summary-val">${totalInstances}</span>
        <span class="mig-summary-lbl">instances on old versions</span>
      </div>
      <div class="mig-summary-stat">
        <span class="mig-summary-val">${breakdown.length}</span>
        <span class="mig-summary-lbl">definitions affected</span>
      </div>
      <div class="mig-summary-stat">
        <span class="mig-summary-val mig-summary-warn">${totalStuck}</span>
        <span class="mig-summary-lbl">with failures/incidents</span>
      </div>
    </div>
  `;

  html += '<div class="mig-def-list">';
  for (const b of breakdown) {
    const isExpanded = expandedDef === b.defId;
    const hasIssues = b.incidents > 0 || b.failed > 0;
    html += `
      <div class="mig-def-card ${hasIssues ? 'mig-def-issues' : ''}">
        <div class="mig-def-header" onclick="toggleMigrationDef('${b.defId}')">
          <div class="mig-def-info">
            <div class="mig-def-name">${esc(b.name)}</div>
            <div class="mig-def-meta">
              <span class="mig-def-key">${esc(b.key)}</span>
              <span class="mig-ver-badge">v${b.ver}</span>
              <span class="mig-ver-arrow">→</span>
              <span class="mig-ver-badge mig-ver-latest">v${b.latestVer}</span>
            </div>
          </div>
          <div class="mig-def-stats">
            <span class="mig-def-count">${b.count} instance${b.count !== 1 ? 's' : ''}</span>
            ${b.incidents > 0 ? `<span class="tag tag-red">${b.incidents} incidents</span>` : ''}
            ${b.failed > 0 ? `<span class="tag tag-yellow">${b.failed} failed jobs</span>` : ''}
          </div>
          <div class="mig-def-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-primary" onclick="migrateDef('${b.defId}','${b.latestDefId}','${esc(b.name)}',${b.count})">
              Migrate All to v${b.latestVer}
            </button>
            <button class="btn btn-sm btn-outline" onclick="showVersionPicker('${b.key}','${b.defId}','${esc(b.name)}')">
              Pick Version…
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteDefInstances('${b.defId}','${esc(b.name)}',${b.count})">
              Delete All
            </button>
          </div>
          <div class="mig-chevron ${isExpanded ? 'open' : ''}">▶</div>
        </div>
        <div class="mig-def-body" id="mig-body-${b.defId.replace(/[^a-zA-Z0-9]/g, '_')}" style="display:${isExpanded ? 'block' : 'none'}">
          <div class="mig-loading">Loading instances…</div>
        </div>
      </div>
    `;
  }
  html += '</div>';

  body.innerHTML = html;

  // If a definition was expanded, reload its instances
  if (expandedDef) {
    loadDefInstances(expandedDef);
  }
}

// ── Expand/Collapse Definition ───────────────────────────────────

export function toggleMigrationDef(defId) {
  if (expandedDef === defId) {
    expandedDef = null;
    const bodyEl = document.getElementById('mig-body-' + defId.replace(/[^a-zA-Z0-9]/g, '_'));
    if (bodyEl) bodyEl.style.display = 'none';
    const chevron = bodyEl?.parentElement?.querySelector('.mig-chevron');
    if (chevron) chevron.classList.remove('open');
    return;
  }

  // Collapse previous
  if (expandedDef) {
    const prevBody = document.getElementById('mig-body-' + expandedDef.replace(/[^a-zA-Z0-9]/g, '_'));
    if (prevBody) prevBody.style.display = 'none';
    const prevChevron = prevBody?.parentElement?.querySelector('.mig-chevron');
    if (prevChevron) prevChevron.classList.remove('open');
  }

  expandedDef = defId;
  const bodyEl = document.getElementById('mig-body-' + defId.replace(/[^a-zA-Z0-9]/g, '_'));
  if (bodyEl) {
    bodyEl.style.display = 'block';
    bodyEl.innerHTML = '<div class="mig-loading">Loading instances…</div>';
  }
  const chevron = bodyEl?.parentElement?.querySelector('.mig-chevron');
  if (chevron) chevron.classList.add('open');

  loadDefInstances(defId);
}

// ── Load Instances for a Definition ──────────────────────────────

async function loadDefInstances(defId) {
  const bodyEl = document.getElementById('mig-body-' + defId.replace(/[^a-zA-Z0-9]/g, '_'));
  if (!bodyEl) return;

  try {
    const data = await rawApi(`/migration/old-version/instances?definitionId=${encodeURIComponent(defId)}`);
    instanceData[defId] = data.instances || [];
    renderInstanceList(defId);
  } catch (err) {
    bodyEl.innerHTML = `<div class="mig-error">Failed to load instances: ${err.message}</div>`;
  }
}

function renderInstanceList(defId) {
  const bodyEl = document.getElementById('mig-body-' + defId.replace(/[^a-zA-Z0-9]/g, '_'));
  if (!bodyEl) return;

  const instances = instanceData[defId] || [];
  if (instances.length === 0) {
    bodyEl.innerHTML = '<div class="mig-empty-inline">No running instances found.</div>';
    return;
  }

  const stuckCount = instances.filter(i => i.status === 'stuck').length;

  let html = `
    <div class="mig-instance-toolbar">
      <div class="mig-instance-summary">
        ${instances.length} instance${instances.length !== 1 ? 's' : ''}
        ${stuckCount > 0 ? ` · <span class="mig-stuck-badge">${stuckCount} stuck</span>` : ''}
      </div>
      <div class="mig-instance-actions">
        <label class="mig-select-all">
          <input type="checkbox" onchange="toggleMigSelectAll('${defId}', this.checked)" />
          Select all
        </label>
      </div>
    </div>
    <div class="mig-instance-table">
      <div class="mig-inst-header">
        <span class="mig-inst-col-sel"></span>
        <span class="mig-inst-col-id">Instance ID</span>
        <span class="mig-inst-col-activity">Current Activity</span>
        <span class="mig-inst-col-status">Status</span>
        <span class="mig-inst-col-detail">Detail</span>
      </div>
  `;

  for (const inst of instances) {
    const isSelected = selectedInstances.has(inst.processInstanceId);
    const statusClass = inst.status === 'stuck' ? 'mig-status-stuck' : 'mig-status-running';
    const statusIcon = inst.status === 'stuck' ? '🔴' : '🟢';
    html += `
      <div class="mig-inst-row ${isSelected ? 'mig-inst-selected' : ''}">
        <span class="mig-inst-col-sel">
          <input type="checkbox" ${isSelected ? 'checked' : ''}
            onchange="toggleMigSelect('${inst.processInstanceId}', this.checked)" />
        </span>
        <span class="mig-inst-col-id">
          <a href="#" onclick="showInstanceDetail('${inst.processInstanceId}');closeMigrationOverlay();return false">${shortId(inst.processInstanceId)}</a>
          ${copyBtn(inst.processInstanceId)}
        </span>
        <span class="mig-inst-col-activity">${esc(inst.activityName)}</span>
        <span class="mig-inst-col-status">
          <span class="${statusClass}">${statusIcon} ${inst.status}</span>
        </span>
        <span class="mig-inst-col-detail">
          ${inst.stuckReason ? `<span class="mig-stuck-reason">${esc(inst.stuckReason)}</span>` : ''}
          ${inst.incidentCount > 0 ? `<span class="tag tag-red">${inst.incidentCount} inc</span>` : ''}
        </span>
      </div>
    `;
  }

  html += '</div>';

  // Selected actions bar
  html += `
    <div class="mig-selected-bar" id="mig-sel-bar-${defId.replace(/[^a-zA-Z0-9]/g, '_')}" style="display:${selectedInstances.size > 0 ? 'flex' : 'none'}">
      <span class="mig-sel-count">${selectedInstances.size} selected</span>
      <button class="btn btn-sm btn-primary" onclick="migrateSelected('${defId}')">
        Migrate Selected
      </button>
      <button class="btn btn-sm btn-danger" onclick="deleteSelected('${defId}')">
        Delete Selected
      </button>
    </div>
  `;

  bodyEl.innerHTML = html;
}

// ── Selection ────────────────────────────────────────────────────

export function toggleMigSelect(instanceId, checked) {
  if (checked) {
    selectedInstances.add(instanceId);
  } else {
    selectedInstances.delete(instanceId);
  }
  // Update selected bar visibility
  if (expandedDef) {
    const bar = document.getElementById('mig-sel-bar-' + expandedDef.replace(/[^a-zA-Z0-9]/g, '_'));
    if (bar) {
      bar.style.display = selectedInstances.size > 0 ? 'flex' : 'none';
      const countEl = bar.querySelector('.mig-sel-count');
      if (countEl) countEl.textContent = selectedInstances.size + ' selected';
    }
  }
}

export function toggleMigSelectAll(defId, checked) {
  const instances = instanceData[defId] || [];
  selectedInstances.clear();
  if (checked) {
    instances.forEach(i => selectedInstances.add(i.processInstanceId));
  }
  renderInstanceList(defId);
}

// ── Migrate All for a Definition ─────────────────────────────────

export function migrateDef(sourceDefId, targetDefId, defName, count) {
  showMigrationConfirm({
    title: `Migrate "${defName}"`,
    message: `This will migrate <strong>${count} instance${count !== 1 ? 's' : ''}</strong> to the latest BPMN version.`,
    detail: `Source: ${shortId(sourceDefId)}<br>Target: ${shortId(targetDefId)}`,
    onConfirm: () => executeMigration(sourceDefId, targetDefId, null),
  });
}

export function migrateSelected(sourceDefId) {
  if (selectedInstances.size === 0) {
    toast('No instances selected', 'error');
    return;
  }

  const b = (window.__oldVerBreakdown || []).find(x => x.defId === sourceDefId);
  const targetDefId = b?.latestDefId;
  if (!targetDefId) {
    toast('Cannot determine target version', 'error');
    return;
  }

  const ids = [...selectedInstances];
  showMigrationConfirm({
    title: `Migrate ${ids.length} Selected Instance${ids.length !== 1 ? 's' : ''}`,
    message: `This will migrate <strong>${ids.length} instance${ids.length !== 1 ? 's' : ''}</strong> to the latest version.`,
    detail: `Target: ${shortId(targetDefId)}`,
    onConfirm: () => executeMigration(sourceDefId, targetDefId, ids),
  });
}

// ── Delete All for a Definition ───────────────────────────────────

export function deleteDefInstances(sourceDefId, defName, count) {
  showMigrationConfirm({
    title: `Delete "${defName}" Instances`,
    message: `This will <strong>permanently delete ${count} instance${count !== 1 ? 's' : ''}</strong> running on this old version.`,
    detail: `Definition: ${shortId(sourceDefId)}`,
    confirmLabel: 'Delete Now',
    confirmClass: 'btn-danger',
    onConfirm: () => executeDelete(sourceDefId, null),
  });
}

export function deleteSelected(sourceDefId) {
  if (selectedInstances.size === 0) {
    toast('No instances selected', 'error');
    return;
  }

  const ids = [...selectedInstances];
  showMigrationConfirm({
    title: `Delete ${ids.length} Selected Instance${ids.length !== 1 ? 's' : ''}`,
    message: `This will <strong>permanently delete ${ids.length} instance${ids.length !== 1 ? 's' : ''}</strong>.`,
    detail: `This action cannot be undone.`,
    confirmLabel: 'Delete Now',
    confirmClass: 'btn-danger',
    onConfirm: () => executeDelete(sourceDefId, ids),
  });
}

async function executeDelete(sourceDefId, specificInstanceIds) {
  const body = document.getElementById('migration-body');

  if (body) {
    body.insertAdjacentHTML('afterbegin', `
      <div class="mig-progress" id="mig-progress">
        <div class="mig-progress-spinner"></div>
        <div class="mig-progress-text">Deleting instances…</div>
      </div>
    `);
  }

  try {
    let instanceIds = specificInstanceIds;

    if (!instanceIds) {
      const data = await rawApi(`/migration/old-version/instances?definitionId=${encodeURIComponent(sourceDefId)}`);
      instanceIds = (data.instances || []).map(i => i.processInstanceId);
    }

    if (instanceIds.length === 0) {
      toast('No instances to delete', 'error');
      return;
    }

    const result = await rawApi('/migration/delete', {
      method: 'POST',
      body: { processInstanceIds: instanceIds },
    });

    if (result.success) {
      toast(result.message, 'success');
      clearMigrationError();
    } else {
      toast(result.message, 'error');
      if (result.failCount > 0) {
        const failedIds = (result.results || []).filter(r => !r.success);
        showMigrationError(result.message, failedIds);
      }
    }

    // Clear caches and refresh with fresh data
    instanceData = {};
    selectedInstances.clear();
    await refreshOverlay();
  } catch (err) {
    const msg = err.message || 'Unexpected error';
    toast('Delete failed: ' + msg, 'error');
    showMigrationError(msg);
  } finally {
    const progress = document.getElementById('mig-progress');
    if (progress) progress.remove();
  }
}

// ── Version Picker ───────────────────────────────────────────────

const INITIAL_VERSION_LIMIT = 10;

export async function showVersionPicker(defKey, sourceDefId, defName) {
  // Fetch available versions
  if (!versionCache[defKey]) {
    try {
      const data = await rawApi(`/migration/versions/${defKey}`);
      versionCache[defKey] = data.versions || [];
    } catch (err) {
      toast('Failed to load versions: ' + err.message, 'error');
      return;
    }
  }

  renderVersionPicker(defKey, sourceDefId, defName, false);
}

function renderVersionPicker(defKey, sourceDefId, defName, showAll) {
  const allVersions = versionCache[defKey] || [];
  if (allVersions.length === 0) return;

  const overlay = document.getElementById('migration-confirm-overlay');
  if (!overlay) return;

  // Show a limited list initially, with option to expand
  const hasMore = allVersions.length > INITIAL_VERSION_LIMIT;
  const versions = showAll ? allVersions : allVersions.slice(0, INITIAL_VERSION_LIMIT);

  // Ensure the source version is always visible even if outside the limit
  const sourceInList = versions.some(v => v.id === sourceDefId);
  const sourceEntry = allVersions.find(v => v.id === sourceDefId);
  if (!sourceInList && sourceEntry && !showAll) {
    versions.push(sourceEntry);
  }

  let html = `
    <div class="mig-confirm-dialog">
      <div class="mig-confirm-header">
        <h3>Select Target Version</h3>
        <button class="mig-confirm-close" onclick="closeMigrationConfirm()">✕</button>
      </div>
      <div class="mig-confirm-body">
        <p>Migrate <strong>${esc(defName)}</strong> instances to:</p>
        <div class="mig-version-list">
  `;

  for (const v of versions) {
    const isCurrent = v.id === sourceDefId;
    const isLatest = v.version === allVersions[0]?.version;
    html += `
      <div class="mig-version-item ${isCurrent ? 'mig-version-current' : ''}"
           ${!isCurrent ? `onclick="selectMigrationVersion('${sourceDefId}','${v.id}','${esc(defName)}','v${v.version}')"` : ''}>
        <span class="mig-version-num">v${v.version}</span>
        <span class="mig-version-name">${esc(v.name)}</span>
        ${isLatest ? '<span class="tag tag-green">latest</span>' : ''}
        ${isCurrent ? '<span class="tag tag-yellow">current</span>' : ''}
      </div>
    `;
  }

  // "Show all" toggle
  if (hasMore && !showAll) {
    html += `
      <div class="mig-version-item" style="justify-content:center;color:var(--primary);font-size:12px;font-weight:500"
           onclick="expandVersionPicker('${defKey}','${sourceDefId}','${esc(defName)}')">
        Show all ${allVersions.length} versions…
      </div>
    `;
  }

  html += `
        </div>
      </div>
    </div>
  `;

  overlay.innerHTML = html;
  overlay.classList.add('open');
}

export function expandVersionPicker(defKey, sourceDefId, defName) {
  renderVersionPicker(defKey, sourceDefId, defName, true);
}

export function selectMigrationVersion(sourceDefId, targetDefId, defName, targetVer) {
  closeMigrationConfirm();

  const b = (window.__oldVerBreakdown || []).find(x => x.defId === sourceDefId);
  const count = b?.count || 0;

  showMigrationConfirm({
    title: `Migrate "${defName}" to ${targetVer}`,
    message: `This will migrate <strong>${count} instance${count !== 1 ? 's' : ''}</strong> to ${targetVer}.`,
    detail: `Source: ${shortId(sourceDefId)}<br>Target: ${shortId(targetDefId)}`,
    onConfirm: () => executeMigration(sourceDefId, targetDefId, null),
  });
}

// ── Confirmation Dialog ──────────────────────────────────────────

let pendingConfirmAction = null;

function showMigrationConfirm({ title, message, detail, onConfirm, confirmLabel, confirmClass }) {
  pendingConfirmAction = onConfirm;

  const btnLabel = confirmLabel || 'Confirm Migration';
  const btnClass = confirmClass || 'btn-primary';

  const overlay = document.getElementById('migration-confirm-overlay');
  if (!overlay) return;

  const isDanger = btnClass.includes('danger');
  const warnText = isDanger
    ? '⚠️ This action is permanent and cannot be undone.'
    : '⚠️ Migration cannot be undone. Ensure the target BPMN has matching activities.';

  overlay.innerHTML = `
    <div class="mig-confirm-dialog">
      <div class="mig-confirm-header">
        <h3>${title}</h3>
        <button class="mig-confirm-close" onclick="closeMigrationConfirm()">✕</button>
      </div>
      <div class="mig-confirm-body">
        <p>${message}</p>
        <div class="mig-confirm-detail">${detail}</div>
        <div class="mig-confirm-warn">
          ${warnText}
        </div>
      </div>
      <div class="mig-confirm-footer">
        <button class="btn btn-outline" onclick="closeMigrationConfirm()">Cancel</button>
        <button class="btn ${btnClass}" onclick="confirmMigration()">${btnLabel}</button>
      </div>
    </div>
  `;

  overlay.classList.add('open');
}

export function closeMigrationConfirm() {
  const overlay = document.getElementById('migration-confirm-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.innerHTML = '';
  }
  pendingConfirmAction = null;
}

export function confirmMigration() {
  if (pendingConfirmAction) {
    pendingConfirmAction();
  }
  closeMigrationConfirm();
}

// ── Execute Migration ────────────────────────────────────────────

async function executeMigration(sourceDefId, targetDefId, specificInstanceIds) {
  // Show progress
  const body = document.getElementById('migration-body');
  const origHtml = body?.innerHTML || '';

  if (body) {
    body.insertAdjacentHTML('afterbegin', `
      <div class="mig-progress" id="mig-progress">
        <div class="mig-progress-spinner"></div>
        <div class="mig-progress-text">Executing migration…</div>
      </div>
    `);
  }

  try {
    let instanceIds = specificInstanceIds;

    // If no specific IDs, fetch all instances for this definition
    if (!instanceIds) {
      const data = await rawApi(`/migration/old-version/instances?definitionId=${encodeURIComponent(sourceDefId)}`);
      instanceIds = (data.instances || []).map(i => i.processInstanceId);
    }

    if (instanceIds.length === 0) {
      toast('No instances to migrate', 'error');
      return;
    }

    // Use async batch for large sets, sync for small
    const endpoint = instanceIds.length > 50 ? '/migration/execute-async' : '/migration/execute';
    const result = await rawApi(endpoint, {
      method: 'POST',
      body: {
        sourceDefinitionId: sourceDefId,
        targetDefinitionId: targetDefId,
        processInstanceIds: instanceIds,
      },
    });

    if (result.success) {
      toast(result.message, 'success');
      clearMigrationError();

      // Clear caches and refresh with fresh data
      instanceData = {};
      selectedInstances.clear();
      await refreshOverlay();
    } else {
      const msg = result.error || 'Unknown error';
      toast('Migration failed: ' + msg, 'error');
      showMigrationError(msg, result.details);
    }
  } catch (err) {
    const msg = err.message || 'Unexpected error';
    toast('Migration failed: ' + msg, 'error');
    showMigrationError(msg);
  } finally {
    const progress = document.getElementById('mig-progress');
    if (progress) progress.remove();
  }
}

// ── Inline Error Display ──────────────────────────────────────────

function showMigrationError(message, details) {
  clearMigrationError();
  const body = document.getElementById('migration-body');
  if (!body) return;

  let detailHtml = '';
  if (details) {
    const detailStr = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
    detailHtml = `
      <details class="mig-error-details">
        <summary>Show details</summary>
        <pre>${esc(detailStr)}</pre>
      </details>
    `;
  }

  body.insertAdjacentHTML('afterbegin', `
    <div class="mig-error-banner" id="mig-error-banner">
      <div class="mig-error-banner-icon">✕</div>
      <div class="mig-error-banner-content">
        <div class="mig-error-banner-title">Migration Failed</div>
        <div class="mig-error-banner-msg">${esc(message)}</div>
        ${detailHtml}
      </div>
      <button class="mig-error-dismiss" onclick="document.getElementById('mig-error-banner')?.remove()">Dismiss</button>
    </div>
  `);
}

function clearMigrationError() {
  const banner = document.getElementById('mig-error-banner');
  if (banner) banner.remove();
}
