import type { Scene } from '../scene-types';
import stageBackground from './abandoned-macys.jpg';
import ir from './R1NuclearReactorHall.m4a';

const scene: Scene = {
  name: 'coming-soon',
  icon: 'tabler-building-warehouse',
  stageBackground,
  imageCredit: 'Deven Smith',
  creditUrl: 'https://reddit.com/u/deven_smith_',
  vibe: {
    ir,
    reverbMix: 0.7,
    // Eerie, vast — nuclear reactor hall
    eqLowGain: 2,
    eqMidFreq: 900,
    eqMidGain: -4,
    eqMidQ: 2,
    eqHighGain: 2,
    warmth: 1.6,
    formantMix: 0.4,
    stereoWidth: 1.7,
    reverbPreDelay: 0.08,
  },
};

export default scene;
