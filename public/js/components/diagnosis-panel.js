import { rawApi } from '../api-client.js';
import { esc, toast, fmtDuration } from '../utils.js';

// ── SVG Icons ───────────────────────────────────────────────────

const DX_ICONS = {
  close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  retry: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  modify: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>`,
  restart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2v6h6"/><path d="M2.66 15.57a10 10 0 1 0 .57-8.38"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  warn: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  block: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  signal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  shield: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  brain: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7a7 7 0 0 0-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
  expand: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  collapse: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
  code: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>`,
  hint: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 5 7v4h4v-4c3-1.5 5-4 5-7a7 7 0 0 0-7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
};

const TYPE_ICONS = {
  retry: DX_ICONS.retry,
  restart: DX_ICONS.restart,
};

// ── State ───────────────────────────────────────────────────────

let currentDiagnosis = null;

// ── Public: Open Diagnosis ──────────────────────────────────────

export async function openDiagnosis(instanceId, incidentId, errorMessage) {
  const overlay = document.getElementById('diagnosis-overlay');
  if (!overlay) return;

  overlay.style.display = 'flex';
  document.getElementById('dx-body').innerHTML = `
    <div class="dx-loading">
      <div class="dx-spinner"></div>
      <div>Analyzing process execution…</div>
      <div class="dx-loading-detail">Reconstructing history • Extracting signals • Computing recovery options</div>
    </div>
  `;

  try {
    const diagnosis = await rawApi('/intelligence/diagnose', {
      method: 'POST',
      body: { instanceId, incidentId: incidentId || '', errorMessage: errorMessage || '' },
    });

    currentDiagnosis = diagnosis;
    renderDiagnosis(diagnosis);
  } catch (err) {
    document.getElementById('dx-body').innerHTML = `
      <div class="dx-fail-state">
        <h4>Diagnosis Failed</h4>
        <p>${esc(err.message)}</p>
        <p style="color:var(--text3);font-size:12px;margin-top:8px">Ensure the process instance exists and the Camunda engine is accessible.</p>
      </div>
    `;
  }
}

export function closeDiagnosis() {
  const overlay = document.getElementById('diagnosis-overlay');
  if (overlay) overlay.style.display = 'none';
  currentDiagnosis = null;
}

// ── Render Full Diagnosis ───────────────────────────────────────

function renderDiagnosis(dx) {
  const body = document.getElementById('dx-body');
  if (!body) return;

  const riskColor = dx.riskScore >= 70 ? 'var(--red)' : dx.riskScore >= 40 ? 'var(--yellow)' : 'var(--green)';
  const riskLabel = dx.riskScore >= 70 ? 'HIGH' : dx.riskScore >= 40 ? 'MEDIUM' : 'LOW';

  const signalCount = dx.signals.length;
  const highSignals = dx.signals.filter(s => s.severity === 'high').length;
  const suggestionCount = dx.suggestions.length;

  const errText = dx.errorMessage || '';
  const isLongError = errText.length > 120;

  body.innerHTML = `
    <!-- Glanceable summary -->
    <div class="dx-glance">
      <div class="dx-glance-info">
        <div class="dx-row">
          <div class="dx-row-label">${DX_ICONS.warn} Failed At</div>
          <div class="dx-fail-name">${esc(dx.failedActivity.name || dx.failedActivity.id)}</div>
        </div>
        <span class="dx-fail-pill">${esc(dx.failedActivity.type)}</span>
        ${errText ? `
          <div class="dx-row" style="margin-top:8px">
            <div class="dx-row-label">${DX_ICONS.warn} Error</div>
            <div class="dx-error${isLongError ? ' dx-error-truncated' : ''}" id="dx-error-main">
              <span class="dx-error-text">${esc(errText)}</span>
            </div>
            ${isLongError ? `<button class="dx-showmore" onclick="toggleDxErrorExpand()">Show more</button>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="dx-risk" style="border-color:${riskColor}">
        <span class="dx-risk-val" style="color:${riskColor}">${dx.riskScore}</span>
        <span class="dx-risk-lbl">${riskLabel}</span>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="dx-quick-actions">
      <button class="btn btn-primary btn-sm dx-quick-btn" onclick="closeDiagnosis();modifyInstanceFromPanel('${esc(dx.instanceId)}')">
        ${DX_ICONS.modify} Modify Instance
      </button>
    </div>

    <!-- Stacktrace Analysis -->
    ${dx.stacktraceAnalysis ? renderStacktraceAccordion(dx.stacktraceAnalysis) : ''}

    <!-- Known Failure Pattern -->
    ${dx.matchingCluster ? renderClusterAccordion(dx.matchingCluster) : ''}

    <!-- Detected Signals -->
    ${signalCount > 0 ? renderSignalsAccordion(dx.signals, signalCount, highSignals) : ''}

    <!-- Recovery Suggestions — open by default -->
    <div class="dx-accordion dx-accordion-open" id="dx-acc-recovery">
      <div class="dx-accordion-header" onclick="toggleDxSection('recovery')">
        <div class="dx-accordion-header-left">
          <span class="dx-accordion-icon">${DX_ICONS.brain}</span>
          <span class="dx-accordion-title">Recommended Actions</span>
          <span class="dx-accordion-badge dx-badge-primary">${suggestionCount}</span>
        </div>
        <span class="dx-accordion-chevron">${DX_ICONS.expand}</span>
      </div>
      <div class="dx-accordion-body">
        <div class="dx-suggestions">
          ${suggestionCount > 0
            ? renderSuggestionsWithHero(dx)
            : '<div class="dx-no-suggestions">No recovery actions available for this failure.</div>'}
        </div>
      </div>
    </div>
  `;
}

// ── Error expand toggle ──────────────────────────────────────────

export function toggleDxErrorExpand() {
  const el = document.getElementById('dx-error-main');
  if (!el) return;
  const isExpanded = el.classList.toggle('dx-error-expanded');
  const btn = el.parentElement?.querySelector('.dx-showmore');
  if (btn) btn.textContent = isExpanded ? 'Show less' : 'Show more';
}

// ── Stacktrace Analysis Render (Accordion) ──────────────────────

const DX_LAYER_LABELS = {
  data_access: 'Data Access',
  external_service: 'External Service',
  business_logic: 'Business Logic',
  worker: 'Worker',
  infrastructure: 'Infrastructure',
  configuration: 'Configuration',
  unknown: 'Unknown',
};

const DX_LAYER_COLORS = {
  data_access: 'var(--red)',
  external_service: 'var(--yellow)',
  business_logic: 'var(--blue)',
  worker: 'var(--text3)',
  infrastructure: 'var(--yellow)',
  configuration: 'var(--red)',
  unknown: 'var(--text3)',
};

function renderStacktraceAccordion(analysis) {
  const layerLabel = DX_LAYER_LABELS[analysis.failureLayer] || 'Unknown';
  const layerColor = DX_LAYER_COLORS[analysis.failureLayer] || 'var(--text3)';
  const natureBadge = analysis.isTransient
    ? '<span class="dx-pill dx-pill-transient">Transient</span>'
    : '<span class="dx-pill dx-pill-persistent">Persistent</span>';

  const rootFrame = analysis.rootCauseFrame;
  const hints = analysis.fixHints || [];
  const frames = analysis.frames || [];

  const subSections = [];

  if (hints.length > 0) {
    subSections.push({
      id: 'st-hints',
      icon: DX_ICONS.hint,
      title: 'Fix Suggestions',
      meta: `${hints.length}`,
      green: true,
      body: `<div class="dx-hints-list">${hints.map(h => `<div class="dx-hint-item">${esc(h)}</div>`).join('')}</div>`,
    });
  }

  if (frames.length > 0) {
    subSections.push({
      id: 'st-frames',
      icon: DX_ICONS.code,
      title: 'Stack Frames',
      meta: `${frames.length}`,
      body: `<div class="dx-frames-list">${frames.slice(0, 10).map(f =>
        `<div class="dx-frame">
          <span class="dx-frame-pkg">${esc(f.package || '')}</span>
          <span class="dx-frame-method">${esc(f.className)}.${esc(f.method)}</span>
          ${f.file ? `<span class="dx-frame-loc">${esc(f.file.split(/[/\\]/).pop())}${f.line ? ':' + f.line : ''}</span>` : ''}
        </div>`
      ).join('')}</div>`,
    });
  }

  const subAccHtml = subSections.length > 0 ? `
    <div class="dx-sub-accordions">
      ${subSections.map(s => `
        <div class="dx-sub-acc" id="dx-sub-${s.id}">
          <div class="dx-sub-acc-header${s.green ? ' dx-sub-acc-header-green' : ''}" onclick="toggleDxSubSection('${s.id}')">
            <span class="dx-sub-acc-icon">${s.icon}</span>
            <span class="dx-sub-acc-title">${s.title}</span>
            ${s.meta ? `<span class="dx-sub-acc-meta">${s.meta}</span>` : ''}
            <span class="dx-sub-acc-chevron">${DX_ICONS.expand}</span>
          </div>
          <div class="dx-sub-acc-body">${s.body}</div>
        </div>
      `).join('')}
    </div>` : '';

  return `
    <div class="dx-accordion dx-accordion-open" id="dx-acc-stacktrace">
      <div class="dx-accordion-header dx-accordion-header-purple" onclick="toggleDxSection('stacktrace')">
        <div class="dx-accordion-header-left">
          <span class="dx-accordion-icon">${DX_ICONS.code}</span>
          <span class="dx-accordion-title">Stacktrace Analysis</span>
          <span class="dx-pill dx-pill-layer" style="color:${layerColor};border-color:${layerColor}">${layerLabel}</span>
          ${natureBadge}
        </div>
        <span class="dx-accordion-chevron">${DX_ICONS.expand}</span>
      </div>
      <div class="dx-accordion-body">
        <div class="dx-st-content">
          <!-- Analysis summary row -->
          <div class="dx-row">
            <div class="dx-row-label">${DX_ICONS.signal} Summary</div>
            <div class="dx-text-block">${esc(analysis.summary)}</div>
          </div>

          <!-- Root cause row -->
          ${rootFrame ? `
          <div class="dx-row">
            <div class="dx-row-label">${DX_ICONS.block} Root Cause</div>
            <div class="dx-root">
              <span class="dx-root-method">${esc(rootFrame.className)}.${esc(rootFrame.method)}</span>
              ${rootFrame.file ? `<span class="dx-root-file">${esc(rootFrame.file.split(/[/\\]/).pop())}${rootFrame.line ? ':' + rootFrame.line : ''}</span>` : ''}
            </div>
          </div>` : ''}

          <!-- Component row -->
          <div class="dx-row dx-row-inline">
            <div class="dx-row-label">${DX_ICONS.shield} Component</div>
            <span class="dx-comp-val">${esc(analysis.failureComponent)}</span>
          </div>

          <!-- Sub-accordions for deeper details -->
          ${subAccHtml}
        </div>
      </div>
    </div>
  `;
}

// ── Cluster Match Render (Accordion) ────────────────────────────

function renderClusterAccordion(cluster) {
  const retryPct = Math.round(cluster.retrySuccessRate * 100);
  const modifyPct = Math.round(cluster.modifySuccessRate * 100);
  const recColor = cluster.suggestedRecovery === 'retry' ? 'var(--green)'
    : cluster.suggestedRecovery === 'modify' ? 'var(--blue)' : 'var(--yellow)';

  const conditions = cluster.conditions || [];
  const condSubAcc = conditions.length > 0 ? `
    <div class="dx-sub-accordions" style="margin-top:8px">
      <div class="dx-sub-acc" id="dx-sub-cl-vars">
        <div class="dx-sub-acc-header" onclick="toggleDxSubSection('cl-vars')">
          <span class="dx-sub-acc-icon">${DX_ICONS.signal}</span>
          <span class="dx-sub-acc-title">Correlated Variables</span>
          <span class="dx-sub-acc-meta">${conditions.length}</span>
          <span class="dx-sub-acc-chevron">${DX_ICONS.expand}</span>
        </div>
        <div class="dx-sub-acc-body">
          <div class="dx-cond-grid">${conditions.map(c =>
            `<div class="dx-cond-row">
              <span class="dx-cond-var">${esc(c.variable)}</span>
              <span class="dx-cond-eq">=</span>
              <span class="dx-cond-val">${esc(c.value)}</span>
              <span class="dx-cond-freq">${Math.round(c.frequency * 100)}%</span>
            </div>`
          ).join('')}</div>
        </div>
      </div>
    </div>` : '';

  return `
    <div class="dx-accordion" id="dx-acc-cluster">
      <div class="dx-accordion-header dx-accordion-header-blue" onclick="toggleDxSection('cluster')">
        <div class="dx-accordion-header-left">
          <span class="dx-accordion-icon">${DX_ICONS.signal}</span>
          <span class="dx-accordion-title">Known Failure Pattern</span>
          <span class="dx-accordion-badge dx-badge-blue">${cluster.occurrenceCount}×</span>
        </div>
        <span class="dx-accordion-chevron">${DX_ICONS.expand}</span>
      </div>
      <div class="dx-accordion-body">
        <div class="dx-cluster-match-inner">
          <div class="dx-text-block" style="margin-bottom:10px">
            Matches a pattern seen <strong>${cluster.occurrenceCount} times</strong> at
            <strong>${esc(cluster.activityName)}</strong>.
          </div>
          <div class="dx-metrics">
            <div class="dx-metric"><span class="dx-metric-v">${retryPct}%</span><span class="dx-metric-l">retry</span></div>
            <span class="dx-metric-sep">·</span>
            <div class="dx-metric"><span class="dx-metric-v">${modifyPct}%</span><span class="dx-metric-l">modify</span></div>
            <div class="dx-metric-rec" style="color:${recColor};border-color:${recColor}">
              ${cluster.suggestedRecovery.toUpperCase()}
            </div>
          </div>
          ${condSubAcc}
        </div>
      </div>
    </div>
  `;
}

// ── Signals Render (Accordion) ──────────────────────────────────

function renderSignalsAccordion(signals, totalCount, highCount) {
  const grouped = {
    high: signals.filter(s => s.severity === 'high'),
    medium: signals.filter(s => s.severity === 'medium'),
    low: signals.filter(s => s.severity === 'low'),
  };

  const renderGroup = (label, list, color) => {
    if (list.length === 0) return '';
    return `
      <div class="dx-sig-group">
        <div class="dx-sig-group-header">
          <span class="dx-sig-dot" style="background:${color}"></span>
          <span class="dx-sig-group-label">${label}</span>
          <span class="dx-sig-group-count">${list.length}</span>
        </div>
        ${list.map(s => `
          <div class="dx-sig" style="border-left-color:${color}">
            <div class="dx-sig-top">
              <span class="dx-sig-type">${esc(s.type.replace(/_/g, ' '))}</span>
              <span class="dx-sig-evidence">
                ${esc(s.evidence.expected)} → ${esc(s.evidence.actual)}${s.evidence.sampleSize > 0 ? ` (n=${s.evidence.sampleSize})` : ''}
              </span>
            </div>
            <div class="dx-sig-desc">${esc(s.description)}</div>
          </div>
        `).join('')}
      </div>
    `;
  };

  const badgeClass = highCount > 0 ? 'dx-badge-red' : 'dx-badge-yellow';

  return `
    <div class="dx-accordion" id="dx-acc-signals">
      <div class="dx-accordion-header dx-accordion-header-signal" onclick="toggleDxSection('signals')">
        <div class="dx-accordion-header-left">
          <span class="dx-accordion-icon">${DX_ICONS.signal}</span>
          <span class="dx-accordion-title">Detected Signals</span>
          <span class="dx-accordion-badge ${badgeClass}">${totalCount}</span>
          ${highCount > 0 ? `<span class="dx-accordion-sub-badge">${highCount} high</span>` : ''}
        </div>
        <span class="dx-accordion-chevron">${DX_ICONS.expand}</span>
      </div>
      <div class="dx-accordion-body">
        <div class="dx-accordion-content">
          ${renderGroup('High Severity', grouped.high, 'var(--red)')}
          ${renderGroup('Medium Severity', grouped.medium, 'var(--yellow)')}
          ${renderGroup('Low Severity', grouped.low, 'var(--text3)')}
        </div>
      </div>
    </div>
  `;
}

// ── Hero + Progressive Disclosure ────────────────────────────────

function renderSuggestionsWithHero(dx) {
  const suggestions = dx.suggestions;
  if (suggestions.length === 0) return '';

  const heroHtml = `
    <div class="dx-hero-suggestion">
      <div class="dx-hero-label">${DX_ICONS.brain} Best Recommendation</div>
      ${renderSuggestion(suggestions[0], 0, dx)}
    </div>
  `;

  if (suggestions.length === 1) return heroHtml;

  const othersHtml = suggestions.slice(1).map((s, i) => renderSuggestion(s, i + 1, dx)).join('');
  return `
    ${heroHtml}
    <div class="dx-more-toggle" id="dx-more-toggle">
      <button class="btn btn-outline btn-sm dx-more-btn" onclick="toggleDxMore()">
        ${DX_ICONS.expand} Show ${suggestions.length - 1} more option${suggestions.length - 1 > 1 ? 's' : ''}
      </button>
    </div>
    <div class="dx-more-options" id="dx-more-options" style="display:none">
      ${othersHtml}
    </div>
  `;
}

// ── Suggestion Render ───────────────────────────────────────────

function renderSuggestion(s, idx, dx) {
  const icon = TYPE_ICONS[s.type] || DX_ICONS.retry;
  const confColor = s.confidence >= 70 ? 'var(--green)' : s.confidence >= 40 ? 'var(--yellow)' : 'var(--red)';
  const riskBadge = s.risk === 'high'
    ? '<span class="dx-risk-tag dx-risk-high">High Risk</span>'
    : s.risk === 'medium'
    ? '<span class="dx-risk-tag dx-risk-medium">Medium Risk</span>'
    : '<span class="dx-risk-tag dx-risk-low">Low Risk</span>';

  const valKey = `${s.type}::${s.targetActivityId}`;
  const validation = dx.validation[valKey];
  const isBlocked = validation && !validation.isValid;

  const validationHtml = validation
    ? validation.findings.map(f => {
        const fIcon = f.severity === 'blocker' ? DX_ICONS.block
          : f.severity === 'warning' ? DX_ICONS.warn
          : DX_ICONS.check;
        return `<div class="dx-val-finding dx-val-${f.severity}">${fIcon} ${esc(f.message)}</div>`;
      }).join('')
    : '';

  return `
    <div class="dx-suggestion ${isBlocked ? 'dx-suggestion-blocked' : ''}" id="dx-suggestion-${idx}">
      <div class="dx-sug-header">
        <div class="dx-sug-icon" style="color:${confColor}">${icon}</div>
        <div class="dx-sug-info">
          <div class="dx-sug-title">${formatType(s.type)}</div>
          <div class="dx-sug-target">→ ${esc(s.targetActivityName)}</div>
        </div>
        <div class="dx-sug-conf">
          <div class="dx-sug-conf-bar">
            <div class="dx-sug-conf-fill" style="width:${s.confidence}%;background:${confColor}"></div>
          </div>
          <span style="color:${confColor};font-weight:700">${s.confidence}%</span>
          <span class="dx-basis-tag dx-basis-${s.confidenceBasis || 'heuristic'}">${(s.confidenceBasis || 'heuristic') === 'historical' ? 'data' : 'estimate'}</span>
        </div>
        ${riskBadge}
      </div>
      <div class="dx-sug-explanation">${esc(s.explanation)}</div>
      ${s.riskFactors.length > 0
        ? `<div class="dx-sug-risks">${s.riskFactors.map(r => `<div class="dx-risk-item">${DX_ICONS.warn} ${esc(r)}</div>`).join('')}</div>`
        : ''}
      ${validationHtml ? `<div class="dx-sug-validation">${DX_ICONS.shield} Safety Checks${validationHtml}</div>` : ''}
      <div class="dx-sug-footer">
        <span class="dx-sug-meta">
          ${s.historicalBasis.sampleSize > 0 ? `Based on ${s.historicalBasis.sampleSize} similar cases` : s.historicalBasis.timeWindow}
          ${s.estimatedDurationMs ? ` • Est. ${fmtMs(s.estimatedDurationMs)}` : ''}
        </span>
        <button class="btn btn-primary btn-sm dx-exec-btn" ${isBlocked ? 'disabled title="Blocked by safety check"' : ''}
          onclick="executeDxRecovery(${idx})">
          ${icon} Execute
        </button>
      </div>
    </div>
  `;
}

// ── Confirmation + Execute Recovery ─────────────────────────────

const COOLDOWN_MS = 30000;
let lastExecKey = '';
let lastExecTs = 0;

export function executeDxRecovery(idx) {
  if (!currentDiagnosis) return;
  const suggestion = currentDiagnosis.suggestions[idx];
  if (!suggestion) return;

  // Cooldown guard
  const execKey = `${currentDiagnosis.instanceId}::${suggestion.type}::${suggestion.targetActivityId}`;
  if (execKey === lastExecKey && Date.now() - lastExecTs < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastExecTs)) / 1000);
    toast(`Cooldown active — wait ${remaining}s before re-executing`, 'info');
    return;
  }

  const valKey = `${suggestion.type}::${suggestion.targetActivityId}`;
  const validation = currentDiagnosis.validation[valKey];
  const warnings = validation ? validation.findings.filter(f => f.severity === 'warning') : [];

  const warningHtml = warnings.length > 0
    ? `<div style="margin-top:10px;padding:8px;border-radius:6px;background:rgba(255,193,7,0.1);border:1px solid var(--yellow)">
        <div style="font-weight:600;color:var(--yellow);margin-bottom:4px">${DX_ICONS.warn} Warnings</div>
        ${warnings.map(w => `<div style="font-size:12px;color:var(--text2);margin-top:4px">• ${esc(w.message)}</div>`).join('')}
      </div>`
    : '';

  const confirmHtml = `
    <div class="dx-confirm-overlay" id="dx-confirm-overlay">
      <div class="dx-confirm-dialog">
        <div style="font-size:16px;font-weight:700;margin-bottom:12px">${DX_ICONS.shield} Confirm Recovery Action</div>
        <div class="dx-confirm-detail">
          <div><strong>Action:</strong> ${formatType(suggestion.type)}</div>
          <div><strong>Target:</strong> ${esc(suggestion.targetActivityName)}</div>
          <div><strong>Instance:</strong> ${esc(currentDiagnosis.instanceId.substring(0, 16))}…</div>
          <div><strong>Confidence:</strong> ${suggestion.confidence}% (${suggestion.confidenceBasis || 'heuristic'})</div>
          <div><strong>Risk:</strong> ${suggestion.risk}</div>
        </div>
        ${warningHtml}
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button class="btn btn-outline btn-sm" onclick="cancelDxConfirm()">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="confirmDxExecute(${idx})">
            ${TYPE_ICONS[suggestion.type] || DX_ICONS.retry} Confirm & Execute
          </button>
        </div>
      </div>
    </div>
  `;

  const body = document.getElementById('dx-body');
  if (body) {
    const div = document.createElement('div');
    div.innerHTML = confirmHtml;
    body.appendChild(div.firstElementChild);
  }
}

export function cancelDxConfirm() {
  const overlay = document.getElementById('dx-confirm-overlay');
  if (overlay) overlay.remove();
}

export async function confirmDxExecute(idx) {
  cancelDxConfirm();

  if (!currentDiagnosis) return;
  const suggestion = currentDiagnosis.suggestions[idx];
  if (!suggestion) return;

  const btn = document.querySelector(`#dx-suggestion-${idx} .dx-exec-btn`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="dx-spinner-sm"></span> Executing…';
  }

  const execKey = `${currentDiagnosis.instanceId}::${suggestion.type}::${suggestion.targetActivityId}`;
  lastExecKey = execKey;
  lastExecTs = Date.now();

  try {
    const result = await rawApi('/intelligence/execute-recovery', {
      method: 'POST',
      body: {
        instanceId: currentDiagnosis.instanceId,
        type: suggestion.type,
        targetActivityId: suggestion.targetActivityId,
        definitionKey: currentDiagnosis.definitionKey || '',
        failedActivityId: currentDiagnosis.failedActivity?.id || '',
        errorMessage: currentDiagnosis.errorMessage || '',
      },
    });

    if (result.success) {
      toast(`Recovery successful: ${result.message}`, 'success');
      if (btn) btn.innerHTML = `${DX_ICONS.check} Done`;
      setTimeout(() => {
        if (window.loadIncidents) window.loadIncidents();
        if (window.loadInstances) window.loadInstances();
      }, 1000);
    } else {
      toast(`Recovery failed: ${result.message}`, 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${TYPE_ICONS[suggestion.type] || DX_ICONS.retry} Execute`;
      }
    }
  } catch (err) {
    toast(`Recovery error: ${err.message}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${TYPE_ICONS[suggestion.type] || DX_ICONS.retry} Execute`;
    }
  }
}

// ── Section Accordion Toggle ─────────────────────────────────────

export function toggleDxSection(sectionId) {
  const accordion = document.getElementById('dx-acc-' + sectionId);
  if (!accordion) return;
  accordion.classList.toggle('dx-accordion-open');
}

export function toggleDxSubSection(sectionId) {
  const el = document.getElementById('dx-sub-' + sectionId);
  if (!el) return;
  el.classList.toggle('dx-sub-acc-open');
}

// ── Progressive Disclosure Toggle ────────────────────────────────

export function toggleDxMore() {
  const moreOptions = document.getElementById('dx-more-options');
  const toggleBtn = document.querySelector('#dx-more-toggle .dx-more-btn');
  if (!moreOptions || !toggleBtn) return;

  const isHidden = moreOptions.style.display === 'none';
  moreOptions.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    toggleBtn.innerHTML = `${DX_ICONS.collapse} Hide additional options`;
  } else {
    const count = moreOptions.querySelectorAll('.dx-suggestion').length;
    toggleBtn.innerHTML = `${DX_ICONS.expand} Show ${count} more option${count > 1 ? 's' : ''}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function formatType(type) {
  switch (type) {
    case 'retry': return 'Retry';
    case 'restart': return 'Restart';
    default: return type;
  }
}

const fmtMs = fmtDuration;
