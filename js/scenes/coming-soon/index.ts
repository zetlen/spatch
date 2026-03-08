import type { Scene } from '../scene-types';
import stageBackground from './abandoned-macys.jpg';
import ir from './R1NuclearReactorHall.m4a';

const scene: Scene = {
  name: 'coming-soon',
  stageBackground,
  imageCredit: 'Deven Smith',
  creditUrl: 'https://reddit.com/u/deven_smith_',
  vibe: {
    ir,
    reverbMix: 0.7,
  },
};

export default scene;
