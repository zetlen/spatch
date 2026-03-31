// Loader.ts — Scene asset prefetch and loading.
//
// Preloads scene images (via Image) and IR bytes (via fetchSample) so they're
// Ready before a scene transition. Individual asset failures are absorbed
// (logged as warnings) so the scene always resolves. Caches successful
// Prefetches; clears failed entries so retries are possible.

import type { Scene } from './scene-types';
import { fetchSample, decodeSample } from '../audio/sample-loader';
import { SCENES, getScene } from './index';

const imageLoaded = new Set<string>();
const imagePending = new Map<string, Promise<void>>();

/** Preload a single image URL. Resolves when loaded, rejects on error. */
function preloadImage(url: string): Promise<void> {
  if (imageLoaded.has(url)) {
    return Promise.resolve();
  }

  const inflight = imagePending.get(url);
  if (inflight) {
    return inflight;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => {
      imageLoaded.add(url);
      imagePending.delete(url);
      resolve();
    });
    img.addEventListener('error', () => {
      imagePending.delete(url);
      reject(new Error(`Failed to load scene image: ${url}`));
    });
    img.src = url;
  });

  imagePending.set(url, promise);
  return promise;
}

const scenePending = new Map<string, Promise<void>>();

/**
 * Preload all assets for a scene: background image + IR bytes.
 * Always resolves — individual asset failures are logged as warnings and
 * the scene degrades gracefully (missing image = previous background stays,
 * missing IR = dry audio). Caches successful prefetches; clears the cache
 * entry when any asset fails so a later call can retry.
 */
export function prefetchScene(scene: Scene): Promise<void> {
  const key = scene.name;

  const inflight = scenePending.get(key);
  if (inflight) {
    return inflight;
  }

  let anyFailed = false;

  const tasks: Promise<void>[] = [
    preloadImage(scene.stageBackground).catch((error) => {
      console.warn(`[spatch] Scene "${key}": image failed —`, error.message);
      anyFailed = true;
    }),
  ];

  if (scene.reverb.ir) {
    tasks.push(
      fetchSample(scene.reverb.ir)
        .then(() => undefined)
        .catch((error) => {
          console.warn(`[spatch] Scene "${key}": IR failed —`, error.message);
          anyFailed = true;
        }),
    );
  }

  const promise = Promise.all(tasks).then(() => {
    if (anyFailed) {
      scenePending.delete(key);
    }
  });

  scenePending.set(key, promise);
  return promise;
}

/**
 * Decode the prefetched IR for a scene. Returns undefined if the scene has no IR.
 * If not yet prefetched, fetches automatically (via decodeSample's internal fetchSample).
 */
export function loadSceneIR(ctx: BaseAudioContext, scene: Scene): Promise<AudioBuffer | undefined> {
  if (!scene.reverb.ir) {
    return Promise.resolve(undefined);
  }
  return decodeSample(ctx, scene.reverb.ir);
}

/**
 * Fire-and-forget prefetch for the next scene in the cycle.
 * Called after a scene change so the next transition is instant.
 */
export function preloadNextScene(currentIndex: number): void {
  const next = getScene((currentIndex + 1) % SCENES.length);
  prefetchScene(next);
}

/** Fire-and-forget prefetch for all scenes. */
export function prefetchAllScenes(): void {
  for (const scene of SCENES) {
    prefetchScene(scene);
  }
}

/** Clear image cache state (testing only). */
export function _reset(): void {
  imageLoaded.clear();
  imagePending.clear();
  scenePending.clear();
}
