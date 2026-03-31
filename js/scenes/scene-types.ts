import type { ReverbConfig } from '../audio/master-types';

export interface Scene {
  name: string;
  icon: string;
  stageBackground: string;
  imageCredit: string;
  creditUrl?: string;
  reverb: ReverbConfig;
}
