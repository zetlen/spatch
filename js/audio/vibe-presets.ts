import type { VibeOptions } from './vibe.ts';

export interface SceneDefinition {
  name: string;
  credit: string;
  vibe: Partial<VibeOptions>;
}

export const SCENES = [
  {
    name: 'chiclet',
    credit: 'me',
    vibe: {},
  },
  {
    name: 'four-freedoms',
    credit: 'Archetonic',
    vibe: {},
  },
  {
    name: 'gate-78',
    credit: 'CarpetsInter',
    vibe: {},
  },
  {
    name: 'knockdown',
    credit: 'me',
    vibe: {},
  },
  {
    name: 'finger-lakes',
    credit: 'Ed the Punk Rock Guy',
    vibe: {},
  },
  {
    name: 'parking-elevator',
    credit: 'liminalsorting.tumblr.com',
    vibe: {},
  },
  {
    name: 'putty-click',
    credit: '/u/Born03',
    vibe: {},
  },
  {
    name: 's-c-b-d',
    credit: 'Mohammed Alim',
    vibe: {},
  },
  {
    name: 'tartu',
    credit: 'Indrek Mustimets',
    vibe: {},
  },
  {
    name: 'the-metro',
    credit: '/u/ramenov3lord',
    vibe: {},
  },
  {
    name: 'to-let',
    credit: 'Deven Smith',
    vibe: {},
  },
  {
    name: 'grout',
    credit: 'Alf van Beem',
    vibe: {},
  },
] as const;

export function getSceneImage(index: number): string {
  const scene = SCENES[index % SCENES.length]!;
  return `/img/scene/${scene.name}.jpg`;
}
