import type { Scene } from '../scene-types';
import stageBackground from './chairpillows.jpg';
import ir from './DomesticLivingRoom.m4a';

const scene: Scene = {
  name: 'chiclet',
  stageBackground,
  imageCredit: 'me',
  vibe: {
    ir,
    reverbMix: 0.7,
  },
};

export default scene;
