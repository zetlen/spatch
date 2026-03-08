import type { Scene } from '../scene-types';
import stageBackground from './jakarta-night.jpg';
import ir from './TyndallBruceMonument.m4a';

const scene: Scene = {
  name: 's-c-b-d',
  stageBackground,
  imageCredit: 'Mohammed Alim',
  creditUrl: 'https://www.pexels.com/@apyfz/',
  vibe: {
    ir,
    reverbMix: 0.75,
  },
};

export default scene;
