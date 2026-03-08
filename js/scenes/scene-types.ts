import type { VibeOptions } from '../audio/vibe';

export interface Scene {
  name: string;
  stageBackground: string;
  imageCredit: string;
  vibe: Partial<VibeOptions>;
}
