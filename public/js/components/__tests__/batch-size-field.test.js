import { afterEach, describe, expect, it } from 'vitest';
import {
  BATCH_PRESETS,
  readBatchSize,
  renderBatchSizeField,
  syncBatchSizeHint,
} from '../batch-size-field.js';

/**
 * These run under vitest's node environment, so there is no DOM. The component
 * only ever calls getElementById, which is cheap to stand in for.
 */
function mountDom(elements) {
  globalThis.document = {
    getElementById: (id) => elements[id] || null,
  };
}

function inputEl(value) {
  return { value: String(value) };
}

function hintEl() {
  const classes = new Set();
  return {
    textContent: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    has: (c) => classes.has(c),
  };
}

afterEach(() => {
  delete globalThis.document;
});

describe('readBatchSize', () => {
  it('returns the value when it is within the preset range', () => {
    mountDom({ f: inputEl(25) });
    expect(readBatchSize('f', 'incident')).toBe(25);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['above the ceiling', 101],
    ['not a number', 'abc'],
    ['empty', ''],
  ])('returns null for %s', (_label, value) => {
    mountDom({ f: inputEl(value) });
    expect(readBatchSize('f', 'incident')).toBeNull();
  });

  it('accepts the exact boundaries', () => {
    mountDom({ f: inputEl(1) });
    expect(readBatchSize('f', 'incident')).toBe(1);
    mountDom({ f: inputEl(100) });
    expect(readBatchSize('f', 'incident')).toBe(100);
  });

  it('applies the instance ceiling separately from the incident one', () => {
    mountDom({ f: inputEl(500) });
    expect(readBatchSize('f', 'instance')).toBe(500);
    expect(readBatchSize('f', 'incident')).toBeNull();
  });

  it('falls back to the preset default when the field is not mounted', () => {
    mountDom({});
    expect(readBatchSize('missing', 'incident')).toBe(BATCH_PRESETS.incident.default);
    expect(readBatchSize('missing', 'instance')).toBe(BATCH_PRESETS.instance.default);
  });
});

describe('syncBatchSizeHint', () => {
  it('describes the resulting batch count when a total is supplied', () => {
    const hint = hintEl();
    mountDom({ f: inputEl(10), 'f-hint': hint });
    expect(syncBatchSizeHint('f', 'instance', 25)).toBe(10);
    expect(hint.textContent).toBe('25 instance(s) → 3 Camunda batch(es) of up to 10');
    expect(hint.has('batch-size-hint-error')).toBe(false);
  });

  it('shows an error and flags the field when the value is unusable', () => {
    const hint = hintEl();
    mountDom({ f: inputEl(0), 'f-hint': hint });
    expect(syncBatchSizeHint('f', 'incident', 25)).toBeNull();
    expect(hint.textContent).toBe('Enter a whole number between 1 and 100');
    expect(hint.has('batch-size-hint-error')).toBe(true);
  });

  it('stays blank when no total is available, as on the maintenance bar', () => {
    const hint = hintEl();
    mountDom({ f: inputEl(10), 'f-hint': hint });
    expect(syncBatchSizeHint('f', 'incident')).toBe(10);
    expect(hint.textContent).toBe('');
  });

  it('clears a previous error once the value becomes valid again', () => {
    const hint = hintEl();
    mountDom({ f: inputEl(0), 'f-hint': hint });
    syncBatchSizeHint('f', 'incident', 10);
    expect(hint.has('batch-size-hint-error')).toBe(true);

    mountDom({ f: inputEl(5), 'f-hint': hint });
    syncBatchSizeHint('f', 'incident', 10);
    expect(hint.has('batch-size-hint-error')).toBe(false);
  });
});

describe('renderBatchSizeField', () => {
  it('emits the preset bounds, the given id, and the paired hint element', () => {
    const html = renderBatchSizeField({
      id: 'modify-batch-size', preset: 'instance', total: 250, onInput: 'setModifyBatchSize()',
    });
    expect(html).toContain('id="modify-batch-size"');
    expect(html).toContain('id="modify-batch-size-hint"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="1000"');
    expect(html).toContain('value="100"');
    expect(html).toContain('oninput="setModifyBatchSize()"');
    expect(html).toContain('250 instance(s) → 3 Camunda batch(es) of up to 100');
  });

  it('honours an explicit value over the preset default', () => {
    const html = renderBatchSizeField({
      id: 'f', preset: 'incident', total: 30, value: 15, onInput: 'x()',
    });
    expect(html).toContain('value="15"');
    expect(html).toContain('30 incident(s) → 2 wave(s) of up to 15');
  });

  it('omits the hint text when no total is supplied', () => {
    const html = renderBatchSizeField({ id: 'f', preset: 'incident', onInput: 'x()' });
    expect(html).toContain('id="f-hint"');
    expect(html).toContain('class="batch-size-hint"></div>');
  });
});
