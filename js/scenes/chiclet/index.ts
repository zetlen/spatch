import type { Scene } from '../scene-types';
import stageBackground from './chairpillows.jpg';
import ir from './DomesticLivingRoom.m4a';

const scene: Scene = {
  name: 'chiclet',
  stageBackground,
  imageCredit: 'me',
  creditUrl: 'https://jbz.fyi',
  vibe: {
    ir,
    reverbMix: 0.7,
    // Bright, present, playful — colorful pillows in a living room
    eqHighGain: 3,
    warmth: 1.8,
    stereoWidth: 1.2,
  },
};

export default scene;
