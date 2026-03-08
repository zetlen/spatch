import type { Scene } from '../scene-types';
import stageBackground from './mac-classic-mouse.jpg';
import ir from './MidiverbMark2Preset29.m4a';

const scene: Scene = {
  name: 'putty-click',
  stageBackground,
  imageCredit: '/u/Born03',
  creditUrl: 'https://reddit.com/u/Born03',
  vibe: {
    ir,
    reverbMix: 0.7,
    // Soft, retro, smooth — vintage Mac mouse
    eqLowGain: -2,
    eqMidFreq: 1200,
    eqMidGain: 3,
    eqHighGain: -2,
    warmth: 1.0,
    formantMix: 0.9,
    brightnessQ: 0.5,
    stereoWidth: 0.9,
  },
};

export default scene;
