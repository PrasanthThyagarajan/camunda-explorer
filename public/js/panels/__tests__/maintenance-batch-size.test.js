import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.fn();
vi.mock('../../utils.js', () => ({
  esc: (s) => String(s ?? ''),
  shortId: (s) => String(s ?? ''),
  fmtDate: (s) => String(s ?? ''),
  toast: (...args) => toast(...args),
  copyBtn: () => '',
  shortMsg: (s) => String(s ?? ''),
}));

const { currentBatchSize } = await import('../maintenance.js');
const { BATCH_PRESETS } = await import('../../components/batch-size-field.js');

/** The panel reads its value straight out of #maint-batch-size. */
function mountField(value) {
  globalThis.document = {
    getElementById: (id) => (id === 'maint-batch-size' ? { value: String(value) } : null),
  };
}

const MAX_DELETE = 25;

beforeEach(() => { toast.mockReset(); });
afterEach(() => { delete globalThis.document; });

describe('currentBatchSize — retry strategies', () => {
  it('passes a valid value straight through', () => {
    mountField(40);
    expect(currentBatchSize('retry')).toBe(40);
    expect(toast).not.toHaveBeenCalled();
  });

  it('allows the full incident ceiling', () => {
    mountField(BATCH_PRESETS.incident.max);
    expect(currentBatchSize('retry')).toBe(BATCH_PRESETS.incident.max);
  });
});

describe('currentBatchSize — delete strategy cap', () => {
  it('caps an oversized delete batch to limit the blast radius', () => {
    mountField(100);
    expect(currentBatchSize('delete')).toBe(MAX_DELETE);
  });

  it('leaves a delete batch below the cap untouched', () => {
    mountField(5);
    expect(currentBatchSize('delete')).toBe(5);
  });

  it('caps exactly at the boundary', () => {
    mountField(MAX_DELETE);
    expect(currentBatchSize('delete')).toBe(MAX_DELETE);
    mountField(MAX_DELETE + 1);
    expect(currentBatchSize('delete')).toBe(MAX_DELETE);
  });

  it('caps deletes harder than retries for the same input', () => {
    mountField(80);
    const retry = currentBatchSize('retry');
    const del = currentBatchSize('delete');
    expect(retry).toBe(80);
    expect(del).toBeLessThan(retry);
  });
});

describe('currentBatchSize — rejects unusable input', () => {
  it.each([
    ['zero', 0],
    ['negative', -3],
    ['above the ceiling', 101],
    ['non-numeric', 'abc'],
    ['empty', ''],
  ])('returns null and warns the operator for %s', (_label, value) => {
    mountField(value);
    expect(currentBatchSize('retry')).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1]).toBe('error');
  });

  it('blocks a delete just as firmly as a retry', () => {
    mountField(0);
    expect(currentBatchSize('delete')).toBeNull();
  });

  it('falls back to the preset default when the field is absent', () => {
    globalThis.document = { getElementById: () => null };
    expect(currentBatchSize('retry')).toBe(BATCH_PRESETS.incident.default);
    expect(toast).not.toHaveBeenCalled();
  });
});
