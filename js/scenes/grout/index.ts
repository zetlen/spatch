import type { Scene } from '../scene-types';
import stageBackground from './grout.jpg';
import ir from './EmptyApartmentBedroom.m4a';

const scene: Scene = {
  name: 'grout',
  stageBackground,
  imageCredit: 'Alf van Beem',
  vibe: {
    ir,
    reverbMix: 0.75,
  },
};

export default scene;
