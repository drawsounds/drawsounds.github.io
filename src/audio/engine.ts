import { SoundFontStudio } from './soundfontStudio';
import type { NoteEvent, Phrase, Song, TransportState } from './types';

type TimelineEvent = { time:number; event:NoteEvent };

class Transport {
  private readonly studio=new SoundFontStudio();
  private song:Song|null=null;
  private playing=false;
  private preparing=false;
  private startTime=0;
  private pausedAt=0;
  private scheduleTimer:number|null=null;
  private timeline:TimelineEvent[]=[];
  private nextEventIndex=0;
  private listeners=new Set<(s:TransportState)=>void>();
  private readonly lookAhead=.24;
  private scheduledTo=0;
  private playRequest=0;

  unlockAudio(){
    if(this.studio.ctx.state!=='running'){
      void this.studio.ctx.resume().catch(()=>{});
    }
    void this.studio.unlockFromGesture().catch(err=>console.warn('DrawSounds audio resume failed',err));
  }

  private rebuildTimeline(song:Song){
    const timeline:TimelineEvent[]=[];
    for(const phrase of song.phrases)for(const event of phrase.events){
      const time=phrase.startTime+event.timeOffset;
      if(time>=0&&time<=song.totalDuration+.5)timeline.push({time,event});
    }
    timeline.sort((a,b)=>a.time-b.time);
    this.timeline=timeline;
  }

  private lowerBound(time:number){
    let lo=0,hi=this.timeline.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(this.timeline[mid].time<time)lo=mid+1;else hi=mid;}
    return lo;
  }

  setSong(song:Song){
    if((this.playing||this.preparing)&&this.song!==song)this.interruptPlayback();
    const previousWorld=this.song?.worldId;
    const pos=previousWorld&&previousWorld!==song.worldId?0:Math.min(song.totalDuration,this.currentTime());
    this.song=song;
    this.rebuildTimeline(song);
    this.pausedAt=pos;
    this.scheduledTo=pos;
    this.nextEventIndex=this.lowerBound(pos);
    this.studio.setStudioState({worldId:song.worldId,tempo:song.baseTempo});
    this.emit();
  }

  private currentTime(){
    if(!this.song)return 0;
    if(this.playing)return Math.max(0,Math.min(this.song.totalDuration,this.studio.ctx.currentTime-this.startTime));
    return this.pausedAt;
  }

  togglePlay(){
    this.unlockAudio();
    if(this.playing||this.preparing)this.stop(false);
    else void this.play();
  }

  private async play(){
    if(!this.song)return;
    const request=++this.playRequest;
    this.preparing=true;
    this.emit();
    try{await Promise.all([this.studio.unlockFromGesture(),this.studio.ready()]);}
    catch(err){
      if(request!==this.playRequest)return;
      this.preparing=false;
      console.warn('DrawSounds playback unavailable',err);
      this.emit();
      return;
    }
    if(request!==this.playRequest||!this.song)return;
    if(this.pausedAt>=this.song.totalDuration-.05)this.pausedAt=0;
    this.studio.setStudioState({worldId:this.song.worldId,tempo:this.song.baseTempo});
    this.preparing=false;
    this.playing=true;
    this.startTime=this.studio.ctx.currentTime-this.pausedAt;
    this.scheduledTo=this.pausedAt;
    this.nextEventIndex=this.lowerBound(this.pausedAt);
    this.startLoops();
    this.emit();
  }

  interruptPlayback(){
    if(!this.playing&&!this.preparing)return;
    this.playRequest++;
    this.preparing=false;
    this.playing=false;
    this.pausedAt=0;
    this.clearLoops();
    this.scheduledTo=0;
    this.nextEventIndex=0;
    this.studio.panic(true);
    this.emit();
  }

  stop(reset=true){
    this.playRequest++;
    this.preparing=false;
    this.pausedAt=reset?0:this.currentTime();
    this.playing=false;
    this.clearLoops();
    this.scheduledTo=this.pausedAt;
    this.nextEventIndex=this.lowerBound(this.pausedAt);
    this.studio.panic(true);
    this.emit();
  }

  seek(time:number){
    if(!this.song)return;
    const t=Math.max(0,Math.min(this.song.totalDuration,time)),wasPlaying=this.playing;
    if(wasPlaying)this.studio.panic(true);
    this.pausedAt=t;
    this.scheduledTo=t;
    this.nextEventIndex=this.lowerBound(t);
    if(wasPlaying){this.startTime=this.studio.ctx.currentTime-t;this.schedule();}
    this.emit();
  }

  auditionPhrase(phrase:Phrase,live=false,onset=false):NoteEvent[]{
    if(this.song)this.studio.setStudioState({worldId:this.song.worldId,tempo:this.song.baseTempo});
    const source=phrase.events;if(!source.length)return [];
    let events:NoteEvent[];
    if(live){
      let anchor=source[0];
      for(let i=1;i<source.length;i++)if(onset?source[i].timeOffset<anchor.timeOffset:source[i].timeOffset>anchor.timeOffset)anchor=source[i];
      events=[];
      for(const e of source){
        if(Math.abs(e.timeOffset-anchor.timeOffset)>=.03)continue;
        if(onset){if(events.length<3)events.push(e);}else{events.push(e);if(events.length>3)events.shift();}
      }
      if(!events.length)events=[anchor];
      if(events.length>1)events.sort((a,b)=>a.timeOffset-b.timeOffset);
    }else{
      const ordered=source.slice().sort((a,b)=>a.timeOffset-b.timeOffset);
      const first=ordered[0].timeOffset;
      events=ordered.filter(e=>e.timeOffset-first<=1.8).slice(0,18);
    }
    let first=events[0].timeOffset;for(let i=1;i<events.length;i++)if(events[i].timeOffset<first)first=events[i].timeOffset;
    const played=events.map(e=>({...e,timeOffset:Math.max(0,e.timeOffset-first),duration:live?Math.min(1.25,e.duration):e.duration}));
    const start=this.studio.ctx.currentTime+.008;
    for(const e of played)this.studio.playNote(e,start+e.timeOffset,'audition');
    return played;
  }

  private schedule(){
    if(!this.song||!this.playing)return;
    const nowSong=this.currentTime();
    if(nowSong>=this.song.totalDuration-.002){this.stop();return;}
    const end=Math.min(this.song.totalDuration,Math.max(this.scheduledTo,nowSong)+this.lookAhead);
    while(this.nextEventIndex<this.timeline.length){
      const item=this.timeline[this.nextEventIndex];if(item.time>=end)break;
      this.nextEventIndex++;
      if(item.time<nowSong-.035)continue;
      const when=this.studio.ctx.currentTime+Math.max(.008,item.time-nowSong);
      this.studio.playNote(item.event,when,'transport');
    }
    this.scheduledTo=end;
  }

  private startLoops(){
    this.clearLoops();
    this.scheduleTimer=window.setInterval(()=>{this.schedule();if(this.playing)this.emit();},45);
    this.schedule();
  }

  private clearLoops(){if(this.scheduleTimer!==null){clearInterval(this.scheduleTimer);this.scheduleTimer=null;}}

  private snapshot():TransportState{return{
    isPlaying:this.playing,
    isPreparing:this.preparing,
    currentTime:this.currentTime(),
    totalDuration:this.song?.totalDuration??0,
  };}

  private emit(){const state=this.snapshot();for(const listener of this.listeners)listener(state);}
  subscribe(fn:(s:TransportState)=>void){this.listeners.add(fn);fn(this.snapshot());return()=>{this.listeners.delete(fn);};}
}

export const transport=new Transport();
