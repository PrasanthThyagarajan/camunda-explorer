/**
 * Process Intelligence Panel
 *
 * BPMN-level intelligence view showing:
 *   - Node metrics heatmap (failure rate, duration, hotspots)
 *   - Execution path analysis
 *   - Failure clusters
 *   - Quick drill-down to instance-level diagnosis
 */

import { panelLoaders } from '../state.js';
import { rawApi, api } from '../api-client.js';
import { esc, toast, fmtDuration, relativeTime } from '../utils.js';

// ── State ───────────────────────────────────────────────────────

let currentDefKey = '';
let intelData = null;
let clusterData = null;
let defList = [];
let defIncidentCounts = {};  // { definitionKey: count }

// ── SVG Icons ───────────────────────────────────────────────────

const ICONS = {
  hotspot: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>`,
  healthy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  warning: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  path: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  cluster: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="5" cy="19" r="2"/><line x1="14.5" y1="9.5" x2="17.5" y2="6.5"/><line x1="9.5" y1="9.5" x2="6.5" y2="6.5"/><line x1="14.5" y1="14.5" x2="17.5" y2="17.5"/><line x1="9.5" y1="14.5" x2="6.5" y2="17.5"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  instances: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  brain: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7a7 7 0 0 0-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
  chevDown: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  retry: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  modify: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  escalate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11l-5-5-5 5"/><path d="M17 18l-5-5-5 5"/></svg>`,
  link: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  code: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>`,
};

// ── Helpers ─────────────────────────────────────────────────────

// fmtMs now imported as fmtDuration from shared utils
const fmtMs = fmtDuration;

function pct(val) {
  return Math.round(val * 100) + '%';
}

// relativeTime is now imported from ../utils.js

function severityLevel(count) {
  if (count >= 10) return { label: 'Critical', class: 'severity-critical' };
  if (count >= 5)  return { label: 'High', class: 'severity-high' };
  if (count >= 2)  return { label: 'Medium', class: 'severity-medium' };
  return { label: 'Low', class: 'severity-low' };
}

function shortInstanceId(id) {
  if (!id) return '—';
  return id.substring(0, 8) + '…';
}

function riskColor(rate) {
  if (rate >= 0.15) return 'var(--red)';
  if (rate >= 0.05) return 'var(--yellow)';
  return 'var(--green)';
}

// ── Load Definitions List ─────────────────────────────────────────

async function loadDefList() {
  try {
    const [data, incidents] = await Promise.all([
      api('/process-definition?latestVersion=true&sortBy=name&sortOrder=asc&maxResults=200'),
      api('/incident?maxResults=1000').catch(() => []),
    ]);
    defList = data || [];

    // Count incidents grouped by definition key
    defIncidentCounts = {};
    (incidents || []).forEach(inc => {
      if (inc.processDefinitionId) {
        const key = inc.processDefinitionId.split(':')[0];
        defIncidentCounts[key] = (defIncidentCounts[key] || 0) + 1;
      }
    });
  } catch {
    defList = [];
    defIncidentCounts = {};
  }
}

// ── Main Panel Loader (called by navigation — always shows selector) ──

export async function loadIntelligence() {
  const container = document.getElementById('intel-content');
  if (!container) return;

  // Reset state — navigation always starts fresh at the selector
  currentDefKey = '';
  intelData = null;
  clusterData = null;

  // Refresh definitions list each time
  await loadDefList();
  renderDefSelector(container);
}

// ── Load Detail View for a Definition ────────────────────────────

async function loadDefDetail(key) {
  const container = document.getElementById('intel-content');
  if (!container) return;

  currentDefKey = key;
  container.innerHTML = `<div class="intel-loading">Analyzing <strong>${esc(key)}</strong>… This may take a moment.</div>`;

  try {
    const [intel, clusters, liveActiveCount, liveIncidentCount, liveFailedJobCount] = await Promise.all([
      rawApi(`/intelligence/bpmn/${key}`),
      rawApi(`/intelligence/clusters/${key}`),
      api(`/process-instance/count?processDefinitionKey=${key}&active=true`).catch(() => ({ count: 0 })),
      api(`/incident/count?processDefinitionKey=${key}`).catch(() => ({ count: 0 })),
      api(`/job/count`, { method: 'POST', body: { processDefinitionKey: key, withException: true } }).catch(() => ({ count: 0 })),
    ]);
    intelData = intel;
    clusterData = clusters;
    intelData._liveActive = liveActiveCount?.count ?? 0;
    intelData._liveIncidents = liveIncidentCount?.count ?? 0;
    intelData._liveFailedJobs = liveFailedJobCount?.count ?? 0;
    renderIntelligence(container);
  } catch (err) {
    container.innerHTML = `<div class="intel-error">Failed to load intelligence: ${esc(err.message)}</div>`;
  }
}

// ── Definition Selector ─────────────────────────────────────────

function renderDefSelector(container) {
  const opts = defList.map(d => {
    const incCount = defIncidentCounts[d.key] || 0;
    const cardClass = incCount > 0 ? 'intel-def-card intel-def-card-incident' : 'intel-def-card';

    return `<div class="${cardClass}" onclick="selectIntelDef('${esc(d.key)}')">
      <div class="intel-def-name">${esc(d.name || d.key)}</div>
      <div class="intel-def-key">${esc(d.key)}</div>
      ${incCount > 0 ? `<div class="intel-def-incident">${ICONS.warning} ${incCount} incident${incCount !== 1 ? 's' : ''}</div>` : ''}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="intel-selector">
      <div class="intel-selector-title">Select a Process Definition to Analyze</div>
      <div class="intel-search-wrap">
        ${ICONS.search}
        <input type="text" id="intel-def-search" class="intel-search" placeholder="Search definitions…" oninput="filterIntelDefs()" />
      </div>
      <div class="intel-def-grid" id="intel-def-grid">${opts || '<div class="empty">No definitions found</div>'}</div>
    </div>
  `;
}

export function filterIntelDefs() {
  const q = (document.getElementById('intel-def-search')?.value || '').toLowerCase();
  const cards = document.querySelectorAll('.intel-def-card');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? '' : 'none';
  });
}

export function selectIntelDef(key) {
  loadDefDetail(key);
}

export function clearIntelDef() {
  currentDefKey = '';
  intelData = null;
  clusterData = null;
  // Show selector without re-fetching definitions (already cached)
  const container = document.getElementById('intel-content');
  if (container) renderDefSelector(container);
}

// ── Main Intelligence Render ────────────────────────────────────

function renderIntelligence(container) {
  if (!intelData) return;

  const d = intelData;
  const nodes = d.nodeMetrics || [];
  const hotspots = nodes.filter(n => n.isHotspot);

  const successRate = d.overallFailureRate != null ? (1 - d.overallFailureRate) : 1;

  // Live counts (fetched alongside intelligence data)
  const liveActive = d._liveActive || 0;
  const liveIncidents = d._liveIncidents || 0;
  const liveFailedJobs = d._liveFailedJobs || 0;

  // Health status
  let healthDot = 'idc-health-green';
  let healthText = 'Healthy';
  if (liveIncidents >= 5 || liveFailedJobs >= 5 || d.overallFailureRate >= 0.15) {
    healthDot = 'idc-health-red'; healthText = 'Critical';
  } else if (liveIncidents > 0 || liveFailedJobs > 0 || d.overallFailureRate >= 0.05) {
    healthDot = 'idc-health-yellow'; healthText = 'Warning';
  }

  container.innerHTML = `
    <div class="intel-header-bar">
      <div>
        <h3 class="intel-title">
          <span class="idc-health-dot ${healthDot}" style="display:inline-block;vertical-align:middle;margin-right:8px" title="${healthText}"></span>
          ${esc(d.definitionKey)}
        </h3>
        <span class="intel-meta">${d.sampleSize} instances analyzed · ${nodes.length} activities · ${hotspots.length} hotspot${hotspots.length !== 1 ? 's' : ''}</span>
      </div>
      <button class="btn btn-outline btn-sm" onclick="clearIntelDef()">← Back</button>
    </div>

    <!-- Live Status Row -->
    <div class="intel-live-row">
      <div class="intel-live-card">
        <div class="intel-live-icon" style="color:var(--primary)">▶</div>
        <div class="intel-live-data">
          <span class="intel-live-val">${liveActive}</span>
          <span class="intel-live-lbl">Active Now</span>
        </div>
      </div>
      <div class="intel-live-card${liveIncidents > 0 ? ' intel-live-alert' : ''}">
        <div class="intel-live-icon" style="color:${liveIncidents > 0 ? 'var(--red)' : 'var(--green)'}">⚠</div>
        <div class="intel-live-data">
          <span class="intel-live-val">${liveIncidents}</span>
          <span class="intel-live-lbl">Open Incidents</span>
        </div>
      </div>
      <div class="intel-live-card${liveFailedJobs > 0 ? ' intel-live-alert' : ''}">
        <div class="intel-live-icon" style="color:${liveFailedJobs > 0 ? 'var(--red)' : 'var(--green)'}">✕</div>
        <div class="intel-live-data">
          <span class="intel-live-val">${liveFailedJobs}</span>
          <span class="intel-live-lbl">Failed Jobs</span>
        </div>
      </div>
      <div class="intel-live-card">
        <div class="intel-live-icon" style="color:${riskColor(d.overallFailureRate)}">◉</div>
        <div class="intel-live-data">
          <span class="intel-live-val" style="color:${riskColor(d.overallFailureRate)}">${pct(d.overallFailureRate)}</span>
          <span class="intel-live-lbl">Failure Rate</span>
        </div>
      </div>
      <div class="intel-live-card">
        <div class="intel-live-icon" style="color:var(--green)">✓</div>
        <div class="intel-live-data">
          <span class="intel-live-val" style="color:var(--green)">${pct(successRate)}</span>
          <span class="intel-live-lbl">Success Rate</span>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="intel-tabs" id="intel-tabs">
      <button class="intel-tab active" onclick="switchIntelTab('heatmap')">
        ${ICONS.hotspot} Node Heatmap
      </button>
      <button class="intel-tab" onclick="switchIntelTab('paths')">
        ${ICONS.path} Paths
      </button>
      <button class="intel-tab" onclick="switchIntelTab('clusters')">
        ${ICONS.cluster} Failure Clusters
      </button>
    </div>

    <div class="intel-tab-content" id="intel-tab-content">
      ${renderHeatmapTab()}
    </div>
  `;
}

// ── Tab Switching ───────────────────────────────────────────────

let currentIntelTab = 'heatmap';

export function switchIntelTab(tab) {
  currentIntelTab = tab;
  const content = document.getElementById('intel-tab-content');
  if (!content) return;

  document.querySelectorAll('.intel-tab').forEach((el, i) => {
    el.classList.toggle('active', ['heatmap', 'paths', 'clusters'][i] === tab);
  });

  switch (tab) {
    case 'heatmap':
      content.innerHTML = renderHeatmapTab();
      break;
    case 'paths':
      content.innerHTML = renderPathsTab();
      break;
    case 'clusters':
      content.innerHTML = renderClustersTab();
      break;
  }
}

// ── Heatmap Tab ─────────────────────────────────────────────────

function renderHeatmapTab() {
  if (!intelData) return '';
  const nodes = intelData.nodeMetrics;
  if (nodes.length === 0) return '<div class="empty">No node data available</div>';

  const rows = nodes.map(n => {
    const failColor = riskColor(n.failureRate);
    const hotBadge = n.isHotspot
      ? `<span class="intel-hotspot-badge">${ICONS.hotspot} Hotspot</span>`
      : '';

    return `
      <tr class="intel-node-row ${n.isHotspot ? 'intel-node-hot' : ''}">
        <td>
          <div class="intel-node-name">${esc(n.activityName)}</div>
          <div class="intel-node-type">${esc(n.activityType)}</div>
        </td>
        <td class="intel-center">${n.executionCount}</td>
        <td class="intel-center"><span style="color:${failColor};font-weight:600">${pct(n.failureRate)}</span></td>
        <td class="intel-center">${pct(n.completionRate)}</td>
        <td class="intel-center">${fmtMs(n.avgDurationMs)}</td>
        <td class="intel-center">${fmtMs(n.p95DurationMs)}</td>
        <td>${hotBadge}${n.topErrors.map(e => `<div class="intel-error-tag" title="${esc(e.message)}">${esc(e.message.substring(0, 50))} (${e.count})</div>`).join('')}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="intel-table">
      <thead>
        <tr>
          <th>Activity</th>
          <th class="intel-center">Executions</th>
          <th class="intel-center">Failure %</th>
          <th class="intel-center">Success %</th>
          <th class="intel-center">Avg Duration</th>
          <th class="intel-center">P95</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Paths Tab ───────────────────────────────────────────────────

function renderPathsTab() {
  if (!intelData) return '';
  const paths = intelData.commonPaths || [];
  if (paths.length === 0) return '<div class="empty">No path data available</div>';

  const rows = paths.map((p, idx) => {
    const riskBadge = p.isHighRisk
      ? '<span class="intel-risk-badge">HIGH RISK</span>'
      : '';
    const pathSteps = p.pathDescription.map(s =>
      `<span class="intel-path-step">${esc(s)}</span>`
    ).join('<span class="intel-path-arrow">→</span>');

    return `
      <div class="intel-path-card ${p.isHighRisk ? 'intel-path-risky' : ''}">
        <div class="intel-path-header">
          <span class="intel-path-rank">#${idx + 1}</span>
          <span class="intel-path-freq">${pct(p.frequency)} of instances</span>
          <span class="intel-path-fail" style="color:${riskColor(p.failureRate)}">${pct(p.failureRate)} failure</span>
          <span class="intel-path-dur">${fmtMs(p.avgDurationMs)} avg</span>
          ${riskBadge}
        </div>
        <div class="intel-path-flow">${pathSteps}</div>
      </div>
    `;
  }).join('');

  return `<div class="intel-paths-list">${rows}</div>`;
}

// ── Clusters Tab ────────────────────────────────────────────────
//
// Design: 2-tier progressive disclosure
//   Tier 1 (always visible):  Error → Root Cause → Metrics strip → Recovery
//   Tier 2 (accordion):       Call Chain, Analysis, Actions, Instances

function renderClustersTab() {
  if (!clusterData) return '<div class="empty">No cluster data available</div>';
  const clusters = clusterData.clusters;
  if (clusters.length === 0) return '<div class="empty">No failure patterns detected</div>';

  const totalInstances = clusters.reduce((s, c) => s + (c.affectedInstanceCount || 0), 0);

  const cards = clusters.map((c, idx) => {
    const sev = severityLevel(c.occurrenceCount);
    const a = c.stacktraceAnalysis || null;
    const retryPct = Math.round(c.retrySuccessRate * 100);
    const modifyPct = Math.round(c.modifySuccessRate * 100);
    const recColor = c.suggestedRecovery === 'retry' ? 'var(--green)'
      : c.suggestedRecovery === 'modify' ? 'var(--blue)' : 'var(--yellow)';
    const recIcon = c.suggestedRecovery === 'retry' ? ICONS.retry
      : c.suggestedRecovery === 'modify' ? ICONS.modify : ICONS.escalate;

    const instanceIds = c.affectedInstanceIds || [];
    const rootFrame = a?.rootCauseFrame;
    const hints = a?.fixHints || [];
    const conditions = c.conditions || [];
    const errorText = c.rawErrorSample || c.normalizedError || '';
    const isLongError = errorText.length > 120;

    // Layer + nature badges for header
    const layerBadge = a ? `<span class="cl-pill cl-pill-layer" style="color:${LAYER_COLORS[a.failureLayer] || 'var(--text3)'};border-color:${LAYER_COLORS[a.failureLayer] || 'var(--text3)'}">${LAYER_LABELS[a.failureLayer] || 'Unknown'}</span>` : '';
    const natureBadge = a
      ? (a.isTransient ? `<span class="cl-pill cl-pill-transient">Transient</span>` : `<span class="cl-pill cl-pill-persistent">Persistent</span>`)
      : '';

    // Collect accordion sections dynamically (only render non-empty ones)
    const accSections = [];

    if (a?.summary) {
      accSections.push({
        id: `analysis-${idx}`,
        icon: ICONS_SM.info,
        title: 'Analysis',
        meta: '',
        body: `<div class="cl-acc-text">${esc(a.summary)}</div>`,
      });
    }

    if (hints.length > 0) {
      accSections.push({
        id: `actions-${idx}`,
        icon: ICONS_SM.bulb,
        title: 'Suggested Actions',
        meta: `${hints.length}`,
        body: `<div class="cl-hints-list">${hints.map(h => `<div class="cl-hint-item">${esc(h)}</div>`).join('')}</div>`,
        green: true,
      });
    }

    if (instanceIds.length > 0) {
      const links = instanceIds.map(id =>
        `<a href="#" class="cl-instance-link" onclick="showInstanceDetail('${id}');return false" title="${id}">${shortInstanceId(id)}</a>`
      ).join('');
      const more = (c.affectedInstanceCount || 0) > instanceIds.length
        ? `<span class="cl-instance-more">+${(c.affectedInstanceCount || 0) - instanceIds.length} more</span>` : '';
      accSections.push({
        id: `instances-${idx}`,
        icon: ICONS_SM.grid,
        title: 'Affected Instances',
        meta: `${c.affectedInstanceCount || instanceIds.length}`,
        body: `<div class="cl-instances-list">${links}${more}</div>`,
      });
    }

    if (conditions.length > 0) {
      accSections.push({
        id: `vars-${idx}`,
        icon: ICONS_SM.crosshair,
        title: 'Correlated Variables',
        meta: `${conditions.length}`,
        body: `<div class="cl-conditions-grid">${conditions.map(cond =>
      `<div class="cl-condition-row">
        <span class="cl-condition-var">${esc(cond.variable)}</span>
        <span class="cl-condition-eq">=</span>
        <span class="cl-condition-val">${esc(cond.value)}</span>
        <span class="cl-condition-freq">${pct(cond.frequency)}</span>
      </div>`
        ).join('')}</div>`,
      });
    }

    const accordionHtml = accSections.length > 0 ? `
      <div class="cl-accordions">
        ${accSections.map(s => `
          <div class="cl-acc" id="cl-acc-${s.id}">
            <div class="cl-acc-header${s.green ? ' cl-acc-header-green' : ''}" onclick="toggleClAccordion('${s.id}')">
              <span class="cl-acc-icon">${s.icon}</span>
              <span class="cl-acc-title">${s.title}</span>
              ${s.meta ? `<span class="cl-acc-meta">${s.meta}</span>` : ''}
              <span class="cl-acc-chevron">${ICONS.chevDown}</span>
            </div>
            <div class="cl-acc-body">${s.body}</div>
          </div>
        `).join('')}
      </div>` : '';

    return `
      <div class="cl-card cl-card-${sev.class}" id="cl-card-${idx}">

        <!-- Header -->
        <div class="cl-card-header">
          <div class="cl-header-left">
            <span class="cl-sev ${sev.class}">${sev.label}</span>
            <span class="cl-name">${esc(c.activityName)}</span>
            ${layerBadge}${natureBadge}
          </div>
          <span class="cl-count">${c.occurrenceCount}×</span>
        </div>

        <!-- Tier 1: Glanceable content -->
        <div class="cl-glance">

          <!-- Error -->
          <div class="cl-row">
            <div class="cl-row-label">${ICONS_SM.alert} Error</div>
            <div class="cl-error${isLongError ? ' cl-error-truncated' : ''}" id="cl-error-${idx}">
              <span class="cl-error-text">${esc(errorText)}</span>
          </div>
            ${isLongError ? `<button class="cl-showmore" onclick="toggleClErrorExpand(${idx})">Show more</button>` : ''}
        </div>

          <!-- Root Cause -->
          ${rootFrame ? `
          <div class="cl-row">
            <div class="cl-row-label">${ICONS_SM.crosshair} Root Cause</div>
            <div class="cl-root">
              <span class="cl-root-method">${esc(rootFrame.className)}.${esc(rootFrame.method)}</span>
              ${rootFrame.file ? `<span class="cl-root-file">${esc(rootFrame.file.split(/[/\\]/).pop())}${rootFrame.line ? ':' + rootFrame.line : ''}</span>` : ''}
          </div>
          </div>` : ''}

          <!-- Metrics Strip -->
          <div class="cl-metrics">
            <div class="cl-metric"><span class="cl-metric-v">${c.affectedInstanceCount || c.occurrenceCount}</span><span class="cl-metric-l">instances</span></div>
            <span class="cl-metric-sep">·</span>
            <div class="cl-metric"><span class="cl-metric-v">${relativeTime(c.firstSeen)}</span><span class="cl-metric-l">first</span></div>
            <span class="cl-metric-sep">–</span>
            <div class="cl-metric"><span class="cl-metric-v">${relativeTime(c.lastSeen)}</span><span class="cl-metric-l">last</span></div>
            <span class="cl-metric-sep">·</span>
            <div class="cl-metric"><span class="cl-metric-v">${retryPct}%</span><span class="cl-metric-l">retry</span></div>
            <span class="cl-metric-sep">·</span>
            <div class="cl-metric"><span class="cl-metric-v">${modifyPct}%</span><span class="cl-metric-l">modify</span></div>
            <div class="cl-metric-rec" style="color:${recColor};border-color:${recColor}">
              ${recIcon} ${c.suggestedRecovery.toUpperCase()}
          </div>
          </div>
        </div>

        <!-- Tier 2: Accordion sections -->
        ${accordionHtml}

        <!-- Actions -->
        <div class="cl-actions">
          ${c.rawStacktraceSample ? `
          <button class="cl-btn cl-btn-primary" onclick="openStacktraceViewer(${idx})">
            ${ICONS.code} <span>View Stacktrace</span>
          </button>` : ''}
          ${instanceIds.length > 0 ? `
          <button class="cl-btn cl-btn-warn" onclick="openDiagnosis('${instanceIds[0]}')">
            ${ICONS.brain} <span>Diagnose</span>
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="cl-summary-bar">
      <div class="cl-summary-stat">${ICONS.warning} <strong>${clusterData.totalIncidentsAnalyzed}</strong> incidents analyzed</div>
      <div class="cl-summary-stat">${ICONS.cluster} <strong>${clusters.length}</strong> failure pattern${clusters.length > 1 ? 's' : ''} detected</div>
      <div class="cl-summary-stat">${ICONS.instances} <strong>${totalInstances}</strong> instance${totalInstances > 1 ? 's' : ''} affected</div>
    </div>
    <div class="cl-cards-grid">${cards}</div>
  `;
}

// ── Accordion toggle (class-based, no IDs needed for body) ──────

export function toggleClAccordion(sectionId) {
  const acc = document.getElementById('cl-acc-' + sectionId);
  if (!acc) return;
  acc.classList.toggle('cl-acc-open');
}

export function toggleClErrorExpand(idx) {
  const el = document.getElementById('cl-error-' + idx);
  if (!el) return;
  const isExpanded = el.classList.toggle('cl-error-expanded');
  const btn = el.parentElement?.querySelector('.cl-showmore');
  if (btn) btn.textContent = isExpanded ? 'Show less' : 'Show more';
}

// Keep legacy name for anything that still calls it
export function toggleClusterDetail(idx) { /* no-op, replaced by accordions */ }

// ── Stacktrace Viewer Modal ──────────────────────────────────────

let currentStacktraceText = '';

export function openStacktraceViewer(clusterIdx) {
  if (!clusterData || !clusterData.clusters[clusterIdx]) return;
  const cluster = clusterData.clusters[clusterIdx];
  const overlay = document.getElementById('stacktrace-overlay');
  if (!overlay) return;

  const title = document.getElementById('st-viewer-title');
  const body = document.getElementById('st-viewer-body');
  const copyBtn = document.getElementById('st-copy-btn');

  currentStacktraceText = cluster.rawStacktraceSample || '';

  if (title) title.textContent = `Stacktrace — ${cluster.activityName || cluster.activityId}`;
  if (body) body.textContent = currentStacktraceText || 'No stacktrace available.';
  if (copyBtn) {
    const span = copyBtn.querySelector('span');
    if (span) span.textContent = 'Copy';
  }

  overlay.style.display = 'flex';
}

export function closeStacktraceViewer() {
  const overlay = document.getElementById('stacktrace-overlay');
  if (overlay) overlay.style.display = 'none';
  currentStacktraceText = '';
}

export function copyStacktraceToClipboard() {
  if (!currentStacktraceText) return;
  navigator.clipboard.writeText(currentStacktraceText).then(() => {
    const copyBtn = document.getElementById('st-copy-btn');
    if (copyBtn) {
      const span = copyBtn.querySelector('span');
      if (span) {
        span.textContent = 'Copied!';
        setTimeout(() => { span.textContent = 'Copy'; }, 2000);
      }
    }
    toast('Stacktrace copied to clipboard');
  }).catch(() => {
    toast('Failed to copy — please select and copy manually', 'error');
  });
}

// ── Cluster Analysis Helpers ─────────────────────────────────────

const LAYER_LABELS = {
  data_access: 'Data Access',
  external_service: 'External Service',
  business_logic: 'Business Logic',
  worker: 'Worker',
  infrastructure: 'Infrastructure',
  configuration: 'Configuration',
  unknown: 'Unknown',
};

const LAYER_COLORS = {
  data_access: 'var(--red)',
  external_service: 'var(--yellow)',
  business_logic: 'var(--blue)',
  worker: 'var(--text3)',
  infrastructure: 'var(--yellow)',
  configuration: 'var(--red)',
  unknown: 'var(--text3)',
};

// Compact 12px icons used inside cluster card sections
const ICONS_SM = {
  crosshair: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
  info: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  bulb: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7a7 7 0 0 0-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
  grid: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  alert: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  chevRight: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
};

// ── Cluster Stacktrace Loading ──────────────────────────────────

const clusterStacktraceCache = {};

export async function loadClusterStacktrace(clusterIdx) {
  if (!clusterData || !clusterData.clusters[clusterIdx]) return;
  const cluster = clusterData.clusters[clusterIdx];
  const container = document.getElementById(`cl-stacktrace-${clusterIdx}`);
  if (!container) return;

  const instanceIds = cluster.affectedInstanceIds || [];
  if (instanceIds.length === 0) {
    container.innerHTML = '<div class="cl-stacktrace-empty">No instances available to fetch stacktrace.</div>';
    return;
  }

  // Check cache first
  const cacheKey = cluster.clusterId;
  if (clusterStacktraceCache[cacheKey]) {
    container.innerHTML = clusterStacktraceCache[cacheKey];
    return;
  }

  // Show loading state
  container.innerHTML = `
    <div class="cl-stacktrace-loading">
      <div class="dx-spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto 8px"></div>
      <span>Fetching stacktrace from ${instanceIds.length > 1 ? instanceIds.length + ' instances' : '1 instance'}…</span>
    </div>
  `;

  try {
    // Fetch stacktraces for all affected instances (backend resolves them)
    const results = await Promise.all(
      instanceIds.slice(0, 5).map(id =>
        rawApi(`/intelligence/stacktrace/${id}`).catch(() => ({ instanceId: id, traces: [] }))
      )
    );

    // Merge all traces and deduplicate by stacktrace content
    const allTraces = [];
    const seenTraces = new Set();

    for (const result of results) {
      for (const trace of (result.traces || [])) {
        if (!trace.stacktrace) continue;
        // Use first 200 chars as dedup key to avoid near-duplicates
        const dedup = trace.stacktrace.substring(0, 200);
        if (seenTraces.has(dedup)) continue;
        seenTraces.add(dedup);
        allTraces.push({ ...trace, instanceId: result.instanceId });
      }
    }

    if (allTraces.length === 0) {
      const html = '<div class="cl-stacktrace-empty">No stacktrace available for this failure pattern.</div>';
      clusterStacktraceCache[cacheKey] = html;
      container.innerHTML = html;
      return;
    }

    // Render stacktrace cards
    const traceHtml = allTraces.map((t, i) => {
      const shortId = (t.instanceId || '').substring(0, 8);
      const typeTag = t.incidentType === 'failedExternalTask'
        ? '<span class="cl-st-type-tag cl-st-type-ext">External Task</span>'
        : '<span class="cl-st-type-tag cl-st-type-job">Job</span>';

      return `
        <div class="cl-stacktrace-card">
          <div class="cl-stacktrace-card-header" onclick="toggleClusterStacktraceItem(${clusterIdx}, ${i})">
            <div class="cl-stacktrace-card-left">
              ${ICONS.code}
              <span class="cl-st-instance-label">${shortId}…</span>
              ${typeTag}
              <span class="cl-st-activity">${esc(t.activityId)}</span>
            </div>
            <span class="cl-stacktrace-chevron" id="cl-st-chevron-${clusterIdx}-${i}">${ICONS.chevDown}</span>
          </div>
          ${t.message ? `<div class="cl-st-message">${esc(t.message.substring(0, 150))}</div>` : ''}
          <pre class="cl-stacktrace-pre" id="cl-st-body-${clusterIdx}-${i}" style="display:none">${esc(t.stacktrace)}</pre>
        </div>
      `;
    }).join('');

    const html = `
      <div class="cl-stacktrace-results">
        <div class="cl-stacktrace-summary">
          ${ICONS.code} <strong>${allTraces.length}</strong> unique stacktrace${allTraces.length > 1 ? 's' : ''} found
          across ${instanceIds.length} instance${instanceIds.length > 1 ? 's' : ''}
        </div>
        ${traceHtml}
      </div>
    `;

    clusterStacktraceCache[cacheKey] = html;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="cl-stacktrace-empty error">Failed to load stacktrace: ${esc(err.message)}</div>`;
  }
}

export function toggleClusterStacktraceItem(clusterIdx, traceIdx) {
  const body = document.getElementById(`cl-st-body-${clusterIdx}-${traceIdx}`);
  const chevron = document.getElementById(`cl-st-chevron-${clusterIdx}-${traceIdx}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// ── Register panel loader ────────────────────────────────────────

panelLoaders.intelligence = loadIntelligence;
