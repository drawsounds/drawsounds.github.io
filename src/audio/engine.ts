import { atOrThrow, firstOrThrow } from '../utils/arrays';
import { SoundFontStudio } from './soundfontStudio';
import type { NoteEvent, Phrase, Song, TransportState } from './types';
type TimelineEvent = {
    time: number;
    event: NoteEvent;
};
class Transport {
    private readonly studio = new SoundFontStudio();
    private song: Song | null = null;
    private playing = false;
    private preparing = false;
    private startTime = 0;
    private pausedAt = 0;
    private scheduleTimer: number | null = null;
    private timeline: TimelineEvent[] = [];
    private nextEventIndex = 0;
    private readonly listeners = new Set<(state: TransportState) => void>();
    private readonly lookAhead = 0.24;
    private scheduledTo = 0;
    private playRequest = 0;
    unlockAudio(): void {
        if (this.studio.ctx.state !== 'running') {
            void this.studio.ctx.resume().catch(() => { });
        }
        void this.studio
            .unlockFromGesture()
            .catch((error: unknown) => console.warn('DrawSounds audio resume failed', error));
    }
    private rebuildTimeline(song: Song): void {
        const timeline: TimelineEvent[] = [];
        for (const phrase of song.phrases) {
            for (const event of phrase.events) {
                const time = phrase.startTime + event.timeOffset;
                if (time >= 0 && time <= song.totalDuration + 0.5)
                    timeline.push({ time, event });
            }
        }
        timeline.sort((a, b) => a.time - b.time);
        this.timeline = timeline;
    }
    private lowerBound(time: number): number {
        let low = 0;
        let high = this.timeline.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            const item = atOrThrow(this.timeline, middle, 'transport timeline');
            if (item.time < time)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    }
    setSong(song: Song): void {
        if ((this.playing || this.preparing) && this.song !== song)
            this.interruptPlayback();
        const previousWorld = this.song?.worldId;
        const position = previousWorld && previousWorld !== song.worldId
            ? 0
            : Math.min(song.totalDuration, this.currentTime());
        this.song = song;
        this.rebuildTimeline(song);
        this.pausedAt = position;
        this.scheduledTo = position;
        this.nextEventIndex = this.lowerBound(position);
        this.studio.setStudioState({ worldId: song.worldId, tempo: song.baseTempo });
        this.emit();
    }
    private currentTime(): number {
        if (!this.song)
            return 0;
        if (this.playing) {
            return Math.max(0, Math.min(this.song.totalDuration, this.studio.ctx.currentTime - this.startTime));
        }
        return this.pausedAt;
    }
    togglePlay(): void {
        this.unlockAudio();
        if (this.playing || this.preparing)
            this.stop(false);
        else
            void this.play();
    }
    private async play(): Promise<void> {
        if (!this.song)
            return;
        const request = ++this.playRequest;
        this.preparing = true;
        this.emit();
        try {
            await Promise.all([this.studio.unlockFromGesture(), this.studio.ready()]);
        }
        catch (error: unknown) {
            if (request !== this.playRequest)
                return;
            this.preparing = false;
            console.warn('DrawSounds playback unavailable', error);
            this.emit();
            return;
        }
        if (request !== this.playRequest || !this.song)
            return;
        if (this.pausedAt >= this.song.totalDuration - 0.05)
            this.pausedAt = 0;
        this.studio.setStudioState({ worldId: this.song.worldId, tempo: this.song.baseTempo });
        this.preparing = false;
        this.playing = true;
        this.startTime = this.studio.ctx.currentTime - this.pausedAt;
        this.scheduledTo = this.pausedAt;
        this.nextEventIndex = this.lowerBound(this.pausedAt);
        this.startLoops();
        this.emit();
    }
    interruptPlayback(): void {
        if (!this.playing && !this.preparing)
            return;
        this.playRequest++;
        this.preparing = false;
        this.playing = false;
        this.pausedAt = 0;
        this.clearLoops();
        this.scheduledTo = 0;
        this.nextEventIndex = 0;
        this.studio.panic(true);
        this.emit();
    }
    stop(reset = true): void {
        this.playRequest++;
        this.preparing = false;
        this.pausedAt = reset ? 0 : this.currentTime();
        this.playing = false;
        this.clearLoops();
        this.scheduledTo = this.pausedAt;
        this.nextEventIndex = this.lowerBound(this.pausedAt);
        this.studio.panic(true);
        this.emit();
    }
    seek(time: number): void {
        if (!this.song)
            return;
        const target = Math.max(0, Math.min(this.song.totalDuration, time));
        const wasPlaying = this.playing;
        if (wasPlaying)
            this.studio.panic(true);
        this.pausedAt = target;
        this.scheduledTo = target;
        this.nextEventIndex = this.lowerBound(target);
        if (wasPlaying) {
            this.startTime = this.studio.ctx.currentTime - target;
            this.schedule();
        }
        this.emit();
    }
    auditionPhrase(phrase: Phrase, live = false, onset = false): NoteEvent[] {
        if (this.song) {
            this.studio.setStudioState({ worldId: this.song.worldId, tempo: this.song.baseTempo });
        }
        const source = phrase.events;
        if (!source.length)
            return [];
        let events: NoteEvent[];
        if (live) {
            let anchor = firstOrThrow(source, 'audition phrase events');
            for (let index = 1; index < source.length; index++) {
                const candidate = atOrThrow(source, index, 'audition phrase events');
                const shouldReplace = onset
                    ? candidate.timeOffset < anchor.timeOffset
                    : candidate.timeOffset > anchor.timeOffset;
                if (shouldReplace)
                    anchor = candidate;
            }
            events = [];
            for (const event of source) {
                if (Math.abs(event.timeOffset - anchor.timeOffset) >= 0.03)
                    continue;
                if (onset) {
                    if (events.length < 3)
                        events.push(event);
                }
                else {
                    events.push(event);
                    if (events.length > 3)
                        events.shift();
                }
            }
            if (!events.length)
                events = [anchor];
            if (events.length > 1)
                events.sort((a, b) => a.timeOffset - b.timeOffset);
        }
        else {
            const ordered = source.slice().sort((a, b) => a.timeOffset - b.timeOffset);
            const firstTime = firstOrThrow(ordered, 'ordered audition events').timeOffset;
            events = ordered.filter((event) => event.timeOffset - firstTime <= 1.8).slice(0, 18);
        }
        let firstTime = firstOrThrow(events, 'selected audition events').timeOffset;
        for (let index = 1; index < events.length; index++) {
            firstTime = Math.min(firstTime, atOrThrow(events, index, 'selected audition events').timeOffset);
        }
        const played = events.map((event) => ({
            ...event,
            timeOffset: Math.max(0, event.timeOffset - firstTime),
            duration: live ? Math.min(1.25, event.duration) : event.duration,
        }));
        const start = this.studio.ctx.currentTime + 0.008;
        for (const event of played) {
            this.studio.playNote(event, start + event.timeOffset, 'audition');
        }
        return played;
    }
    private schedule(): void {
        if (!this.song || !this.playing)
            return;
        const nowSong = this.currentTime();
        if (nowSong >= this.song.totalDuration - 0.002) {
            this.stop();
            return;
        }
        const end = Math.min(this.song.totalDuration, Math.max(this.scheduledTo, nowSong) + this.lookAhead);
        while (this.nextEventIndex < this.timeline.length) {
            const item = atOrThrow(this.timeline, this.nextEventIndex, 'transport timeline');
            if (item.time >= end)
                break;
            this.nextEventIndex++;
            if (item.time < nowSong - 0.035)
                continue;
            const when = this.studio.ctx.currentTime + Math.max(0.008, item.time - nowSong);
            this.studio.playNote(item.event, when, 'transport');
        }
        this.scheduledTo = end;
    }
    private startLoops(): void {
        this.clearLoops();
        this.scheduleTimer = window.setInterval(() => {
            this.schedule();
            if (this.playing)
                this.emit();
        }, 45);
        this.schedule();
    }
    private clearLoops(): void {
        if (this.scheduleTimer === null)
            return;
        clearInterval(this.scheduleTimer);
        this.scheduleTimer = null;
    }
    private snapshot(): TransportState {
        return {
            isPlaying: this.playing,
            isPreparing: this.preparing,
            currentTime: this.currentTime(),
            totalDuration: this.song?.totalDuration ?? 0,
        };
    }
    private emit(): void {
        const state = this.snapshot();
        for (const listener of this.listeners)
            listener(state);
    }
    subscribe(listener: (state: TransportState) => void): () => void {
        this.listeners.add(listener);
        listener(this.snapshot());
        return () => {
            this.listeners.delete(listener);
        };
    }
}
export const transport = new Transport();
