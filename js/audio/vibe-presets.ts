import type { VibeOptions } from './vibe.ts';

export interface SceneDefinition {
  image: string;
  name: string;
  vibe: Partial<VibeOptions>;
}

export const SCENES: SceneDefinition[] = [
  { image: 'blue-hall.jpg', name: 'Blue Hall', vibe: {} },
  { image: 'cloud-carpet.jpg', name: 'Cloud Carpet', vibe: {} },
  { image: 'excel-flyer.jpg', name: 'Excel Flyer', vibe: {} },
  { image: 'g-block.jpg', name: 'G Block', vibe: {} },
  { image: 'mclassic.jpg', name: 'Macintosh Classic', vibe: {} },
  { image: 'parking-elevator.jpg', name: 'Parking Elevator', vibe: {} },
  { image: 'shoe-dept.jpg', name: 'Shoe Dept', vibe: {} },
  { image: 'tile-towers.jpg', name: 'Tile Towers', vibe: {} },
];

export function getSceneImage(index: number): string {
  const scene = SCENES[index % SCENES.length]!;
  return `/img/scene/${scene.image}`;
}
