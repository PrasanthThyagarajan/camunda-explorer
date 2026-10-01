/**
 * Shared batch-size control.
 *
 * "Batch" means two different things in this app, so each mount picks a preset:
 *   incident — how many individual REST calls we fan out per wave
 *   instance — how many instances go into each Camunda async batch entity
 *
 * Every mount needs its own element id: the modify dialog is an overlay, so a
 * panel field stays in the DOM behind it and a shared id would collide.
 */

export const BATCH_PRESETS = {
  incident: {
    label: 'Incidents per wave',
    min: 1,
    max: 100,
    default: 10,
    describe: (total, size) =>
      `${total} incident(s) → ${Math.ceil(total / size)} wave(s) of up to ${size}`,
  },
  instance: {
    label: 'Instances per Camunda batch',
    min: 1,
    max: 1000,
    default: 100,
    describe: (total, size) =>
      `${total} instance(s) → ${Math.ceil(total / size)} Camunda batch(es) of up to ${size}`,
  },
};

const hintId = (id) => `${id}-hint`;

/**
 * `total` is optional — pass it where one field describes one known set of work
 * (the modify dialogs). Omit it where a single field serves several actions
 * with different totals, and only validation feedback is shown.
 */
export function renderBatchSizeField({ id, preset, total = null, value = null, onInput }) {
  const config = BATCH_PRESETS[preset];
  const size = value ?? config.default;
  return `<div class="batch-size-section">
    <label class="batch-size-label" for="${id}">${config.label}:</label>
    <input type="number" id="${id}" class="batch-size-input"
      value="${size}" min="${config.min}" max="${config.max}"
      oninput="${onInput}" />
    <div id="${hintId(id)}" class="batch-size-hint">${total === null ? '' : config.describe(total, size)}</div>
  </div>`;
}

/**
 * Reads the live value. Returns the preset default when the field is not
 * mounted, and null when it is mounted but holds an unusable value — callers
 * must treat null as "block the action".
 */
export function readBatchSize(id, preset) {
  const config = BATCH_PRESETS[preset];
  const el = document.getElementById(id);
  if (!el) return config.default;
  const parsed = parseInt(el.value, 10);
  const valid = Number.isInteger(parsed) && parsed >= config.min && parsed <= config.max;
  return valid ? parsed : null;
}

/** Refreshes the hint or error under the field, and returns the value. */
export function syncBatchSizeHint(id, preset, total = null) {
  const config = BATCH_PRESETS[preset];
  const size = readBatchSize(id, preset);
  const hint = document.getElementById(hintId(id));
  if (hint) {
    if (size === null) {
      hint.textContent = `Enter a whole number between ${config.min} and ${config.max}`;
      hint.classList.add('batch-size-hint-error');
    } else {
      hint.textContent = total === null ? '' : config.describe(total, size);
      hint.classList.remove('batch-size-hint-error');
    }
  }
  return size;
}

/** Default oninput handler for standalone fields that need no other wiring. */
export function handleBatchSizeInput(id, preset) {
  syncBatchSizeHint(id, preset);
}
