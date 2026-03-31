import type { Scene } from '../scene-types';
import stageBackground from './tartu-station-lobby.jpg';
import ir from './StPatricksChurchPatringtonPosition1.m4a';

const scene: Scene = {
  name: 'tartu',
  icon: 'tabler-building-bank',
  stageBackground,
  imageCredit: 'Indrek Mustimets',
  creditUrl: 'https://www.instagram.com/indrekmustimets/',
  reverb: { ir, reverbMix: 0.75 },
};

export default scene;
