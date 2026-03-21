// sample-loader.ts — Fetch and decode audio sample files.
//
// Two-layer cache: fetchSample() caches raw ArrayBuffers (no AudioContext needed),
// decodeSample() caches decoded AudioBuffers. This split lets callers prefetch
// bytes at page load before an AudioContext exists. Used for both scene impulse
// responses and stamp voice samples.

const byteCache = new Map<string, ArrayBuffer>();
const bytePending = new Map<string, Promise<ArrayBuffer>>();
const decodedCache = new Map<string, AudioBuffer>();
const decodedPending = new Map<string, Promise<AudioBuffer>>();

/** Fetch sample bytes (network + byte cache). No AudioContext needed. */
export function fetchSample(filename: string): Promise<ArrayBuffer> {
  const cached = byteCache.get(filename);
  if (cached) return Promise.resolve(cached);

  const inflight = bytePending.get(filename);
  if (inflight) return inflight;

  // Wrap in Promise.resolve().then() so that synchronous throws from fetch()
  // (e.g. Bun throws ERR_INVALID_URL for relative URLs) become rejections
  // instead of uncatchable synchronous exceptions.
  const promise = Promise.resolve()
    .then(() => fetch(filename))
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

/** Decode a fetched sample into an AudioBuffer (decoded cache). Fetches if not prefetched. */
export function decodeSample(ctx: BaseAudioContext, filename: string): Promise<AudioBuffer> {
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

/** Get a previously decoded AudioBuffer from the cache, or undefined if not yet decoded. */
export function getCachedSample(filename: string): AudioBuffer | undefined {
  return decodedCache.get(filename);
}

/** Clear all caches (testing only). */
export function _clearCaches(): void {
  byteCache.clear();
  bytePending.clear();
  decodedCache.clear();
  decodedPending.clear();
}
