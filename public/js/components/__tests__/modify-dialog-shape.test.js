import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils.js', () => ({
  esc: (s) => String(s ?? ''),
  shortId: (s) => String(s ?? ''),
  toast: vi.fn(),
}));

const { assertBatchModifyShape, toSkippedResults } = await import('../modify-dialog.js');

const wellFormed = (over = {}) => ({
  alreadyProcessed: [], notFound: [], batches: [], failedGroups: [], ...over,
});

describe('assertBatchModifyShape', () => {
  it('accepts a well-formed batch response', () => {
    expect(() => assertBatchModifyShape(wellFormed())).not.toThrow();
  });

  it('accepts a populated response', () => {
    expect(() => assertBatchModifyShape(wellFormed({
      alreadyProcessed: [{ instanceId: 'p1', reason: 'done' }],
      notFound: ['ghost'],
      batches: [{ batchId: 'b1', instanceCount: 2 }],
      failedGroups: [{ processDefinitionId: 'd1', instanceCount: 1, message: 'nope' }],
    }))).not.toThrow();
  });

  // This is the exact shape an older server returns, and the crash it caused.
  it.each(['alreadyProcessed', 'notFound', 'batches', 'failedGroups'])(
    'rejects a response missing %s',
    (key) => {
      const body = wellFormed();
      delete body[key];
      expect(() => assertBatchModifyShape(body)).toThrow(/older build/i);
    }
  );

  it('rejects the pre-change response that used "omitted"', () => {
    expect(() => assertBatchModifyShape({
      totalInstances: 3, batches: [], omitted: ['p1'], failedGroups: [],
    })).toThrow(/older build/i);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
  ])('rejects %s rather than throwing a TypeError later', (_label, body) => {
    expect(() => assertBatchModifyShape(body)).toThrow(/Unexpected response shape/);
  });

  it('rejects a field that is present but not an array', () => {
    expect(() => assertBatchModifyShape(wellFormed({ notFound: 'ghost' }))).toThrow();
    expect(() => assertBatchModifyShape(wellFormed({ batches: 3 }))).toThrow();
  });
});

describe('toSkippedResults', () => {
  it('maps already-processed instances onto their engine reason', () => {
    const rows = toSkippedResults(wellFormed({
      alreadyProcessed: [{ instanceId: 'p1', reason: 'Already processed — finished COMPLETED' }],
    }));
    expect(rows).toEqual([
      { incidentId: 'p1', status: 'skipped', message: 'Already processed — finished COMPLETED' },
    ]);
  });

  it('labels never-seen ids distinctly from finished ones', () => {
    const rows = toSkippedResults(wellFormed({ notFound: ['ghost'] }));
    expect(rows[0]).toMatchObject({ incidentId: 'ghost', status: 'skipped' });
    expect(rows[0].message).toContain('unknown to the engine');
  });

  it('combines both buckets and marks every row skipped', () => {
    const rows = toSkippedResults(wellFormed({
      alreadyProcessed: [{ instanceId: 'a', reason: 'done' }, { instanceId: 'b', reason: 'done' }],
      notFound: ['c'],
    }));
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.status === 'skipped')).toBe(true);
    expect(rows.map(r => r.incidentId)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing when there is nothing to skip', () => {
    expect(toSkippedResults(wellFormed())).toEqual([]);
  });

  it('uses incidentId as the key because that is what the progress list renders', () => {
    const rows = toSkippedResults(wellFormed({ notFound: ['x'] }));
    expect(rows[0]).toHaveProperty('incidentId');
    expect(rows[0]).not.toHaveProperty('instanceId');
  });
});
