import type { Scene } from '../scene-types';
import stageBackground from './abandoned-macys.jpg';
import ir from './R1NuclearReactorHall.m4a';

const scene: Scene = {
  name: 'coming-soon',
  icon: 'tabler-building-warehouse',
  stageBackground,
  imageCredit: 'Deven Smith',
  creditUrl: 'https://reddit.com/u/deven_smith_',
  reverb: { ir, reverbMix: 0.7, reverbPreDelay: 0.08 },
};

export default scene;
