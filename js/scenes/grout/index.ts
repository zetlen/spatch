import type { Scene } from '../scene-types';
import stageBackground from './grout.jpg';
import ir from './EmptyApartmentBedroom.m4a';

const scene: Scene = {
  name: 'grout',
  icon: 'tabler-wall',
  stageBackground,
  imageCredit: 'Alf van Beem',
  creditUrl: 'https://commons.wikimedia.org/wiki/User:Alfvanbeem',
  reverb: { ir, reverbMix: 0.75 },
};

export default scene;
