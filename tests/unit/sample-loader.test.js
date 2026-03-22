import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchSample, decodeSample, _clearCaches } from '../../js/audio/sample-loader.ts';

// Save/restore fetch in beforeEach/afterEach so parallel test files
// don't race on the global. The stub functions no longer save it.
let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  _clearCaches();
});

function stubFetch(arrayBuffer) {
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });
}

function stubFetchFail() {
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404 });
}

describe('fetchSample', () => {
  test('fetches and caches ArrayBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const result = await fetchSample('test.m4a');
    expect(result).toBe(buf);

    // Second call returns cached value without fetch
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    };
    const cached = await fetchSample('test.m4a');
    expect(cached).toBe(buf);
    expect(fetchCalled).toBe(false);
  });

  test('deduplicates concurrent requests', async () => {
    let callCount = 0;
    const buf = new ArrayBuffer(16);
    globalThis.fetch = () => {
      callCount++;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    };

    const [a, b] = await Promise.all([fetchSample('dup.m4a'), fetchSample('dup.m4a')]);
    expect(a).toBe(b);
    expect(callCount).toBe(1);
  });

  test('rejects on HTTP error', async () => {
    stubFetchFail();
    await expect(fetchSample('missing.m4a')).rejects.toThrow('Failed to load sample');
  });
});

describe('decodeSample', () => {
  test('decodes prefetched bytes and caches AudioBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);
    await fetchSample('decode-test.m4a');

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeSample(ctx, 'decode-test.m4a');
    expect(result).toBe(decoded);

    // Second call returns cached decoded buffer
    const result2 = await decodeSample(ctx, 'decode-test.m4a');
    expect(result2).toBe(decoded);
  });

  test('fetches bytes automatically if not prefetched', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeSample(ctx, 'auto-fetch.m4a');
    expect(result).toBe(decoded);
  });
});
