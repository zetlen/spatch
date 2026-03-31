import type { Scene } from '../scene-types';
import stageBackground from './chiang-mai-airport-carpet.jpg';
import ir from './TerrysFactoryWarehouse.m4a';

const scene: Scene = {
  name: 'gate-78',
  icon: 'tabler-building-airport',
  stageBackground,
  imageCredit: 'CarpetsInter',
  creditUrl: 'https://carpetsinter.com/',
  reverb: { ir, reverbMix: 0.75 },
};

export default scene;
