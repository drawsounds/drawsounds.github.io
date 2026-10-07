import type { NoteEvent, Phrase, Song } from '../audio/types';
import { fitSoundRegister, soundSpec } from '../audio/sounds';
import { atOrThrow, cyclicAt } from '../utils/arrays';
import type { CanvasMark, CanvasPoint, WorldConfig, WorldId, } from './canvasTypes';
import type { PhraseMotif } from './phraseEngine';
import { compileMarkPhrase, gestureStats, markBounds } from './phraseEngine';
import { buildRelationshipGraph, type RelationshipKind } from './relationships';
import { WORLD_MAP, WORLDS } from './worlds/config';
export type { CanvasMark, CanvasPoint, WorldConfig, WorldId, } from './canvasTypes';
export { performFloodFill } from './floodFill';
export { createGestureStats, extendGestureStats } from './phraseEngine';
export { WORLD_MAP, WORLDS } from './worlds/config';
function totalDuration(world: WorldConfig): number {
    return (world.totalBeats * 60) / world.tempo;
}
type CacheEntry = {
    phrase: Phrase;
    motif?: PhraseMotif;
};
const phraseCache = new Map<string, CacheEntry>();
function cachePut(key: string, value: CacheEntry): void {
    phraseCache.set(key, value);
    if (phraseCache.size <= 768)
        return;
    const oldestKey = phraseCache.keys().next().value;
    if (oldestKey !== undefined)
        phraseCache.delete(oldestKey);
}
function basePhrase(mark: CanvasMark, world: WorldConfig, total: number, voiceOrdinal: number, previous?: PhraseMotif): CacheEntry {
    const key = `${world.id}|${mark.id}|${voiceOrdinal}|${previous?.signature ?? '-'}`;
    const cached = phraseCache.get(key);
    if (cached)
        return cached;
    const compiled = compileMarkPhrase(mark, world, total, voiceOrdinal, previous);
    const entry: CacheEntry = {
        phrase: {
            ...compiled.phrase,
            events: compiled.phrase.events.map((event) => ({ ...event })),
        },
        ...(compiled.motif ? { motif: compiled.motif } : {}),
    };
    cachePut(key, entry);
    return entry;
}
function cleanPhrase(mark: CanvasMark, phrase: Phrase): Phrase {
    const bounds = markBounds(mark);
    const holes = mark.erasures;
    const events = !holes?.length
        ? phrase.events
        : phrase.events.filter((event) => {
            const x = event.canvasX ?? bounds.minX;
            const y = event.canvasY ?? 0.5;
            for (const hole of holes) {
                const dx = x - hole.x;
                const dy = y - hole.y;
                const radius = hole.radius ?? 0.05;
                if (dx * dx + dy * dy < radius * radius)
                    return false;
            }
            return true;
        });
    return { ...phrase, events: events.map((event) => ({ ...event })) };
}
type RelationshipProfile = {
    take: number;
    together: number;
    harm: number;
    respond: number;
    delay: number;
    intervals: readonly number[];
    shifts: readonly number[];
    dur: number;
};
const RELATIONSHIP_PROFILES = {
    float: { take: 1, together: 0.2, harm: 0.19, respond: 0.17, delay: 0.82, intervals: [7, 12], shifts: [0, 7], dur: 1.35 },
    circle: { take: 3, together: 0.48, harm: 0.28, respond: 0.38, delay: 0.12, intervals: [7, 12], shifts: [0, 0, 0], dur: 0.72 },
    hook: { take: 3, together: 0.4, harm: 0.34, respond: 0.34, delay: 0.22, intervals: [7, 4, 12], shifts: [2, 0, 2], dur: 0.78 },
    lock: { take: 4, together: 0.5, harm: 0.31, respond: 0.36, delay: 0.08, intervals: [12, 7], shifts: [0, 0, -2], dur: 0.58 },
    clave: { take: 3, together: 0.47, harm: 0.28, respond: 0.38, delay: 0.28, intervals: [3, 7], shifts: [0, 2, -1], dur: 0.7 },
    odd: { take: 2, together: 0.32, harm: 0.31, respond: 0.32, delay: 0.41, intervals: [6, 11, 3], shifts: [5, -2, 3], dur: 0.92 },
    sway: { take: 2, together: 0.36, harm: 0.29, respond: 0.31, delay: 0.36, intervals: [3, 7], shifts: [0, 2], dur: 0.96 },
    compas: { take: 2, together: 0.42, harm: 0.27, respond: 0.32, delay: 0.18, intervals: [3, 7], shifts: [0, 0], dur: 0.7 },
    tension: { take: 2, together: 0.38, harm: 0.29, respond: 0.31, delay: 0.16, intervals: [3, 7, 10], shifts: [-1, 2, 0], dur: 0.76 },
} as const satisfies Record<WorldConfig['feel']['interaction'], RelationshipProfile>;
function relationshipEvents(relation: {
    kind: RelationshipKind;
    strength: number;
}, source: Phrase, target: Phrase, world: WorldConfig): NoteEvent[] {
    if (!source.events.length || !target.events.length)
        return [];
    const output: NoteEvent[] = [];
    const beat = 60 / world.tempo;
    const mode = world.feel.interaction;
    const profile = RELATIONSHIP_PROFILES[mode];
    const base = source.events.slice(0, profile.take);
    const targetStrong = target.events.slice(0, profile.take);
    if (relation.kind === 'together') {
        base.forEach((event, index) => {
            const targetEvent = cyclicAt(targetStrong, index, 'relationship target events');
            output.push({
                ...event,
                timeOffset: Math.max(0, target.startTime + targetEvent.timeOffset - source.startTime),
                duration: Math.min(event.duration, targetEvent.duration) * profile.dur,
                velocity: event.velocity * profile.together,
            });
        });
        return output;
    }
    if (relation.kind === 'harmonize') {
        base.forEach((event, index) => {
            const targetEvent = cyclicAt(targetStrong, index, 'relationship target events');
            const interval = cyclicAt(profile.intervals, index, 'relationship intervals');
            output.push({
                ...event,
                // Kit keys identify articulations, not scale degrees. Preserve
                // the source hit when interacting with another instrument.
                midi: soundSpec(event.sound).bank === 'percussion'
                    ? event.midi
                    : fitSoundRegister(event.sound, targetEvent.midi + interval),
                timeOffset: Math.max(0, target.startTime +
                    targetEvent.timeOffset -
                    source.startTime +
                    (mode === 'float' ? beat * 0.45 : 0.03)),
                duration: Math.min(event.duration, targetEvent.duration * 1.1) * profile.dur,
                velocity: event.velocity * profile.harm,
                ...(mode === 'float' ? { articulation: 'legato' as const } : {}),
            });
        });
        return output;
    }
    const targetTail = target.events.slice(-profile.take);
    const sourceSeed = base.slice().reverse();
    targetTail.forEach((targetEvent, index) => {
        const event = cyclicAt(sourceSeed, index, 'relationship source events');
        const shift = cyclicAt(profile.shifts, index, 'relationship shifts');
        const delay = beat *
            (profile.delay +
                (mode === 'clave' && index % 2 !== 0 ? 0.18 : mode === 'odd' ? index * 0.11 : 0));
        output.push({
            ...event,
            midi: soundSpec(event.sound).bank === 'percussion'
                ? event.midi
                : fitSoundRegister(event.sound, event.midi + shift),
            timeOffset: Math.max(0, target.startTime + targetEvent.timeOffset + targetEvent.duration - source.startTime + delay),
            duration: event.duration * profile.dur,
            velocity: event.velocity * profile.respond,
            ...(mode === 'float' ? { articulation: 'legato' as const } : {}),
        });
    });
    return output;
}
export function freezeMark(mark: CanvasMark): CanvasMark {
    const gesture = gestureStats(mark);
    return {
        ...mark,
        points: mark.points.map((point) => ({ ...point })),
        gesture: { ...gesture },
        bounds: { ...markBounds(mark) },
        ...(mark.erasures ? { erasures: mark.erasures.map((erasure) => ({ ...erasure })) } : {}),
        ...(mark.performance
            ? {
                performance: {
                    ...mark.performance,
                    events: mark.performance.events.map((event) => ({ ...event })),
                },
            }
            : {}),
    };
}
export function eraseMarkAt(mark: CanvasMark, point: CanvasPoint, radius = 0.05): CanvasMark | null {
    const bounds = mark.bounds;
    if (bounds &&
        (point.x < bounds.minX - radius ||
            point.x > bounds.maxX + radius ||
            point.y < bounds.minY - radius ||
            point.y > bounds.maxY + radius)) {
        return mark;
    }
    if (mark.tool === 'fill') {
        const fillBounds = bounds ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 };
        if (point.x < fillBounds.minX - radius ||
            point.x > fillBounds.maxX + radius ||
            point.y < fillBounds.minY - radius ||
            point.y > fillBounds.maxY + radius) {
            return mark;
        }
        const erasures = [...(mark.erasures ?? []), { ...point, radius }];
        if (erasures.length > 8)
            return null;
        return { ...mark, erasures };
    }
    const hitRadius = radius * 1.2;
    const hitRadiusSquared = hitRadius * hitRadius;
    const hit = mark.points.some((markPoint) => {
        const dx = markPoint.x - point.x;
        const dy = markPoint.y - point.y;
        return dx * dx + dy * dy < hitRadiusSquared;
    });
    if (!hit)
        return mark;
    const radiusSquared = radius * radius;
    const remaining = mark.points.filter((markPoint) => {
        const dx = markPoint.x - point.x;
        const dy = markPoint.y - point.y;
        return dx * dx + dy * dy >= radiusSquared;
    });
    const erasures = [...(mark.erasures ?? []), { ...point, radius }];
    if (remaining.length < 2)
        return null;
    return { ...mark, erasures };
}
export function interpretMark(mark: CanvasMark, worldId: WorldId): Phrase {
    const world = WORLD_MAP[worldId];
    const total = totalDuration(world);
    const compiled = compileMarkPhrase(mark, world, total, 0);
    return cleanPhrase(mark, compiled.phrase);
}
export function interpretCanvas(marks: CanvasMark[], worldId: WorldId): Song {
    const world = WORLD_MAP[worldId];
    const total = totalDuration(world);
    const motifs = new Map<number, PhraseMotif>();
    const ordinals = new Map<number, number>();
    const phrases: Phrase[] = [];
    for (const mark of marks) {
        const voice = ((mark.paletteIndex % world.palette.length) + world.palette.length) % world.palette.length;
        const ordinal = ordinals.get(voice) ?? 0;
        const previous = motifs.get(voice);
        const compiled = basePhrase(mark, world, total, ordinal, previous);
        ordinals.set(voice, ordinal + 1);
        if (compiled.motif)
            motifs.set(voice, compiled.motif);
        phrases.push(cleanPhrase(mark, compiled.phrase));
    }
    const byId = new Map(phrases.map((phrase) => [phrase.sourceMarkId, phrase]));
    for (const relation of buildRelationshipGraph(marks, world)) {
        const source = byId.get(relation.sourceId);
        const target = byId.get(relation.targetId);
        if (source && target) {
            source.events.push(...relationshipEvents(relation, source, target, world));
        }
    }
    const capturedIds = new Set<string>();
    for (const mark of marks) {
        if (mark.performance?.worldId === worldId && mark.performance.events.length) {
            capturedIds.add(mark.id);
        }
    }
    for (const phrase of phrases) {
        const cap = capturedIds.has(phrase.sourceMarkId) ? 192 : 40;
        phrase.events = phrase.events
            .filter((event) => Number.isFinite(event.timeOffset) && Number.isFinite(event.midi))
            .sort((a, b) => a.timeOffset - b.timeOffset)
            .slice(0, cap);
    }
    return { worldId, baseTempo: world.tempo, totalDuration: total, phrases };
}
export function randomWorld(exclude?: WorldId): WorldId {
    const pool = exclude ? WORLDS.filter((world) => world.id !== exclude) : WORLDS;
    const index = Math.floor(Math.random() * pool.length);
    return atOrThrow(pool, index, 'world pool').id;
}
