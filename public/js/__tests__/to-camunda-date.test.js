import { describe, it, expect } from 'vitest';
import { toCamundaDate } from '../utils.js';

// Camunda 7 answers a query carrying a "Z"-suffixed timestamp with
// InvalidRequestException, so these assertions guard the wire format itself.
describe('toCamundaDate', () => {
  it('replaces the ISO Z suffix with a numeric offset', () => {
    expect(toCamundaDate('2026-10-01T12:30:00.000Z')).toBe('2026-10-01T12:30:00.000+0000');
  });

  it('never emits a Z suffix', () => {
    expect(toCamundaDate(Date.now())).not.toMatch(/Z$/);
  });

  it('emits the full millisecond precision Camunda expects', () => {
    expect(toCamundaDate('2026-10-01T12:30:00.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$/
    );
  });

  it('accepts a Date instance', () => {
    expect(toCamundaDate(new Date('2026-01-02T03:04:05.006Z'))).toBe('2026-01-02T03:04:05.006+0000');
  });

  it('accepts an epoch milliseconds number', () => {
    expect(toCamundaDate(0)).toBe('1970-01-01T00:00:00.000+0000');
  });

  it('normalises an offset-bearing string to UTC', () => {
    expect(toCamundaDate('2026-10-01T18:00:00.000+05:30')).toBe('2026-10-01T12:30:00.000+0000');
  });

  it('round-trips to the same instant', () => {
    const iso = '2026-07-04T09:08:07.123Z';
    expect(new Date(toCamundaDate(iso)).getTime()).toBe(new Date(iso).getTime());
  });

  it('returns null for an unparseable value rather than "Invalid Date"', () => {
    expect(toCamundaDate('not a date')).toBeNull();
    expect(toCamundaDate(undefined)).toBeNull();
    expect(toCamundaDate(NaN)).toBeNull();
  });
});
