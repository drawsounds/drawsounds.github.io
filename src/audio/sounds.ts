export type RuntimeBank = 'instruments' | 'percussion';
const BANKS: Record<RuntimeBank, {
    path: string;
    offset: number;
}> = {
    instruments: { path: 'soundfonts/drawsounds-instruments.sf3', offset: 0 },
    percussion: { path: 'soundfonts/drawsounds-percussion.sf3', offset: 1 },
};
export const SOUNDS = {
    piano: { bank: 'instruments', program: 0 },
    lately_bass: { bank: 'instruments', program: 1 },
    warm_pad: { bank: 'instruments', program: 2 },
    tubular_bells: { bank: 'instruments', program: 3 },
    harp: { bank: 'instruments', program: 4 },
    choir_aahs: { bank: 'instruments', program: 5 },
    ocarina: { bank: 'instruments', program: 6 },
    saw_hook: { bank: 'instruments', program: 7 },
    electric_piano: { bank: 'instruments', program: 8 },
    synth_vox: { bank: 'instruments', program: 9 },
    crystal: { bank: 'instruments', program: 10 },
    finger_bass: { bank: 'instruments', program: 11 },
    clean_guitar: { bank: 'instruments', program: 12 },
    fret_noise: { bank: 'instruments', program: 13 },
    acoustic_bass: { bank: 'instruments', program: 14 },
    brass: { bank: 'instruments', program: 15 },
    marimba: { bank: 'instruments', program: 16 },
    voice_oohs: { bank: 'instruments', program: 17 },
    alto_sax: { bank: 'instruments', program: 18 },
    nylon_guitar: { bank: 'instruments', program: 19 },
    bandoneon: { bank: 'instruments', program: 20 },
    violin: { bank: 'instruments', program: 21 },
    upright_piano: { bank: 'instruments', program: 22 },
    cello: { bank: 'instruments', program: 23 },
    tenor_sax: { bank: 'instruments', program: 24 },
    flamenco_strum: { bank: 'instruments', program: 25 },
    theremin: { bank: 'instruments', program: 26 },
    hurdy_gurdy: { bank: 'instruments', program: 27 },
    waterphone: { bank: 'instruments', program: 28 },
    nyckelharpa: { bank: 'instruments', program: 29 },
    ondioline: { bank: 'instruments', program: 30 },
    musical_saw: { bank: 'instruments', program: 31 },
    glass_harmonica: { bank: 'instruments', program: 32 },
    pop_kit: { bank: 'percussion', program: 0 },
    world_percussion: { bank: 'percussion', program: 1 },
    rock_kit: { bank: 'percussion', program: 2 },
    djembe: { bank: 'percussion', program: 3 },
    shekere: { bank: 'percussion', program: 4 },
    salsa_kit: { bank: 'percussion', program: 5 },
} as const satisfies Record<string, {
    bank: RuntimeBank;
    program: number;
}>;
export type SoundId = keyof typeof SOUNDS;
export const soundSpec = (sound: SoundId) => SOUNDS[sound];
export const bankOffset = (bank: RuntimeBank) => BANKS[bank].offset;
// Supported registers include stamps, glides, bass octave drops and relationship
// harmonies. Keep a margin for continuous gestures; don't trim to a demo song.
export const PITCH_RANGES = {
    piano: [36, 96], lately_bass: [12, 72], warm_pad: [28, 96],
    tubular_bells: [40, 108], harp: [28, 96], choir_aahs: [24, 104],
    ocarina: [40, 108], saw_hook: [48, 112], electric_piano: [36, 104],
    synth_vox: [36, 100], crystal: [48, 120], finger_bass: [12, 60],
    clean_guitar: [24, 100], fret_noise: [24, 84], acoustic_bass: [12, 72],
    brass: [36, 108], marimba: [48, 120], voice_oohs: [36, 100],
    alto_sax: [36, 104], nylon_guitar: [36, 108], bandoneon: [36, 104],
    violin: [48, 116], upright_piano: [36, 104], cello: [24, 92],
    tenor_sax: [36, 104], flamenco_strum: [28, 108], theremin: [24, 112],
    hurdy_gurdy: [24, 100], waterphone: [36, 120], nyckelharpa: [24, 112],
    ondioline: [24, 100], musical_saw: [24, 112], glass_harmonica: [36, 120],
} as const satisfies Record<Exclude<SoundId, 'pop_kit' | 'world_percussion' | 'rock_kit' | 'djembe' | 'shekere' | 'salsa_kit'>, readonly [number, number]>;
export function fitSoundRegister(sound: SoundId, midi: number): number {
    const range = PITCH_RANGES[sound as keyof typeof PITCH_RANGES];
    let note = Math.max(0, Math.min(127, Math.round(midi)));
    if (!range)
        return note;
    while (note < range[0]) note += 12;
    while (note > range[1]) note -= 12;
    return note;
}
// These limits are also used by the bank builder and coverage audit. Percussion
// variants are encoded in velocity zones, so never send values outside the bank.
export function soundVelocityRange(sound: SoundId): readonly [number, number] {
    return SOUNDS[sound].bank === 'percussion'
        ? (sound === 'pop_kit' ? [12, 90] : [16, 72])
        : [12, 104];
}
export function noteVelocity(sound: SoundId, strength: number): number {
    const [min, max] = soundVelocityRange(sound);
    return Math.max(min, Math.min(max, Math.round(min + strength * (max - min))));
}
function assetUrl(path: string) {
    const clean = path.startsWith('/') ? path.slice(1) : path;
    try {
        return new URL(clean, document.baseURI || window.location.href).href;
    }
    catch {
        const base = import.meta.env.BASE_URL || '/';
        const prefix = base.endsWith('/') ? base : `${base}/`;
        return `${prefix}${clean}`;
    }
}
export async function fetchRuntimeBank(bank: RuntimeBank): Promise<ArrayBuffer> {
    // The studio coalesces in-flight loads. Transfer the fetched buffer directly
    // to the worklet instead of keeping a second compressed copy in JS memory.
    const response = await fetch(assetUrl(BANKS[bank].path));
    if (!response.ok)
        throw new Error(`Audio asset unavailable (${response.status})`);
    return response.arrayBuffer();
}
