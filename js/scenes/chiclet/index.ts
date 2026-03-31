import type { Scene } from '../scene-types';
import stageBackground from './chairpillows.jpg';
import ir from './DomesticLivingRoom.m4a';

const scene: Scene = {
  name: 'chiclet',
  icon: 'tabler-armchair',
  stageBackground,
  imageCredit: 'me',
  creditUrl: 'https://jbz.fyi',
  reverb: { ir, reverbMix: 0.7 },
};

export default scene;
