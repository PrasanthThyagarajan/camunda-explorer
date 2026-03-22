import { api } from '../api-client.js';
import { esc, shortId, fmtDate, copyBtn, buildTable, toast, fmtDuration, relativeTime } from '../utils.js';
import { panelLoaders } from '../state.js';
import { showHistoryTrack } from '../components/history-track.js';

// ── Definition Key Dropdown ──────────────────────────────────────

let defKeysLoaded = false;

async function populateDefKeyDropdown() {
  if (defKeysLoaded) return;

  const select = document.getElementById('hist-filter-defkey');
  if (!select) return;

  try {
    const data = await api('/history/process-instance?sortBy=startTime&sortOrder=desc&maxResults=500');

    const keys = new Set();
    (data || []).forEach(inst => {
      if (inst.processDefinitionKey) keys.add(inst.processDefinitionKey);
    });

    const sorted = [...keys].sort((a, b) => a.localeCompare(b));

    const currentVal = select.value;

    select.innerHTML = '<option value="">All Definitions</option>';

    sorted.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      select.appendChild(opt);
    });

    if (currentVal && keys.has(currentVal)) {
      select.value = currentVal;
    }

    defKeysLoaded = true;
  } catch { /* noop */ }
}

export function refreshDefKeyDropdown() {
  defKeysLoaded = false;
  populateDefKeyDropdown();
}

// ── History Table ────────────────────────────────────────────────

export async function loadHistory() {
  // Populate dropdown on first load
  populateDefKeyDropdown();

  try {
    const params = new URLSearchParams();
    const pi = document.getElementById('hist-filter-pi').value;
    const st = document.getElementById('hist-filter-state').value;
    const dk = document.getElementById('hist-filter-defkey')?.value;
    const bk = document.getElementById('hist-filter-bizkey')?.value;
    if (pi) params.set('processInstanceId', pi);
    if (st === 'finished') params.set('finished', 'true');
    if (st === 'unfinished') params.set('unfinished', 'true');
    if (dk) params.set('processDefinitionKey', dk);
    if (bk) params.set('businessKeyLike', `%${bk}%`);
    params.set('sortBy', 'startTime');
    params.set('sortOrder', 'desc');
    params.set('maxResults', '100');

    const data = await api('/history/process-instance?' + params);
    const cols = [
      {
        key: 'id', label: 'Instance',
        render: r => `<a class="hist-link" href="#" onclick="event.preventDefault();showHistoryTrack('${esc(r.id)}')" title="Open execution track">${shortId(r.id)}</a>`,
        copyVal: r => r.id
      },
      { key: 'processDefinitionKey', label: 'Definition' },
      { key: 'businessKey', label: 'Business Key', render: r => r.businessKey || '<span class="text-muted">—</span>' },
      { key: 'state', label: 'State', render: r => {
        const map = {
          'COMPLETED': ['tag-green', 'Completed'],
          'ACTIVE': ['tag-blue', 'Active'],
          'SUSPENDED': ['tag-yellow', 'Suspended'],
          'EXTERNALLY_TERMINATED': ['tag-red', 'Terminated'],
          'INTERNALLY_TERMINATED': ['tag-red', 'Terminated'],
        };
        const [cls, label] = map[r.state] || ['tag-gray', r.state || '—'];
        return `<span class="tag ${cls}">${label}</span>`;
      }, noCopy: true },
      { key: 'startTime', label: 'Started', render: r => {
        const abs = fmtDate(r.startTime);
        const rel = relativeTime(r.startTime);
        return `<span title="${abs}">${abs}</span>${rel ? `<span class="hist-rel">${rel}</span>` : ''}`;
      }, noCopy: true },
      { key: 'endTime', label: 'Ended', render: r => r.endTime ? fmtDate(r.endTime) : '<span class="text-muted">running</span>', noCopy: true },
      { key: 'durationInMillis', label: 'Duration', render: r => {
        const d = fmtDuration(r.durationInMillis);
        if (r.durationInMillis && r.durationInMillis > 300000) {
          return `<span class="hist-slow" title="Long-running process">${d}</span>`;
        }
        return d;
      }, noCopy: true },
    ];

    const TRACK_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';

    const actionsCol = (r) => {
      return `<button class="btn btn-xs btn-outline hist-track-btn" onclick="showHistoryTrack('${esc(r.id)}')" title="View execution track">${TRACK_ICON} Track</button>`;
    };

    document.getElementById('history-table').innerHTML = buildTable(cols, data, actionsCol);
  } catch (e) {
    document.getElementById('history-table').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

panelLoaders.history = loadHistory;
