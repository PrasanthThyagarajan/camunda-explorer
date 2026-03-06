export function openDetail(title, html) {
  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-body').innerHTML = html;
  document.getElementById('detail-panel').classList.add('open');
}

export function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
}
