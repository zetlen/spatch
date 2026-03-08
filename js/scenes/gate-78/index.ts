import type { Scene } from '../scene-types';
import stageBackground from './chiang-mai-airport-carpet.jpg';
import ir from './TerrysFactoryWarehouse.m4a';

const scene: Scene = {
  name: 'gate-78',
  stageBackground,
  imageCredit: 'CarpetsInter',
  creditUrl: 'https://carpetsinter.com/',
  vibe: {
    ir,
    reverbMix: 0.75,
    // Gritty, industrial — factory warehouse
    eqLowGain: 3,
    eqMidFreq: 1500,
    eqMidGain: -3,
    eqHighGain: -1,
    compThreshold: -6,
    compRatio: 5,
    warmth: 2.2,
  },
};

export default scene;
