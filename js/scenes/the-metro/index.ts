import type { Scene } from '../scene-types';
import stageBackground from './bengaluru-train.jpg';
import ir from './PurnodesRailroadTunnel.m4a';

const scene: Scene = {
  name: 'the-metro',
  icon: 'tabler-train',
  stageBackground,
  imageCredit: '/u/ramenov3lord',
  creditUrl: 'https://reddit.com/u/ramenov3lord',
  vibe: {
    ir,
    reverbMix: 0.8,
    // Rumbling, diffuse — long railroad tunnel (already resonant low-end IR)
    eqLowFreq: 150,
    eqLowGain: 2,
    eqMidFreq: 600,
    eqMidGain: -3,
    eqHighGain: -2,
    compThreshold: -14,
    compRatio: 4,
    warmth: 2,
    stereoWidth: 1.8,
    reverbPreDelay: 0.06,
  },
};

export default scene;
