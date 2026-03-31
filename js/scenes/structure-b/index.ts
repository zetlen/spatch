import type { Scene } from '../scene-types';
import stageBackground from './parking-elevator.jpg';
import ir from './UndergroundCarPark.m4a';

const scene: Scene = {
  name: 'structure-b',
  icon: 'tabler-traffic-cone',
  stageBackground,
  imageCredit: 'liminalsorting.tumblr.com',
  creditUrl: 'https://liminalsorting.tumblr.com',
  reverb: { ir, reverbMix: 0.8 },
};

export default scene;
