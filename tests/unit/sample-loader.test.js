import { describe, expect, test } from 'bun:test';
import { createSampleLoader } from '../../js/audio/sample-loader.ts';

function stubFetch(arrayBuffer) {
  return () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });
}

function stubFetchFail() {
  return () => Promise.resolve({ ok: false, status: 404 });
}

describe('fetchSample', () => {
  test('fetches and caches ArrayBuffer', async () => {
    const buf = new ArrayBuffer(16);
    let callCount = 0;
    const loader = createSampleLoader(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(buf),
      });
    });

    const result = await loader.fetchSample('test.m4a');
    expect(result).toBe(buf);
    expect(callCount).toBe(1);

    // Second call returns cached value without fetch
    const cached = await loader.fetchSample('test.m4a');
    expect(cached).toBe(buf);
    expect(callCount).toBe(1);
  });

  test('deduplicates concurrent requests', async () => {
    let callCount = 0;
    const buf = new ArrayBuffer(16);
    const loader = createSampleLoader(() => {
      callCount++;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    });

    const [a, b] = await Promise.all([
      loader.fetchSample('dedup.m4a'),
      loader.fetchSample('dedup.m4a'),
    ]);
    expect(a).toBe(b);
    expect(callCount).toBe(1);
  });

  test('rejects on HTTP error', async () => {
    const loader = createSampleLoader(stubFetchFail());
    await expect(loader.fetchSample('fail.m4a')).rejects.toThrow('Failed to load sample');
  });
});

describe('decodeSample', () => {
  test('decodes prefetched bytes and caches AudioBuffer', async () => {
    const buf = new ArrayBuffer(16);
    const loader = createSampleLoader(stubFetch(buf));
    await loader.fetchSample('decode.m4a');

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await loader.decodeSample(ctx, 'decode.m4a');
    expect(result).toBe(decoded);

    // Second call returns cached decoded buffer
    const result2 = await loader.decodeSample(ctx, 'decode.m4a');
    expect(result2).toBe(decoded);
  });

  test('fetches bytes automatically if not prefetched', async () => {
    const buf = new ArrayBuffer(16);
    const loader = createSampleLoader(stubFetch(buf));

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await loader.decodeSample(ctx, 'autofetch.m4a');
    expect(result).toBe(decoded);
  });
});

describe('clearCaches', () => {
  test('clears all caches so subsequent calls refetch', async () => {
    let callCount = 0;
    const buf = new ArrayBuffer(16);
    const loader = createSampleLoader(() => {
      callCount++;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    });

    await loader.fetchSample('clear.m4a');
    expect(callCount).toBe(1);

    loader.clearCaches();

    await loader.fetchSample('clear.m4a');
    expect(callCount).toBe(2);
  });
});
