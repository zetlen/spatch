import type { Scene } from '../scene-types';
import stageBackground from './mac-classic-mouse.jpg';
import ir from './MidiverbMark2Preset29.m4a';

const scene: Scene = {
  name: 'putty-click',
  icon: 'tabler-mouse-2',
  stageBackground,
  imageCredit: '/u/Born03',
  creditUrl: 'https://reddit.com/u/Born03',
  reverb: { ir, reverbMix: 0.7 },
};

export default scene;
