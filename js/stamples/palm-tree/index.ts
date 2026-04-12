import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'Ocean Wave',
  svgRaw,
  sampleUrl,
  referencePitch: 277,
  shapeAreaCoeff: 1.2,
  gain: 2.5,
};

export default stample;
