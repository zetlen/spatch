import type { Scene } from '../scene-types';
import stageBackground from './mac-classic-mouse.jpg';
import ir from './MidiverbMark2Preset29.m4a';

const scene: Scene = {
  name: 'putty-click',
  stageBackground,
  imageCredit: '/u/Born03',
  vibe: {
    ir,
    reverbMix: 0.7,
  },
};

export default scene;
