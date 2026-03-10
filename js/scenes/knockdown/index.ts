import type { Scene } from '../scene-types';
import stageBackground from './knockdown-plaster.jpg';
import ir from './Basement.m4a';

const scene: Scene = {
  name: 'knockdown',
  icon: 'tabler-paint',
  stageBackground,
  imageCredit: 'me',
  creditUrl: 'https://jbz.fyi',
  vibe: {
    ir,
    reverbMix: 0.6,
    // Punchy, dry, close — basement plaster texture
    eqLowGain: 4,
    eqMidFreq: 2000,
    eqMidGain: 1,
    compThreshold: -8,
    compRatio: 4,
    compAttack: 0.002,
    warmth: 2.0,
    stereoWidth: 0.8,
  },
};

export default scene;
