import { WorkletSynthesizer } from 'spessasynth_lib';
import { cyclicAt } from '../utils/arrays';
import { isWorldId, WORLD_MAP } from '../music/worlds/config';
import { bankOffset, fetchRuntimeBank, noteVelocity, PITCH_RANGES, soundSpec } from './sounds';
import type { RuntimeBank, SoundId } from './sounds';
import type { NoteEvent, PerformerRole, StudioState } from './types';
function resolveAssetUrl(relativePath: string): string {
    const clean = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    try {
        return new URL(clean, document.baseURI || window.location.href).href;
    }
    catch {
        const base = import.meta.env.BASE_URL || '/';
        const prefix = base.endsWith('/') ? base : `${base}/`;
        return `${prefix}${clean}`;
    }
}
const TRANSPORT_CHANNELS = [0, 1, 2, 3, 4, 5] as const;
const AUDITION_CHANNELS = [10, 11, 12, 13, 14, 15] as const;
const ROLE_MIX: Record<PerformerRole, {
    pan: number;
    room: number;
    echo: number;
    level: number;
}> = {
    drums: { pan: 0.05, room: 0.07, echo: 0.015, level: 1.08 },
    bass: { pan: 0, room: 0.04, echo: 0.015, level: 1.07 },
    harmony: { pan: 0.12, room: 0.11, echo: 0.05, level: 1.12 },
    melody: { pan: 0.18, room: 0.13, echo: 0.07, level: 1.16 },
    texture: { pan: 0.26, room: 0.2, echo: 0.13, level: 1.08 },
    human: { pan: 0.1, room: 0.15, echo: 0.08, level: 1.12 },
};
const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB = 91;
const CC_CHORUS = 93;
type PlayBus = 'transport' | 'audition';
type ChannelMix = {
    volume: number;
    pan: number;
    reverb: number;
    chorus: number;
};
export class SoundFontStudio {
    readonly ctx = new AudioContext({ latencyHint: 'interactive' });
    private readonly synthBus = this.ctx.createGain();
    private readonly master = this.ctx.createGain();
    private readonly safety = this.ctx.createDynamicsCompressor();
    private roomL: DelayNode;
    private roomR: DelayNode;
    private roomWetL: GainNode;
    private roomWetR: GainNode;
    private echoL: DelayNode;
    private echoR: DelayNode;
    private echoFbL: GainNode;
    private echoFbR: GainNode;
    private echoWetL: GainNode;
    private echoWetR: GainNode;
    private echoFilterL: BiquadFilterNode;
    private echoFilterR: BiquadFilterNode;
    private panL: StereoPannerNode;
    private panR: StereoPannerNode;
    private synth: WorkletSynthesizer | null = null;
    private initialization: Promise<void> | null = null;
    private readonly loadedBanks = new Set<RuntimeBank>();
    private readonly bankJobs = new Map<RuntimeBank, Promise<void>>();
    private bankQueue: Promise<void> = Promise.resolve();
    private readonly readyListeners = new Set<() => void>();
    private generation = 0;
    private readonly channelSetup = new Map<number, number>();
    private readonly channelMix = new Map<number, ChannelMix>();
    private studioKey = '';
    private studioState: StudioState | null = null;
    constructor() {
        this.roomL = this.ctx.createDelay(0.35);
        this.roomR = this.ctx.createDelay(0.35);
        this.roomWetL = this.ctx.createGain();
        this.roomWetR = this.ctx.createGain();
        this.echoL = this.ctx.createDelay(2.5);
        this.echoR = this.ctx.createDelay(2.5);
        this.echoFbL = this.ctx.createGain();
        this.echoFbR = this.ctx.createGain();
        this.echoWetL = this.ctx.createGain();
        this.echoWetR = this.ctx.createGain();
        this.echoFilterL = this.ctx.createBiquadFilter();
        this.echoFilterR = this.ctx.createBiquadFilter();
        this.panL = this.ctx.createStereoPanner();
        this.panR = this.ctx.createStereoPanner();
        this.master.gain.value = 0.8;
        this.safety.threshold.value = -8;
        this.safety.knee.value = 12;
        this.safety.ratio.value = 3;
        this.safety.attack.value = 0.008;
        this.safety.release.value = 0.18;
        this.synthBus.connect(this.master);
        this.master.connect(this.safety);
        this.safety.connect(this.ctx.destination);
        this.connectEffects();
        void this.ready().catch((error: unknown) => console.warn('DrawSounds audio initialization failed', error));
    }
    private async initialize(): Promise<void> {
        await this.ctx.audioWorklet.addModule(resolveAssetUrl('spessasynth_processor.min.js'));
        const synth = new WorkletSynthesizer(this.ctx, { eventsEnabled: false });
        try {
            await synth.isReady;
            synth.setLogLevel(false, true, false);
            // Bound real-time allocations on both mobile and desktop. This
            // covers six performers, stereo layers and overlapping releases.
            synth.setSystemParameter('voiceCap', 128);
            synth.setSystemParameter('autoAllocateVoices', false);
            synth.connect(this.synthBus);
            this.synth = synth;
        }
        catch (error: unknown) {
            synth.destroy();
            throw error;
        }
    }
    private notifyReady(): void {
        for (const listener of this.readyListeners) {
            try {
                listener();
            }
            catch (error: unknown) {
                console.warn('DrawSounds ready listener failed', error);
            }
        }
    }
    isReady(): boolean {
        return this.synth !== null && this.requiredBanks().every(bank => this.loadedBanks.has(bank));
    }
    onReady(listener: () => void): () => void {
        this.readyListeners.add(listener);
        if (this.isReady()) {
            listener();
        }
        return () => {
            this.readyListeners.delete(listener);
        };
    }
    async ensureReady(sound?: SoundId): Promise<void> {
        await this.ready();
        if (sound)
            await this.loadBank(soundSpec(sound).bank);
        if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
            try {
                await this.ctx.resume();
            }
            catch (error: unknown) {
                console.warn('DrawSounds audio resume failed', error);
            }
        }
    }
    private requiredBanks(): RuntimeBank[] {
        const world = this.studioState && isWorldId(this.studioState.worldId)
            ? WORLD_MAP[this.studioState.worldId] : WORLD_MAP.dreamland;
        return [...new Set(world.palette.map(performer => soundSpec(performer.sound).bank))];
    }
    private loadBank(bank: RuntimeBank): Promise<void> {
        if (this.loadedBanks.has(bank))
            return Promise.resolve();
        let job = this.bankJobs.get(bank);
        if (!job) {
            job = this.bankQueue.then(async () => {
                const data = await fetchRuntimeBank(bank);
                if (!this.synth)
                    throw new Error('SoundFont synthesizer unavailable');
                await this.synth.soundBankManager.addSoundBank(data, bank, bankOffset(bank));
                this.loadedBanks.add(bank);
                this.notifyReady();
            }).finally(() => this.bankJobs.delete(bank));
            this.bankJobs.set(bank, job);
            this.bankQueue = job.catch(() => { });
        }
        return job;
    }
    async ready(): Promise<void> {
        if (!this.initialization) {
            this.initialization = this.initialize().catch((error: unknown) => {
                this.initialization = null;
                throw error;
            });
        }
        await this.initialization;
        // Load one bank at a time: the worklet bank manager uses a single
        // response queue, and sequential parsing limits peak mobile memory.
        while (!this.isReady()) {
            for (const bank of this.requiredBanks())
                await this.loadBank(bank);
        }
    }
    async unlockFromGesture(): Promise<void> {
        if (this.ctx.state === 'closed')
            return;
        if (this.ctx.state !== 'running') {
            try {
                await this.ctx.resume();
            }
            catch (error: unknown) {
                console.warn('DrawSounds audio resume failed', error);
            }
        }
        try {
            const source = this.ctx.createBufferSource();
            source.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
            source.connect(this.ctx.destination);
            source.start(0);
            source.onended = () => {
                try {
                    source.disconnect();
                }
                catch {
                    // Already disconnected.
                }
            };
        }
        catch {
            // Safari can reject the silent unlock buffer while the context is transitioning.
        }
        await this.ready();
    }
    private disconnectEffects(): void {
        for (const node of [
            this.roomL,
            this.roomR,
            this.roomWetL,
            this.roomWetR,
            this.echoL,
            this.echoR,
            this.echoFbL,
            this.echoFbR,
            this.echoWetL,
            this.echoWetR,
            this.echoFilterL,
            this.echoFilterR,
            this.panL,
            this.panR,
        ]) {
            try {
                node.disconnect();
            }
            catch {
                // Web Audio throws if a browser believes the node is already disconnected.
            }
        }
    }
    private connectEffects(): void {
        this.panL.pan.value = -0.5;
        this.panR.pan.value = 0.5;
        this.roomWetL.gain.value = 0;
        this.roomWetR.gain.value = 0;
        this.echoWetL.gain.value = 0;
        this.echoWetR.gain.value = 0;
        this.echoFbL.gain.value = 0;
        this.echoFbR.gain.value = 0;
        this.roomL.connect(this.panL);
        this.roomR.connect(this.panR);
        this.panL.connect(this.roomWetL);
        this.panR.connect(this.roomWetR);
        this.roomWetL.connect(this.master);
        this.roomWetR.connect(this.master);
        this.echoFilterL.type = 'lowpass';
        this.echoFilterR.type = 'lowpass';
        this.echoL.connect(this.echoFilterL);
        this.echoR.connect(this.echoFilterR);
        this.echoFilterL.connect(this.echoWetL);
        this.echoFilterR.connect(this.echoWetR);
        this.echoWetL.connect(this.master);
        this.echoWetR.connect(this.master);
        this.echoFilterL.connect(this.echoFbL);
        this.echoFbL.connect(this.echoR);
        this.echoFilterR.connect(this.echoFbR);
        this.echoFbR.connect(this.echoL);
        this.synthBus.connect(this.roomL);
        this.synthBus.connect(this.roomR);
        this.synthBus.connect(this.echoL);
        this.synthBus.connect(this.echoR);
    }
    private resetEffects(): void {
        try {
            this.synthBus.disconnect(this.roomL);
            this.synthBus.disconnect(this.roomR);
            this.synthBus.disconnect(this.echoL);
            this.synthBus.disconnect(this.echoR);
        }
        catch {
            // Connections can already be gone after an interrupted browser audio transition.
        }
        this.disconnectEffects();
        this.roomL = this.ctx.createDelay(0.35);
        this.roomR = this.ctx.createDelay(0.35);
        this.roomWetL = this.ctx.createGain();
        this.roomWetR = this.ctx.createGain();
        this.echoL = this.ctx.createDelay(2.5);
        this.echoR = this.ctx.createDelay(2.5);
        this.echoFbL = this.ctx.createGain();
        this.echoFbR = this.ctx.createGain();
        this.echoWetL = this.ctx.createGain();
        this.echoWetR = this.ctx.createGain();
        this.echoFilterL = this.ctx.createBiquadFilter();
        this.echoFilterR = this.ctx.createBiquadFilter();
        this.panL = this.ctx.createStereoPanner();
        this.panR = this.ctx.createStereoPanner();
        this.connectEffects();
        this.studioKey = '';
        if (this.studioState)
            this.setStudioState(this.studioState);
    }
    setStudioState(state: StudioState): void {
        this.studioState = state;
        const key = `${state.worldId}:${state.tempo}`;
        if (key === this.studioKey)
            return;
        this.studioKey = key;
        void this.ready().catch((error: unknown) => console.warn('DrawSounds world audio unavailable', error));
        const world = isWorldId(state.worldId) ? WORLD_MAP[state.worldId] : WORLD_MAP.dreamland;
        const studio = world.studio;
        const beat = 60 / Math.max(50, state.tempo);
        const now = this.ctx.currentTime;
        this.master.gain.setTargetAtTime(studio.master, now, 0.04);
        this.roomL.delayTime.setTargetAtTime(0.026 + studio.room * 0.035, now, 0.04);
        this.roomR.delayTime.setTargetAtTime(0.044 + studio.room * 0.055, now, 0.04);
        this.roomWetL.gain.setTargetAtTime(studio.room * 0.52, now, 0.04);
        this.roomWetR.gain.setTargetAtTime(studio.room * 0.48, now, 0.04);
        this.echoL.delayTime.setTargetAtTime(Math.min(2.2, beat * studio.echoBeats[0]), now, 0.05);
        this.echoR.delayTime.setTargetAtTime(Math.min(2.2, beat * studio.echoBeats[1]), now, 0.05);
        this.echoWetL.gain.setTargetAtTime(studio.echo * 0.52, now, 0.04);
        this.echoWetR.gain.setTargetAtTime(studio.echo * 0.49, now, 0.04);
        this.echoFbL.gain.setTargetAtTime(Math.min(0.6, studio.feedback), now, 0.05);
        this.echoFbR.gain.setTargetAtTime(Math.min(0.6, studio.feedback * 0.96), now, 0.05);
        this.echoFilterL.frequency.setTargetAtTime(studio.lowpass, now, 0.05);
        this.echoFilterR.frequency.setTargetAtTime(studio.lowpass * 0.9, now, 0.05);
    }
    private channelFor(event: NoteEvent, bus: PlayBus): number {
        const pool = bus === 'transport' ? TRANSPORT_CHANNELS : AUDITION_CHANNELS;
        return cyclicAt(pool, Math.abs(event.channelIndex ?? 0), `${bus} channels`);
    }
    private configureChannel(synth: WorkletSynthesizer, channel: number, bank: 'instruments' | 'percussion', program: number, time: number): void {
        const key = bankOffset(bank) * 128 + program;
        if (this.channelSetup.get(channel) === key)
            return;
        synth.controllerChange(channel, 0, bankOffset(bank), { time });
        synth.controllerChange(channel, 32, 0, { time });
        synth.programChange(channel, program, { time });
        this.channelSetup.set(channel, key);
    }
    private configureMix(synth: WorkletSynthesizer, channel: number, event: NoteEvent, time: number): void {
        const role = ROLE_MIX[event.channelRole ?? 'melody'];
        const index = event.channelIndex ?? 0;
        const side = index % 2 ? 1 : -1;
        const pan = Math.max(-0.7, Math.min(0.7, event.pan ?? side * role.pan));
        const room = Math.max(0, Math.min(0.44, event.room ?? role.room));
        const echo = Math.max(0, Math.min(0.4, event.echo ?? role.echo));
        const next: ChannelMix = {
            volume: Math.max(1, Math.min(127, Math.round(104 * role.level))),
            pan: Math.max(0, Math.min(127, Math.round(64 + pan * 63))),
            reverb: Math.max(0, Math.min(127, Math.round(room * 220))),
            chorus: Math.max(0, Math.min(127, Math.round(echo * 150))),
        };
        const previous = this.channelMix.get(channel);
        if (!previous || previous.volume !== next.volume) {
            synth.controllerChange(channel, CC_VOLUME, next.volume, { time });
        }
        if (!previous || previous.pan !== next.pan) {
            synth.controllerChange(channel, CC_PAN, next.pan, { time });
        }
        if (!previous || previous.reverb !== next.reverb) {
            synth.controllerChange(channel, CC_REVERB, next.reverb, { time });
        }
        if (!previous || previous.chorus !== next.chorus) {
            synth.controllerChange(channel, CC_CHORUS, next.chorus, { time });
        }
        this.channelMix.set(channel, next);
    }
    private playReady(event: NoteEvent, requested: number, bus: PlayBus, generation: number): boolean {
        const synth = this.synth;
        if (!synth || generation !== this.generation)
            return false;
        const spec = soundSpec(event.sound);
        const channel = this.channelFor(event, bus);
        const world = this.studioState && isWorldId(this.studioState.worldId)
            ? WORLD_MAP[this.studioState.worldId]
            : WORLD_MAP.dreamland;
        const articulationScale = event.articulation === 'staccato' ? 0.62 : event.articulation === 'legato' ? 1.1 : 1;
        const duration = spec.bank === 'percussion'
            ? Math.max(0.42, event.duration * 2.5)
            : Math.max(0.045, event.duration * world.studio.release * articulationScale);
        const velocity = noteVelocity(event.sound, event.velocity);
        const range = event.sound in PITCH_RANGES ? PITCH_RANGES[event.sound as keyof typeof PITCH_RANGES] : [0, 127] as const;
        const note = Math.max(range[0], Math.min(range[1], Math.round(event.midi)));
        const start = Math.max(requested, this.ctx.currentTime + 0.016);
        const setup = Math.max(this.ctx.currentTime, start - 0.008);
        this.configureChannel(synth, channel, spec.bank, spec.program, setup);
        this.configureMix(synth, channel, event, setup);
        const play = (midi: number, noteVelocity: number, on: number, off: number): void => {
            synth.noteOn(channel, midi, noteVelocity, { time: on });
            synth.noteOff(channel, midi, { time: off });
        };
        const target = event.glideToMidi === undefined
            ? null
            : Math.max(range[0], Math.min(range[1], Math.round(event.glideToMidi)));
        if (target !== null && target !== note && spec.bank !== 'percussion') {
            const steps = Math.min(4, Math.max(2, Math.abs(target - note) + 1));
            const span = Math.min(duration * 0.5, 0.34);
            for (let index = 0; index < steps; index++) {
                const midi = Math.round(note + ((target - note) * index) / (steps - 1));
                const on = start + (span * index) / (steps - 1);
                const off = Math.min(start + duration, on + Math.max(0.08, (span / (steps - 1)) * 1.5));
                play(midi, noteVelocity(event.sound, event.velocity * (1 - index * 0.04)), on, off);
            }
        }
        else {
            play(note, velocity, start, start + duration);
        }
        return true;
    }
    playNote(event: NoteEvent, when: number, bus: PlayBus = 'transport'): void {
        const schedule = () => {
            if (!this.synth)
                return;
            const now = this.ctx.currentTime;
            const start = Math.max(now + 0.006, when);
            this.playReady(event, start, bus, this.generation);
        };

        if (this.synth && this.loadedBanks.has(soundSpec(event.sound).bank) && this.ctx.state === 'running') {
            schedule();
            return;
        }

        const generation = this.generation;
        void this.ensureReady(event.sound)
            .then(() => {
                if (generation === this.generation)
                    schedule();
            })
            .catch((error: unknown) => console.warn('DrawSounds note failed', error));
    }
    panic(clearEffects = false): void {
        this.generation++;
        if (this.synth)
            this.synth.stopAll(true);
        if (!clearEffects)
            return;
        const now = this.ctx.currentTime;
        try {
            this.synthBus.gain.cancelScheduledValues(now);
            this.synthBus.gain.setValueAtTime(0, now);
            this.synthBus.gain.setValueAtTime(1, now + 0.015);
        }
        catch {
            // The context may be suspended/closing; effect reset below is still safe.
        }
        this.resetEffects();
    }
}
