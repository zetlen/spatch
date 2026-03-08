import type { Scene } from '../scene-types';
import stageBackground from './knockdown-plaster.jpg';
import ir from './Basement.m4a';

const scene: Scene = {
  name: 'knockdown',
  stageBackground,
  imageCredit: 'me',
  vibe: {
    ir,
    reverbMix: 0.6,
  },
};

export default scene;
