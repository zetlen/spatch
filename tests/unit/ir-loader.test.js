import { afterEach, describe, expect, test } from 'bun:test';
import { fetchIR, decodeIR, _clearCaches } from '../../js/audio/ir-loader.ts';

// Stub fetch globally
let fetchStub;
afterEach(() => {
  _clearCaches();
  globalThis.fetch = fetchStub;
});

function stubFetch(arrayBuffer) {
  fetchStub = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });
}

function stubFetchFail() {
  fetchStub = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404 });
}

describe('fetchIR', () => {
  test('fetches and caches ArrayBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const result = await fetchIR('test.m4a');
    expect(result).toBe(buf);

    // Second call returns cached value without fetch
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    };
    const cached = await fetchIR('test.m4a');
    expect(cached).toBe(buf);
    expect(fetchCalled).toBe(false);
  });

  test('deduplicates concurrent requests', async () => {
    let callCount = 0;
    const buf = new ArrayBuffer(16);
    fetchStub = globalThis.fetch;
    globalThis.fetch = () => {
      callCount++;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    };

    const [a, b] = await Promise.all([fetchIR('dup.m4a'), fetchIR('dup.m4a')]);
    expect(a).toBe(b);
    expect(callCount).toBe(1);
  });

  test('rejects on HTTP error', async () => {
    stubFetchFail();
    await expect(fetchIR('missing.m4a')).rejects.toThrow('Failed to load IR');
  });
});

describe('decodeIR', () => {
  test('decodes prefetched bytes and caches AudioBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);
    await fetchIR('decode-test.m4a');

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeIR(ctx, 'decode-test.m4a');
    expect(result).toBe(decoded);

    // Second call returns cached decoded buffer
    const result2 = await decodeIR(ctx, 'decode-test.m4a');
    expect(result2).toBe(decoded);
  });

  test('fetches bytes automatically if not prefetched', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeIR(ctx, 'auto-fetch.m4a');
    expect(result).toBe(decoded);
  });
});
