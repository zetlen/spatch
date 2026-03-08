import type { Scene } from '../scene-types';
import stageBackground from './parking-elevator.jpg';
import ir from './UndergroundCarPark.m4a';

const scene: Scene = {
  name: 'structure-b',
  stageBackground,
  imageCredit: 'liminalsorting.tumblr.com',
  creditUrl: 'https://liminalsorting.tumblr.com',
  vibe: {
    ir,
    reverbMix: 0.8,
    // Dark, cavernous — underground car park (already bass-heavy IR)
    eqLowGain: 2,
    eqMidGain: -4,
    eqHighGain: -3,
    compThreshold: -12,
    compRatio: 6,
    warmth: 2.5,
    formantMix: 0.5,
    stereoWidth: 1.6,
  },
};

export default scene;
