export type PerformerRole = 'drums' | 'bass' | 'harmony' | 'melody' | 'texture' | 'human';
export type SoundBank = 'gm' | 'odd' | 'bandoneon' | 'nylon' | 'finger_bass' | 'world_perc' | 'clean_guitar' | 'flamenco_strum' | 'piano_kw' | 'tenor_sax' | 'harp' | 'tubular_bells' | 'ocarina' | 'lately_bass' | 'acoustic_drums';
export type ProductionGesture = 'dry' | 'bloom' | 'smear';

export interface NoteEvent {
  pitch: string;
  frequency: number;
  timeOffset: number;
  duration: number;
  velocity: number;
  articulation?: 'staccato' | 'legato' | 'accent' | 'tenuto' | 'tremolo' | 'pizzicato' | 'marcato';
  bank?: SoundBank;
  program?: number;
  fallbackProgram?: number;
  drumMidi?: number;
  tone?: 'clean' | 'warm' | 'dark' | 'bright' | 'wide' | 'soft' | 'gritty';
  glideToFrequency?: number;
  production?: ProductionGesture;
  motion?: number;
  channelIndex?: number;
  channelRole?: PerformerRole;
  sourceMarkId?: string;
  relationshipGenerated?: boolean;
  canvasX?: number;
  canvasY?: number;
  sourceTool?: 'crayon'|'dots'|'spray'|'stamp'|'boom'|'fill';
  technique?: string;
  pan?: number;
  room?: number;
  echo?: number;
  drive?: number;
}

export interface Phrase {
  id: string;
  sourceMarkId: string;
  performerIndex: number;
  startTime: number;
  duration: number;
  events: NoteEvent[];
  energy: number;
  density: number;
}

export interface Section {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  intensity: number;
  phrases: Phrase[];
}

export interface Song {
  id: string;
  worldId: string;
  baseTempo: number;
  totalDuration: number;
  sections: Section[];
}

export interface StudioState {
  worldId: string;
  tempo: number;
  sectionIndex: number;
  sectionEnergy: number;
}

export interface TransportState {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  currentSectionIndex: number;
  activePhraseIds: string[];
}
