import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
export const { WORLDS } = await jiti.import('../src/music/worlds/config.ts');
export const { SOUNDS, PITCH_RANGES, soundVelocityRange, noteVelocity } = await jiti.import('../src/audio/sounds.ts');
const { compileMarkPhrase } = await jiti.import('../src/music/phraseEngine.ts');
const { interpretCanvas } = await jiti.import('../src/music/canvasMusic.ts');

// Exercise every tool, stamp override and palette at register/progression edges,
// with flat, rising, falling and winding strokes, plus live captures/relations.
export function* audioCorpus() {
    for (const world of WORLDS) {
        for (let paletteIndex = 0; paletteIndex < world.palette.length; paletteIndex++) {
            for (const tool of ['crayon', 'dots', 'spray', 'fill', 'boom', 'stamp']) {
                for (const stamp of tool === 'stamp' ? world.stamps : [{ id: 'star' }]) {
                    for (let seed = 0; seed < 12; seed++) {
                        for (const y of [0, .5, 1]) {
                            for (const contour of ['flat', 'rise', 'fall', 'winding']) {
                                const mark = {
                                    id: `${world.id}-${paletteIndex}-${tool}-${stamp.id}-${seed}-${y}-${contour}`,
                                    paletteIndex, tool, stampKind: stamp.id, seed, size: seed % 2 ? .5 : 2,
                                    points: [0, .33, .67, 1].map((x, index) => ({
                                        x, y: contour === 'flat' ? y : contour === 'rise' ? 1 - x
                                            : contour === 'fall' ? x : index % 2 ? 1 - y : y,
                                    })),
                                };
                                const { phrase } = compileMarkPhrase(mark, world, world.totalBeats * 60 / world.tempo, seed);
                                yield { world: world.id, mark, events: phrase.events };
                            }
                        }
                    }
                }
            }
        }
        for (const tool of ['crayon', 'stamp', 'dots', 'spray', 'fill', 'boom']) {
            for (let seed = 0; seed < 12; seed++) {
                const marks = world.palette.map((_, paletteIndex) => ({
                    id: `relation-${tool}-${seed}-${paletteIndex}`, paletteIndex, tool,
                    seed, size: 1, stampKind: world.stamps[seed % world.stamps.length].id,
                    points: [{ x: .3 + paletteIndex * .009, y: .35 }, { x: .7, y: .65 }],
                }));
                const song = interpretCanvas(marks, world.id);
                yield { world: world.id, mark: marks[0], events: song.phrases.flatMap(p => p.events) };
                const captured = {
                    ...marks[0], tool: 'crayon',
                    performance: { worldId: world.id, events: song.phrases[0].events.map((e, index) => ({
                        ...e, pointIndex: index % 2, gestureTime: index * .05,
                    })) },
                };
                yield { world: world.id, mark: captured, events: interpretCanvas([captured, ...marks.slice(1)], world.id).phrases.flatMap(p => p.events) };
            }
        }
    }
}

export function percussionKeys() {
    const keys = new Map();
    for (const world of WORLDS) for (const performer of world.palette) {
        if (SOUNDS[performer.sound].bank !== 'percussion') continue;
        const used = keys.get(performer.sound) ?? new Set();
        for (const key of performer.drumNotes ?? [36, 38, 42]) used.add(key);
        keys.set(performer.sound, used);
    }
    return keys;
}
