import type { Scene } from '../scene-types';
import stageBackground from './jakarta-night.jpg';
import ir from './TyndallBruceMonument.m4a';

const scene: Scene = {
  name: 's-c-b-d',
  icon: 'tabler-building-skyscraper',
  stageBackground,
  imageCredit: 'Mohammed Alim',
  creditUrl: 'https://www.pexels.com/@apyfz/',
  vibe: {
    ir,
    reverbMix: 0.75,
    // Shimmering, nocturnal — Jakarta city lights
    eqHighFreq: 6000,
    eqHighGain: 4,
    eqLowGain: 1,
    warmth: 1.4,
    formantMix: 0.6,
    stereoWidth: 1.4,
    compThreshold: -14,
  },
};

export default scene;
