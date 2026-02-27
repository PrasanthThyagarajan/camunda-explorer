/**
 * Detail Slide-over Panel — Presentation component.
 *
 * SRP: Open/close the right-side detail panel.
 */

/**
 * Open the detail slide-over panel with given title and HTML content.
 * @param {string} title
 * @param {string} html
 */
export function openDetail(title, html) {
  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-body').innerHTML = html;
  document.getElementById('detail-panel').classList.add('open');
}

/**
 * Close the detail slide-over panel.
 */
export function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
}
