import type { Performer, StampChoice, WorldConfig, WorldFeel, WorldId } from '../canvasTypes';
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10], PENTA = [0, 2, 4, 7, 9], MINOR_PENTA = [0, 3, 5, 7, 10], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
const P = (name: string, color: string, ink: string, role: Performer['role'], sound: Performer['sound'], octave: number, extra: Partial<Performer> = {}): Performer => ({ name, color, ink, role, sound, octave, ...extra });
const F = (grid: number, snap: number, swing: number, sustain: number, pulse: number[], pulseStep: number, interaction: WorldFeel['interaction']): WorldFeel => ({ grid, snap, swing, sustain, pulse, pulseStep, interaction });
// Seven visually distinct stamps share stable gesture identities across worlds.
type StampLabels = Record<StampChoice['id'], string>;
function stampChoice(id: StampChoice['id'], label: string, technique?: string): StampChoice {
    return technique === undefined ? { id, label } : { id, label, technique };
}
const seven = (labels: StampLabels, techniques: Partial<Record<StampChoice['id'], string>> = {}): StampChoice[] => [
    stampChoice('cat', labels.cat, techniques.cat),
    stampChoice('frog', labels.frog, techniques.frog),
    stampChoice('panda', labels.panda, techniques.panda),
    stampChoice('star', labels.star, techniques.star),
    stampChoice('rocket', labels.rocket, techniques.rocket),
    stampChoice('flower', labels.flower, techniques.flower),
    stampChoice('lightning', labels.lightning, techniques.lightning),
];
const dreamStamps = seven({ cat: 'Moon cat', frog: 'Bubble frog', panda: 'Dream panda', star: 'Chime burst', rocket: 'Comet rise', flower: 'Halo bloom', lightning: 'Glass flash' });
const drumStamps = seven({ cat: 'Pounce slap', frog: 'Frog call', panda: 'Panda stomp', star: 'Call burst', rocket: 'Rolling hands', flower: 'Circle response', lightning: 'Clap break' });
const popStamps = seven({ cat: 'Hook pounce', frog: 'Bounce hook', panda: 'Panda bounce', star: 'Hook burst', rocket: 'Riser', flower: 'Chorus bloom', lightning: 'Downbeat hit' });
const rockStamps = seven({ cat: 'Riff pounce', frog: 'Low growl', panda: 'Panda stomp', star: 'Crash burst', rocket: 'Feedback rise', flower: 'Anthem chord', lightning: 'Power hit' });
const salsaStamps = seven({ cat: 'Mambo pounce', frog: 'Tumbao call', panda: 'Panda pulse', star: 'Campana burst', rocket: 'Brass rise', flower: 'Coro bloom', lightning: 'Mambo stab' });
const weirdStamps = seven({ cat: 'Clockwork cat', frog: 'Croak wobble', panda: 'Clockwork panda', star: 'Music-box burst', rocket: 'Theremin swoop', flower: 'Water bloom', lightning: 'Metal snap' });
const zoukStamps = seven({ cat: 'Guitar pounce', frog: 'Low sway', panda: 'Panda sway', star: 'Guitar chime', rocket: 'Lead glide', flower: 'Warm bloom', lightning: 'Syncopated hit' });
const flamencoStamps = seven({ cat: 'Cat · rasgueado', frog: 'Frog · picado', panda: 'Panda · alzapúa', star: 'Star · remate', rocket: 'Rocket · llamada', flower: 'Flower · abanico', lightning: 'Lightning · golpe' }, { cat: 'rasgueado', frog: 'picado', panda: 'alzapua', star: 'remate', rocket: 'llamada', flower: 'abanico', lightning: 'golpe' });
const tangoStamps = seven({ cat: 'Cat · marcato', frog: 'Frog · síncopa', panda: 'Panda · milonga', star: 'Star · bordoneo', rocket: 'Rocket · arrastre', flower: 'Flower · yumba', lightning: 'Lightning · marcato 2' }, { cat: 'marcato4', frog: 'sincopa', panda: 'milonga', star: 'bordoneo', rocket: 'arrastre', flower: 'yumba', lightning: 'marcato2' });
export const WORLDS: WorldConfig[] = [
    {
        id: 'dreamland', label: 'Dreamland', tempo: 68, key: 50, scale: PENTA, progression: [[0, 7, 14], [5, 9, 12], [2, 7, 9], [0, 5, 9]], totalBeats: 48, relationReach: .052, canvas: '#0b1020', canvasInk: '#f4f7ff', accent: '#9fb8ff', stamps: dreamStamps, feel: F(.5, .06, .10, 1.26, [1, .98, 1.02, .97], 1, 'float'), studio: { master: .76, room: .32, echo: .34, feedback: .50, release: 1.38, echoBeats: [1.5, 2], lowpass: 4800 }, palette: [
            P('celestial harp', '#2dd4bf', '#0b221e', 'harmony', 'harp', 4, { room: .26, echo: .18 }),
            P('starlight chimes', '#fbbf24', '#342605', 'melody', 'tubular_bells', 5, { room: .24, echo: .24 }),
            P('nebula pad', '#c084fc', '#2a0f44', 'texture', 'warm_pad', 4, { room: .34, echo: .26 }),
            P('deep slumber', '#38bdf8', '#082a3d', 'bass', 'lately_bass', 2, { room: .08, echo: .08 }),
            P('angel breath', '#f472b6', '#3b0d26', 'human', 'choir_aahs', 4, { room: .30, echo: .18 }),
            P('dream comet', '#f1f5f9', '#1e293b', 'texture', 'ocarina', 5, { room: .30, echo: .30 }),
        ]
    },
    {
        id: 'drum_circle', label: 'Drum Circle', tempo: 108, key: 48, scale: PENTA, progression: [[0, 7], [0, 5], [0, 7], [3, 7]], totalBeats: 32, relationReach: .060, canvas: '#f3e4c8', canvasInk: '#3a2618', accent: '#c65b32', stamps: drumStamps, feel: F(.25, .30, .12, .86, [1.08, .96, 1.03, .94, 1.05, .97], .5, 'circle'), studio: { master: .80, room: .24, echo: .09, feedback: .18, release: 1.04, echoBeats: [.33, .5], lowpass: 3700 }, palette: [
            P('djembe bass', '#dc2626', '#fff1f1', 'drums', 'world_percussion', 3, { drumNotes: [48, 50, 64, 69] }),
            P('hand drum', '#ea580c', '#fff3ea', 'drums', 'world_percussion', 3, { drumNotes: [51, 52, 53, 62, 63, 65] }),
            P('dun-dun', '#2563eb', '#eff6ff', 'drums', 'world_percussion', 2, { drumNotes: [64, 66, 69] }),
            P('shaker', '#eab308', '#3d2e03', 'drums', 'world_percussion', 4, { drumNotes: [54, 55, 56, 67, 68] }),
            P('wood claves', '#16a34a', '#f1fcf4', 'drums', 'world_percussion', 4, { drumNotes: [59, 60, 61] }),
            P('rock kit', '#f59e0b', '#2e2202', 'drums', 'rock_kit', 3, { drumNotes: [48, 50, 52, 53, 58, 59, 60] }),
        ]
    },
    {
        id: 'pop_star', label: 'Pop Star', tempo: 122, key: 61, scale: MAJOR, progression: [[0, 4, 7, 11], [9, 0, 4, 7], [5, 9, 0, 4], [7, 11, 2, 5]], totalBeats: 40, relationReach: .047, canvas: '#fff6fb', canvasInk: '#241724', accent: '#ff3e93', stamps: popStamps, feel: F(.25, .34, .04, .96, [1.07, .97, 1.02, .96], 1, 'hook'), studio: { master: .80, room: .15, echo: .20, feedback: .32, release: 1.10, echoBeats: [.75, 1], lowpass: 6500 }, palette: [
            P('saw hook', '#eab308', '#3d2e03', 'melody', 'saw_hook', 5, { echo: .14 }),
            P('synth vox', '#ec4899', '#fff0f7', 'human', 'synth_vox', 4, { room: .19, echo: .16 }),
            P('electric keys', '#8b5cf6', '#faf5ff', 'harmony', 'electric_piano', 4),
            P('punchy bass', '#0284c7', '#032a3d', 'bass', 'lately_bass', 2),
            P('pop drums', '#ef4444', '#fff1f3', 'drums', 'pop_kit', 3, { drumNotes: [36, 38, 39, 42, 46] }),
            P('crystal shimmer', '#10b981', '#042f20', 'texture', 'crystal', 5, { room: .26, echo: .23 }),
        ]
    },
    {
        id: 'rock_monster', label: 'Rock Monster', tempo: 142, key: 40, scale: MINOR_PENTA, progression: [[0, 7, 12], [3, 10, 15], [5, 12, 17], [0, 7, 10]], totalBeats: 32, relationReach: .043, canvas: '#111214', canvasInk: '#f2eee8', accent: '#d73b2f', stamps: rockStamps, feel: F(.5, .42, 0, .84, [1.10, .94, 1.06, .93], 1, 'lock'), studio: { master: .84, room: .21, echo: .29, feedback: .47, release: 1.16, echoBeats: [.75, 1.25], lowpass: 4300 }, palette: [
            P('rock guitar', '#ef4444', '#fff1f1', 'harmony', 'clean_guitar', 4, { echo: .12 }),
            P('drive bass', '#3b82f6', '#eff6ff', 'bass', 'finger_bass', 3),
            P('rock kit', '#f59e0b', '#2e2202', 'drums', 'rock_kit', 3, { drumNotes: [48, 50, 52, 53, 58, 59, 60] }),
            P('solo lead', '#a855f7', '#faf5ff', 'melody', 'clean_guitar', 5, { echo: .17 }),
            P('arena shout', '#ec4899', '#fff1f7', 'human', 'choir_aahs', 4, { room: .18, echo: .16 }),
            P('amp feedback', '#14b8a6', '#effefb', 'texture', 'fret_noise', 4, { room: .25, echo: .34 }),
        ]
    },
    {
        id: 'salsa_party', label: 'Salsa Party', tempo: 168, key: 60, scale: DORIAN, progression: [[0, 4, 7, 10], [5, 9, 0, 4], [7, 11, 2, 5], [0, 4, 7, 10]], totalBeats: 36, relationReach: .055, canvas: '#fff4df', canvasInk: '#3b2013', accent: '#d94a2b', stamps: salsaStamps, feel: F(.25, .32, .10, .90, [1.08, .95, 1.02, 1.06, .94, 1.03, .98, .96], .5, 'clave'), studio: { master: .81, room: .19, echo: .15, feedback: .27, release: 1.07, echoBeats: [.5, .75], lowpass: 5500 }, palette: [
            P('montuno piano', '#eab308', '#3b2b02', 'harmony', 'piano', 4),
            P('salsa brass', '#dc2626', '#fff1f1', 'melody', 'brass', 4),
            P('congas & timbales', '#0891b2', '#042f3e', 'drums', 'world_percussion', 4, { drumNotes: [62, 63, 64, 65, 60, 67, 68, 57] }),
            P('baby bass', '#2563eb', '#f0f6ff', 'bass', 'acoustic_bass', 2),
            P('marimba & bells', '#16a34a', '#f0fcf4', 'melody', 'marimba', 5, { echo: .10 }),
            P('coro shouts', '#c026d3', '#fdf4ff', 'human', 'choir_aahs', 4, { echo: .10 }),
        ]
    },
    {
        id: 'weird_cabinet', label: 'Weird Cabinet', tempo: 96, key: 55, scale: MINOR_PENTA, progression: [[0, 3, 7], [5, 10, 0], [7, 0, 3], [0, 5, 10]], totalBeats: 38, relationReach: .064, canvas: '#eeece2', canvasInk: '#242722', accent: '#6e5a8e', stamps: weirdStamps, feel: F(.375, .24, .18, 1.16, [1.05, .93, 1.01, .97, 1.07], .75, 'odd'), studio: { master: .79, room: .24, echo: .31, feedback: .52, release: 1.24, echoBeats: [1, 1.5], lowpass: 3400 }, palette: [
            P('theremin', '#8b5cf6', '#faf5ff', 'melody', 'theremin', 5),
            P('musical saw', '#06b6d4', '#083344', 'texture', 'musical_saw', 5),
            P('hurdy gurdy', '#ea580c', '#fff3ea', 'bass', 'hurdy_gurdy', 3),
            P('nyckelharpa', '#db2777', '#fff0f7', 'melody', 'nyckelharpa', 4),
            P('ondioline', '#84cc16', '#243c04', 'harmony', 'ondioline', 4),
            P('waterphone', '#1e3a8a', '#eff6ff', 'texture', 'waterphone', 5),
        ]
    },
    {
        id: 'zouk', label: 'Zouk', tempo: 98, key: 57, scale: MINOR, progression: [[0, 3, 7, 10], [8, 0, 3, 7], [5, 8, 0, 3], [10, 2, 5, 8]], totalBeats: 40, relationReach: .052, canvas: '#142238', canvasInk: '#fff5ef', accent: '#ff7b68', stamps: zoukStamps, feel: F(.5, .24, .16, 1.04, [1.05, .96, 1.02, .98], 1, 'sway'), studio: { master: .81, room: .19, echo: .24, feedback: .38, release: 1.14, echoBeats: [.75, 1.25], lowpass: 5600 }, palette: [
            P('zouk guitar', '#f59e0b', '#3d2503', 'harmony', 'clean_guitar', 4, { echo: .14 }),
            P('warm bass', '#06b6d4', '#042b33', 'bass', 'finger_bass', 2),
            P('zouk groove', '#ef4444', '#fff1f3', 'drums', 'pop_kit', 3, { drumNotes: [36, 38, 42, 46, 39] }),
            P('sax lead', '#10b981', '#042e20', 'melody', 'alto_sax', 4, { echo: .16 }),
            P('rhodes keys', '#8b5cf6', '#28144f', 'harmony', 'electric_piano', 4),
            P('choral sway', '#ec4899', '#fff0f7', 'human', 'voice_oohs', 4, { room: .20, echo: .17 }),
        ]
    },
    {
        id: 'flamenco', label: 'Flamenco', tempo: 144, key: 52, scale: PHRYGIAN, progression: [[0, 1, 5, 7], [0, 5, 7, 8], [3, 1, 0, 7], [0, 1, 5, 0]], totalBeats: 36, relationReach: .048, canvas: '#f7e8d0', canvasInk: '#2b130f', accent: '#b63b2e', stamps: flamencoStamps, feel: F(.25, .34, .05, .82, [1.08, .96, .99, 1.05, .95, 1.02, 1.07, .94, 1.01, 1.06, .96, 1.03], .5, 'compas'), studio: { master: .82, room: .16, echo: .10, feedback: .18, release: 1.06, echoBeats: [.33, .5], lowpass: 6200 }, palette: [
            P('Spanish guitar', '#f59e0b', '#3d2503', 'harmony', 'nylon_guitar', 4, { room: .13 }),
            P('cajón', '#dc2626', '#fff1f1', 'drums', 'world_percussion', 3, { drumNotes: [48, 49, 50] }),
            P('palmas', '#f97316', '#3f1702', 'drums', 'world_percussion', 4, { drumNotes: [59, 61, 60] }),
            P('falseta', '#c026d3', '#fdf4ff', 'melody', 'nylon_guitar', 5, { room: .16, echo: .06 }),
            P('bajo flamenco', '#2563eb', '#eff5ff', 'bass', 'acoustic_bass', 2),
            P('jaleo shouts', '#16a34a', '#f4fbe9', 'human', 'choir_aahs', 4, { room: .15 }),
        ]
    },
    {
        id: 'tango', label: 'Tango', tempo: 126, key: 57, scale: HARM_MINOR, progression: [[0, 3, 7, 11], [5, 8, 0, 3], [7, 11, 2, 5], [0, 3, 7, 0]], totalBeats: 40, relationReach: .050, canvas: '#151619', canvasInk: '#f4e9da', accent: '#a93136', stamps: tangoStamps, feel: F(.25, .40, -.04, .88, [1.10, .94, 1.04, .97], 1, 'tension'), studio: { master: .81, room: .20, echo: .12, feedback: .22, release: 1.11, echoBeats: [.5, .75], lowpass: 5400 }, palette: [
            P('bandoneón', '#dc2626', '#fff1f1', 'harmony', 'bandoneon', 4, { room: .22, echo: .08 }),
            P('violin', '#f59e0b', '#3d2503', 'melody', 'violin', 5, { room: .24 }),
            P('piano tango', '#f1f5f9', '#1e293b', 'harmony', 'upright_piano', 4),
            P('contrabajo', '#2563eb', '#eff6ff', 'bass', 'acoustic_bass', 2),
            P('cello dramático', '#8b5cf6', '#faf5ff', 'melody', 'cello', 3),
            P('tenor sax', '#10b981', '#042e20', 'melody', 'tenor_sax', 4, { room: .25, echo: .10 }),
        ]
    },
];
export const WORLD_MAP = Object.fromEntries(WORLDS.map((world) => [world.id, world])) as Record<WorldId, WorldConfig>;
export function isWorldId(value: string): value is WorldId {
    return Object.prototype.hasOwnProperty.call(WORLD_MAP, value);
}
