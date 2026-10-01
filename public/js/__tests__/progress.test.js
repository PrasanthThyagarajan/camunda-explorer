import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { finishProgress } from '../progress.js';

/**
 * progress.js talks straight to getElementById, so a map of stub elements is
 * enough to drive it under vitest's node environment.
 */
const IDS = [
  'progress-title', 'progress-bar', 'progress-status', 'progress-detail',
  'progress-results', 'progress-close-btn', 'progress-overlay',
];

let els;

function stubEl() {
  const classes = new Set();
  return {
    textContent: '', innerHTML: '', style: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
  };
}

/** utils.esc() escapes by round-tripping through a detached element. */
function escapingEl() {
  return {
    innerHTML: '',
    set textContent(v) {
      this.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    get textContent() { return this.innerHTML; },
  };
}

beforeEach(() => {
  els = Object.fromEntries(IDS.map((id) => [id, stubEl()]));
  globalThis.document = {
    getElementById: (id) => els[id] || null,
    createElement: () => escapingEl(),
  };
});

afterEach(() => { delete globalThis.document; });

const status = () => els['progress-status'].textContent;
const results = () => els['progress-results'].innerHTML;

describe('finishProgress — skipped reporting', () => {
  it('counts already-processed items separately from successes and failures', () => {
    finishProgress({ succeeded: 3, skipped: 2, failed: 1, results: [] });
    expect(status()).toContain('3 succeeded');
    expect(status()).toContain('2 already processed');
    expect(status()).toContain('1 failed');
  });

  it('stays quiet about skips when there are none', () => {
    finishProgress({ succeeded: 5, skipped: 0, failed: 0, results: [] });
    expect(status()).not.toContain('already processed');
    expect(status()).toContain('5 succeeded');
  });

  it('tolerates a response that omits the skipped field entirely', () => {
    finishProgress({ succeeded: 1, failed: 0, results: [] });
    expect(status()).toContain('1 succeeded');
    expect(status()).not.toContain('NaN');
    expect(status()).not.toContain('undefined');
  });

  it('prefers an explicit statusText over the generated summary', () => {
    finishProgress({
      succeeded: 0, skipped: 4, failed: 0, results: [],
      statusText: 'Nothing to modify — all 4 instance(s) were already processed',
    });
    expect(status()).toBe('Nothing to modify — all 4 instance(s) were already processed');
  });
});

describe('finishProgress — per-result styling', () => {
  it('gives a skipped row its own class and marker, distinct from an error', () => {
    finishProgress({
      succeeded: 0, skipped: 1, failed: 1,
      results: [
        { incidentId: 'skipped-one', status: 'skipped', message: 'Already processed' },
        { incidentId: 'failed-one', status: 'error', message: 'Boom' },
      ],
    });
    expect(results()).toContain('result-skip');
    expect(results()).toContain('⊘');
    expect(results()).toContain('result-err');
    expect(results()).toContain('❌');
  });

  it('marks a success row green', () => {
    finishProgress({
      succeeded: 1, skipped: 0, failed: 0,
      results: [{ incidentId: 'ok-one', status: 'success', message: 'Done' }],
    });
    expect(results()).toContain('result-ok');
    expect(results()).toContain('✅');
    expect(results()).not.toContain('result-skip');
  });

  it('falls back to the error style for an unrecognised status', () => {
    finishProgress({
      succeeded: 0, skipped: 0, failed: 1,
      results: [{ incidentId: 'odd-one', status: 'who-knows', message: 'Unmapped' }],
    });
    expect(results()).toContain('result-err');
  });

  it('escapes the message so an engine error cannot inject markup', () => {
    finishProgress({
      succeeded: 0, skipped: 0, failed: 1,
      results: [{ incidentId: 'x', status: 'error', message: '<img src=x onerror=alert(1)>' }],
    });
    expect(results()).not.toContain('<img');
    expect(results()).toContain('&lt;img');
  });

  it('renders one row per result', () => {
    finishProgress({
      succeeded: 1, skipped: 1, failed: 1,
      results: [
        { incidentId: 'a', status: 'success', message: 'ok' },
        { incidentId: 'b', status: 'skipped', message: 'skip' },
        { incidentId: 'c', status: 'error', message: 'err' },
      ],
    });
    expect(results().match(/class="result-item"/g)).toHaveLength(3);
  });

  it('handles an empty result list without producing markup', () => {
    finishProgress({ succeeded: 0, skipped: 0, failed: 0, results: [] });
    expect(results()).toBe('');
  });
});
