import type { CanvasMark, Performer, WorldConfig } from './canvasTypes';
import { atOrThrow, cyclicAt } from '../utils/arrays';
export type RelationshipKind = 'together' | 'respond' | 'harmonize';
export interface MarkRelationship {
    sourceId: string;
    targetId: string;
    kind: RelationshipKind;
    strength: number;
}
type Bounds = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};
function bounds(mark: CanvasMark): Bounds {
    if (mark.bounds)
        return mark.bounds;
    if (mark.tool === 'fill')
        return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const points = mark.points.length ? mark.points : [{ x: 0.5, y: 0.5 }];
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const point of points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }
    const pad = (mark.tool === 'stamp' || mark.tool === 'boom' ? 0.04 : 0.014) * mark.size;
    return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}
function overlapBounds(a: Bounds, b: Bounds): number {
    const width = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
    const height = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
    return width * height;
}
function distanceBounds(a: Bounds, b: Bounds): number {
    const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
    const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
    return Math.hypot(dx * 1.2, dy);
}
function kindFor(a: Performer, b: Performer, overlap: number, world: WorldConfig): RelationshipKind {
    // Percussion has a finite key map. Spatial relationships can synchronize it,
    // but must never turn proximity into chromatic drum-note transposition.
    if (a.role === 'drums' || b.role === 'drums')
        return 'together';
    const mode = world.feel.interaction;
    const hasHarmony = a.role === 'harmony' || b.role === 'harmony';
    const hasBass = a.role === 'bass' || b.role === 'bass';
    const hasHuman = a.role === 'human' || b.role === 'human';
    if (mode === 'circle')
        return hasHuman ? 'respond' : 'together';
    if (mode === 'float')
        return (overlap > 0.002 || hasHarmony) ? 'harmonize' : 'respond';
    if (mode === 'hook')
        return (hasHarmony || overlap > 0.006) ? 'harmonize' : 'respond';
    if (mode === 'lock')
        return (overlap > 0.002 || hasBass || hasHarmony) ? 'together' : 'respond';
    if (mode === 'clave')
        return overlap > 0.008 && hasHarmony ? 'harmonize' : 'respond';
    if (mode === 'odd')
        return overlap > 0.006 ? 'harmonize' : 'respond';
    if (mode === 'sway')
        return (hasHarmony || overlap > 0.004) ? 'harmonize' : 'respond';
    if (mode === 'compas') {
        return hasHuman ? 'respond' : (overlap > 0.004 || hasHarmony) ? 'harmonize' : 'respond';
    }
    if (mode === 'tension')
        return (overlap > 0.003 || hasHarmony) ? 'harmonize' : 'respond';
    return (overlap > 0.004 || hasHarmony) ? 'harmonize' : 'respond';
}
function pairRelations(a: CanvasMark, b: CanvasMark, world: WorldConfig, aBounds = bounds(a), bBounds = bounds(b)): MarkRelationship[] {
    const distance = distanceBounds(aBounds, bBounds);
    const reach = Math.max(0.02, world.relationReach);
    if (distance > reach)
        return [];
    const aPerformer = cyclicAt(world.palette, a.paletteIndex, `${world.id} palette`);
    const bPerformer = cyclicAt(world.palette, b.paletteIndex, `${world.id} palette`);
    const overlap = overlapBounds(aBounds, bBounds);
    const kind = kindFor(aPerformer, bPerformer, overlap, world);
    const strength = Math.max(0.2, Math.min(1, 1 - distance / reach + (overlap > 0 ? 0.18 : 0)));
    if (kind === 'respond') {
        return [{ sourceId: b.id, targetId: a.id, kind, strength }];
    }
    return [
        { sourceId: a.id, targetId: b.id, kind, strength },
        { sourceId: b.id, targetId: a.id, kind, strength },
    ];
}
function capBySource(relations: MarkRelationship[]): MarkRelationship[] {
    const bySource = new Map<string, MarkRelationship[]>();
    for (const relation of relations) {
        const group = bySource.get(relation.sourceId) ?? [];
        group.push(relation);
        bySource.set(relation.sourceId, group);
    }
    const result: MarkRelationship[] = [];
    for (const group of bySource.values()) {
        result.push(...group.sort((a, b) => b.strength - a.strength).slice(0, 3));
    }
    return result;
}
export function buildRelationshipGraph(marks: CanvasMark[], world: WorldConfig): MarkRelationship[] {
    if (marks.length < 2)
        return [];
    const result: MarkRelationship[] = [];
    const allBounds = marks.map(bounds);
    for (let i = 0; i < marks.length - 1; i++) {
        const a = atOrThrow(marks, i, 'canvas marks');
        const aBounds = atOrThrow(allBounds, i, 'mark bounds');
        for (let j = i + 1; j < marks.length; j++) {
            result.push(...pairRelations(a, atOrThrow(marks, j, 'canvas marks'), world, aBounds, atOrThrow(allBounds, j, 'mark bounds')));
        }
    }
    return capBySource(result);
}
