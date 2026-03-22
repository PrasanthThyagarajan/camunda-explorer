export function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function shortId(id) {
  return id ? (id.length > 16 ? id.substring(0, 14) + '…' : id) : '—';
}

export function shortMsg(s, max) {
  if (!s) return '—';
  return s.length > max ? s.substring(0, max) + '…' : s;
}

export function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : '—';
}

const TOAST_DURATION = 4000;

export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), TOAST_DURATION);
}

const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export function copyVal(btn, value) {
  const onSuccess = () => {
    btn.classList.add('copied');
    btn.innerHTML = CHECK_ICON;
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = COPY_ICON; }, 1200);
  };

  navigator.clipboard.writeText(value).then(onSuccess).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onSuccess();
  });
}

export function copyBtn(value) {
  if (!value || value === '—' || value === 'null') return '';
  const escaped = String(value).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  return `<button class="copy-btn" onclick="event.stopPropagation();copyVal(this,'${escaped}')" title="Copy">${COPY_ICON}</button>`;
}

// ── Duration / Time Formatters ───────────────────────────────────

export function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms === 0) return '0ms';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return mins + 'm ' + secs + 's';
  const hrs = Math.floor(mins / 60);
  return hrs + 'h ' + (mins % 60) + 'm';
}

export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'in future';
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

export function buildTable(cols, rows, actions) {
  if (!rows || rows.length === 0) return '<div class="empty">No data found.</div>';

  let html = '<table><thead><tr>';
  cols.forEach(c => html += `<th>${c.label}</th>`);
  if (actions) html += '<th>Actions</th>';
  html += '</tr></thead><tbody>';

  rows.forEach(row => {
    html += '<tr>';
    cols.forEach(c => {
      const rawVal = c.copyVal ? c.copyVal(row) : (c.key ? (row[c.key] ?? '') : '');
      const displayVal = c.render ? c.render(row) : (row[c.key] ?? '—');
      const cpBtn = (c.noCopy || !rawVal) ? '' : copyBtn(rawVal);
      html += `<td>${displayVal}${cpBtn}</td>`;
    });
    if (actions) html += `<td>${actions(row)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}
