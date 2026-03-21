import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'champagne',
  svgRaw,
  sampleUrl,
  referencePitch: 550,
  shapeAreaCoeff: 0.8,
  gainExponent: 1.0,
  formantMaxQ: 4,
  // Simplified hull following the flute outline
  hull: 'M 35,10 L 85,10 L 85,80 L 65,115 L 65,200 L 90,215 L 90,220 L 30,220 L 30,215 L 55,200 L 55,115 L 35,80 Z',
};

export default stample;
