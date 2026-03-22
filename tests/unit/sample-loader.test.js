import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchSample, decodeSample, _clearCaches } from '../../js/audio/sample-loader.ts';

// Use unique filenames per test to avoid cache collisions with parallel
// test files that also import sample-loader. This sidesteps the global
// fetch stubbing race condition until the DI refactor (#279).
let testId = 0;
function uniqueName(prefix) {
  return `__test_${prefix}_${testId++}_${Date.now()}.m4a`;
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  _clearCaches();
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
    const name = uniqueName('cache');

    const result = await fetchSample(name);
    expect(result).toBe(buf);

    // Second call returns cached value without fetch
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    };
    const cached = await fetchSample(name);
    expect(cached).toBe(buf);
    expect(fetchCalled).toBe(false);
  });

  test('deduplicates concurrent requests', async () => {
    let callCount = 0;
    const buf = new ArrayBuffer(16);
    const name = uniqueName('dedup');
    globalThis.fetch = () => {
      callCount++;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    };

    const [a, b] = await Promise.all([fetchSample(name), fetchSample(name)]);
    expect(a).toBe(b);
    expect(callCount).toBe(1);
  });

  test('rejects on HTTP error', async () => {
    stubFetchFail();
    await expect(fetchSample(uniqueName('fail'))).rejects.toThrow('Failed to load sample');
  });
});

describe('decodeSample', () => {
  test('decodes prefetched bytes and caches AudioBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);
    const name = uniqueName('decode');
    await fetchSample(name);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeSample(ctx, name);
    expect(result).toBe(decoded);

    // Second call returns cached decoded buffer
    const result2 = await decodeSample(ctx, name);
    expect(result2).toBe(decoded);
  });

  test('fetches bytes automatically if not prefetched', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeSample(ctx, uniqueName('autofetch'));
    expect(result).toBe(decoded);
  });
});
