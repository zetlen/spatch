import type { Scene } from '../scene-types';
import stageBackground from './finger-lakes-mall.jpg';
import ir from './FalklandPalaceRoyalTennisCourt.m4a';

const scene: Scene = {
  name: 'finger-lakes',
  stageBackground,
  imageCredit: 'Ed the Punk Rock Guy',
  vibe: {
    ir,
    reverbMix: 0.75,
  },
};

export default scene;
