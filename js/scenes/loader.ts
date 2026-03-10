// loader.ts — Scene asset prefetch and loading.
//
// Preloads scene images (via Image) and IR bytes (via fetchIR) so they're
// ready before a scene transition. Caches completed prefetches and deduplicates
// in-flight requests.

import type { Scene } from './scene-types';
import { fetchIR, decodeIR } from '../audio/ir-loader';
import { SCENES, getScene } from './index';

const imageLoaded = new Set<string>();
const imagePending = new Map<string, Promise<void>>();

/** Preload a single image URL. Resolves when loaded, rejects on error. */
function preloadImage(url: string): Promise<void> {
  if (imageLoaded.has(url)) return Promise.resolve();

  const inflight = imagePending.get(url);
  if (inflight) return inflight;

  const promise = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageLoaded.add(url);
      imagePending.delete(url);
      resolve();
    };
    img.onerror = () => {
      imagePending.delete(url);
      reject(new Error(`Failed to load scene image: ${url}`));
    };
    img.src = url;
  });

  imagePending.set(url, promise);
  return promise;
}

const scenePending = new Map<string, Promise<void>>();

/**
 * Preload all assets for a scene: background image + IR bytes.
 * Caches so repeat calls are instant. Deduplicates in-flight requests.
 */
export function prefetchScene(scene: Scene): Promise<void> {
  const key = scene.name;

  const inflight = scenePending.get(key);
  if (inflight) return inflight;

  const tasks: Promise<void>[] = [preloadImage(scene.stageBackground)];

  if (scene.vibe.ir) {
    tasks.push(fetchIR(scene.vibe.ir).then(() => undefined));
  }

  const promise = Promise.all(tasks).then(() => {
    // Keep the entry in scenePending as the "done" sentinel so repeat calls
    // return the resolved promise instantly.
  });

  scenePending.set(key, promise);
  return promise;
}

/**
 * Decode the prefetched IR for a scene. Returns undefined if the scene has no IR.
 * If not yet prefetched, fetches automatically (via decodeIR's internal fetchIR).
 */
export function loadSceneIR(ctx: BaseAudioContext, scene: Scene): Promise<AudioBuffer | undefined> {
  if (!scene.vibe.ir) return Promise.resolve(undefined);
  return decodeIR(ctx, scene.vibe.ir);
}

/**
 * Fire-and-forget prefetch for the next scene in the cycle.
 * Called after a scene change so the next transition is instant.
 */
export function preloadNextScene(currentIndex: number): void {
  const next = getScene((currentIndex + 1) % SCENES.length);
  prefetchScene(next).catch(() => {
    // Swallow errors — prefetch is best-effort.
  });
}

/** Fire-and-forget prefetch for all scenes. */
export function prefetchAllScenes(): void {
  for (const scene of SCENES) {
    prefetchScene(scene).catch(() => {});
  }
}

/** Clear image cache state (testing only). */
export function _reset(): void {
  imageLoaded.clear();
  imagePending.clear();
  scenePending.clear();
}
