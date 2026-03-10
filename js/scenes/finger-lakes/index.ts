import type { Scene } from '../scene-types';
import stageBackground from './finger-lakes-mall.jpg';
import ir from './FalklandPalaceRoyalTennisCourt.m4a';

const scene: Scene = {
  name: 'finger-lakes',
  icon: 'tabler-fountain-off',
  stageBackground,
  imageCredit: 'Ed the Punk Rock Guy',
  creditUrl: 'https://reddit.com/u/Chicky_P00t',
  vibe: {
    ir,
    reverbMix: 0.75,
    // Spacious, airy — cavernous palace court
    eqLowGain: 2,
    eqMidGain: -2,
    warmth: 1.2,
    stereoWidth: 1.5,
    compRatio: 2,
  },
};

export default scene;
