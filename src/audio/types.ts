import type { SoundId } from './sounds';
export type { SoundId } from './sounds';

export type PerformerRole = 'drums' | 'bass' | 'harmony' | 'melody' | 'texture' | 'human';

export interface NoteEvent {
  midi: number;
  timeOffset: number;
  duration: number;
  velocity: number;
  articulation?: 'staccato' | 'legato' | 'accent' | 'tenuto' | 'marcato';
  sound: SoundId;
  glideToMidi?: number;
  channelIndex?: number;
  channelRole?: PerformerRole;
  canvasX?: number;
  canvasY?: number;
  pan?: number;
  room?: number;
  echo?: number;
}

export interface Phrase {
  sourceMarkId: string;
  startTime: number;
  events: NoteEvent[];
}

export interface Song {
  worldId: string;
  baseTempo: number;
  totalDuration: number;
  phrases: Phrase[];
}

export interface StudioState {
  worldId: string;
  tempo: number;
}

export interface TransportState {
  isPlaying: boolean;
  isPreparing: boolean;
  isAudioReady: boolean;
  audioError?: string;
  currentTime: number;
  totalDuration: number;
}
