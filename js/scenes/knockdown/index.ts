import type { Scene } from '../scene-types';
import stageBackground from './knockdown-plaster.jpg';
import ir from './Basement.m4a';

const scene: Scene = {
  name: 'knockdown',
  icon: 'tabler-paint',
  stageBackground,
  imageCredit: 'me',
  creditUrl: 'https://jbz.fyi',
  reverb: { ir, reverbMix: 0.6 },
};

export default scene;
