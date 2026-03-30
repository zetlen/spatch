import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createSampleLoader, setSampleLoader } from '../../js/audio/sample-loader.ts';
import { prefetchScene, loadSceneIR, preloadNextScene, _reset } from '../../js/scenes/loader.ts';
import { SCENES, getScene } from '../../js/scenes/index.ts';

let originalImage;
let imageInstances;

function setMockLoader(responses = {}) {
  setSampleLoader(
    createSampleLoader((url) => {
      const key = typeof url === 'string' ? url : url.toString();
      if (responses[key]) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(responses[key]),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
      });
    }),
  );
}

function stubImage() {
  imageInstances = [];
  originalImage = globalThis.Image;
  globalThis.Image = class FakeImage extends EventTarget {
    constructor() {
      super();
      imageInstances.push(this);
      this._src = '';
    }
    get src() {
      return this._src;
    }
    set src(value) {
      this._src = value;
      queueMicrotask(() => {
        this.dispatchEvent(new Event('load'));
      });
    }
  };
}

beforeEach(() => {
  setMockLoader();
  stubImage();
});

afterEach(() => {
  globalThis.Image = originalImage;
  imageInstances = [];
});

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

    expect(imageInstances.length).toBe(1);
    expect(imageInstances[0].src).toBe('/img/test.jpg');
  });

  test('resolves for scene without IR', async () => {
    const scene = {
      name: 'no-ir',
      stageBackground: '/img/no-ir.jpg',
      imageCredit: 'test',
      vibe: { reverbMix: 0 },
    };

    await prefetchScene(scene);

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
    expect(imageInstances.length).toBe(countAfterFirst);
  });

  test('resolves when image fails but IR succeeds', async () => {
    globalThis.Image = class FakeImage extends EventTarget {
      constructor() {
        super();
        imageInstances.push(this);
        this._src = '';
      }
      get src() {
        return this._src;
      }
      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          this.dispatchEvent(new Event('error'));
        });
      }
    };

    const scene = {
      name: 'img-fail',
      stageBackground: '/img/broken.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/ok.m4a', reverbMix: 0.5 },
    };

    await prefetchScene(scene);
  });

  test('resolves when IR fails but image succeeds', async () => {
    setSampleLoader(
      createSampleLoader((url) => {
        const key = typeof url === 'string' ? url : url.toString();
        if (key.endsWith('.m4a')) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
        });
      }),
    );

    const scene = {
      name: 'ir-fail',
      stageBackground: '/img/ok.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/broken.m4a', reverbMix: 0.5 },
    };

    await prefetchScene(scene);
  });

  test('clears scenePending on failure so retry is possible', async () => {
    let failImage = true;
    globalThis.Image = class FakeImage extends EventTarget {
      constructor() {
        super();
        imageInstances.push(this);
        this._src = '';
      }
      get src() {
        return this._src;
      }
      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          this.dispatchEvent(new Event(failImage ? 'error' : 'load'));
        });
      }
    };

    const scene = {
      name: 'retry-test',
      stageBackground: '/img/flaky.jpg',
      imageCredit: 'test',
      vibe: {},
    };

    await prefetchScene(scene);
    const countAfterFirst = imageInstances.length;

    failImage = false;
    await prefetchScene(scene);
    expect(imageInstances.length).toBeGreaterThan(countAfterFirst);
  });

  test('deduplicates concurrent prefetch calls', async () => {
    const scene = {
      name: 'dedup',
      stageBackground: '/img/dedup.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/dedup.m4a', reverbMix: 0.5 },
    };

    await Promise.all([prefetchScene(scene), prefetchScene(scene)]);

    expect(imageInstances.length).toBe(1);
  });
});

describe('loadSceneIR', () => {
  afterEach(() => {
    _reset();
  });

  test('returns decoded AudioBuffer after prefetch', async () => {
    setMockLoader({ '/audio/decode.m4a': new ArrayBuffer(32) });

    const scene = {
      name: 'decode-scene',
      stageBackground: '/img/decode.jpg',
      imageCredit: 'test',
      vibe: { ir: '/audio/decode.m4a', reverbMix: 0.5 },
    };

    await prefetchScene(scene);

    const decoded = { duration: 1, length: 44_100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await loadSceneIR(ctx, scene);
    expect(result).toBe(decoded);
  });

  test('returns undefined for scene with no IR', async () => {
    const scene = {
      name: 'no-ir',
      stageBackground: '/img/no-ir.jpg',
      imageCredit: 'test',
      vibe: { reverbMix: 0 },
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

    preloadNextScene(currentIndex);

    await new Promise((r) => setTimeout(r, 50));

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
    expect(imageInstances.length).toBe(countBefore + 1);
  });
});
