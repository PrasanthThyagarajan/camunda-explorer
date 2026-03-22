const STORAGE_KEY = 'camunda-explorer-theme';
const TRANSITION_DURATION = 350;

function getPreferredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateToggleIcon(theme);
}

function updateToggleIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const sun = btn.querySelector('.theme-icon-sun');
  const moon = btn.querySelector('.theme-icon-moon');
  if (!sun || !moon) return;

  if (theme === 'light') {
    sun.style.display = 'none';
    moon.style.display = 'block';
  } else {
    sun.style.display = 'block';
    moon.style.display = 'none';
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';

  document.documentElement.classList.add('theme-transition');

  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);

  setTimeout(() => {
    document.documentElement.classList.remove('theme-transition');
  }, TRANSITION_DURATION);
}

export function initTheme() {
  const theme = getPreferredTheme();
  applyTheme(theme);

}
