import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BasicSoundBank, BasicPreset, BasicInstrument, BasicSample, SoundBankLoader, GeneratorTypes as G, SampleTypes, SpessaLog } from 'spessasynth_core';
import { SOUNDS, PITCH_RANGES, soundVelocityRange, percussionKeys } from './audio-corpus.mjs';

SpessaLog.setLogLevel(false, true, false);
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/soundfont-sources.json')));
const sources = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'drawsounds-sources'));
fs.mkdirSync(sources, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'drawsounds-encode-'));
const hasVorbis = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('libvorbis');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const asArrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const banks = {};
for (const name of ['instruments', 'percussion']) {
    // A frozen seed preserves the recordings and their original compression.
    // A full git clone contains it; shallow clones can use the pinned raw file.
    const filename = path.join(sources, `seed-${name}.sf3`);
    if (!fs.existsSync(filename)) {
        fs.writeFileSync(filename, execFileSync('git', ['show', `${manifest.seedCommit}:public/soundfonts/drawsounds-${name}.sf3`], { cwd: root, maxBuffer: 20 * 1024 * 1024 }));
    }
    const seed = fs.readFileSync(filename);
    if (hash(seed) !== manifest.seedHashes[name]) throw new Error(`Seed checksum mismatch: ${name}`);
    banks[name] = SoundBankLoader.fromArrayBuffer(asArrayBuffer(seed));
}
await BasicSoundBank.isSF3DecoderReady;

function readAudio(id) {
    const source = manifest.samples.find(s => s.id === id);
    const filename = path.join(sources, source.file);
    if (!fs.existsSync(filename)) execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', source.url, '-o', filename]);
    if (hash(fs.readFileSync(filename)) !== source.sha256) throw new Error(`Sample checksum mismatch: ${id}`);
    const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', filename, '-ac', '1', '-ar', '32000', '-f', 'f32le', '-'], { maxBuffer: 20 * 1024 * 1024 });
    return new Float32Array(asArrayBuffer(bytes));
}
function prepareAudio(data, peak = .6) {
    let maximum = 0;
    for (const x of data) maximum = Math.max(maximum, Math.abs(x));
    let first = data.findIndex(x => Math.abs(x) > maximum * .003);
    let last = data.length - 1;
    while (last > first && Math.abs(data[last]) < maximum * .001) last--;
    data = data.slice(Math.max(0, first - 64), Math.min(data.length, last + 320));
    for (let i = 0; i < data.length; i++) data[i] *= peak / maximum * Math.min(1, i / 32, (data.length - 1 - i) / 256);
    return data;
}
async function encode(data, sampleRate) {
    const raw = path.join(temporary, 'sample.f32');
    const ogg = path.join(temporary, 'sample.ogg');
    fs.writeFileSync(raw, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    if (hasVorbis) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', raw, '-c:a', 'libvorbis', '-q:a', '5', '-fflags', '+bitexact', ogg]);
    else execFileSync('python3', [path.join(root, 'scripts/encode-vorbis.py'), raw, ogg, String(sampleRate)]);
    return new Uint8Array(fs.readFileSync(ogg));
}
async function addSample(bank, name, data, rootKey, loop = false) {
    const sample = new BasicSample(name, 32000, rootKey, 0, SampleTypes.monoSample, 0, data.length);
    if (loop) {
        sample.loopStart = 38400;
        sample.loopEnd = data.length - 320;
        // Crossfade into the audio immediately preceding the loop start.
        const fade = 1280;
        for (let i = 0; i < fade; i++) {
            const fraction = i / (fade - 1), index = sample.loopEnd - fade + i;
            data[index] = data[index] * (1 - fraction) + data[sample.loopStart - fade + i] * fraction;
        }
    }
    sample.setAudioData(data, 32000);
    // Encoding failures must abort instead of silently shipping PCM in SF3.
    sample.setCompressedData(await encode(data, 32000));
    bank.addSamples(sample);
    return sample;
}
function preset(bank, sound, name) {
    const p = new BasicPreset(bank);
    p.name = name; p.program = SOUNDS[sound].program; p.bankMSB = 0; p.bankLSB = 0;
    bank.addPresets(p);
    const instrument = new BasicInstrument(); instrument.name = name;
    bank.addInstruments(instrument); p.createZone(instrument);
    return { p, instrument };
}
function sampleZone(instrument, sample, key, velocities = [16, 72]) {
    const z = instrument.createZone(sample);
    z.keyRange = { min: key, max: key };
    z.velRange = { min: velocities[0], max: velocities[1] };
    z.setGenerator(G.scaleTuning, 0);
    z.setGenerator(G.releaseVolEnv, -1200); // Preserve the natural hit tail.
    return z;
}
const percussion = banks.percussion;
const djembe = preset(percussion, 'djembe', 'Djembe').instrument;
for (const [key, id] of [[48, 'djembe-bass'], [49, 'djembe-tone'], [50, 'djembe-slap'], [51, 'djembe-muted']]) {
    sampleZone(djembe, await addSample(percussion, id, prepareAudio(readAudio(id), .7), key), key);
}
const shekere = preset(percussion, 'shekere', 'Shekere & Shaker').instrument;
sampleZone(shekere, await addSample(percussion, 'Shekere hit', prepareAudio(readAudio('shekere'), .45), 54), 54);
const worldPreset = percussion.presets.find(p => p.program === SOUNDS.world_percussion.program);
const worldInstrument = worldPreset.zones[0].instrument;
// The other two keys retain FreePats' fast/soft egg shaker articulations.
for (const key of [55, 56]) for (const original of worldInstrument.zones.filter(z => z.keyRange.min === key)) {
    const z = shekere.createZone(original.sample); z.copyFrom(original);
}
const salsa = preset(percussion, 'salsa_kit', 'Salsa Percussion').instrument;
salsa.globalZone.copyFrom(worldInstrument.globalZone);
for (const key of [60, 62, 63, 64, 65]) for (const original of worldInstrument.zones.filter(z => z.keyRange.min === key)) {
    const z = salsa.createZone(original.sample); z.copyFrom(original);
}
for (const [index, layer] of [2, 3, 4].entries()) {
    const velocity = [[16, 34], [35, 53], [54, 72]][index];
    sampleZone(salsa, await addSample(percussion, `Cowbell ${layer}`, prepareAudio(readAudio(`cowbell-${layer}`), .55), 67), 67, velocity);
}
const timbales = readAudio('timbales');
// Isolated low/high strikes from hello_flowers' CC0 one-shot collection.
for (const [key, start, end] of [[57, 0, 1.3], [68, 12.15, 14.4]]) {
    const slice = timbales.slice(Math.floor(start * 32000), Math.floor(end * 32000));
    sampleZone(salsa, await addSample(percussion, `Timbale ${key === 57 ? 'low' : 'high'}`, prepareAudio(slice, .6), key), key);
}
const glass = preset(banks.instruments, 'glass_harmonica', 'Rubbed Glass').instrument;
for (const [index, rootKey] of [63, 66, 70, 74].entries()) {
    const data = prepareAudio(readAudio(`glass-${index + 1}`).slice(0, 128000), .4);
    const sample = await addSample(banks.instruments, `Rubbed glass ${rootKey}`, data, rootKey, true);
    const z = glass.createZone(sample);
    z.keyRange = { min: [36, 65, 69, 73][index], max: [64, 68, 72, 120][index] };
    z.velRange = { min: 12, max: 104 };
    z.setGenerator(G.sampleModes, 1);
    z.setGenerator(G.attackVolEnv, -3600);
    z.setGenerator(G.releaseVolEnv, 0);
}

// Restore edge zones stripped by the old compiler; keep the original recordings
// and tuning, and extend only the outermost zone of each instrument layer.
for (const [sound, [min, max]] of Object.entries(PITCH_RANGES)) {
    const p = banks.instruments.presets.find(p => p.program === SOUNDS[sound].program);
    for (const pz of p.zones) {
        pz.keyRange = { min, max };
        const instrument = pz.instrument;
        if (instrument.globalZone.hasKeyRange) instrument.globalZone.keyRange = { min, max };
        const zones = instrument.zones;
        if (!zones.length) continue;
        const lo = Math.min(...zones.map(z => Math.max(0, z.keyRange.min)));
        const hi = Math.max(...zones.map(z => z.keyRange.max));
        for (const z of zones) {
            if (Math.max(0, z.keyRange.min) === lo) z.keyRange.min = Math.min(lo, min);
            if (z.keyRange.max === hi) z.keyRange.max = Math.max(hi, max);
        }
        // Some old subsets retained only the quiet sax layer in low registers.
        // Extend the last surviving layer per key zone, keeping velocity gain.
        for (const z of zones) {
            const peers = zones.filter(other => other.keyRange.min === z.keyRange.min && other.keyRange.max === z.keyRange.max);
            const highest = Math.max(...peers.map(other => other.velRange.max));
            const lowest = Math.min(...peers.map(other => Math.max(0, other.velRange.min)));
            if (z.velRange.max === highest && highest < 104) z.velRange.max = 104;
            if (Math.max(0, z.velRange.min) === lowest && lowest > 12) z.velRange.min = 12;
        }
    }
    if (p.globalZone.hasKeyRange) p.globalZone.keyRange = { min, max };
}

const keys = percussionKeys();
for (const [sound, used] of keys) {
    const p = percussion.presets.find(p => p.program === SOUNDS[sound].program);
    if (sound === 'pop_kit' || sound === 'djembe') continue;
    for (const pz of p.zones) {
        const instrument = pz.instrument;
        const originals = instrument.zones.slice();
        // Three actual sampled layers replace dozens of overlapping velocity
        // variants. Stereo pairs stay together; no samples are recompressed.
        const retained = new Map();
        for (const key of used) for (const [anchor, min, max] of [[24, 16, 34], [44, 35, 53], [64, 54, 72]]) {
            for (const z of originals) {
                if (key < Math.max(0, z.keyRange.min) || key > z.keyRange.max || anchor < Math.max(0, z.velRange.min) || anchor > z.velRange.max) continue;
                const signature = `${key}:${z.sample.name}:${JSON.stringify(z.generators)}`;
                const previous = retained.get(signature);
                if (previous) { previous.velRange.min = Math.min(previous.velRange.min, min); previous.velRange.max = Math.max(previous.velRange.max, max); }
                else {
                    const copy = instrument.createZone(z.sample); copy.copyFrom(z);
                    copy.keyRange = { min: key, max: key }; copy.velRange = { min, max };
                    retained.set(signature, copy);
                }
            }
        }
        for (let index = originals.length - 1; index >= 0; index--) instrument.deleteZone(index, true);
    }
}
for (const [name, bank] of Object.entries(banks)) {
    const combinations = new Map();
    for (const [sound, spec] of Object.entries(SOUNDS)) {
        if (spec.bank !== name) continue;
        const p = bank.presets.find(p => p.program === spec.program);
        const range = PITCH_RANGES[sound];
        const used = range ? Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i) : [...keys.get(sound)];
        const [min, max] = soundVelocityRange(sound);
        combinations.set(p, new Map(used.map(key => [key, new Set(Array.from({ length: max - min + 1 }, (_, i) => min + i))])));
    }
    bank.trim(combinations);
    for (const p of bank.presets) for (let i = p.zones.length - 1; i >= 0; i--) if (!p.zones[i].instrument.zones.length) p.deleteZone(i);
    bank.removeUnusedElements();
    const out = bank.writeSF2({ software: 'DrawSounds audited runtime compiler' });
    fs.writeFileSync(path.join(root, `public/soundfonts/drawsounds-${name}.sf3`), new Uint8Array(out));
    console.log(`${name}: ${bank.presets.length} presets, ${bank.samples.length} samples, ${(out.byteLength / 1048576).toFixed(2)} MiB`);
}
fs.rmSync(temporary, { recursive: true });
