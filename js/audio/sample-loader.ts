// sample-loader.ts — Fetch and decode audio sample files.
//
// Two-layer cache: fetchSample() caches raw ArrayBuffers (no AudioContext needed),
// decodeSample() caches decoded AudioBuffers. This split lets callers prefetch
// bytes at page load before an AudioContext exists. Used for both scene impulse
// responses and stamp voice samples.
//
// Set/get singleton pattern (same as vibe.ts): app calls setSampleLoader() once
// at init, consumers import the free functions. Tests call setSampleLoader()
// with a mock-fetch loader for isolation.

/** Public interface for a sample loader instance. */
export interface SampleLoader {
  fetchSample(filename: string): Promise<ArrayBuffer>;
  decodeSample(ctx: BaseAudioContext, filename: string): Promise<AudioBuffer>;
  getCachedSample(filename: string): AudioBuffer | undefined;
  clearCaches(): void;
}

/** Create an isolated sample loader with its own caches. */
export function createSampleLoader(fetchFn: typeof fetch): SampleLoader {
  const byteCache = new Map<string, ArrayBuffer>();
  const bytePending = new Map<string, Promise<ArrayBuffer>>();
  const decodedCache = new Map<string, AudioBuffer>();
  const decodedPending = new Map<string, Promise<AudioBuffer>>();

  function fetchSample(filename: string): Promise<ArrayBuffer> {
    const cached = byteCache.get(filename);
    if (cached) return Promise.resolve(cached);

    const inflight = bytePending.get(filename);
    if (inflight) return inflight;

    // Wrap in Promise.resolve().then() so that synchronous throws from fetch()
    // (e.g. Bun throws ERR_INVALID_URL for relative URLs) become rejections
    // instead of uncatchable synchronous exceptions.
    const promise = Promise.resolve()
      .then(() => fetchFn(filename))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load sample: ${res.status} ${filename}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        byteCache.set(filename, buf);
        bytePending.delete(filename);
        return buf;
      })
      .catch((err) => {
        bytePending.delete(filename);
        throw err;
      });

    bytePending.set(filename, promise);
    return promise;
  }

  function decodeSample(ctx: BaseAudioContext, filename: string): Promise<AudioBuffer> {
    const cached = decodedCache.get(filename);
    if (cached) return Promise.resolve(cached);

    const inflight = decodedPending.get(filename);
    if (inflight) return inflight;

    // decodeAudioData consumes its ArrayBuffer, so pass a copy to preserve the byte cache.
    const promise = fetchSample(filename)
      .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
      .then((decoded) => {
        decodedCache.set(filename, decoded);
        decodedPending.delete(filename);
        return decoded;
      });

    decodedPending.set(filename, promise);
    return promise;
  }

  function getCachedSample(filename: string): AudioBuffer | undefined {
    return decodedCache.get(filename);
  }

  function clearCaches(): void {
    byteCache.clear();
    bytePending.clear();
    decodedCache.clear();
    decodedPending.clear();
  }

  return { fetchSample, decodeSample, getCachedSample, clearCaches };
}

// ---- Singleton accessor (same pattern as vibe.ts) ----

let _loader: SampleLoader | undefined;

/** Set the active sample loader. Call once at app init. */
export function setSampleLoader(loader: SampleLoader): void {
  _loader = loader;
}

function loader(): SampleLoader {
  if (!_loader) throw new Error('setSampleLoader() not called');
  return _loader;
}

/** Fetch sample bytes (network + byte cache). No AudioContext needed. */
export function fetchSample(filename: string): Promise<ArrayBuffer> {
  return loader().fetchSample(filename);
}

/** Decode a fetched sample into an AudioBuffer. Fetches if not prefetched. */
export function decodeSample(ctx: BaseAudioContext, filename: string): Promise<AudioBuffer> {
  return loader().decodeSample(ctx, filename);
}

/** Get a previously decoded AudioBuffer from the cache, or undefined. */
export function getCachedSample(filename: string): AudioBuffer | undefined {
  return loader().getCachedSample(filename);
}
