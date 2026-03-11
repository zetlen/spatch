import type { Scene } from '../scene-types';
import stageBackground from './grout.jpg';
import ir from './EmptyApartmentBedroom.m4a';

const scene: Scene = {
  name: 'grout',
  icon: 'tabler-wall',
  stageBackground,
  imageCredit: 'Alf van Beem',
  creditUrl: 'https://commons.wikimedia.org/wiki/User:Alfvanbeem',
  vibe: {
    ir,
    reverbMix: 0.75,
    // Warm, intimate — small bedroom
    eqLowGain: 1,
    eqMidFreq: 1400,
    eqMidGain: 2,
    eqHighGain: -1,
    warmth: 2.2,
    formantMix: 0.8,
    brightnessQ: 0.6,
    compRatio: 2.5,
    combMix: 0.4,
    combFreq: 0.012,
  },
};

export default scene;
