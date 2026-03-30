import type { Scene } from './scene-types';
import { prefetchScene, preloadNextScene } from './loader';

import chiclet from './chiclet';
import fingerLakes from './finger-lakes';
import fourFreedoms from './four-freedoms';
import gate78 from './gate-78';
import knockdown from './knockdown';
import structureB from './structure-b';
import puttyClick from './putty-click';
import scbd from './s-c-b-d';
import tartu from './tartu';
import theMetro from './the-metro';
import comingSoon from './coming-soon';
import grout from './grout';

export type { Scene } from './scene-types';

export const SCENES: Scene[] = [
  chiclet,
  fingerLakes,
  fourFreedoms,
  gate78,
  knockdown,
  structureB,
  puttyClick,
  scbd,
  tartu,
  theMetro,
  comingSoon,
  grout,
];

export function getScene(index: number): Scene {
  return SCENES[((index % SCENES.length) + SCENES.length) % SCENES.length] as Scene;
}

export function randomSceneIndex(): number {
  return Math.floor(Math.random() * SCENES.length);
}

let activeLayer: HTMLElement | undefined;
let inactiveLayer: HTMLElement | undefined;

export function initStageLayers(app: HTMLElement): void {
  const layers = app.querySelectorAll<HTMLElement>('.stage-bg');
  activeLayer = layers[0];
  inactiveLayer = layers[1];
  // Active layer starts visible, inactive starts hidden
  if (inactiveLayer) {
    inactiveLayer.classList.add('fade-out');
  }
}

export async function applyScene(app: HTMLElement, index: number): Promise<void> {
  const scene = getScene(index);

  if (!activeLayer || !inactiveLayer) {
    // Fallback before initStageLayers (shouldn't happen in normal flow)
    app.style.backgroundImage = `url(${scene.stageBackground})`;
    app.style.backgroundSize = 'cover';
    app.style.backgroundPosition = 'center';
    await prefetchScene(scene);
    return;
  }

  // Set new image on inactive layer
  inactiveLayer.style.backgroundImage = `url(${scene.stageBackground})`;

  await prefetchScene(scene);

  // Crossfade
  inactiveLayer.classList.remove('fade-out');
  activeLayer.classList.add('fade-out');

  // Swap roles
  const prev = activeLayer;
  activeLayer = inactiveLayer;
  inactiveLayer = prev;

  // Preload next scene
  preloadNextScene(index);
}
