import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BasicSoundBank, SoundBankLoader, SpessaLog, SpessaSynthProcessor } from 'spessasynth_core';
import { audioCorpus, SOUNDS, PITCH_RANGES, WORLDS, percussionKeys, soundVelocityRange, noteVelocity } from './audio-corpus.mjs';

SpessaLog.setLogLevel(false, true, false);
const root = path.resolve(import.meta.dirname, '..');
const bankDirectory = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? path.join(root, 'public/soundfonts'));
const baseline = process.argv.includes('--baseline');
const report = { banks: {}, sounds: {}, corpus: { phrases: 0, events: 0 }, missing: [] };
const banks = {};
for (const name of ['instruments', 'percussion']) {
    const bytes = fs.readFileSync(path.join(bankDirectory, baseline ? `seed-${name}.sf3` : `drawsounds-${name}.sf3`));
    const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    banks[name] = bank;
    report.banks[name] = {
        bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        presets: bank.presets.length, samples: bank.samples.length,
    };
}
await BasicSoundBank.isSF3DecoderReady;
const keys = percussionKeys();
const usedSamples = new Set();
const seen = new Set();
function validate(sound, key, velocity, context) {
    const signature = `${sound}:${key}:${velocity}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    const spec = SOUNDS[sound];
    const preset = banks[spec.bank].presets.find(p => p.program === spec.program && p.bankMSB === 0 && !p.isGMGSDrum);
    const voices = preset?.getVoiceParameters(key, velocity) ?? [];
    if (!voices.length) {
        if (report.missing.length < 40) report.missing.push({ sound, key, velocity, context });
        return;
    }
    for (const voice of voices) usedSamples.add(voice.sample);
}
for (const [sound, spec] of Object.entries(SOUNDS)) {
    const preset = banks[spec.bank].presets.find(p => p.program === spec.program);
    const range = PITCH_RANGES[sound];
    const supported = range ? Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i) : [...keys.get(sound)].sort((a, b) => a - b);
    report.sounds[sound] = { ...spec, preset: preset?.name, keys: range ?? supported, velocities: soundVelocityRange(sound), observed: [] };
    const [min, max] = soundVelocityRange(sound);
    for (const key of supported) for (let velocity = min; velocity <= max; velocity++) validate(sound, key, velocity, 'declared register');
}
const observed = new Map(Object.keys(SOUNDS).map(sound => [sound, new Set()]));
for (const { world, mark, events } of audioCorpus()) {
    report.corpus.phrases++;
    for (const event of events) {
        report.corpus.events++;
        assert(SOUNDS[event.sound], `Unknown sound ${event.sound}`);
        assert(Number.isFinite(event.midi) && Number.isFinite(event.velocity), `Invalid event in ${mark.id}`);
        const notes = event.glideToMidi === undefined ? [event.midi] : Array.from(
            { length: Math.abs(event.glideToMidi - event.midi) + 1 },
            (_, i) => Math.min(event.midi, event.glideToMidi) + i,
        );
        for (const note of notes) {
            const range = PITCH_RANGES[event.sound];
            if (!baseline) assert(range ? note >= range[0] && note <= range[1] : keys.get(event.sound).has(note), `${world} ${mark.id}: ${event.sound} key ${note} outside its contract`);
            observed.get(event.sound).add(note);
            validate(event.sound, note, noteVelocity(event.sound, event.velocity), `${world}/${mark.tool}/${mark.stampKind}`);
        }
    }
}
for (const [sound, notes] of observed) {
    assert(notes.size, `Unused sound ID: ${sound}`);
    report.sounds[sound].observed = [...notes].sort((a, b) => a - b);
}
if (!baseline) {
    // The shipped worklet has one local fix: panic also clears scheduled notes.
    // Check the rest against the installed wrapper's matching processor.
    const normalizeWorklet = source => source.replace(/(stopAllChannels\(\w+\)\{)this\.eventQueue\.length=0;/, '$1');
    const shippedWorklet = fs.readFileSync(path.join(root, 'public/spessasynth_processor.min.js'), 'utf8');
    const installedWorklet = fs.readFileSync(path.join(root, 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js'), 'utf8');
    assert.equal(normalizeWorklet(shippedWorklet), normalizeWorklet(installedWorklet), 'AudioWorklet and installed synthesizer are out of sync');
    for (const [name, bank] of Object.entries(banks)) {
        assert.equal(bank.presets.length, Object.values(SOUNDS).filter(s => s.bank === name).length, `Extra or missing ${name} presets`);
        for (const sample of bank.samples) {
            assert(usedSamples.has(sample) || (sample.linkedSample && usedSamples.has(sample.linkedSample)), `Unused sample: ${sample.name}`);
            assert(sample.isCompressed, `Uncompressed sample: ${sample.name}`);
            const audio = sample.getAudioData();
            assert(audio.length && audio.every(Number.isFinite), `Corrupt audio: ${sample.name}`);
            assert(audio.some(x => Math.abs(x) > .00001), `Silent sample: ${sample.name}`);
        }
        report.banks[name].decodedMiB = +(bank.samples.reduce((sum, s) => sum + s.getAudioData().byteLength, 0) / 1048576).toFixed(2);
    }
    assert.equal(report.missing.length, 0, JSON.stringify(report.missing, null, 2));
    // Render every preset/key/layer through the actual decoder and synthesizer,
    // including both common device sample rates. A zone existing isn't enough.
    for (const sampleRate of [44100, 48000]) {
        const synth = new SpessaSynthProcessor(sampleRate, { enableEffects: false });
        await synth.processorInitialized;
        for (const [name, bank] of Object.entries(banks)) synth.soundBankManager.addSoundBank(bank, name, name === 'percussion' ? 1 : 0);
        const l = new Float32Array(128), r = new Float32Array(128);
        for (const [sound, spec] of Object.entries(SOUNDS)) {
            const channel = synth.midiChannels[0];
            synth.controllerChange(0, 0, spec.bank === 'percussion' ? 1 : 0);
            synth.controllerChange(0, 32, 0);
            synth.programChange(0, spec.program);
            assert.equal(channel.preset.program, spec.program, `Wrong program for ${sound}`);
            assert.equal(channel.preset.bankMSB, spec.bank === 'percussion' ? 1 : 0, `Wrong bank for ${sound}`);
            const range = PITCH_RANGES[sound];
            const notes = range ? [range[0], Math.round((range[0] + range[1]) / 2), range[1]] : [...keys.get(sound)];
            for (const key of notes) for (const strength of [.1, .5, .9]) {
                synth.stopAllChannels(true);
                synth.noteOn(0, key, noteVelocity(sound, strength));
                let energy = 0;
                for (let block = 0; block < Math.ceil(sampleRate * .25 / 128); block++) {
                    synth.process(l, r);
                    for (let i = 0; i < 128; i++) { assert(Number.isFinite(l[i]) && Number.isFinite(r[i]), `Non-finite render: ${sound}`); energy += l[i] ** 2 + r[i] ** 2; }
                }
                assert(energy > 1e-9, `Silent render at ${sampleRate}: ${sound}/${key}/${strength}`);
            }
        }
        console.log(`Rendered all sounds at ${sampleRate} Hz`);
    }
    // Keep the checked-in inventory current without requiring an audit to edit it.
    const target = path.join(root, 'public/soundfonts/inventory.json');
    if (process.argv.includes('--write')) fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    else if (fs.existsSync(target)) assert.deepEqual(JSON.parse(fs.readFileSync(target)), report, 'SoundFont inventory stale; run npm run audio:inventory');
}
console.log(JSON.stringify({ banks: report.banks, corpus: report.corpus, missing: report.missing }, null, 2));
if (baseline) process.exitCode = 0;
