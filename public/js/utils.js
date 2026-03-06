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

export function copyVal(btn, value) {
  const onSuccess = () => {
    btn.classList.add('copied');
    btn.textContent = '✓';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '📋'; }, 1200);
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
  return `<button class="copy-btn" onclick="event.stopPropagation();copyVal(this,'${escaped}')" title="Copy: ${escaped}">📋</button>`;
}

/**
 * Build an HTML table from column definitions and row data.
 * @param {Array<{key?: string, label: string, render?: Function, copyVal?: Function, noCopy?: boolean}>} cols
 * @param {Array<object>} rows
 * @param {Function} [actions] — optional action buttons renderer per row
 */
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
