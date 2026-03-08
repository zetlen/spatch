import type { Scene } from '../scene-types';
import stageBackground from './tartu-station-lobby.jpg';
import ir from './StPatricksChurchPatringtonPosition1.m4a';

const scene: Scene = {
  name: 'tartu',
  stageBackground,
  imageCredit: 'Indrek Mustimets',
  creditUrl: 'https://www.instagram.com/indrekmustimets/',
  vibe: {
    ir,
    reverbMix: 0.75,
  },
};

export default scene;
