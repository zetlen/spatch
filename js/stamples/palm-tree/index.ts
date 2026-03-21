import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'palm-tree',
  svgRaw,
  sampleUrl,
  referencePitch: 277,
  shapeAreaCoeff: 1.2,
  gainExponent: 1.0,
  formantMaxQ: 4,
  // Rough hull around the palm tree silhouette (viewBox: 390 565 385 360)
  hull: 'M 630,575 L 670,580 L 765,655 L 740,685 L 665,695 L 665,912 L 625,912 L 525,860 L 510,810 L 570,710 L 400,745 L 450,710 L 455,620 L 480,615 L 590,640 L 595,575 Z',
};

export default stample;
