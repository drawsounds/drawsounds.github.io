import type { NoteEvent, PerformerRole, ProductionGesture, SoundBank } from '../audio/types';

export type WorldId = 'dreamland' | 'drum_circle' | 'pop_star' | 'rock_monster' | 'salsa_party' | 'weird_cabinet' | 'zouk' | 'flamenco' | 'tango';
export type CanvasTool = 'crayon' | 'dots' | 'spray' | 'stamp' | 'boom' | 'fill' | 'eraser';
export type DrawTool = Exclude<CanvasTool, 'eraser'>;
export type GenericStampKind = 'cat' | 'bunny' | 'bear' | 'frog' | 'panda' | 'puppy' | 'chick' | 'fox' | 'penguin' | 'star' | 'rocket' | 'flower' | 'lightning';
export type StampKind = string;

export interface CanvasPoint { x: number; y: number; }
export interface CanvasMark {
  id: string;
  paletteIndex: number;
  tool: DrawTool;
  points: CanvasPoint[];
  size: number;
  seed: number;
  stampKind?: StampKind;
  frozenEvents?: NoteEvent[];
  frozenWorldId?: WorldId;
  erasures?: Array<CanvasPoint & { radius?: number }>;
  fillDataUrl?: string;
  fillMaskDataUrl?: string;
  bounds?: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface Performer {
  name: string;
  color: string;
  ink: string;
  role: PerformerRole;
  bank: SoundBank;
  program: number;
  fallbackProgram?: number;
  octave: number;
  tone?: NoteEvent['tone'];
  drumNotes?: number[];
  pan?: number;
  room?: number;
  echo?: number;
  drive?: number;
  production?: ProductionGesture;
}

export interface StampChoice {
  id: StampKind;
  label: string;
  glyph: string;
  technique?: string;
}

export interface WorldSection { name: string; weight: number; energy: number; }
export interface WorldStudio {
  master: number;
  room: number;
  echo: number;
  feedback: number;
  release: number;
  drive: number;
  echoBeats: [number, number];
  lowpass: number;
}

export interface WorldConfig {
  id: WorldId;
  label: string;
  littleName: string;
  tempo: number;
  key: number;
  scale: number[];
  progression: number[][];
  totalBeats: number;
  sections: WorldSection[];
  relationReach: number;
  emotion: string;
  palette: Performer[];
  canvas: string;
  canvasInk: string;
  accent: string;
  stamps: StampChoice[];
  studio: WorldStudio;
}
