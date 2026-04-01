import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'Glass Bell',
  svgRaw,
  sampleUrl,
  referencePitch: 550,
  shapeAreaCoeff: 0.8,
  gainExponent: 1,
  handles: { n: [35, 10], e: [85, 10], s: [90, 220], w: [30, 220] },
};

export default stample;
