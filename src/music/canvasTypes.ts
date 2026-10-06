import type { PerformerRole, SoundId } from '../audio/types';

export type WorldId = 'dreamland' | 'drum_circle' | 'pop_star' | 'rock_monster' | 'salsa_party' | 'weird_cabinet' | 'zouk' | 'flamenco' | 'tango';
export type CanvasTool = 'crayon' | 'dots' | 'spray' | 'stamp' | 'boom' | 'fill' | 'eraser';
export type DrawTool = Exclude<CanvasTool, 'eraser'>;
export type GenericStampKind = 'cat' | 'bunny' | 'bear' | 'frog' | 'panda' | 'puppy' | 'chick' | 'fox' | 'penguin' | 'star' | 'rocket' | 'flower' | 'lightning';
export type StampKind = string;

export interface CanvasPoint { x: number; y: number; }

/**
 * Constant-time summary of a pointer gesture. The full point list is retained
 * for drawing, but music does not need to rescan it on every live audition.
 */
export interface GestureStats {
  pointCount: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sumY: number;
  totalDistance: number;
  upDistance: number;
  downDistance: number;
  directionChanges: number;
  lastDx: number;
  lastDy: number;
  minYIndex: number;
  maxYIndex: number;
}

export interface CanvasMark {
  id: string;
  paletteIndex: number;
  tool: DrawTool;
  points: CanvasPoint[];
  size: number;
  seed: number;
  stampKind?: StampKind;
  gesture?: GestureStats;
  erasures?: Array<CanvasPoint & { radius?: number }>;
  fillMaskDataUrl?: string;
  bounds?: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface Performer {
  name: string;
  color: string;
  ink: string;
  role: PerformerRole;
  sound: SoundId;
  octave: number;
  drumNotes?: number[];
  pan?: number;
  room?: number;
  echo?: number;
}

export interface StampChoice {
  id: StampKind;
  label: string;
  glyph: string;
  technique?: string;
}

export interface WorldStudio {
  master: number;
  room: number;
  echo: number;
  feedback: number;
  release: number;
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
  relationReach: number;
  emotion: string;
  palette: Performer[];
  canvas: string;
  canvasInk: string;
  accent: string;
  stamps: StampChoice[];
  studio: WorldStudio;
}
