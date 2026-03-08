import type { VibeOptions } from '../audio/vibe';

export interface Scene {
  name: string;
  stageBackground: string;
  imageCredit: string;
  creditUrl?: string;
  vibe: Partial<VibeOptions>;
}
