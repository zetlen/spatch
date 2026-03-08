import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { _clearCaches } from '../../js/audio/ir-loader.ts';

// Stub globalThis.fetch before importing the module under test, so fetchIR
// doesn't hit the network during module-level side effects.
let originalFetch;
let originalImage;

function stubFetch(responses = {}) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    const key = typeof url === 'string' ? url : url.toString();
    if (responses[key]) {
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(responses[key]),
      });
    }
    // Default: return a small ArrayBuffer for any URL
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    });
  };
}

// Minimal Image stub: calls onload async when src is set
let imageInstances;
function stubImage() {
  imageInstances = [];
  originalImage = globalThis.Image;
  globalThis.Image = class FakeImage {
    constructor() {
      imageInstances.push(this);
      this._src = '';
      this.onload = null;
      this.onerror = null;
    }
    get src() {
      return this._src;
    }
    set src(value) {
      this._src = value;
      // Fire onload asynchronously
      queueMicrotask(() => {
        if (this.onload) this.onload();
      });
    }
  };
}

beforeEach(() => {
  stubFetch();
  stubImage();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Image = originalImage;
  _clearCaches();
  imageInstances = [];
});

// Import the module under test after stubs are set up (but these are
// bun:test imports so they happen at parse time — the stubs in beforeEach
// will be active when the actual test functions run).
import { prefetchScene, loadSceneIR, preloadNextScene, _reset } from '../../js/scenes/loader.ts';
import { SCENES, getScene } from '../../js/scenes/index.ts';

describe('prefetchScene', () => {
  afterEach(() => {
    _reset();
  });

  test('resolves when both image and IR are loaded', async () => {
    const scene = {
      name: 'test-scene',
      stageBackground: '/img/test.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/test.m4a', reverbMix: 0.5 },
    };

    await prefetchScene(scene);

    // Image was created and src was set
    expect(imageInstances.length).toBe(1);
    expect(imageInstances[0].src).toBe('/img/test.jpg');
  });

  test('resolves for scene without IR', async () => {
    const scene = {
      name: 'no-ir',
      stageBackground: '/img/no-ir.jpg',
      imageCredit: 'test',
      vibe: { reverbMix: 0.0 },
    };

    await prefetchScene(scene);

    // Image was loaded
    expect(imageInstances.length).toBe(1);
    expect(imageInstances[0].src).toBe('/img/no-ir.jpg');
  });

  test('caches so second call is instant (no new Image created)', async () => {
    const scene = {
      name: 'cached',
      stageBackground: '/img/cached.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/cached.m4a', reverbMix: 0.5 },
    };

    await prefetchScene(scene);
    const countAfterFirst = imageInstances.length;

    await prefetchScene(scene);
    // No additional Image was created on second call
    expect(imageInstances.length).toBe(countAfterFirst);
  });

  test('deduplicates concurrent prefetch calls', async () => {
    const scene = {
      name: 'dedup',
      stageBackground: '/img/dedup.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/dedup.m4a', reverbMix: 0.5 },
    };

    await Promise.all([prefetchScene(scene), prefetchScene(scene)]);

    // Only one Image was created
    expect(imageInstances.length).toBe(1);
  });
});

describe('loadSceneIR', () => {
  afterEach(() => {
    _reset();
  });

  test('returns decoded AudioBuffer after prefetch', async () => {
    const irBuffer = new ArrayBuffer(32);
    stubFetch({ '/audio/decode.m4a': irBuffer });

    const scene = {
      name: 'decode-scene',
      stageBackground: '/img/decode.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/decode.m4a', reverbMix: 0.5 },
    };

    await prefetchScene(scene);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await loadSceneIR(ctx, scene);
    expect(result).toBe(decoded);
  });

  test('returns undefined for scene with no IR', async () => {
    const scene = {
      name: 'no-ir',
      stageBackground: '/img/no-ir.jpg',
      imageCredit: 'test',
      vibe: { reverbMix: 0.0 },
    };

    const ctx = { decodeAudioData: () => Promise.resolve({}) };

    const result = await loadSceneIR(ctx, scene);
    expect(result).toBeUndefined();
  });
});

describe('preloadNextScene', () => {
  afterEach(() => {
    _reset();
  });

  test('prefetches the scene at (index + 1) % SCENES.length', async () => {
    const currentIndex = 0;
    const nextScene = getScene(currentIndex + 1);

    // Fire-and-forget; we just verify it doesn't throw
    preloadNextScene(currentIndex);

    // Give microtasks time to resolve
    await new Promise((r) => setTimeout(r, 50));

    // The next scene's image should have been requested
    const loadedSrcs = imageInstances.map((img) => img.src);
    expect(loadedSrcs).toContain(nextScene.stageBackground);
  });

  test('wraps around at end of SCENES array', async () => {
    const lastIndex = SCENES.length - 1;
    const firstScene = getScene(0);

    preloadNextScene(lastIndex);

    await new Promise((r) => setTimeout(r, 50));

    const loadedSrcs = imageInstances.map((img) => img.src);
    expect(loadedSrcs).toContain(firstScene.stageBackground);
  });
});

describe('_reset', () => {
  test('clears image cache so prefetch runs again', async () => {
    const scene = {
      name: 'reset-test',
      stageBackground: '/img/reset.jpg',
      imageCredit: 'test',
      vibe: {},
    };

    await prefetchScene(scene);
    const countBefore = imageInstances.length;

    _reset();

    await prefetchScene(scene);
    // A new Image was created after reset
    expect(imageInstances.length).toBe(countBefore + 1);
  });
});
