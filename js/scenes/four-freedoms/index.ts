import type { Scene } from '../scene-types';
import stageBackground from './fdr-water-sculpture.jpg';
import ir from './StMarysAbbeyReconstructionPhase2.m4a';

const scene: Scene = {
  name: 'four-freedoms',
  icon: 'tabler-building-monument',
  stageBackground,
  imageCredit: 'Archetonic',
  creditUrl: 'https://archetonic.mx/studio',
  reverb: { ir, reverbMix: 0.8 },
};

export default scene;
