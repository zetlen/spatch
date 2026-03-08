import type { Scene } from '../scene-types';
import stageBackground from './fdr-water-sculpture.jpg';
import ir from './StMarysAbbeyReconstructionPhase2.m4a';

const scene: Scene = {
  name: 'four-freedoms',
  stageBackground,
  imageCredit: 'Archetonic',
  vibe: {
    ir,
    reverbMix: 0.8,
  },
};

export default scene;
