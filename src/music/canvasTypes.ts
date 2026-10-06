import type { NoteEvent, PerformerRole, SoundId } from '../audio/types';

export type WorldId = 'dreamland' | 'drum_circle' | 'pop_star' | 'rock_monster' | 'salsa_party' | 'weird_cabinet' | 'zouk' | 'flamenco' | 'tango';
export type CanvasTool = 'crayon' | 'dots' | 'spray' | 'stamp' | 'boom' | 'fill' | 'eraser';
export type DrawTool = Exclude<CanvasTool, 'eraser'>;
export type StampKind = 'cat' | 'frog' | 'panda' | 'star' | 'rocket' | 'flower' | 'lightning';

export interface CanvasPoint { x: number; y: number; }

/** Notes captured from the live drawing performance and reused for playback. */
export interface CapturedPerformanceEvent extends NoteEvent {
  /** Point index in the original stroke when this audition voice was heard. */
  pointIndex: number;
  /** Wall-clock seconds from pointer-down, retained as a secondary feel cue. */
  gestureTime: number;
}

export interface LivePerformanceCapture {
  worldId: WorldId;
  events: CapturedPerformanceEvent[];
}

/** Incremental gesture summary used by the live music interpreter. */
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
  performance?: LivePerformanceCapture;
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
  technique?: string;
}

export type WorldInteraction = 'float' | 'circle' | 'hook' | 'lock' | 'clave' | 'odd' | 'sway' | 'compas' | 'tension';

export interface WorldFeel {
  grid: number;
  snap: number;
  swing: number;
  sustain: number;
  pulse: number[];
  pulseStep: number;
  interaction: WorldInteraction;
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
  tempo: number;
  key: number;
  scale: number[];
  progression: number[][];
  totalBeats: number;
  relationReach: number;
  palette: Performer[];
  canvas: string;
  canvasInk: string;
  accent: string;
  stamps: StampChoice[];
  feel: WorldFeel;
  studio: WorldStudio;
}
