import type { Scene } from '../scene-types';
import stageBackground from './tartu-station-lobby.jpg';
import ir from './StPatricksChurchPatringtonPosition1.m4a';

const scene: Scene = {
  name: 'tartu',
  icon: 'tabler-building-bank',
  stageBackground,
  imageCredit: 'Indrek Mustimets',
  creditUrl: 'https://www.instagram.com/indrekmustimets/',
  vibe: {
    ir,
    reverbMix: 0.75,
    // Elegant, crystalline — church acoustics, train station lobby
    eqMidFreq: 3000,
    eqMidGain: 2,
    eqHighGain: 3,
    eqLowGain: -1,
    warmth: 1.1,
    formantQ: 1.4,
    stereoWidth: 1.3,
  },
};

export default scene;
