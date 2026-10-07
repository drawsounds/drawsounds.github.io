import type { NoteEvent, Phrase } from '../audio/types';
import { atOrThrow, cyclicAt, firstOrThrow } from '../utils/arrays';
import type { CanvasMark, CanvasPoint, GestureStats, Performer, WorldConfig } from './canvasTypes';
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const rng = (seed: number) => () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
} return h >>> 0; };
type EventSource = Partial<NoteEvent> & Pick<NoteEvent, 'sound'>;
export type PhraseContour = 'rise' | 'fall' | 'arch' | 'valley' | 'oscillate' | 'still';
export type PhraseCadence = 'open' | 'closed' | 'continue';
export interface PhraseIntent {
    startTime: number;
    beats: number;
    register: number;
    contour: PhraseContour;
    energy: number;
    density: number;
    tension: number;
    curvature: number;
    cadence: PhraseCadence;
    centerY: number;
    seed: number;
}
export interface PhraseMotif {
    steps: number[];
    rhythm: number[];
    gate: number[];
    signature: string;
}
export interface CompileResult {
    phrase: Phrase;
    motif?: PhraseMotif;
}
export function createGestureStats(p: CanvasPoint): GestureStats { return { pointCount: 1, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, minX: p.x, maxX: p.x, minY: p.y, maxY: p.y, sumY: p.y, totalDistance: 0, upDistance: 0, downDistance: 0, directionChanges: 0, lastDx: 0, lastDy: 0, minYIndex: 0, maxYIndex: 0 }; }
export function extendGestureStats(g: GestureStats, p: CanvasPoint): GestureStats {
    const dx = p.x - g.lastX, dy = p.y - g.lastY, d = Math.hypot(dx, dy), lastD = Math.hypot(g.lastDx, g.lastDy), index = g.pointCount;
    if (d > .001 && lastD > .001) {
        const dot = (dx * g.lastDx + dy * g.lastDy) / (d * lastD);
        if (dot < .25)
            g.directionChanges++;
    }
    if (p.y < g.minY) {
        g.minY = p.y;
        g.minYIndex = index;
    }
    if (p.y > g.maxY) {
        g.maxY = p.y;
        g.maxYIndex = index;
    }
    g.minX = Math.min(g.minX, p.x);
    g.maxX = Math.max(g.maxX, p.x);
    g.pointCount = index + 1;
    g.lastX = p.x;
    g.lastY = p.y;
    g.sumY += p.y;
    g.totalDistance += d;
    g.upDistance += Math.max(0, -dy);
    g.downDistance += Math.max(0, dy);
    g.lastDx = dx;
    g.lastDy = dy;
    return g;
}
export function gestureStats(mark: CanvasMark): GestureStats {
    if (mark.gesture)
        return mark.gesture;
    const points = mark.points.length ? mark.points : [{ x: 0.5, y: 0.5 }];
    let stats = createGestureStats(firstOrThrow(points, 'gesture points'));
    for (let index = 1; index < points.length; index++) {
        stats = extendGestureStats(stats, atOrThrow(points, index, 'gesture points'));
    }
    return stats;
}
export function markBounds(mark: CanvasMark) {
    if (mark.bounds)
        return mark.bounds;
    if (mark.tool === 'fill')
        return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const stats = gestureStats(mark);
    const pad = (mark.tool === 'stamp' || mark.tool === 'boom' ? 0.04 : 0.012) * mark.size;
    return {
        minX: clamp(stats.minX - pad),
        maxX: clamp(stats.maxX + pad),
        minY: clamp(stats.minY - pad),
        maxY: clamp(stats.maxY + pad),
    };
}
function event(midi: number, timeOffset: number, duration: number, velocity: number, extra: EventSource): NoteEvent {
    return {
        midi: Math.max(0, Math.min(127, Math.round(midi))),
        timeOffset: Math.max(0, timeOffset),
        duration: Math.max(0.04, duration),
        velocity: clamp(velocity, 0.05, 0.9),
        ...extra,
    };
}
function beatSeconds(world: WorldConfig): number {
    return 60 / world.tempo;
}
function chord(world: WorldConfig, absolute: number, total: number): number[] {
    const section = Math.floor(clamp(absolute / total, 0, 0.999) *
        Math.max(world.progression.length, Math.round(world.totalBeats / 4)));
    return cyclicAt(world.progression, section, `${world.id} progression`);
}
function chordDegree(values: readonly number[], index: number, fallback = 0): number {
    return values[index] ?? fallback;
}
function nearest(world: WorldConfig, target: number, absolute: number, total: number, chordBias = false, previous?: number, maxLeap = 7): number {
    const degrees = chordBias ? chord(world, absolute, total) : world.scale;
    let best = world.key;
    let bestDistance = Infinity;
    let nearBest = world.key;
    let nearDistance = Infinity;
    let hasNear = false;
    for (let octave = -3; octave <= 4; octave++) {
        for (const degree of degrees) {
            const midi = world.key + degree + octave * 12;
            const distance = Math.abs(midi - target);
            if (distance < bestDistance) {
                best = midi;
                bestDistance = distance;
            }
            if (previous !== undefined &&
                Math.abs(midi - previous) <= maxLeap &&
                distance < nearDistance) {
                nearBest = midi;
                nearDistance = distance;
                hasNear = true;
            }
        }
    }
    return previous !== undefined && hasNear ? nearBest : best;
}
function targetMidi(world: WorldConfig, performer: Performer, y: number): number {
    return world.key + (performer.octave - 4) * 12 + (0.5 - clamp(y)) * 18;
}
function extra(performer: Performer, index: number, point: CanvasPoint): EventSource {
    return {
        sound: performer.sound,
        channelIndex: index,
        channelRole: performer.role,
        canvasX: point.x,
        canvasY: point.y,
        ...(performer.pan !== undefined ? { pan: performer.pan } : {}),
        ...(performer.room !== undefined ? { room: performer.room } : {}),
        ...(performer.echo !== undefined ? { echo: performer.echo } : {}),
    };
}
function pointAt(mark: CanvasMark, phase: number): CanvasPoint {
    const points = mark.points;
    if (!points.length)
        return { x: 0.5, y: 0.5 };
    if (points.length === 1)
        return firstOrThrow(points, 'mark points');
    const position = clamp(phase) * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(position));
    const fraction = position - index;
    const a = atOrThrow(points, index, 'mark points');
    const b = atOrThrow(points, index + 1, 'mark points');
    return {
        x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction,
    };
}
function quantizeBeats(value: number, choices: readonly number[]): number {
    return choices.reduce((best, choice) => Math.abs(choice - value) < Math.abs(best - value) ? choice : best, firstOrThrow(choices, 'beat choices'));
}
export function phraseIntent(mark: CanvasMark, w: WorldConfig, total: number): PhraseIntent {
    const g = gestureStats(mark), b = markBounds(mark), span = Math.max(.015, b.maxX - b.minX), avgY = g.sumY / Math.max(1, g.pointCount), vertical = g.maxY - g.minY, delta = g.lastY - g.startY;
    let contour: PhraseContour = 'still';
    const both = Math.min(g.upDistance, g.downDistance), travel = Math.max(.001, g.upDistance + g.downDistance);
    if (g.directionChanges >= 3 || both / travel > .34)
        contour = 'oscillate';
    else if (Math.abs(delta) > .07)
        contour = delta < 0 ? 'rise' : 'fall';
    else if (vertical > .10) {
        const minPos = g.minYIndex / Math.max(1, g.pointCount - 1), maxPos = g.maxYIndex / Math.max(1, g.pointCount - 1);
        contour = minPos > .18 && minPos < .82 ? 'arch' : maxPos > .18 && maxPos < .82 ? 'valley' : 'oscillate';
    }
    const rawBeats = mark.tool === 'fill' ? w.totalBeats : span * w.totalBeats;
    const style = w.id === 'dreamland' ? 'serene' : (w.id === 'tango' || w.id === 'flamenco' || w.id === 'zouk') ? 'traditional' : 'wild';
    const choices = style === 'serene' ? [2, 4, 6, 8, 12] : style === 'traditional' ? [1, 2, 4, 6, 8] : [1, 2, 3, 4, 6, 8];
    const beats = mark.tool === 'boom' ? 2 : mark.tool === 'stamp' ? Math.max(1, quantizeBeats(rawBeats, choices)) : quantizeBeats(Math.max(1, rawBeats), choices);
    const normalizedTravel = clamp(g.totalDistance / Math.max(.08, span * 1.5));
    const toolEnergy = mark.tool === 'boom' ? .95 : mark.tool === 'spray' ? .78 : mark.tool === 'dots' ? .62 : mark.tool === 'stamp' ? .66 : mark.tool === 'fill' ? .36 : .52;
    const energy = clamp(toolEnergy * .72 + normalizedTravel * .20 + clamp(mark.size - 0.8, 0, .5) * .16);
    const density = clamp((g.pointCount / Math.max(2, beats)) * 0.10 + (mark.tool === 'spray' ? .38 : mark.tool === 'dots' ? .30 : mark.tool === 'boom' ? .24 : .10));
    const curvature = clamp(g.directionChanges / 5 + both / travel * .55);
    const tension = clamp(Math.abs(avgY - .5) * .55 + curvature * .35 + (contour === 'oscillate' ? .12 : 0));
    const cadence: PhraseCadence = (b.maxX > .86 || mark.tool === 'boom') ? 'closed' : beats >= 6 ? 'continue' : 'open';
    return { startTime: b.minX * total, beats, register: clamp(1 - avgY), contour, energy, density, tension, curvature, cadence, centerY: avgY, seed: mark.seed };
}
function patternForContour(contour: PhraseContour, length: number): number[] {
    const patterns: Record<PhraseContour, readonly number[]> = {
        rise: [0, 1, 2, 3, 4, 5],
        fall: [0, -1, -2, -3, -4, -5],
        arch: [0, 1, 3, 4, 2, 0],
        valley: [0, -2, -3, -1, 1, 0],
        oscillate: [0, 2, -1, 3, -2, 1],
        still: [0, 1, 0, -1, 0, 1],
    };
    const source = patterns[contour];
    return Array.from({ length }, (_, index) => cyclicAt(source, index, `${contour} contour`));
}
function motifFromIntent(intent: PhraseIntent, length: number, rhythm: readonly number[], previous: PhraseMotif | undefined, voiceOrdinal: number, wildness: number): PhraseMotif {
    const random = rng(intent.seed ^ hash(intent.contour));
    const phase = voiceOrdinal % 4;
    let steps = patternForContour(intent.contour, length);
    const lastRhythm = rhythm.length ? atOrThrow(rhythm, rhythm.length - 1, 'motif rhythm') : 0;
    const cycleSpan = Math.max(1, Math.ceil(lastRhythm + 0.5));
    let useRhythm = Array.from({ length }, (_, index) => cyclicAt(rhythm, index, 'motif rhythm') +
        Math.floor(index / rhythm.length) * cycleSpan);
    if (previous && phase !== 0) {
        steps = Array.from({ length }, (_, index) => cyclicAt(previous.steps, index, 'previous motif steps'));
        useRhythm = Array.from({ length }, (_, index) => cyclicAt(previous.rhythm, index, 'previous motif rhythm'));
        if (phase === 1) {
            const index = Math.min(length - 1, 1 + Math.floor(random() * Math.max(1, length - 2)));
            steps[index] = atOrThrow(steps, index, 'motif steps') + (random() > 0.5 ? 1 : -1);
        }
        else if (phase === 2) {
            steps = steps.map((step, index) => index ? Math.round(-step * 0.75 + (index % 2 ? 1 : 0)) : 0);
            useRhythm = useRhythm.map((beat, index) => beat + (index > 0 && index % 2 ? 0.125 : 0));
        }
        else {
            steps = steps.map((step, index) => (index === length - 1 ? 0 : step));
        }
    }
    if (wildness > 0.55 && !previous) {
        steps = steps.map((step, index) => step +
            (index > 1 && random() < wildness * 0.28 ? (random() > 0.5 ? 2 : -2) : 0));
    }
    const gate = Array.from({ length }, (_, index) => index === length - 1 ? 0.9 : 0.58 + random() * 0.2);
    const signature = `${steps.join(',')}|${useRhythm
        .map((beat) => beat.toFixed(3))
        .join(',')}`;
    return { steps, rhythm: useRhythm, gate, signature };
}
function midiForStep(w: WorldConfig, p: Performer, intent: PhraseIntent, step: number, absolute: number, total: number, previous?: number, chordBias = false, maxLeap = 8) { const target = targetMidi(w, p, intent.centerY) + step * 2; return nearest(w, target, absolute, total, chordBias, previous, maxLeap); }
// Traditional & World-Specific Stamp Vocabularies
function flamencoTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const choice = w.stamps.find(s => s.id === mark.stampKind);
    const id = choice?.technique || mark.stampKind || 'rasgueado';
    const out: NoteEvent[] = [];
    const chordalGuitar = (p.sound === 'nylon_guitar' || p.sound === 'clean_guitar' || p.name.toLowerCase().includes('guitar')) && ['rasgueado', 'abanico', 'golpe', 'llamada', 'remate'].includes(id);
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'accent', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), ...(chordalGuitar ? { sound: 'flamenco_strum' as const } : {}), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'drums') {
        const isPalmas = p.name.toLowerCase().includes('palmas');
        if (isPalmas) {
            const claps = p.drumNotes || [59, 61, 60];
            const pat = id === 'remate' ? [0, .25, .5, .75, 1, 1.25] : id === 'llamada' ? [0, .5, .75, 1] : id === 'golpe' ? [0, .18, .5] : [0, .33, .66, 1, 1.33];
            pat.forEach((b, k) => add(cyclicAt(claps, k, 'palmas notes'), b * beat, beat * .14, .52 + (k === 0 || k === pat.length - 1 ? .14 : 0), 'staccato'));
            return out;
        }
        const cajon = p.drumNotes || [48, 49, 50];
        const low = cajon[0] ?? 48, hi = cajon[2] ?? (cajon[1] ?? 50);
        if (id === 'remate') {
            [0, .25, .5, .75, 1].forEach((b, k) => add(k === 0 || k === 4 ? low : hi, b * beat, beat * .16, k === 0 || k === 4 ? .68 : .48, 'accent'));
        } else if (id === 'llamada') {
            [0, .5, .75, 1].forEach((b, k) => add(k < 2 ? low : hi, b * beat, beat * .18, .58 + (k === 3 ? .1 : 0), 'marcato'));
        } else if (id === 'golpe') {
            add(low, 0, beat * .22, .72, 'accent');
            add(hi, beat * .14, beat * .12, .54, 'staccato');
        } else {
            [0, .33, .66, 1, 1.33].forEach((b, k) => add(k % 2 === 0 ? low : hi, b * beat, beat * .18, .50 + (k === 0 ? .12 : 0), 'accent'));
        }
        return out;
    }
    if (p.role === 'bass') {
        if (id === 'picado' || id === 'alzapua') {
            [0, 1, 3, 1, 0].forEach((step, k) => add(base + step, k * beat * .24, beat * .22, .54 + (k === 0 ? .12 : 0), 'marcato'));
        } else if (id === 'golpe') {
            add(base, 0, beat * .22, .72, 'accent');
            add(base + 7, beat * .14, beat * .18, .48, 'staccato');
        } else if (id === 'remate') {
            [7, 5, 3, 1, 0].forEach((step, k) => add(base + step, k * beat * .22, beat * .20, .56 + (k === 4 ? .12 : 0), 'accent'));
        } else {
            [0, 1, 5, 0].forEach((step, k) => add(base + step, k * beat * .36, beat * .32, .52 + (k === 0 ? .1 : 0), 'tenuto'));
        }
        return out;
    }
    if (p.role === 'human') {
        if (id === 'llamada' || id === 'remate') {
            add(base + 7, 0, beat * 1.2, .64, 'accent', base + 3);
            add(base + 3, beat * .65, beat * 1.4, .56, 'tenuto');
        } else if (id === 'golpe') {
            add(base + 5, 0, beat * .32, .72, 'accent');
        } else {
            [0, 1, 3, 1, 0].forEach((step, k) => add(base + step, k * beat * .32, beat * .42, .48 + (k === 0 ? .12 : 0), 'legato'));
        }
        return out;
    }
    if (id === 'picado') {
        let prev: number | undefined;
        for (let k = 0; k < 8; k++) {
            const m = nearest(w, base + k, pt.x * total, total, k === 7, prev, 3);
            prev = m;
            add(m, k * beat * .18, beat * .16, .48, 'staccato');
        }
    } else if (id === 'alzapua') {
        [0, 7, 0, 3, 7, 3].forEach((d, k) => add(base + d, k * beat * .24, beat * .20, .5, k % 3 === 0 ? 'accent' : 'staccato'));
    } else if (id === 'golpe') {
        add(base + chordDegree(ch, 0), 0, beat * .16, .66, 'accent');
        add(base + chordDegree(ch, 1), beat * .08, beat * .12, .38, 'staccato');
    } else if (id === 'llamada') {
        [0, 1, 2, 0].forEach((x, k) => add(base + cyclicAt(ch, x, 'flamenco chord'), k * beat * .42, beat * .30, .58, k === 0 ? 'accent' : 'marcato'));
    } else if (id === 'remate') {
        [0, 2, 1, 0].forEach((x, k) => add(base + cyclicAt(ch, x, 'flamenco chord'), k * beat * .26, beat * .22, .55 + k * .02, 'accent'));
    } else {
        const pattern = id === 'abanico' ? [0, .11, .22, .38, .49, .60] : [0, .07, .14, .21, .36, .43];
        pattern.forEach((t, k) => ch.slice(0, 3).forEach((d, j) => add(base + d, t * beat + j * .025, beat * .34, .38 + (k === 0 ? .08 : 0), id === 'rasgueado' ? 'marcato' : 'accent')));
    }
    return out;
}

function tangoTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const choice = w.stamps.find(s => s.id === mark.stampKind);
    const id = choice?.technique || mark.stampKind || 'marcato4';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'accent', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'bass') {
        if (id === 'arrastre') {
            const e = add(base - 5, 0, beat * .38, .46, 'legato', base);
            e.glideToMidi = base;
            add(base, beat * .34, beat * .65, .68, 'marcato');
        } else if (id === 'marcato4') {
            [0, 1, 2, 3].forEach(b => add(base + (b % 2 === 0 ? 0 : 7), b * beat, beat * .42, b % 2 === 0 ? .62 : .45, 'marcato'));
        } else if (id === 'marcato2') {
            [0, 2].forEach(b => add(base + (b === 0 ? 0 : 7), b * beat, beat * .62, .64, 'marcato'));
        } else if (id === 'sincopa') {
            [0, .75, 1.5, 2.75].forEach((b, k) => add(base + (k % 2 ? 7 : 0), b * beat, beat * .34, .54 + (k % 2 ? .08 : 0), 'accent'));
        } else if (id === 'milonga') {
            [0, .75, 1.5, 2.0, 2.75, 3.5].forEach((b, k) => add(base + (k % 3 === 0 ? 0 : 7), b * beat, beat * .28, .50 + (k === 0 ? .12 : 0), 'staccato'));
        } else if (id === 'yumba') {
            [0, 2].forEach(b => add(base, b * beat, beat * .52, .68, 'accent'));
        } else {
            [0, -2, -4, 0, 3, 0].forEach((d, k) => add(base + d, k * beat * .32, beat * .38, .48 + (k === 0 ? .1 : 0), 'tenuto'));
        }
        return out;
    }
    if (p.role === 'melody') {
        if (id === 'arrastre') {
            add(base + 3, 0, beat * .42, .48, 'legato', base + 7);
            add(base + 7, beat * .38, beat * 1.2, .64, 'tenuto', base + 12);
            add(base + 12, beat * 1.1, beat * 1.5, .58, 'tenuto');
        } else if (id === 'sincopa') {
            [0, .75, 1.5, 2.75].forEach((b, k) => add(base + cyclicAt([3, 7, 8, 12], k, 'tango sincopa melody'), b * beat, beat * .32, .55 + (k % 2 ? .08 : 0), 'accent'));
        } else if (id === 'milonga') {
            [0, .75, 1.5, 2.0, 2.75].forEach((b, k) => add(base + cyclicAt([0, 3, 7, 5, 2], k, 'tango milonga melody'), b * beat, beat * .26, .52 + (k === 0 ? .1 : 0), 'staccato'));
        } else if (id === 'yumba') {
            add(base + 12, 0, beat * .75, .66, 'accent');
            add(base + 7, beat * 1.0, beat * .65, .42, 'tenuto');
            add(base + 11, beat * 2.0, beat * .85, .64, 'accent');
        } else if (id === 'bordoneo') {
            [0, 7, 3, 7, 0, 11].forEach((d, k) => add(base + d, k * beat * .34, beat * .44, .48 + (k === 0 ? .1 : 0), 'tenuto'));
        } else {
            [0, 2].forEach((b, k) => add(base + (k === 0 ? 7 : 12), b * beat, beat * .85, .60, 'marcato'));
        }
        return out;
    }
    // Harmony: bandoneon / piano chords
    const addChord = (t: number, v = .5, d = beat * .42) => ch.slice(0, 3).forEach((x, j) => out.push(event(base + x, t + j * .018, d, v - (j * .025), { ...extra(p, i, pt), articulation: id.startsWith('marcato') ? 'marcato' : 'accent' })));
    if (id === 'marcato2') {
        [0, 2].forEach(b => addChord(b * beat, .56, beat * .6));
    } else if (id === 'marcato4') {
        [0, 1, 2, 3].forEach(b => addChord(b * beat, .50 + (b === 0 ? .08 : 0), beat * .42));
    } else if (id === 'sincopa') {
        [0, .75, 1.5, 2.75].forEach((b, k) => addChord(b * beat, .49 + (k % 2 ? .08 : 0), beat * .38));
    } else if (id === 'arrastre') {
        const target = base + chordDegree(ch, 0);
        for (let k = 0; k < 4; k++) {
            const m = target - 5 + k * 2;
            const e = event(m, k * beat * .12, beat * .26, .38 + k * .05, { ...extra(p, i, pt), articulation: 'legato' });
            if (k < 3) e.glideToMidi = m + 2;
            out.push(e);
        }
        addChord(beat * .52, .58, beat * .7);
    } else if (id === 'milonga') {
        [0, .75, 1.5, 2.0, 2.75, 3.5].forEach((b, k) => addChord(b * beat, .46 + (k % 3 === 0 ? .07 : 0), beat * .28));
    } else if (id === 'yumba') {
        [0, 1, 2, 3].forEach(b => addChord(b * beat, b % 2 === 0 ? .60 : .38, beat * (b % 2 === 0 ? .64 : .28)));
    } else {
        [0, 7, 3, 7, 0, 10].forEach((d, k) => out.push(event(base + d, k * beat * .34, beat * .48, .45 + (k === 0 ? .08 : 0), { ...extra(p, i, pt), articulation: 'tenuto' })));
    }
    return out;
}

function salsaPartyTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const kind = mark.stampKind || 'cat';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'accent', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'drums') {
        const drums = p.drumNotes || [62, 63, 64, 65, 60, 67, 68, 57];
        const congaSlap = drums[1] ?? 63, congaOpen = drums[2] ?? 64, bell = drums[5] ?? 67, rim = drums[6] ?? 68;
        if (kind === 'frog' || kind === 'panda') {
            // Authentic conga tumbao: heel/toe, slap on 1.5/2, open tones on 3.5 & 4
            [0, .75, 1.5, 2.25, 3.0, 3.5].forEach((b, k) => {
                const note = k === 2 ? congaSlap : k >= 4 ? congaOpen : rim;
                add(note, b * beat, beat * .20, k === 2 ? .68 : k >= 4 ? .60 : .40, k === 2 ? 'accent' : 'staccato');
            });
        } else if (kind === 'star' || kind === 'cat') {
            // Cascara / campana timbale bell burst
            [0, .375, .75, 1.25, 1.625, 2.0, 2.5].forEach((b, k) => add(k % 2 === 0 ? bell : rim, b * beat, beat * .16, .52 + (k % 2 === 0 ? .1 : 0), 'staccato'));
        } else if (kind === 'lightning') {
            // Unison mambo break cut
            add(bell, 0, beat * .14, .62, 'accent');
            add(congaSlap, beat * .5, beat * .14, .64, 'staccato');
            add(rim, beat * 1.5, beat * .22, .76, 'accent');
        } else {
            // Rocket / flower: timbale roll into open bell
            [0, .18, .36, .54, .72, .90].forEach((b, k) => add(rim, b * beat, beat * .12, .38 + k * .06, 'staccato'));
            add(bell, beat * 1.15, beat * .35, .72, 'accent');
        }
        return out;
    }
    if (p.role === 'bass') {
        // Authentic salsa baby bass tumbao: anticipates on upbeat of 2 and on 4 (never hits 1!)
        if (kind === 'frog' || kind === 'panda' || kind === 'cat') {
            add(base, beat * 1.5, beat * .65, .62, 'accent', base + 7);
            add(base + 7, beat * 3.0, beat * .80, .66, 'tenuto');
        } else if (kind === 'star') {
            [1.5, 2.25, 3.0, 3.75].forEach((b, k) => add(base + cyclicAt([0, 3, 7, 5], k, 'salsa bass walk'), b * beat, beat * .42, .54 + (k === 0 ? .1 : 0), 'marcato'));
        } else if (kind === 'rocket') {
            const e = add(base - 5, 0, beat * .6, .48, 'legato', base + 7);
            e.glideToMidi = base + 7;
            add(base + 7, beat * .55, beat * 1.1, .68, 'tenuto');
        } else if (kind === 'lightning') {
            add(base, beat * 1.5, beat * .28, .74, 'accent');
            add(base + 12, beat * 2.5, beat * .24, .70, 'accent');
        } else {
            [1.5, 3.0, 3.75, 4.5].forEach((b, k) => add(base + (k % 2 === 0 ? 0 : 7), b * beat, beat * .55, .55 + (k === 0 ? .1 : 0), 'accent'));
        }
        return out;
    }
    if (p.role === 'harmony') {
        // Montuno piano: syncopated broken octaves dancing over the clave
        if (kind === 'flower' || kind === 'cat' || kind === 'frog') {
            const montuno = [
                { b: .5, step: 12 }, { b: 1.0, step: 7 }, { b: 1.75, step: 12 },
                { b: 2.5, step: 10 }, { b: 3.25, step: 12 }, { b: 3.75, step: 7 }
            ];
            montuno.forEach((m, k) => {
                add(base + m.step, m.b * beat, beat * .36, .52 + (k % 2 === 0 ? .08 : 0), 'staccato');
                add(base + m.step - 12, m.b * beat + .015, beat * .34, .44, 'staccato');
            });
        } else if (kind === 'star') {
            [0, .33, .66, 1.0, 1.33, 1.66].forEach((b, k) => add(base + cyclicAt([0, 4, 7, 12, 16, 19], k, 'montuno arpeggio'), b * beat, beat * .24, .50 + (k === 0 ? .1 : 0), 'accent'));
        } else if (kind === 'lightning') {
            ch.slice(0, 3).forEach(d => add(base + d + 12, beat * 1.5, beat * .28, .72, 'accent'));
        } else {
            [0, .75, 1.5, 2.25].forEach((b, k) => ch.slice(0, 3).forEach((d, j) => add(base + d + (j === 2 ? 12 : 0), b * beat + j * .02, beat * .42, .48 + (k === 0 ? .08 : 0), 'accent')));
        }
        return out;
    }
    if (p.role === 'human') {
        // Coro shouts ("¡Azúcar!", "¡Vaya!")
        if (kind === 'lightning' || kind === 'cat') {
            add(base + 7, beat * .5, beat * .32, .74, 'accent');
            add(base + 12, beat * 1.5, beat * .55, .76, 'accent');
        } else {
            [base + 7, base + 10, base + 12].forEach((m, k) => add(m, k * beat * .45, beat * .65, .58 + k * .05, 'tenuto'));
        }
        return out;
    }
    // Melody: salsa brass / marimba
    if (kind === 'cat' || kind === 'star') {
        [0, .5, 1.25, 2.0].forEach((b, k) => add(base + cyclicAt([7, 10, 12, 14], k, 'mambo brass lick'), b * beat, beat * .28, .62 + (k === 0 ? .1 : 0), 'marcato'));
    } else if (kind === 'rocket') {
        const e = add(base + 3, 0, beat * .4, .52, 'legato', base + 12);
        e.glideToMidi = base + 12;
        add(base + 12, beat * .35, beat * 1.2, .74, 'accent');
    } else if (kind === 'lightning') {
        add(base + 12, 0, beat * .18, .76, 'accent');
        add(base + 15, beat * .35, beat * .26, .72, 'staccato');
    } else {
        [0, .33, .66, 1.2, 1.8].forEach((b, k) => add(base + cyclicAt([0, 3, 7, 10, 12], k, 'salsa melody lick'), b * beat, beat * .36, .54 + (k === 0 ? .1 : 0), 'tenuto'));
    }
    return out;
}

function zoukTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const kind = mark.stampKind || 'cat';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'tenuto', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'drums') {
        const drums = p.drumNotes || [36, 38, 42, 46, 39];
        const kick = drums[0] ?? 36, snare = drums[1] ?? 38, rim = drums[4] ?? (drums[2] ?? 42);
        // Definitive Caribbean zouk / kizomba riddim: Boom... ch-boom
        if (kind === 'panda' || kind === 'frog' || kind === 'flower') {
            add(kick, 0, beat * .22, .72, 'accent');
            add(rim, beat * .75, beat * .16, .60, 'staccato');
            add(snare, beat * 1.5, beat * .24, .64, 'accent');
            add(kick, beat * 2.0, beat * .20, .66, 'accent');
            add(rim, beat * 2.75, beat * .16, .58, 'staccato');
        } else if (kind === 'lightning') {
            add(kick, 0, beat * .18, .74, 'accent');
            add(rim, beat * .5, beat * .14, .62, 'staccato');
            add(snare, beat * 1.0, beat * .28, .78, 'accent');
        } else {
            add(kick, 0, beat * .22, .68, 'accent');
            add(rim, beat * .5, beat * .16, .52, 'staccato');
            add(rim, beat * .75, beat * .16, .58, 'staccato');
            add(snare, beat * 1.5, beat * .24, .65, 'accent');
        }
        return out;
    }
    if (p.role === 'bass') {
        // Warm sensual zouk sub-bass with smooth portamento sway
        if (kind === 'frog' || kind === 'panda') {
            const e = add(base, 0, beat * .85, .62, 'legato', base + 3);
            e.glideToMidi = base + 3;
            add(base + 3, beat * .75, beat * .90, .58, 'tenuto', base);
            add(base, beat * 1.75, beat * 1.2, .64, 'tenuto');
        } else if (kind === 'rocket') {
            const e = add(base - 5, 0, beat * .75, .50, 'legato', base + 7);
            e.glideToMidi = base + 7;
            add(base + 7, beat * .65, beat * 1.4, .66, 'tenuto');
        } else if (kind === 'lightning') {
            add(base, 0, beat * .28, .72, 'accent');
            add(base + 7, beat * .75, beat * .35, .64, 'staccato');
        } else {
            [0, 1.25, 2.0].forEach((b, k) => add(base + (k === 1 ? 3 : k === 2 ? 7 : 0), b * beat, beat * .75, .58 + (k === 0 ? .1 : 0), 'tenuto'));
        }
        return out;
    }
    if (p.role === 'melody') {
        // Silky smooth saxophone legato glide
        if (kind === 'rocket' || kind === 'cat') {
            add(base + 3, 0, beat * .5, .54, 'legato', base + 7);
            add(base + 7, beat * .4, beat * .6, .60, 'legato', base + 12);
            add(base + 12, beat * .9, beat * 1.8, .68, 'tenuto');
        } else if (kind === 'flower') {
            [base + 7, base + 10, base + 12, base + 15].forEach((m, k) => add(m, k * beat * .42, beat * .85, .52 + k * .04, 'legato'));
        } else if (kind === 'lightning') {
            add(base + 12, 0, beat * .24, .72, 'accent');
            add(base + 10, beat * .35, beat * .5, .64, 'tenuto');
        } else {
            [0, 3, 7, 10].forEach((d, k) => add(base + d, k * beat * .38, beat * .52, .54 + (k === 0 ? .1 : 0), 'tenuto'));
        }
        return out;
    }
    if (p.role === 'human') {
        // Airy choral sway
        [base + 7, base + 12].forEach((m, k) => add(m, k * beat * .04, beat * 2.2, .52 - k * .04, 'legato'));
        add(base + 15, beat * .6, beat * 1.8, .50, 'tenuto');
        return out;
    }
    // Harmony: zouk guitar / rhodes keys
    if (kind === 'star' || kind === 'cat') {
        [0, 4, 7, 11, 14].forEach((d, k) => add(base + d, k * beat * .18, beat * 1.4, .48 - k * .02, 'legato'));
    } else if (kind === 'flower') {
        ch.slice(0, 4).forEach((d, k) => add(base + d + 12, k * .04, beat * 2.4, .48 - k * .03, 'legato'));
    } else if (kind === 'lightning') {
        ch.slice(0, 3).forEach(d => add(base + d, 0, beat * .28, .66, 'accent'));
    } else {
        [0, .75, 1.5, 2.5].forEach((b, k) => ch.slice(0, 3).forEach((d, j) => add(base + d, b * beat + j * .02, beat * .55, .46 + (k === 0 ? .08 : 0), 'tenuto')));
    }
    return out;
}

function dreamlandTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, _intent: PhraseIntent) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const kind = mark.stampKind || 'star';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'legato', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'harmony') {
        // Celestial harp waterfall arpeggios
        if (kind === 'cat' || kind === 'star') {
            [0, 4, 7, 11, 14, 16, 19].forEach((d, k) => add(base + d, k * beat * .14, beat * (2.0 + k * .1), .42 + (k === 0 ? .1 : 0) - k * .015, 'legato'));
        } else if (kind === 'rocket') {
            [0, 2, 4, 7, 9, 12, 14, 16].forEach((d, k) => add(base + d, k * beat * .09, beat * 1.8, .36 + k * .035, 'legato'));
        } else if (kind === 'flower') {
            [0, 7, 12, 16, 19].forEach((d, k) => add(base + d, k * .08, beat * 3.2, .45 - k * .02, 'legato'));
        } else {
            [0, 7, 4, 9].forEach((d, k) => add(base + d, k * beat * .35, beat * 2.2, .48 + (k === 0 ? .08 : 0), 'legato'));
        }
        return out;
    }
    if (p.role === 'melody') {
        // Starlight chimes / tubular bells
        if (kind === 'star' || kind === 'lightning') {
            [12, 16, 19, 24, 28].forEach((d, k) => add(base + d, k * beat * .12, beat * 2.8, .50 + (k === 0 ? .14 : 0), 'staccato'));
        } else if (kind === 'rocket') {
            [7, 12, 16, 19, 24].forEach((d, k) => add(base + d, k * beat * .22, beat * 2.2, .44 + k * .04, 'tenuto'));
        } else {
            [12, 19, 16, 24].forEach((d, k) => add(base + d, k * beat * .45, beat * 2.4, .52, 'tenuto'));
        }
        return out;
    }
    if (p.role === 'bass') {
        // Deep slumber sub swell
        if (kind === 'panda' || kind === 'frog') {
            add(base, 0, beat * 2.4, .62, 'legato', base + 7);
            add(base + 7, beat * .9, beat * 2.2, .52, 'tenuto');
        } else if (kind === 'rocket') {
            const e = add(base - 12, 0, beat * 1.2, .48, 'legato', base);
            e.glideToMidi = base;
            add(base, beat * .8, beat * 2.5, .64, 'tenuto');
        } else {
            add(base, 0, beat * 3.0, .60, 'tenuto');
        }
        return out;
    }
    if (p.role === 'human') {
        // Angel breath choir swell
        if (kind === 'flower' || kind === 'star') {
            [0, 7, 12].forEach((d, k) => add(base + d, k * .06, beat * 3.4, .48 - k * .03, 'legato'));
            add(base + 16, beat * .8, beat * 2.8, .50, 'tenuto');
        } else {
            add(base + 7, 0, beat * 2.8, .54, 'legato', base + 12);
            add(base + 12, beat * 1.0, beat * 2.6, .56, 'tenuto');
        }
        return out;
    }
    // Texture: nebula pad / dream comet ocarina
    if (kind === 'rocket') {
        const e = add(base + 4, 0, beat * 1.1, .44, 'legato', base + 16);
        e.glideToMidi = base + 16;
        add(base + 16, beat * .85, beat * 2.5, .56, 'tenuto');
    } else if (kind === 'flower') {
        ch.slice(0, 3).forEach((d, k) => add(base + d + 12, k * .12, beat * 3.5, .40, 'legato'));
    } else {
        [0, 7, 12, 14].forEach((d, k) => add(base + d, k * beat * .35, beat * 2.6, .45, 'legato'));
    }
    return out;
}

function drumCircleTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, _total: number, i: number, _intent: PhraseIntent) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 };
    const kind = mark.stampKind || 'star';
    const notes = p.drumNotes?.length ? p.drumNotes : [48, 50, 52, 53, 58, 59, 60];
    const out: NoteEvent[] = [];
    const hit = (idx: number, rb: number, v: number, d = .16) => {
        out.push(event(cyclicAt(notes, idx, 'drum circle notes'), rb * beat, beat * d, v, extra(p, i, pt)));
    };
    if (kind === 'cat') {
        // Pounce slap: rapid flam into high crack
        hit(0, 0, .42, .08);
        hit(notes.length - 1, .06, .74, .14);
        hit(1, .35, .52, .12);
        hit(notes.length - 2, .75, .66, .16);
    } else if (kind === 'frog') {
        // Frog call: low dun-dun / djembe resonance
        hit(0, 0, .68, .26);
        hit(1, .28, .54, .22);
        hit(0, .65, .72, .28);
        hit(2, 1.1, .48, .18);
    } else if (kind === 'panda') {
        // Heavy tribal stomp
        [0, .75, 1.5, 2.25].forEach((b, k) => hit(k === 0 || k === 2 ? 0 : 1, b, k === 0 ? .80 : .60, .20));
    } else if (kind === 'star') {
        // Polyrhythmic call burst: 3 against 2
        [0, .33, .66, 1.0, 1.33, 1.66].forEach((b, k) => hit(k % notes.length, b, .54 + (k === 0 ? .18 : 0), .12));
    } else if (kind === 'rocket') {
        // Rolling hands: accelerating crescendo roll
        [0, .14, .26, .36, .44, .50, .62].forEach((b, k) => hit(k % 3, b, .36 + k * .065, .10));
        hit(0, .80, .78, .30);
    } else if (kind === 'flower') {
        // Circle response: interlocking communal pattern
        [0, .5, 1.0, 1.5, 2.0, 2.5].forEach((b, k) => hit(k % notes.length, b, .50 + (k % 2 === 0 ? .12 : 0), .18));
    } else {
        // Clap break: double rimshot crack + break
        hit(notes.length - 1, 0, .76, .12);
        hit(notes.length - 1, .08, .80, .12);
        hit(0, .45, .70, .22);
        hit(1, .85, .66, .18);
    }
    return out;
}

function popStarTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, _intent: PhraseIntent) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const kind = mark.stampKind || 'star';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'accent', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'drums') {
        const drums = p.drumNotes || [36, 38, 39, 42, 46];
        const kick = drums[0] ?? 36, snare = drums[1] ?? 38, clap = drums[2] ?? 39, hat = drums[3] ?? 42;
        if (kind === 'panda' || kind === 'frog') {
            [0, 1, 2, 3].forEach(b => { add(kick, b * beat, beat * .2, .76, 'accent'); add(snare, (b + .5) * beat, beat * .18, .68, 'accent'); });
        } else if (kind === 'rocket') {
            [0, .5, .75, 1.0, 1.25, 1.375, 1.5, 1.625].forEach((b, k) => add(snare, b * beat, beat * .12, .40 + k * .05, 'staccato'));
            add(kick, 1.8 * beat, beat * .3, .80, 'accent');
        } else if (kind === 'lightning') {
            add(kick, 0, beat * .22, .80, 'accent');
            add(snare, beat * .25, beat * .16, .72, 'staccato');
            add(clap, beat * .75, beat * .24, .76, 'accent');
        } else {
            [0, .33, .66, 1.0, 1.33].forEach((b, k) => add(k % 2 ? snare : (k === 0 ? kick : hat), b * beat, beat * .16, .64, 'staccato'));
        }
        return out;
    }
    if (p.role === 'bass') {
        if (kind === 'frog' || kind === 'panda') {
            [0, .25, .5, .75, 1.25].forEach((b, k) => add(base + (k % 2 ? 12 : 0), b * beat, beat * .20, .64 + (k === 0 ? .1 : 0), 'staccato'));
        } else if (kind === 'lightning') {
            const e = add(base + 12, 0, beat * .4, .74, 'legato', base - 12);
            e.glideToMidi = base - 12;
            add(base - 12, beat * .35, beat * 1.5, .78, 'tenuto');
        } else {
            [0, 7, 12, 7].forEach((d, k) => add(base + d, k * beat * .32, beat * .28, .62, 'accent'));
        }
        return out;
    }
    if (p.role === 'human') {
        if (kind === 'cat' || kind === 'star') {
            add(base + 7, 0, beat * .28, .66, 'staccato', base + 9);
            add(base + 9, beat * .25, beat * .32, .68, 'staccato', base + 12);
            add(base + 12, beat * .55, beat * .7, .74, 'accent');
        } else {
            ch.slice(0, 3).forEach((d, k) => add(base + d + 12, k * .06, beat * 1.6, .58, 'tenuto'));
        }
        return out;
    }
    if (p.role === 'harmony') {
        if (kind === 'flower' || kind === 'panda') {
            [0, .75, 1.5, 2.25].forEach((b, k) => ch.slice(0, 3).forEach((d, j) => add(base + d + 12, b * beat + j * .02, beat * .42, .54 + (k === 0 ? .1 : 0), 'accent')));
        } else if (kind === 'star') {
            [0, 4, 7, 11, 14, 16].forEach((d, k) => add(base + d, k * beat * .14, beat * .48, .52, 'staccato'));
        } else {
            ch.slice(0, 3).forEach(d => add(base + d + 12, 0, beat * .32, .70, 'accent'));
        }
        return out;
    }
    // Melody: saw hook / crystal shimmer
    if (kind === 'cat' || kind === 'star') {
        [0, 7, 9, 7].forEach((d, k) => add(base + d, k * beat * .28, beat * .24, .66 + (k === 0 ? .1 : 0), 'accent'));
    } else if (kind === 'rocket') {
        [0, 2, 4, 7, 9, 11, 12, 14].forEach((d, k) => add(base + d, k * beat * .14, beat * .22, .48 + k * .04, 'staccato'));
    } else if (kind === 'lightning') {
        add(base + 12, 0, beat * .18, .78, 'accent');
        add(base + 16, beat * .22, beat * .35, .72, 'staccato');
    } else {
        [0, 4, 7, 12, 14, 12].forEach((d, k) => add(base + d, k * beat * .22, beat * .32, .56, 'tenuto'));
    }
    return out;
}

function rockMonsterTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, _total: number, i: number, _intent: PhraseIntent) {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12;
    const kind = mark.stampKind || 'star';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'accent', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'drums') {
        const drums = p.drumNotes || [48, 50, 52, 53, 58, 59, 60];
        const kick = drums[0] ?? 48, snare = drums[1] ?? 50, crash = drums[6] ?? 60;
        if (kind === 'panda') {
            add(kick, 0, beat * .25, .72, 'accent');
            add(crash, 0, beat * .65, .70, 'accent');
            add(kick, beat * .5, beat * .18, .62, 'staccato');
            add(snare, beat * 1.0, beat * .25, .72, 'accent');
        } else if (kind === 'star' || kind === 'lightning') {
            add(kick, 0, beat * .2, .72, 'accent');
            add(crash, 0, beat * .85, .72, 'accent');
            add(snare, beat * .25, beat * .16, .68, 'staccato');
            add(snare, beat * .5, beat * .24, .72, 'accent');
        } else {
            [0, .33, .66, 1.0].forEach((b, k) => add(k % 2 ? snare : kick, b * beat, beat * .20, .68, 'accent'));
        }
        return out;
    }
    if (p.role === 'bass') {
        if (kind === 'frog') {
            const e = add(base, 0, beat * .55, .64, 'legato', base + 3);
            e.glideToMidi = base + 3;
            add(base + 3, beat * .5, beat * .6, .60, 'legato', base);
            add(base, beat * 1.0, beat * 1.2, .68, 'tenuto');
        } else if (kind === 'cat') {
            [0, 3, 5, 6, 5, 3].forEach((d, k) => add(base + d, k * beat * .24, beat * .22, .64 + (k === 0 ? .08 : 0), 'marcato'));
        } else {
            [0, 0, 7, 0, 5, 0].forEach((d, k) => add(base + d, k * beat * .26, beat * .24, .62, 'accent'));
        }
        return out;
    }
    if (p.role === 'melody') {
        // Solo lead: screaming pinch harmonics & bends
        if (kind === 'star' || kind === 'lightning') {
            const e = add(base + 12, 0, beat * .35, .68, 'legato', base + 15);
            e.glideToMidi = base + 15;
            add(base + 15, beat * .3, beat * 1.6, .72, 'tenuto');
        } else if (kind === 'rocket') {
            [0, 3, 5, 7, 10, 12, 15, 17].forEach((d, k) => add(base + d, k * beat * .14, beat * .24, .54 + k * .03, 'marcato'));
        } else {
            [0, 3, 5, 6, 5, 3, 0].forEach((d, k) => add(base + d, k * beat * .22, beat * .24, .64, 'accent'));
        }
        return out;
    }
    if (p.role === 'human') {
        // Arena shout ("HEY!")
        [0, 1.0].forEach(b => add(base + 7, b * beat, beat * .32, .72, 'accent'));
        return out;
    }
    // Harmony: rock guitar power chords
    if (kind === 'flower' || kind === 'panda') {
        [0, 7, 12].forEach(d => add(base + d, 0, beat * 2.8, .68, 'accent'));
    } else if (kind === 'cat') {
        [0, 3, 5, 6, 5].forEach((root, k) => {
            [0, 7, 12].forEach(d => add(base + root + d, k * beat * .32, beat * .28, .62, 'accent'));
        });
    } else if (kind === 'lightning') {
        [0, 7, 12].forEach(d => add(base + d, 0, beat * .28, .72, 'accent'));
    } else {
        [0, 1.0, 1.5].forEach(b => [0, 7, 12].forEach(d => add(base + d, b * beat, beat * .38, .64, 'accent')));
    }
    return out;
}

function weirdCabinetTechnique(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number): NoteEvent[] {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const choice = w.stamps.find(s => s.id === mark.stampKind);
    const id = choice?.technique || mark.stampKind || 'theremin';
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, sound: NoteEvent['sound'], art: NoteEvent['articulation'] = 'tenuto', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), sound, articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (id === 'theremin') {
        const start = nearest(w, base + 7, pt.x * total, total);
        const mid = nearest(w, base + 12, pt.x * total, total);
        const end = nearest(w, base + 14, pt.x * total, total);
        add(start, 0, beat * 0.9, 0.48, 'theremin', 'legato', mid);
        add(mid, beat * 0.35, beat * 0.9, 0.52, 'theremin', 'legato', end);
        add(end, beat * 0.75, beat * 1.4, 0.46, 'theremin', 'tenuto');
    } else if (id === 'hurdy_gurdy') {
        add(base - 12, 0, beat * 1.8, 0.50, 'hurdy_gurdy', 'tenuto');
        add(base - 5, 0, beat * 1.8, 0.42, 'hurdy_gurdy', 'tenuto');
        [0, 2, 3, 5, 3, 0].forEach((d, k) => {
            add(base + d, k * beat * 0.26, beat * 0.28, 0.45 + (k % 2 ? 0.05 : 0), 'hurdy_gurdy', k % 2 === 0 ? 'accent' : 'staccato');
        });
    } else if (id === 'glass_harmonica') {
        ch.slice(0, 4).forEach((d, k) => {
            add(base + d + 12, k * 0.06, beat * 2.2, 0.38 - k * 0.02, 'glass_harmonica', 'legato');
        });
        add(base + chordDegree(ch, 2, 7) + 24, beat * 0.3, beat * 1.8, 0.36, 'glass_harmonica', 'legato');
    } else if (id === 'musical_saw') {
        const m1 = nearest(w, base + 5, pt.x * total, total);
        const m2 = nearest(w, base + 10, pt.x * total, total);
        add(m1, 0, beat * 0.85, 0.46, 'musical_saw', 'legato', m2);
        add(m2, beat * 0.42, beat * 1.5, 0.50, 'musical_saw', 'tenuto', m1 + 2);
    } else if (id === 'waterphone') {
        [0, 6, 11, 13, 17].forEach((d, k) => {
            add(base + d + 7, k * beat * 0.16, beat * (1.6 + k * 0.2), 0.34 + k * 0.02, 'waterphone', 'legato');
        });
    } else if (id === 'nyckelharpa') {
        add(base - 7, 0, beat * 1.6, 0.46, 'nyckelharpa', 'tenuto');
        [0, 3, 7, 5].forEach((d, k) => {
            add(base + d, k * beat * 0.32, beat * 0.44, 0.48 + (k === 0 ? 0.08 : 0), 'nyckelharpa', 'accent');
        });
    } else if (id === 'ondioline') {
        [0, 2, 0, 2, 3, 5, 7].forEach((d, k) => {
            add(base + d, k * beat * 0.18, beat * 0.22, 0.46 + (k % 2 ? 0.06 : 0), 'ondioline', k === 0 ? 'accent' : 'staccato');
        });
    } else {
        ch.slice(0, 3).forEach((d, k) => {
            add(base + d, k * beat * 0.2, beat * 1.2, 0.42, 'theremin', 'tenuto');
        });
    }
    return out;
}

// Stable stamp gestures are interpreted through each world's own musical vocabulary.
function worldStampPhrase(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent) {
    if (w.id === 'flamenco')
        return flamencoTechnique(mark, w, p, total, i);
    if (w.id === 'tango')
        return tangoTechnique(mark, w, p, total, i);
    if (w.id === 'salsa_party')
        return salsaPartyTechnique(mark, w, p, total, i);
    if (w.id === 'zouk')
        return zoukTechnique(mark, w, p, total, i);
    if (w.id === 'dreamland')
        return dreamlandTechnique(mark, w, p, total, i, intent);
    if (w.id === 'drum_circle')
        return drumCircleTechnique(mark, w, p, total, i, intent);
    if (w.id === 'pop_star')
        return popStarTechnique(mark, w, p, total, i, intent);
    if (w.id === 'rock_monster')
        return rockMonsterTechnique(mark, w, p, total, i, intent);
    if (w.id === 'weird_cabinet')
        return weirdCabinetTechnique(mark, w, p, total, i);
    return [];
}
function boomPhrase(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, _intent: PhraseIntent, voiceOrdinal = 0): NoteEvent[] {
    const beat = beatSeconds(w), pt = mark.points[0] || { x: .5, y: .5 }, base = w.key + (p.octave - 4) * 12, ch = chord(w, pt.x * total, total);
    const out: NoteEvent[] = [];
    const add = (m: number, t: number, d: number, v: number, art: NoteEvent['articulation'] = 'accent', glide?: number) => {
        const e = event(m, t, d, v, { ...extra(p, i, pt), articulation: art });
        if (glide !== undefined) e.glideToMidi = glide;
        out.push(e);
        return e;
    };
    if (p.role === 'drums') {
        const drums = p.drumNotes || [36, 38, 42];
        const kick = drums[0] ?? 36, snare = drums[1] ?? 38, crash = drums[drums.length - 1] ?? 42;
        if (w.id === 'flamenco') {
            // Cajon double-golpe + palmas remate crack
            add(kick, 0, beat * .35, .88, 'accent');
            add(snare, beat * .05, beat * .22, .86, 'accent');
            add(drums[drums.length > 2 ? 2 : 0] ?? 42, beat * .14, beat * .18, .78, 'staccato');
        } else if (w.id === 'salsa_party') {
            // Timbale rimshot cascade roll + splash crash
            add(drums[1] ?? 38, 0, beat * .12, .82, 'staccato');
            add(drums[1] ?? 38, beat * .08, beat * .12, .86, 'staccato');
            add(crash, beat * .16, beat * 1.8, .88, 'accent');
            add(kick, beat * .16, beat * .35, .84, 'accent');
        } else if (w.id === 'zouk') {
            // Iconic zouk double kick hit + open hat splash
            add(kick, 0, beat * .28, .86, 'accent');
            add(kick, beat * .22, beat * .28, .88, 'accent');
            add(crash, beat * .22, beat * 1.5, .80, 'accent');
        } else if (w.id === 'drum_circle') {
            // Thunderous communal drum circle unison explosion
            add(drums[0] ?? 48, 0, beat * .45, .90, 'accent');
            add(drums[drums.length - 1] ?? 64, beat * .04, beat * .24, .85, 'accent');
            add(drums[1] ?? 51, beat * .12, beat * .20, .80, 'staccato');
            add(drums[2] ?? 66, beat * .22, beat * .40, .86, 'accent');
        } else {
            // Heavy stadium crash impact + kick + snare crack
            add(kick, 0, beat * .35, .88, 'accent');
            add(crash, 0, beat * 1.8, .85, 'accent');
            if (drums.length > 3) {
                add(drums[2] ?? 42, beat * .08, beat * .18, .72, 'staccato');
                add(drums[1] ?? 38, beat * .16, beat * .18, .76, 'staccato');
            }
            add(snare, beat * .26, beat * .30, .84, 'accent');
        }
        return out;
    }
    if (p.role === 'bass') {
        if (w.id === 'tango') {
            // Latigo (whip snap) slap pizzicato with arrastre scoop up into root
            const e = add(base - 12, 0, beat * .18, .88, 'marcato', base);
            e.glideToMidi = base;
            add(base, beat * .16, beat * 2.2, .86, 'tenuto');
        } else if (w.id === 'flamenco') {
            // Phrygian thumb-slap downbeat drop
            add(base + 12, 0, beat * .22, .86, 'accent', base);
            add(base, beat * .20, beat * 2.0, .84, 'tenuto');
        } else if (w.id === 'salsa_party') {
            // Fast tumbao slide into bottom root
            add(base + 7, 0, beat * .20, .84, 'accent', base);
            add(base, beat * .18, beat * 2.2, .86, 'tenuto');
        } else {
            // Massive sub-drop boom sliding into deep sub
            const e = add(base + 12, 0, beat * .5, .84, 'legato', base - 5);
            e.glideToMidi = base - 5;
            add(base - 5, beat * .45, beat * 2.5, .88, 'tenuto');
        }
        return out;
    }
    if (p.role === 'harmony') {
        const chordalGuitar = (p.sound === 'nylon_guitar' || p.sound === 'clean_guitar' || p.name.toLowerCase().includes('guitar'));
        if (w.id === 'tango') {
            // Bandoneon / Piano dramatic fuelle cluster sforzando
            ch.slice(0, 4).forEach((d, j) => {
                out.push(event(base + d, j * .01, beat * 1.6, .82 - j * .03, { ...extra(p, i, pt), articulation: 'marcato' }));
            });
            out.push(event(base - 12, 0, beat * 2.0, .86, { ...extra(p, i, pt), articulation: 'accent' }));
        } else if (w.id === 'flamenco') {
            // Explosive 5-finger rasgueado slam
            ch.slice(0, 4).forEach((d, j) => {
                out.push(event(base + d, j * .018, beat * 1.8, .84 - j * .02, {
                    ...extra(p, i, pt),
                    sound: 'flamenco_strum' as const,
                    articulation: 'accent'
                }));
            });
        } else if (w.id === 'salsa_party') {
            // Tutti mambo octave slam + bright chord crash
            ch.slice(0, 4).forEach((d, j) => {
                out.push(event(base + d + 12, j * .012, beat * 1.7, .80 - j * .02, { ...extra(p, i, pt), articulation: 'accent' }));
            });
            out.push(event(base, 0, beat * 1.6, .84, { ...extra(p, i, pt), articulation: 'accent' }));
        } else {
            ch.slice(0, 4).forEach((d, j) => {
                const e = event(base + d + (j === 3 ? 12 : 0), j * .012, beat * (w.id === 'dreamland' ? 2.8 : 1.8), .78 - j * .03, {
                    ...extra(p, i, pt),
                    ...(chordalGuitar ? { sound: 'flamenco_strum' as const } : {}),
                    articulation: 'accent'
                });
                out.push(e);
            });
        }
        return out;
    }
    if (p.role === 'human') {
        if (w.id === 'flamenco') {
            add(base + 7, 0, beat * .35, .88, 'accent', base + 12);
            add(base + 12, beat * .3, beat * 2.4, .84, 'tenuto');
        } else if (w.id === 'salsa_party') {
            add(base + 12, 0, beat * .28, .86, 'accent', base + 7);
            add(base + 7, beat * .25, beat * 2.0, .80, 'tenuto');
        } else {
            add(base + 7, 0, beat * .4, .86, 'accent', base + 12);
            add(base + 12, beat * .35, beat * 2.2, .82, 'tenuto');
        }
        return out;
    }
    if (p.role === 'texture') {
        if (w.id === 'weird_cabinet') {
            // Eerie waterphone / cabinet bowed horror dissonance
            [base + 12, base + 18, base + 23, base + 28].forEach((m, k) => add(m, k * .03, beat * 3.2, .78 - k * .04, 'accent'));
        } else {
            [base + 12, base + 16, base + 19, base + 24].forEach((m, k) => add(m, k * .04, beat * 2.5, .75 - k * .04, 'accent'));
            add(base - 5, beat * .2, beat * 2.8, .70, 'tenuto');
        }
        return out;
    }
    // Melody: piercing lead blast with slide into tonic
    const octaveShift = (voiceOrdinal % 2 === 1) ? 12 : 0;
    add(base + 12 + octaveShift, 0, beat * .35, .86, 'accent', base + 7 + octaveShift);
    add(base + 7 + octaveShift, beat * .3, beat * 1.5, .78, 'tenuto');
    return out;
}

function dotsPhrase(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0): NoteEvent[] {
    const beat = beatSeconds(w);
    const out: NoteEvent[] = [];
    const pts = mark.points.length ? mark.points : [{ x: .5, y: .5 }];
    pts.forEach((pt, k) => {
        const timeOffset = Math.max(0, pt.x * total - intent.startTime);
        const yPitch = Math.round(targetMidi(w, p, pt.y));
        const m = nearest(w, yPitch, pt.x * total, total);
        const dynamicAccent = k === 0 ? .14 : (k % 2 === 0 ? .08 : 0);
        if (p.role === 'drums') {
            const drums = p.drumNotes || [36, 38, 42];
            const drumIdx = Math.floor(clamp(1 - pt.y) * drums.length);
            const drumNote = cyclicAt(drums, (drumIdx + voiceOrdinal) % drums.length, 'dots drum note');
            out.push(event(drumNote, timeOffset, beat * .10, .54 + dynamicAccent, { ...extra(p, i, pt), articulation: 'staccato' }));
        } else if (p.role === 'bass') {
            const isTango = w.id === 'tango';
            out.push(event(m, timeOffset, beat * (isTango ? .12 : .14), .62 + dynamicAccent, {
                ...extra(p, i, pt),
                articulation: isTango ? 'marcato' : 'staccato'
            }));
        } else if (p.role === 'harmony') {
            const ch = chord(w, pt.x * total, total);
            const isGuitar = p.sound === 'nylon_guitar' || p.sound === 'clean_guitar';
            [0, chordDegree(ch, 1, 4)].forEach((d, j) => {
                out.push(event(m + d, timeOffset + j * .012, beat * .15, .50 + dynamicAccent - j * .03, {
                    ...extra(p, i, pt),
                    ...(isGuitar && w.id === 'flamenco' ? { sound: 'flamenco_strum' as const } : {}),
                    articulation: 'staccato'
                }));
            });
        } else if (p.role === 'human') {
            out.push(event(m, timeOffset, beat * .16, .58 + dynamicAccent, { ...extra(p, i, pt), articulation: 'staccato' }));
        } else {
            out.push(event(m, timeOffset, beat * .18, .54 + dynamicAccent, { ...extra(p, i, pt), articulation: 'staccato' }));
        }
    });
    return out;
}

function sprayPhrase(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0): NoteEvent[] {
    const beat = beatSeconds(w), base = w.key + (p.octave - 4) * 12, bounds = markBounds(mark);
    const span = Math.max(.05, bounds.maxX - bounds.minX);
    const durationSec = Math.max(beat * .8, span * total);
    const count = Math.max(6, Math.min(16, Math.round(durationSec / (beat * .16))));
    const out: NoteEvent[] = [];
    const r = rng(intent.seed ^ 0x59A7 ^ (voiceOrdinal * 0x31));
    for (let k = 0; k < count; k++) {
        const progress = k / (count - 1);
        const pt = pointAt(mark, progress);
        const timeOffset = progress * durationSec;
        const absTime = intent.startTime + timeOffset;
        if (p.role === 'drums') {
            const drums = p.drumNotes || [36, 38, 42];
            // Rapid shaker / snare roll / cascara rattle
            const note = cyclicAt(drums, 2 + Math.floor(r() * Math.max(1, drums.length - 2)), 'spray drum');
            out.push(event(note, timeOffset, beat * .08, .36 + r() * .24 + (k % 2 ? .08 : 0), { ...extra(p, i, pt), articulation: 'staccato' }));
        } else if (p.role === 'harmony') {
            const ch = chord(w, absTime, total);
            const degree = cyclicAt(ch, Math.floor(r() * ch.length), 'spray chord');
            const isGuitar = p.sound === 'nylon_guitar' || p.sound === 'clean_guitar';
            out.push(event(base + degree + (r() > .5 ? 12 : 0), timeOffset, beat * .32, .34 + r() * .18, {
                ...extra(p, i, pt),
                ...(isGuitar && w.id === 'flamenco' ? { sound: 'flamenco_strum' as const } : {}),
                articulation: 'staccato'
            }));
        } else if (p.role === 'melody') {
            const m = nearest(w, targetMidi(w, p, pt.y) + (k % 2 === 0 ? 0 : 2), absTime, total);
            out.push(event(m, timeOffset, beat * .14, .38 + r() * .20, { ...extra(p, i, pt), articulation: 'staccato' }));
        } else if (p.role === 'bass') {
            const m = nearest(w, base + (k % 2 === 0 ? 0 : 7), absTime, total);
            out.push(event(m, timeOffset, beat * .16, .44 + r() * .16, { ...extra(p, i, pt), articulation: 'staccato' }));
        } else if (p.role === 'human') {
            const m = nearest(w, base + 7 + (k % 2 === 0 ? 0 : 3), absTime, total);
            out.push(event(m, timeOffset, beat * .42, .35 + r() * .16, { ...extra(p, i, pt), articulation: 'legato' }));
        } else {
            const m = nearest(w, base + 12 + Math.floor(r() * 12), absTime, total);
            out.push(event(m, timeOffset, beat * .28, .30 + r() * .20, { ...extra(p, i, pt), articulation: 'staccato' }));
        }
    }
    return out;
}

function fillPhrase(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, _intent: PhraseIntent, voiceOrdinal = 0): NoteEvent[] {
    const beat = beatSeconds(w), base = w.key + (p.octave - 4) * 12;
    const out: NoteEvent[] = [];
    const pt = mark.points[0] || { x: .5, y: .5 };
    const stepBeats = 4;
    for (let b = 0; b < w.totalBeats; b += stepBeats) {
        const timeOffset = b * beat;
        const absTime = timeOffset;
        const ch = chord(w, absTime, total);
        if (p.role === 'bass') {
            const degree = (voiceOrdinal % 2 === 1) ? chordDegree(ch, 1, 7) : chordDegree(ch, 0);
            out.push(event(base + degree, timeOffset, beat * 3.8, .56, { ...extra(p, i, pt), articulation: 'tenuto' }));
        } else if (p.role === 'harmony') {
            ch.slice(0, 3).forEach((d, j) => {
                out.push(event(base + d, timeOffset + j * .02, beat * 3.8, .44 - j * .02, { ...extra(p, i, pt), articulation: 'legato' }));
            });
        } else if (p.role === 'drums') {
            const drums = p.drumNotes || [36, 38, 42];
            out.push(event(drums[0] ?? 36, timeOffset, beat * .22, .54, { ...extra(p, i, pt), articulation: 'accent' }));
            out.push(event(drums[drums.length - 1] ?? 42, timeOffset + beat * 2, beat * .18, .42, { ...extra(p, i, pt), articulation: 'staccato' }));
        } else if (p.role === 'human') {
            const shift = (voiceOrdinal % 2 === 1) ? 12 : 7;
            out.push(event(base + shift, timeOffset, beat * 3.8, .48, { ...extra(p, i, pt), articulation: 'legato' }));
        } else {
            out.push(event(base + 12 + chordDegree(ch, 0), timeOffset, beat * 3.8, .42, { ...extra(p, i, pt), articulation: 'legato' }));
        }
    }
    return out;
}

function traditionalMelody(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0) {
    const beat = beatSeconds(w);
    const count = Math.max(3, Math.min(8, Math.round(intent.beats * 1.15)));
    const zoukRhythms = [
        [0, .75, 1.5, 2.5, 3.25, 4.25],
        [0, 1.0, 1.75, 2.75, 3.5, 4.5],
        [0, .5, 1.25, 2.0, 2.75, 3.75]
    ];
    const flamencoRhythms = [
        [0, .5, 1, 1.5, 2.25, 3],
        [0, .75, 1.25, 2.0, 2.5, 3.25],
        [0, .33, .66, 1.0, 1.66, 2.33, 3.0]
    ];
    const tangoRhythms = [
        [0, .75, 1.25, 2, 2.75, 3.5],
        [0, 1.0, 1.5, 2.5, 3.0, 3.75],
        [0, .5, 1.25, 1.75, 2.5, 3.25]
    ];
    const rhythmSet = w.id === 'zouk' ? zoukRhythms : w.id === 'flamenco' ? flamencoRhythms : tangoRhythms;
    const rhythm = cyclicAt(rhythmSet, voiceOrdinal, 'traditional melody rhythm set');
    const motif = motifFromIntent(intent, count, rhythm, undefined, voiceOrdinal, .18);
    const out: NoteEvent[] = [];
    let prev: number | undefined;
    for (let k = 0; k < count; k++) {
        let rb = cyclicAt(motif.rhythm, k, 'traditional melody rhythm');
        if (rb >= intent.beats) break;
        const pt = pointAt(mark, rb / Math.max(1, intent.beats));
        const abs = intent.startTime + rb * beat;
        const step = cyclicAt(motif.steps, k, 'traditional melody steps');
        const m = midiForStep(w, p, intent, step, abs, total, prev, k === 0 || k === count - 1, w.id === 'flamenco' ? 5 : 6);
        prev = m;
        const next = motif.rhythm[k + 1] ?? Math.min(intent.beats, rb + 1);
        const dur = Math.max(.12, Math.min(beat * 1.25, (next - rb) * beat * (mark.tool === 'crayon' ? .92 : .66)));
        const art: NoteEvent['articulation'] = mark.tool === 'crayon' ? 'legato' : k === 0 ? 'accent' : 'tenuto';
        const e = event(m, rb * beat, dur, .42 + intent.energy * .16 + (k === 0 ? .06 : 0), { ...extra(p, i, pt), articulation: art });
        if (mark.tool === 'crayon' && k < count - 1) {
            const nm = midiForStep(w, p, intent, motif.steps[k + 1] ?? 0, intent.startTime + next * beat, total, m, false, 5);
            if (Math.abs(nm - m) <= 3) e.glideToMidi = nm;
        }
        out.push(e);
    }
    return { events: out, motif };
}

function traditionalBass(mark: CanvasMark, w: WorldConfig, p: Performer, _total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0) {
    const beat = beatSeconds(w), out: NoteEvent[] = [];
    const base = w.key + (p.octave - 4) * 12;
    const patIdx = (voiceOrdinal + Math.floor(intent.energy * 2)) % 4;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        if (w.id === 'zouk') {
            const zoukPatterns = [
                { times: [0, 1.25, 2.0, 3.25], steps: [0, 3, 7, 5] },
                { times: [0, 1.0, 1.75, 2.5, 3.5], steps: [0, 0, 3, 7, 5] },
                { times: [0, 1.5, 2.25, 3.0], steps: [0, 5, 7, 3] },
                { times: [0, 2.5], steps: [0, 7] }
            ];
            const pat = zoukPatterns[patIdx]!;
            pat.times.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const pt = pointAt(mark, rb / Math.max(1, intent.beats));
                const step = cyclicAt(pat.steps, k, 'zouk bass step');
                const m = base + step;
                const e = event(m, rb * beat, beat * .70, .60 + (k === 0 ? .1 : 0), { ...extra(p, i, pt), articulation: 'tenuto' });
                if (k === 0 && patIdx === 0) e.glideToMidi = base + 3;
                out.push(e);
            });
        } else if (w.id === 'flamenco') {
            const flamencoPatterns = [
                { times: [0, 1.0, 2.0, 2.75, 3.5], steps: [0, 1, 3, 1, 0] },
                { times: [0, .75, 1.5, 2.25, 3.0], steps: [0, 0, 1, 3, 1] },
                { times: [0, 1.5, 2.5, 3.5], steps: [0, 1, 0, 5] },
                { times: [0, 2.0, 3.0], steps: [0, 1, 0] }
            ];
            const pat = flamencoPatterns[patIdx]!;
            pat.times.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const pt = pointAt(mark, rb / Math.max(1, intent.beats));
                const step = cyclicAt(pat.steps, k, 'flamenco bass step');
                const m = base + step;
                out.push(event(m, rb * beat, beat * .65, .58 + (k === 0 ? .12 : 0), { ...extra(p, i, pt), articulation: 'marcato' }));
            });
        } else {
            const tangoPatterns = [
                { times: [0, 1.0, 2.0, 3.0], steps: [0, 7, 3, 7] },
                { times: [0.5, 1.5, 2.75, 3.5], steps: [0, 3, 7, 0] },
                { times: [0, 1.5, 2.0, 3.0], steps: [0, 0, 7, 3] },
                { times: [0, 2.0], steps: [0, 7] }
            ];
            const pat = tangoPatterns[patIdx]!;
            pat.times.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const pt = pointAt(mark, rb / Math.max(1, intent.beats));
                const step = cyclicAt(pat.steps, k, 'tango bass step');
                const m = base + step;
                const e = event(m, rb * beat, beat * .62, k % 2 === 0 ? .68 : .48, { ...extra(p, i, pt), articulation: 'marcato' });
                if (k === 0 && cycle === 0) e.glideToMidi = m;
                out.push(e);
            });
        }
    }
    return out;
}

function traditionalHarmony(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0) {
    const beat = beatSeconds(w), out: NoteEvent[] = [];
    const chordalGuitar = (p.sound === 'nylon_guitar' || p.sound === 'clean_guitar' || p.name.toLowerCase().includes('guitar'));
    const patIdx = voiceOrdinal % 4;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        if (w.id === 'zouk') {
            const zoukPatterns = [
                [0, .75, 1.75, 2.75, 3.5],
                [0.5, 1.5, 2.5, 3.5],
                [0, 1.25, 2.25, 3.25],
                [0, 2.0]
            ];
            const times = zoukPatterns[patIdx]!;
            times.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total), base = w.key + (p.octave - 4) * 12, pt = pointAt(mark, rb / Math.max(1, intent.beats));
                ch.slice(0, 3).forEach((d, j) => {
                    out.push(event(base + d, rb * beat + j * .016, beat * .46, .46 + (k === 0 ? .08 : 0) - j * .02, { ...extra(p, i, pt), articulation: 'tenuto' }));
                });
            });
        } else if (w.id === 'flamenco') {
            const flamencoPatterns = [
                [0, .5, 1.5, 2.25, 3.0, 3.5],
                [0, .75, 1.5, 2.25, 3.0, 3.75],
                [0.5, 1.25, 2.0, 2.75, 3.5],
                [0, 1.5, 3.0]
            ];
            const times = flamencoPatterns[patIdx]!;
            times.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total), base = w.key + (p.octave - 4) * 12, pt = pointAt(mark, rb / Math.max(1, intent.beats));
                ch.slice(0, 3).forEach((d, j) => {
                    out.push(event(base + d, rb * beat + j * .022, beat * .36, .52 + (k === 0 ? .1 : 0), {
                        ...extra(p, i, pt),
                        ...(chordalGuitar ? { sound: 'flamenco_strum' as const } : {}),
                        articulation: 'accent'
                    }));
                });
            });
        } else {
            const tangoPatterns = [
                [0, 1.0, 2.0, 3.0],
                [0.5, 1.5, 2.75, 3.5],
                [0, 1.5, 2.5, 3.5],
                [0, 2.0]
            ];
            const times = tangoPatterns[patIdx]!;
            times.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total), base = w.key + (p.octave - 4) * 12, pt = pointAt(mark, rb / Math.max(1, intent.beats));
                ch.slice(0, 3).forEach((d, j) => {
                    out.push(event(base + d, rb * beat + j * .018, beat * .42, k % 2 === 0 ? .58 : .42, { ...extra(p, i, pt), articulation: 'marcato' }));
                });
            });
        }
    }
    return out;
}

function traditionalDrums(mark: CanvasMark, w: WorldConfig, p: Performer, i: number, intent: PhraseIntent, voiceOrdinal = 0) {
    const beat = beatSeconds(w), notes = p.drumNotes?.length ? p.drumNotes : [36, 38, 42], out: NoteEvent[] = [];
    const add = (rb: number, k: number, v: number, d = .11) => {
        if (rb >= intent.beats) return;
        out.push(event(cyclicAt(notes, k, 'traditional drum notes'), rb * beat, beat * d, v, extra(p, i, pointAt(mark, rb / Math.max(1, intent.beats)))));
    };
    const patIdx = voiceOrdinal % 3;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        if (w.id === 'zouk') {
            if (patIdx === 1) {
                // Kompa groove with cowbell & rim swing
                add(cycle, 0, .70, .18);
                add(cycle + 1.0, 4, .64, .12);
                add(cycle + 2.0, 0, .68, .18);
                add(cycle + 3.0, 1, .66, .14);
                add(cycle + 3.5, 4, .58, .10);
            } else if (patIdx === 2) {
                // Energetic zouk-beton carnival groove
                add(cycle, 0, .76, .18);
                add(cycle + .5, 4, .54, .10);
                add(cycle + 1.25, 1, .68, .14);
                add(cycle + 2.0, 0, .72, .18);
                add(cycle + 2.75, 4, .60, .10);
                add(cycle + 3.5, 1, .70, .16);
            } else {
                // Authentic French Caribbean zouk riddim: Boom... ch-boom
                add(cycle, 0, .72, .18);
                add(cycle + .75, 4, .58, .12);
                add(cycle + 1.5, 1, .66, .16);
                add(cycle + 2.0, 0, .68, .18);
                add(cycle + 2.75, 4, .56, .12);
                add(cycle + 3.5, 1, .64, .16);
            }
        } else if (w.id === 'flamenco') {
            const isPalmas = p.name.toLowerCase().includes('palmas');
            if (isPalmas) {
                if (patIdx === 1) {
                    // Rapid redoble off-beat claps
                    [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75].forEach(x => add(cycle + x, 1, .62, .08));
                } else {
                    // 12-beat compas handclaps
                    [0, .33, .66, 1.0, 1.33, 1.66, 2.0, 2.33, 2.66, 3.0, 3.33, 3.66].forEach((x, k) => {
                        const acc = [0, 3, 6, 8, 10].includes(k);
                        add(cycle + x, k % notes.length, acc ? .70 : .45, .10);
                    });
                }
            } else {
                if (patIdx === 1) {
                    // Rumba flamenca cajon groove
                    add(cycle, 0, .74, .18);
                    add(cycle + .75, 2, .64, .12);
                    add(cycle + 1.5, 1, .68, .14);
                    add(cycle + 2.25, 0, .66, .16);
                    add(cycle + 3.0, 1, .70, .14);
                    add(cycle + 3.75, 2, .60, .10);
                } else {
                    // Cajon compas groove
                    [0, .5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].forEach((x, k) => {
                        const isBass = k === 0 || k === 4 || k === 6;
                        add(cycle + x, isBass ? 0 : 2, isBass ? .72 : .50, isBass ? .18 : .12);
                    });
                }
            }
        } else {
            // Tango marcato pulse
            [0, 1.0, 2.0, 3.0].forEach((x, k) => {
                add(cycle + x, k % 2 === 0 ? 0 : 1, k === 0 || k === 2 ? .70 : .50, .18);
            });
            if (intent.energy > .6 || patIdx === 1) {
                add(cycle + 1.75, 2, .54, .10);
                add(cycle + 3.75, 2, .58, .10);
            }
        }
    }
    return out;
}

function traditionalHuman(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0): NoteEvent[] {
    const beat = beatSeconds(w), base = w.key + (p.octave - 4) * 12, out: NoteEvent[] = [];
    const pt = mark.points[0] || { x: .5, y: .5 };
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        const abs = intent.startTime + cycle * beat, ch = chord(w, abs, total);
        if (w.id === 'flamenco') {
            // Jaleo vocal shouts ("¡Ole!", "¡Toma!")
            const jaleoTimes = voiceOrdinal % 2 === 0 ? [0.5, 2.25] : [1.5, 3.0];
            jaleoTimes.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const m = base + chordDegree(ch, k % ch.length) + 7;
                out.push(event(m, rb * beat, beat * .38, .66, { ...extra(p, i, pt), articulation: 'accent' }));
            });
        } else if (w.id === 'zouk') {
            // Choral sway gentle vocal pads
            const m = base + chordDegree(ch, 0) + (voiceOrdinal % 2 === 1 ? 12 : 7);
            out.push(event(m, cycle * beat, beat * 3.6, .52, { ...extra(p, i, pt), articulation: 'legato' }));
        } else {
            // Tango vocalise
            const m = base + chordDegree(ch, 0) + 12;
            out.push(event(m, cycle * beat, beat * 3.2, .48, { ...extra(p, i, pt), articulation: 'legato' }));
        }
    }
    return out;
}

function traditionalTexture(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0): NoteEvent[] {
    const beat = beatSeconds(w), base = w.key + (p.octave - 4) * 12, out: NoteEvent[] = [];
    const pt = mark.points[0] || { x: .5, y: .5 };
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        const abs = intent.startTime + cycle * beat, ch = chord(w, abs, total);
        const deg = chordDegree(ch, (voiceOrdinal) % ch.length);
        out.push(event(base + 12 + deg, cycle * beat, beat * 3.7, .44, { ...extra(p, i, pt), articulation: 'legato' }));
    }
    return out;
}
/**
 * Rebuild a continuous mark from the notes the player actually heard while
 * drawing it. This is deliberately a timing pass, not a recomposition pass:
 * pitch, instrument, velocity, articulation, pan and sends remain intact.
 *
 * Path position provides the main musical clock so playback flows across the
 * canvas; a small amount of the original finger timing keeps human feel. The
 * only groove operation is a gentle pull toward a local grid.
 */
function capturedPerformancePhrase(mark: CanvasMark, w: WorldConfig, intent: PhraseIntent): CompileResult | null {
    const capture = mark.performance;
    if (!capture || capture.worldId !== w.id || capture.events.length < 1)
        return null;
    const source = capture.events.filter(e => Number.isFinite(e.midi) && Number.isFinite(e.velocity) && Number.isFinite(e.gestureTime) && Number.isFinite(e.pointIndex));
    if (!source.length)
        return null;
    const beat = beatSeconds(w), phraseSeconds = Math.max(beat * .5, intent.beats * beat);
    const maxPoint = Math.max(1, mark.points.length - 1, ...source.map(e => e.pointIndex));
    const maxGesture = Math.max(.08, ...source.map(e => e.gestureTime));
    const traditional = w.id === 'tango' || w.id === 'flamenco' || w.id === 'zouk';
    const flowStretch = w.id === 'dreamland' ? 1.22 : traditional ? 1.12 : 1.08;
    const desiredSeconds = Math.min(phraseSeconds, Math.max(beat, maxGesture * flowStretch));
    const rawPlaybackBeats = desiredSeconds / beat;
    const playbackBeats = clamp(Math.round(rawPlaybackBeats * 2) / 2, Math.min(1, intent.beats), intent.beats);
    const playbackSeconds = Math.max(beat * .5, playbackBeats * beat);
    const timeScale = playbackSeconds / maxGesture;
    const durationScale = source.length < 2 ? 1 : clamp(Math.max(1, timeScale), 1, w.id === 'dreamland' ? 2.35 : 1.75);
    const { grid, snap, swing, sustain, pulse, pulseStep } = w.feel;
    const maxBeat = Math.max(.05, playbackBeats - .04), bounds = markBounds(mark), spanX = Math.max(.01, bounds.maxX - bounds.minX), out: NoteEvent[] = [];
    for (const captured of source) {
        const pathPhase = clamp(captured.pointIndex / maxPoint), gesturePhase = clamp(captured.gestureTime / maxGesture);
        const xPhase = clamp(((captured.canvasX ?? pointAt(mark, pathPhase).x) - bounds.minX) / spanX);
        const phase = clamp(pathPhase * .74 + gesturePhase * .16 + xPhase * .10);
        const rawBeat = phase * maxBeat, snapped = Math.round(rawBeat / grid) * grid, slot = Math.round(snapped / grid);
        const swingOffset = (slot & 1) ? swing * grid : 0;
        const beatPos = clamp(rawBeat + (snapped - rawBeat) * snap + swingOffset, 0, maxBeat);
        const pulseIndex = Math.floor(Math.max(0, beatPos) / Math.max(.125, pulseStep)) % Math.max(1, pulse.length), pulseGain = pulse[pulseIndex] ?? 1;
        const pt = { x: captured.canvasX ?? pointAt(mark, pathPhase).x, y: captured.canvasY ?? pointAt(mark, pathPhase).y };
        out.push({
            ...captured,
            timeOffset: Math.max(0, beatPos * beat + captured.timeOffset),
            duration: Math.max(.05, Math.min(w.id === 'dreamland' ? beat * 4.8 : beat * 2.9, captured.duration * durationScale * sustain)),
            velocity: clamp(captured.velocity * pulseGain, .05, .9),
            canvasX: pt.x, canvasY: pt.y,
        });
    }
    out.sort((a, b) => a.timeOffset - b.timeOffset);
    return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: out } };
}
// Dreamland fallback for uncaptured marks
function dreamPhrase(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent): CompileResult {
    const beat = beatSeconds(w), out: NoteEvent[] = [], r = rng(intent.seed ^ 0xD3EA), pt = (rb: number) => pointAt(mark, rb / Math.max(1, intent.beats)), midiAt = (rb: number, step: number, absolute: number, previous?: number, chordBias = false, maxLeap = 8) => nearest(w, targetMidi(w, p, pt(rb).y) + step * 2, absolute, total, chordBias, previous, maxLeap);
    if (p.role === 'bass') {
        const times = [0, Math.min(intent.beats * .55, 4), Math.max(0, intent.beats - 1.2)].filter((x, k, a) => k === 0 || Math.abs(x - atOrThrow(a, k - 1, 'dream bass times')) > .7);
        let prev: number | undefined;
        times.forEach((rb, k) => { const abs = intent.startTime + rb * beat, m = midiAt(rb, cyclicAt([0, 3, 1], k, 'dream bass steps'), abs, prev, true, 6); prev = m; out.push(event(m, rb * beat, beat * (1.8 + r() * .8), .25 + intent.energy * .10, { ...extra(p, i, pt(rb)), articulation: 'legato' })); });
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: out } };
    }
    if (p.role === 'harmony') {
        const anchors = [0, Math.min(intent.beats * .58, 5)];
        for (const rb of anchors) {
            const abs = intent.startTime + rb * beat, ch = chord(w, abs, total), base = w.key + (p.octave - 4) * 12;
            [chordDegree(ch, 0), chordDegree(ch, 1, 5), chordDegree(ch, 2, 7) + 12].forEach((d, j) => out.push(event(base + d, rb * beat + j * beat * .28, beat * (2.4 + r() * 1.4), .20 + intent.energy * .10 - j * .015, { ...extra(p, i, pt(rb)), articulation: 'legato' })));
        }
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: out } };
    }
    const count = p.role === 'texture' || p.role === 'human' ? Math.max(1, Math.min(3, Math.round(intent.beats / 3))) : Math.max(2, Math.min(5, Math.round(intent.beats / 2) + 1)), rhythm = [0, 1.5, 3.5, 5.75, 8.5], motif = motifFromIntent(intent, count, rhythm, undefined, 0, .05);
    let prev: number | undefined;
    for (let k = 0; k < count; k++) {
        const rb = Math.min(intent.beats - .05, motif.rhythm[k] ?? k * 2);
        if (rb < 0)
            continue;
        const step = cyclicAt(motif.steps, k, 'dream motif steps') + (k % 3 === 1 ? 2 : 0), abs = intent.startTime + rb * beat, m = midiAt(rb, step, abs, prev, k === 0 || (intent.cadence === 'closed' && k === count - 1), 8);
        prev = m;
        const dur = beat * ((p.role === 'texture' || p.role === 'human' ? 3.2 : 1.55) + r() * 1.6), e = event(m, rb * beat, dur, .19 + intent.energy * .13, { ...extra(p, i, pt(rb)), articulation: 'legato' });
        if (p.role === 'texture' && k < count - 1 && r() > .45) {
            const nm = midiAt(Math.min(intent.beats, rb + 1), step + (intent.contour === 'fall' ? -1 : 1), abs + beat, m, false, 4);
            if (Math.abs(nm - m) <= 4)
                e.glideToMidi = nm;
        }
        out.push(e);
    }
    return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: out }, motif };
}
// Generated phrase vocabularies
const WILDNESS: Record<string, number> = { drum_circle: .66, pop_star: .58, rock_monster: .72, salsa_party: .64, weird_cabinet: .94 };
function wildRhythm(w: WorldConfig, _intent: PhraseIntent) { if (w.id === 'salsa_party')
    return [0, .5, 1.5, 2, 2.75, 3.5, 4.5, 5.5]; if (w.id === 'rock_monster')
    return [0, .5, 1, 1.5, 2.5, 3, 3.5, 4.5]; if (w.id === 'pop_star')
    return [0, .75, 1.5, 2, 2.75, 3.5, 4.25, 5.5]; if (w.id === 'weird_cabinet')
    return [0, .375, 1.25, 2.125, 2.5, 3.75, 5.125, 6]; return [0, .5, 1.25, 2, 2.5, 3.25, 4, 5]; }
function wildMelody(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, previous: PhraseMotif | undefined, voiceOrdinal: number) { const beat = beatSeconds(w), wild = WILDNESS[w.id] ?? .65, count = Math.max(4, Math.min(10, Math.round(4 + intent.density * 4 + intent.energy * 2))), motif = motifFromIntent(intent, count, wildRhythm(w, intent), previous, voiceOrdinal, wild), out: NoteEvent[] = [], r = rng(intent.seed ^ 0x51A7); let prev: number | undefined; for (let k = 0; k < count; k++) {
    const rb = cyclicAt(motif.rhythm, k, 'generated melody rhythm');
    if (rb >= intent.beats)
        break;
    let step = cyclicAt(motif.steps, k, 'generated melody steps');
    if (w.id === 'rock_monster')
        step = Math.round(step / 2) * 2;
    if (w.id === 'weird_cabinet' && k % 3 === 2)
        step += r() > .5 ? 3 : -3;
    const abs = intent.startTime + rb * beat, pt = pointAt(mark, rb / Math.max(1, intent.beats)), m = midiForStep(w, p, intent, step, abs, total, prev, k === 0 || (intent.cadence === 'closed' && k === count - 1), w.id === 'weird_cabinet' ? 12 : 8);
    const next = motif.rhythm[k + 1] ?? Math.min(intent.beats, rb + 1), dur = Math.max(.08, (next - rb) * beat * cyclicAt(motif.gate, k, 'generated melody gate'));
    const art: NoteEvent['articulation'] = w.id === 'rock_monster' ? (k % 3 === 0 ? 'accent' : 'staccato') : mark.tool === 'crayon' ? 'legato' : k % 4 === 0 ? 'accent' : 'tenuto', e = event(m, rb * beat, dur, .34 + intent.energy * .24 + (k === 0 ? .04 : 0), { ...extra(p, i, pt), articulation: art });
    if ((w.id === 'weird_cabinet' || mark.tool === 'crayon') && prev !== undefined && Math.abs(m - prev) <= 5 && k % 2 === 1)
        e.glideToMidi = midiForStep(w, p, intent, atOrThrow(motif.steps, Math.min(k + 1, motif.steps.length - 1), 'generated melody next step'), abs + beat * .3, total, m, false, 6);
    out.push(e);
    prev = m;
} return { events: out, motif }; }
function wildHarmony(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal: number) {
    const beat = beatSeconds(w), out: NoteEvent[] = [];
    const base = w.key + (p.octave - 4) * 12, pt = pointAt(mark, .5);
    const patIdx = (voiceOrdinal + Math.floor(intent.energy * 2)) % 4;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        if (w.id === 'salsa_party') {
            // Authentic Cuban salsa piano montunos: 4 variations
            const montunos = [
                // Classic 2-3 son montuno
                [
                    { b: .5, deg: 0 }, { b: 1.0, deg: 7 }, { b: 1.75, deg: 12 },
                    { b: 2.5, deg: 10 }, { b: 3.25, deg: 12 }, { b: 3.75, deg: 7 }
                ],
                // 3-2 rumba syncopated montuno
                [
                    { b: 0, deg: 0 }, { b: .75, deg: 7 }, { b: 1.5, deg: 12 },
                    { b: 2.25, deg: 10 }, { b: 3.0, deg: 7 }, { b: 3.5, deg: 12 }
                ],
                // Descarga jazz montuno
                [
                    { b: .5, deg: 4 }, { b: 1.25, deg: 7 }, { b: 2.0, deg: 11 },
                    { b: 2.75, deg: 7 }, { b: 3.5, deg: 12 }
                ],
                // Sustained mambo off-beat comping
                [
                    { b: 0.5, deg: 0 }, { b: 1.5, deg: 7 }, { b: 2.5, deg: 10 }, { b: 3.5, deg: 12 }
                ]
            ];
            const chosen = montunos[patIdx]!;
            chosen.forEach((m, k) => {
                const rb = cycle + m.b;
                if (rb >= intent.beats) return;
                out.push(event(base + m.deg, rb * beat, beat * .36, .52 + (k % 2 === 0 ? .08 : 0), { ...extra(p, i, pt), articulation: 'staccato' }));
                out.push(event(base + m.deg - 12, rb * beat + .015, beat * .34, .44, { ...extra(p, i, pt), articulation: 'staccato' }));
            });
        } else if (w.id === 'rock_monster') {
            const rockPatterns = [
                [0, 1.0, 2.5, 3.0],
                [0, 1.5, 2.25, 3.0],
                [0, .5, 1.5, 2.0, 2.75, 3.5],
                [0, 2.0]
            ];
            const offsets = rockPatterns[patIdx]!;
            offsets.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                const root = chordDegree(ch, 0);
                [root, root + 7, root + 12].forEach((d, j) => {
                    out.push(event(base + d, rb * beat + j * .015, beat * .38, .62 - j * .02, { ...extra(p, i, pt), articulation: k === 0 ? 'accent' : 'tenuto' }));
                });
            });
        } else if (w.id === 'pop_star') {
            const popPatterns = [
                [0, .75, 1.75, 2.5, 3.25],
                [0.5, 1.5, 2.5, 3.5],
                [0, 1.0, 2.0, 3.0],
                [0, 1.25, 2.25, 3.25]
            ];
            const offsets = popPatterns[patIdx]!;
            offsets.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                ch.slice(0, 3).forEach((d, j) => {
                    out.push(event(base + d + 12, rb * beat + j * .016, beat * .42, .50 + (k === 0 ? .1 : 0), { ...extra(p, i, pt), articulation: 'accent' }));
                });
            });
        } else {
            // Weird Cabinet & general arpeggios
            const patterns = [[0, .625, 1.75, 2.875], [0, 1.125, 2.375, 3.125], [0, 1.5, 2.5, 3.5], [0, 2.0]];
            const pat = cyclicAt(patterns, patIdx, 'harmony pattern');
            pat.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                ch.slice(0, 3).forEach((d, j) => {
                    out.push(event(base + d, rb * beat + j * beat * .12, beat * .65, .42 - j * .02, { ...extra(p, i, pt), articulation: k === 0 ? 'accent' : 'tenuto' }));
                });
            });
        }
    }
    return out;
}

function wildBass(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal: number) {
    const beat = beatSeconds(w), out: NoteEvent[] = [];
    const base = w.key + (p.octave - 4) * 12, pt = pointAt(mark, .5);
    const patIdx = (voiceOrdinal + Math.floor(intent.energy * 2)) % 4;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        if (w.id === 'salsa_party') {
            const salsaBassPatterns = [
                // Classic Cuban tumbao: anticipates on 2& (1.5) and 4 (3.0)
                [{ off: 1.5, deg: 0 }, { off: 3.0, deg: 7 }],
                // Guaguanco tumbao
                [{ off: 1.0, deg: 0 }, { off: 1.75, deg: 5 }, { off: 2.5, deg: 7 }, { off: 3.25, deg: 12 }],
                // Walking mambo bass
                [{ off: 0, deg: 0 }, { off: 1.0, deg: 4 }, { off: 2.0, deg: 7 }, { off: 3.0, deg: 10 }],
                // Offbeat clave tumbao
                [{ off: 0.5, deg: 0 }, { off: 2.0, deg: 7 }, { off: 3.5, deg: 0 }]
            ];
            const pat = salsaBassPatterns[patIdx]!;
            pat.forEach((note, k) => {
                const rb = cycle + note.off;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                const step = note.deg === 0 ? chordDegree(ch, 0) : chordDegree(ch, 1, note.deg);
                const e = event(base + step, rb * beat, beat * .70, .64 + (k === 0 ? .08 : 0), { ...extra(p, i, pt), articulation: 'tenuto' });
                if (k === 0 && patIdx === 0) e.glideToMidi = base + chordDegree(ch, 1, 7);
                out.push(e);
            });
        } else if (w.id === 'rock_monster') {
            if (patIdx === 1) {
                // Heavy syncopated rock groove with octave pops
                [0, .75, 1.5, 2.25, 3.0].forEach((offset, k) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    const m = base + root + (k % 2 === 1 ? 12 : 0);
                    out.push(event(m, rb * beat, beat * .42, .64, { ...extra(p, i, pt), articulation: 'accent' }));
                });
            } else if (patIdx === 2) {
                // Pounding straight-eighth punk drive
                [0, .5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].forEach((offset) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    out.push(event(base + root, rb * beat, beat * .32, .62, { ...extra(p, i, pt), articulation: 'staccato' }));
                });
            } else if (patIdx === 3) {
                // Walking blues riff with string bends
                [0, 1.0, 2.0, 3.0].forEach((offset, k) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    const steps = [root, root + 3, root + 5, root + 7];
                    out.push(event(base + steps[k]!, rb * beat, beat * .65, .60, { ...extra(p, i, pt), articulation: 'tenuto' }));
                });
            } else {
                // Driving 8th-note blues rock chug with root-fifth
                [0, .5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].forEach((offset, k) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    const step = k % 4 === 3 ? root + 3 : k % 2 === 0 ? root : root + 7;
                    out.push(event(base + step, rb * beat, beat * .36, .62 + (k === 0 ? .1 : 0), { ...extra(p, i, pt), articulation: k % 2 === 0 ? 'accent' : 'staccato' }));
                });
            }
        } else if (w.id === 'pop_star') {
            if (patIdx === 1) {
                // Modern syncopated 16th-note synth-pop groove
                [0, .75, 1.25, 2.0, 2.75, 3.5].forEach((offset, k) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    out.push(event(base + root, rb * beat, beat * .34, .62 + (k === 0 ? .1 : 0), { ...extra(p, i, pt), articulation: 'staccato' }));
                });
            } else if (patIdx === 2) {
                // Smooth gliding 808 sub bass
                [0, 2.0].forEach((offset, k) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    const e = event(base + root, rb * beat, beat * 1.8, .66, { ...extra(p, i, pt), articulation: 'legato' });
                    if (k === 0) e.glideToMidi = base + root + 5;
                    out.push(e);
                });
            } else if (patIdx === 3) {
                // Pumping sidechain offbeat bass
                [0.5, 1.5, 2.5, 3.5].forEach((offset) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    out.push(event(base + root, rb * beat, beat * .42, .64, { ...extra(p, i, pt), articulation: 'tenuto' }));
                });
            } else {
                // Bouncy disco octave bass [root, octave, root, octave]
                [0, .5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].forEach((offset, k) => {
                    const rb = cycle + offset;
                    if (rb >= intent.beats) return;
                    const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                    const root = chordDegree(ch, 0);
                    const m = base + root + (k % 2 === 1 ? 12 : 0);
                    out.push(event(m, rb * beat, beat * .32, .60 + (k === 0 ? .12 : 0), { ...extra(p, i, pt), articulation: 'staccato' }));
                });
            }
        } else {
            // General / weird cabinet walking bass
            const patterns = [[0, 1.0, 2.0, 3.0], [0, 1.5, 2.5, 3.5], [0, 2.0], [0, .75, 2.0, 2.75]];
            const pat = cyclicAt(patterns, patIdx, 'bass pattern');
            pat.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const abs = intent.startTime + rb * beat, ch = chord(w, abs, total);
                const m = base + chordDegree(ch, k % ch.length);
                out.push(event(m, rb * beat, beat * .65, .54 + (k === 0 ? .1 : 0), { ...extra(p, i, pt), articulation: 'tenuto' }));
            });
        }
    }
    return out;
}

function wildDrums(mark: CanvasMark, w: WorldConfig, p: Performer, i: number, intent: PhraseIntent, voiceOrdinal: number) {
    const beat = beatSeconds(w), notes = p.drumNotes?.length ? p.drumNotes : [36, 38, 42], out: NoteEvent[] = [], r = rng(intent.seed ^ 0xD00D);
    const hit = (rb: number, index: number, v: number, d = .10) => {
        if (rb >= intent.beats) return;
        out.push(event(cyclicAt(notes, index, 'generated drum notes'), rb * beat, beat * d, v, extra(p, i, pointAt(mark, rb / Math.max(1, intent.beats)))));
    };
    const patIdx = (voiceOrdinal + Math.floor(intent.energy * 2)) % 4;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        if (w.id === 'pop_star') {
            if (patIdx === 1) {
                // Trap-pop groove with syncopated 808 kicks & hat rolls
                hit(cycle + 0, 0, .76, .18);
                hit(cycle + 1.0, 1, .70, .14);
                hit(cycle + 1.75, 0, .70, .16);
                hit(cycle + 2.5, 0, .68, .16);
                hit(cycle + 3.0, 1, .72, .14);
                [0, .33, .66, 1.0, 1.5, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5].forEach(x => hit(cycle + x, 3, .45, .06));
            } else if (patIdx === 2) {
                // 80s synth-pop gated snare beat
                [0, 2.0].forEach(b => hit(cycle + b, 0, .76, .20));
                [1.0, 3.0].forEach(b => hit(cycle + b, 1, .78, .18));
                for (let x = 0; x < 4; x += .5) hit(cycle + x, 3, .46, .08);
            } else if (patIdx === 3) {
                // Energetic dance build
                for (let b = 0; b < 4; b++) { hit(cycle + b, 0, .74, .16); hit(cycle + b + .5, 1, .66, .12); }
            } else {
                // Pop dance: four-on-the-floor kick, snare on 2 & 4, hi-hats
                [0, 1, 2, 3].forEach(b => hit(cycle + b, 0, .74, .18));
                [1, 3].forEach(b => hit(cycle + b, 1, .68, .16));
                for (let x = 0; x < 4; x += .5) {
                    if (x % 1 !== 0) hit(cycle + x, 3, .44, .08);
                }
                if (intent.energy > .65) {
                    hit(cycle + 3.5, 2, .56, .10);
                    hit(cycle + 3.75, 1, .68, .12);
                }
            }
        } else if (w.id === 'rock_monster') {
            if (patIdx === 1) {
                // Double-time hard rock beat
                [0, 1.0, 2.0, 3.0].forEach(b => { hit(cycle + b, 0, .78, .18); hit(cycle + b + .5, 1, .74, .16); });
            } else if (patIdx === 2) {
                // Half-time heavy breakdown groove with crash accents
                hit(cycle + 0, 0, .82, .24);
                hit(cycle + 2.0, 1, .80, .22);
                hit(cycle + 2.5, 0, .70, .18);
                hit(cycle + 3.5, 0, .68, .16);
                hit(cycle + 0, notes.length - 1, .76, .50);
            } else if (patIdx === 3) {
                // Four-on-the-floor stadium rock stomp
                [0, 1, 2, 3].forEach(b => { hit(cycle + b, 0, .78, .20); hit(cycle + b, 1, .70, .14); });
            } else {
                // Driving rock kick-snare groove with crash accents
                hit(cycle + 0, 0, .78, .22);
                hit(cycle + 1.0, 1, .72, .18);
                hit(cycle + 2.0, 0, .74, .20);
                hit(cycle + 2.5, 0, .64, .16);
                hit(cycle + 3.0, 1, .76, .22);
                for (let x = 0; x < 4; x += .5) hit(cycle + x, 2, .48, .08);
                if (cycle === 0) hit(cycle + 0, notes.length - 1, .74, .60);
            }
        } else if (w.id === 'salsa_party') {
            if (patIdx === 1) {
                // Mambo campana bell + bongo martillo
                [0, 1.0, 2.0, 2.5, 3.0].forEach(x => hit(cycle + x, 5, .68, .14));
                [0.5, 1.5, 2.5, 3.5].forEach(x => hit(cycle + x, 1, .62, .12));
            } else if (patIdx === 2) {
                // Guaguanco polyrhythmic rumba groove
                [0, .75, 1.5, 2.25, 3.0].forEach((x, k) => hit(cycle + x, k % 2 === 0 ? 0 : 2, .66, .14));
            } else if (patIdx === 3) {
                // Fast timbale roll fill with crash flares
                for (let x = 0; x < 4; x += .25) hit(cycle + x, 4, .50 + (x >= 3 ? .25 : 0), .08);
                hit(cycle + 3.75, notes.length - 1, .76, .45);
            } else {
                // Conga tumbao + cascara timbale
                [0, .75, 1.5, 2.25, 3.0, 3.5].forEach((offset, k) => {
                    hit(cycle + offset, k === 2 ? 1 : k >= 4 ? 2 : 5, k === 2 ? .70 : .52, .14);
                });
                [0, .375, .75, 1.25, 1.625, 2.0, 2.5].forEach(x => hit(cycle + x, 4, .48, .08));
            }
        } else if (w.id === 'drum_circle') {
            if (patIdx === 1) {
                // High hand drum call-and-response with shaker drive
                [0, .5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].forEach(x => hit(cycle + x, 3, .46, .08));
                [0, 1.25, 2.0, 3.25].forEach(x => hit(cycle + x, 1, .68, .16));
            } else if (patIdx === 2) {
                // Polyrhythmic 3-against-2 interlocking groove
                [0, 1.33, 2.66].forEach(x => hit(cycle + x, 0, .72, .20));
                [0, 1.0, 2.0, 3.0].forEach(x => hit(cycle + x, 2, .56, .12));
            } else if (patIdx === 3) {
                // Fast celebratory solo burst
                for (let x = 0; x < 4; x += .33) hit(cycle + x, Math.floor(r() * notes.length), .56 + r() * .18, .10);
            } else {
                // African polyrhythmic hand groove
                [0, .66, 1.33, 2.0, 2.66, 3.33].forEach((x, k) => {
                    hit(cycle + x, k % 2 === 0 ? 0 : 1, .60 + (k === 0 ? .18 : 0), .18);
                });
                [0, .5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5].forEach((x, k) => {
                    hit(cycle + x, 2 + (k % Math.max(1, notes.length - 2)), .42 + r() * .14, .10);
                });
            }
        } else {
            [0, .75, 1.5, 2.25, 3.25].forEach((x, k) => hit(cycle + x, k % notes.length, .44 + r() * .18, .14));
            if (intent.energy > .55) hit(cycle + 3.75, 1, .62, .12);
        }
    }
    return out.slice(0, 36);
}

function wildHuman(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal: number): NoteEvent[] {
    const beat = beatSeconds(w), base = w.key + (p.octave - 4) * 12, out: NoteEvent[] = [];
    const pt = mark.points[0] || { x: .5, y: .5 };
    const patIdx = voiceOrdinal % 3;
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        const abs = intent.startTime + cycle * beat, ch = chord(w, abs, total);
        if (w.id === 'salsa_party') {
            // Coro shouts ("¡Esa!", "¡Sabor!")
            const coroTimes = patIdx === 1 ? [1.5, 3.5] : [0.75, 2.25];
            coroTimes.forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const m = base + chordDegree(ch, k % ch.length) + 12;
                out.push(event(m, rb * beat, beat * .36, .66, { ...extra(p, i, pt), articulation: 'accent' }));
            });
        } else if (w.id === 'rock_monster') {
            // Stadium crowd shout / arena chant
            const rb = cycle + (patIdx === 1 ? 2.0 : 0);
            if (rb < intent.beats) {
                out.push(event(base + 7, rb * beat, beat * .48, .74, { ...extra(p, i, pt), articulation: 'accent' }));
            }
        } else if (w.id === 'pop_star') {
            // Catchy autotune synth vox chops
            [0, 1.5, 2.75].forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const m = base + chordDegree(ch, k % ch.length) + 12;
                out.push(event(m, rb * beat, beat * .40, .62, { ...extra(p, i, pt), articulation: 'staccato' }));
            });
        } else {
            const m = base + chordDegree(ch, 0) + 12;
            out.push(event(m, cycle * beat, beat * 3.4, .52, { ...extra(p, i, pt), articulation: 'legato' }));
        }
    }
    return out;
}

function wildTexture(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal: number): NoteEvent[] {
    const beat = beatSeconds(w), base = w.key + (p.octave - 4) * 12, out: NoteEvent[] = [];
    const pt = mark.points[0] || { x: .5, y: .5 };
    for (let cycle = 0; cycle < intent.beats; cycle += 4) {
        const abs = intent.startTime + cycle * beat, ch = chord(w, abs, total);
        if (w.id === 'weird_cabinet') {
            // Waterphone bowed horror scrapes & eerie swells
            const deg = (voiceOrdinal % 2 === 1) ? 6 : 1;
            out.push(event(base + 12 + deg, cycle * beat, beat * 3.8, .48, { ...extra(p, i, pt), articulation: 'legato' }));
        } else if (w.id === 'rock_monster') {
            // Amp feedback sustained overtone howl
            out.push(event(base + 19, cycle * beat, beat * 3.6, .45, { ...extra(p, i, pt), articulation: 'tenuto' }));
        } else if (w.id === 'pop_star') {
            // Crystal shimmer fairy dust sparkles
            [0, 1.0, 2.0, 3.0].forEach((offset, k) => {
                const rb = cycle + offset;
                if (rb >= intent.beats) return;
                const m = base + 24 + chordDegree(ch, k % ch.length);
                out.push(event(m, rb * beat, beat * .55, .38, { ...extra(p, i, pt), articulation: 'staccato' }));
            });
        } else {
            const deg = chordDegree(ch, voiceOrdinal % ch.length);
            out.push(event(base + 12 + deg, cycle * beat, beat * 3.8, .42, { ...extra(p, i, pt), articulation: 'legato' }));
        }
    }
    return out;
}

function compileTraditional(mark: CanvasMark, w: WorldConfig, p: Performer, total: number, i: number, intent: PhraseIntent, voiceOrdinal = 0): CompileResult {
    let events: NoteEvent[], motif: PhraseMotif | undefined;
    if (p.role === 'drums')
        events = traditionalDrums(mark, w, p, i, intent, voiceOrdinal);
    else if (p.role === 'bass')
        events = traditionalBass(mark, w, p, total, i, intent, voiceOrdinal);
    else if (p.role === 'harmony')
        events = traditionalHarmony(mark, w, p, total, i, intent, voiceOrdinal);
    else if (p.role === 'human')
        events = traditionalHuman(mark, w, p, total, i, intent, voiceOrdinal);
    else if (p.role === 'texture')
        events = traditionalTexture(mark, w, p, total, i, intent, voiceOrdinal);
    else {
        const m = traditionalMelody(mark, w, p, total, i, intent, voiceOrdinal);
        events = m.events;
        motif = m.motif;
    }
    const phrase = { sourceMarkId: mark.id, startTime: intent.startTime, events };
    return motif ? { phrase, motif } : { phrase };
}

export function compileMarkPhrase(mark: CanvasMark, w: WorldConfig, total: number, voiceOrdinal = 0, previous?: PhraseMotif): CompileResult {
    const p = cyclicAt(w.palette, mark.paletteIndex, `${w.id} palette`),
          i = ((mark.paletteIndex % w.palette.length) + w.palette.length) % w.palette.length,
          intent = phraseIntent(mark, w, total);
    // Dedicated tool generators for all shapes/toys:
    if (mark.tool === 'stamp')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: worldStampPhrase(mark, w, p, total, i, intent) } };
    if (mark.tool === 'boom')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: boomPhrase(mark, w, p, total, i, intent, voiceOrdinal) } };
    if (mark.tool === 'dots')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: dotsPhrase(mark, w, p, total, i, intent, voiceOrdinal) } };
    if (mark.tool === 'spray')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: sprayPhrase(mark, w, p, total, i, intent, voiceOrdinal) } };
    if (mark.tool === 'fill')
        return { phrase: { sourceMarkId: mark.id, startTime: 0, events: fillPhrase(mark, w, p, total, i, intent, voiceOrdinal) } };

    // Continuous hand-drawn strokes (crayon):
    const captured = capturedPerformancePhrase(mark, w, intent);
    if (captured)
        return captured;
    if (w.id === 'dreamland')
        return dreamPhrase(mark, w, p, total, i, intent);
    if (w.id === 'tango' || w.id === 'flamenco' || w.id === 'zouk')
        return compileTraditional(mark, w, p, total, i, intent, voiceOrdinal);
    if (p.role === 'drums')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: wildDrums(mark, w, p, i, intent, voiceOrdinal) } };
    if (p.role === 'bass')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: wildBass(mark, w, p, total, i, intent, voiceOrdinal) } };
    if (p.role === 'harmony')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: wildHarmony(mark, w, p, total, i, intent, voiceOrdinal) } };
    if (p.role === 'human')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: wildHuman(mark, w, p, total, i, intent, voiceOrdinal) } };
    if (p.role === 'texture')
        return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: wildTexture(mark, w, p, total, i, intent, voiceOrdinal) } };
    const m = wildMelody(mark, w, p, total, i, intent, previous, voiceOrdinal);
    return { phrase: { sourceMarkId: mark.id, startTime: intent.startTime, events: m.events }, motif: m.motif };
}
