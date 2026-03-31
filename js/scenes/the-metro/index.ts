import type { Scene } from '../scene-types';
import stageBackground from './bengaluru-train.jpg';
import ir from './PurnodesRailroadTunnel.m4a';

const scene: Scene = {
  name: 'the-metro',
  icon: 'tabler-train',
  stageBackground,
  imageCredit: '/u/ramenov3lord',
  creditUrl: 'https://reddit.com/u/ramenov3lord',
  reverb: { ir, reverbMix: 0.8, reverbPreDelay: 0.06 },
};

export default scene;
