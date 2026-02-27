/**
 * Utility functions — Domain layer (pure functions).
 *
 * SRP: String formatting, DOM helpers, clipboard, table building.
 * All functions are stateless and side-effect-free (except clipboard/toast).
 */

// ── String Helpers ──────────────────────────────────────────────────

/** HTML-escape a string to prevent XSS. */
export function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Truncate an ID for display. */
export function shortId(id) {
  return id ? (id.length > 16 ? id.substring(0, 14) + '…' : id) : '—';
}

/** Truncate a message for display. */
export function shortMsg(s, max) {
  if (!s) return '—';
  return s.length > max ? s.substring(0, max) + '…' : s;
}

/** Format a date string for display. */
export function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : '—';
}

// ── Toast Notifications ─────────────────────────────────────────────

const TOAST_DURATION = 4000;

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {'info'|'success'|'error'} type
 */
export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), TOAST_DURATION);
}

// ── Clipboard Copy ──────────────────────────────────────────────────

/**
 * Copy a value to clipboard via a copy button element.
 * @param {HTMLElement} btn — the button that was clicked
 * @param {string} value   — the value to copy
 */
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

/**
 * Generate a copy button HTML string for a value.
 * @param {string} value
 * @returns {string} HTML string
 */
export function copyBtn(value) {
  if (!value || value === '—' || value === 'null') return '';
  const escaped = String(value).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  return `<button class="copy-btn" onclick="event.stopPropagation();copyVal(this,'${escaped}')" title="Copy: ${escaped}">📋</button>`;
}

// ── Table Builder ───────────────────────────────────────────────────

/**
 * Build an HTML table from column definitions and row data.
 *
 * @param {Array<{key?: string, label: string, render?: Function, copyVal?: Function, noCopy?: boolean}>} cols
 * @param {Array<object>} rows
 * @param {Function} [actions] — optional function that returns action buttons HTML for each row
 * @returns {string} HTML string
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
