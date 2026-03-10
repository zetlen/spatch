import type { Scene } from '../scene-types';
import stageBackground from './fdr-water-sculpture.jpg';
import ir from './StMarysAbbeyReconstructionPhase2.m4a';

const scene: Scene = {
  name: 'four-freedoms',
  icon: 'tabler-building-monument',
  stageBackground,
  imageCredit: 'Archetonic',
  creditUrl: 'https://archetonic.mx/studio',
  vibe: {
    ir,
    reverbMix: 0.8,
    // Majestic, clean — abbey ruins, stone and water
    eqMidFreq: 800,
    eqMidGain: 2,
    eqHighGain: 1,
    compThreshold: -14,
    warmth: 1.3,
    formantMix: 0.8,
  },
};

export default scene;
