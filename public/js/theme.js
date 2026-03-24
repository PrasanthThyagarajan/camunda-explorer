/**
 * Theme Manager — handles dark/light mode switching with persistence.
 * Supports manual toggle, localStorage persistence, and OS preference detection.
 */

const STORAGE_KEY = 'camunda-explorer-theme';
const TRANSITION_DURATION = 350;

/**
 * Return saved theme or default to light.
 */
function getPreferredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

/**
 * Set the data-theme attribute on the root element and update the toggle icon.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateToggleIcon(theme);
}

/**
 * Swap the sun/moon icon visibility to reflect the current mode.
 * Sun is shown in dark mode (click to go light); moon is shown in light mode.
 */
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

/**
 * Toggle between light and dark themes.
 * Adds a temporary transition class for a smooth visual switch.
 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';

  // Kick off CSS transition for all themed properties
  document.documentElement.classList.add('theme-transition');

  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);

  // Remove the transition class once the animation settles
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transition');
  }, TRANSITION_DURATION);
}

/**
 * Initialize the theme on page load.
 * Should be called from DOMContentLoaded or as early as possible.
 */
export function initTheme() {
  const theme = getPreferredTheme();
  applyTheme(theme);

  // If user hasn't explicitly picked a theme, stay on light (the default).
  // No OS preference listener — light is always the factory default.
}
