import { SoundFontStudio } from './soundfontStudio';
import type { NoteEvent, Phrase, Song, TransportState } from './types';

type TimelineEvent = { time:number; event:NoteEvent };

class Transport {
  private studio:SoundFontStudio|null=null;
  private song:Song|null=null;
  private playing=false;
  private preparing=false;
  private startTime=0;
  private pausedAt=0;
  private scheduleTimer:number|null=null;
  private uiTimer:number|null=null;
  private timeline:TimelineEvent[]=[];
  private nextEventIndex=0;
  private listeners=new Set<(s:TransportState)=>void>();
  private readonly lookAhead=.24;
  private scheduledTo=0;
  private playRequest=0;
  private audioError:string|undefined;
  private audioReady=false;

  private init(){if(!this.studio)this.studio=new SoundFontStudio();}

  activateDrawingAudio(worldId?:string,paletteIndex=0){
    this.audioError=undefined;
    this.init();
    void this.studio!.unlockFromGesture().then(()=>{
      this.audioReady=true;
      this.emit();
      if(worldId)return this.studio!.prepareWorld(worldId,paletteIndex);
    }).catch(err=>{
      this.audioReady=false;
      this.audioError=err instanceof Error?err.message:'Unable to start DrawSounds audio';
      this.emit();
    });
  }

  unlockAudio(worldId?:string,paletteIndex?:number){
    this.activateDrawingAudio(worldId,paletteIndex);
  }

  preparePalette(worldId:string,paletteIndex:number){this.unlockAudio(worldId,paletteIndex);}

  private rebuildTimeline(song:Song){
    const timeline:TimelineEvent[]=[];
    for(const phrase of song.phrases){
      for(const event of phrase.events){
        const time=phrase.startTime+event.timeOffset;
        if(time>=0&&time<=song.totalDuration+.5)timeline.push({time,event});
      }
    }
    timeline.sort((a,b)=>a.time-b.time);
    this.timeline=timeline;
  }

  private lowerBound(time:number){
    let lo=0,hi=this.timeline.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(this.timeline[mid].time<time)lo=mid+1;else hi=mid;}
    return lo;
  }

  setSong(song:Song,preservePosition=false,preserveAudition=false){
    const previousWorld=this.song?.worldId;
    const worldChanged=Boolean(previousWorld&&previousWorld!==song.worldId);
    const oldTime=this.currentTime(),oldScheduledTo=this.scheduledTo;

    // World changes are hard transport boundaries.
    if(worldChanged){
      this.playRequest++;this.preparing=false;this.playing=false;this.clearLoops();
      this.pausedAt=0;this.scheduledTo=0;this.nextEventIndex=0;
      this.studio?.hardStop();
    }

    this.song=song;
    this.rebuildTimeline(song);
    const canPreserve=preservePosition&&!worldChanged;
    const pos=canPreserve?Math.min(song.totalDuration,oldTime):0;
    this.pausedAt=pos;
    this.studio?.setStudioState({worldId:song.worldId,tempo:song.baseTempo});

    if(this.playing&&this.studio){
      this.startTime=this.studio.ctx.currentTime-pos;
      this.scheduledTo=Math.min(song.totalDuration,Math.max(pos,oldScheduledTo));
      this.nextEventIndex=this.lowerBound(this.scheduledTo);
      this.schedule();
    }else{
      this.scheduledTo=pos;
      this.nextEventIndex=this.lowerBound(pos);
      if(!preserveAudition||worldChanged)this.studio?.stopAudition();
      this.studio?.stopTransport();
    }
    this.emit();
  }

  private currentTime(){
    if(!this.song)return 0;
    if(this.playing&&this.studio)return Math.max(0,Math.min(this.song.totalDuration,this.studio.ctx.currentTime-this.startTime));
    return this.pausedAt;
  }

  togglePlay(){
    if(this.playing)this.pause();
    else if(this.preparing){
      this.playRequest++;this.preparing=false;
      this.studio?.hardStop();
      this.emit();
    }else void this.play();
  }

  private async play(){
    if(!this.song)return;
    this.init();
    const request=++this.playRequest;
    this.preparing=true;
    this.audioError=undefined;
    this.emit();
    this.studio!.resumeTransport();

    try{await this.studio!.prepareSong(this.song);}
    catch(err){
      if(request!==this.playRequest)return;
      this.preparing=false;
      this.audioError=err instanceof Error?err.message:'Unable to load a required SoundFont';
      this.emit();
      return;
    }
    if(request!==this.playRequest||!this.song)return;

    this.studio!.setStudioState({worldId:this.song.worldId,tempo:this.song.baseTempo});
    this.preparing=false;
    this.playing=true;
    this.startTime=this.studio!.ctx.currentTime-this.pausedAt;
    this.scheduledTo=this.pausedAt;
    this.nextEventIndex=this.lowerBound(this.pausedAt);
    this.startLoops();
    this.emit();
  }

  private pause(){
    if(!this.song||!this.studio)return;
    this.playRequest++;
    this.preparing=false;
    this.pausedAt=this.currentTime();
    this.playing=false;
    this.clearLoops();
    this.studio.hardStop();
    this.emit();
  }

  hardStop(reset=true){
    this.playRequest++;
    this.preparing=false;
    this.pausedAt=reset?0:this.currentTime();
    this.playing=false;
    this.clearLoops();
    this.scheduledTo=this.pausedAt;
    this.nextEventIndex=this.lowerBound(this.pausedAt);
    this.studio?.hardStop();
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
    // Stop clears transport, audition voices, and effect tails.
    this.studio?.hardStop();
    this.emit();
  }

  seek(time:number){
    if(!this.song)return;
    const t=Math.max(0,Math.min(this.song.totalDuration,time)),was=this.playing;
    this.studio?.stopTransport();
    this.pausedAt=t;
    this.scheduledTo=t;
    this.nextEventIndex=this.lowerBound(t);
    if(was&&this.studio){this.startTime=this.studio.ctx.currentTime-t;this.schedule();}
    this.emit();
  }

  auditionPhrase(phrase:Phrase,live=false,onset=false):NoteEvent[]{
    this.init();
    this.studio!.resumeTransport();
    if(this.song)this.studio!.setStudioState({worldId:this.song.worldId,tempo:this.song.baseTempo});
    const source=phrase.events;
    if(!source.length)return [];
    let events:NoteEvent[];
    if(live){
      let anchor=source[0];
      for(let i=1;i<source.length;i++)if(onset?source[i].timeOffset<anchor.timeOffset:source[i].timeOffset>anchor.timeOffset)anchor=source[i];
      events=[];
      for(const e of source){
        if(Math.abs(e.timeOffset-anchor.timeOffset)>=.03)continue;
        if(onset){if(events.length<3)events.push(e);}
        else{events.push(e);if(events.length>3)events.shift();}
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
    const start=this.studio!.ctx.currentTime+.008;
    for(const e of played)this.studio!.playNote(e,start+e.timeOffset,'audition');
    return played;
  }

  private schedule(){
    if(!this.song||!this.studio||!this.playing)return;
    const nowSong=this.currentTime();
    if(nowSong>=this.song.totalDuration-.002){this.stop();return;}
    const end=Math.min(this.song.totalDuration,Math.max(this.scheduledTo,nowSong)+this.lookAhead);

    while(this.nextEventIndex<this.timeline.length){
      const item=this.timeline[this.nextEventIndex];
      if(item.time>=end)break;
      this.nextEventIndex++;
      if(item.time<nowSong-.035)continue;
      const when=this.studio.ctx.currentTime+Math.max(.008,item.time-nowSong);
      this.studio.playNote(item.event,when,'transport');
    }
    this.scheduledTo=end;
  }

  private startLoops(){
    this.clearLoops();
    this.scheduleTimer=window.setInterval(()=>this.schedule(),45);
    this.uiTimer=window.setInterval(()=>this.emit(),50);
    this.schedule();
  }

  private clearLoops(){
    if(this.scheduleTimer!==null){clearInterval(this.scheduleTimer);this.scheduleTimer=null;}
    if(this.uiTimer!==null){clearInterval(this.uiTimer);this.uiTimer=null;}
  }

  private snapshot():TransportState{return{
    isPlaying:this.playing,
    isPreparing:this.preparing,
    isAudioReady:this.audioReady,
    audioError:this.audioError,
    currentTime:this.currentTime(),
    totalDuration:this.song?.totalDuration??0,
  };}

  private emit(){const state=this.snapshot();for(const listener of this.listeners)listener(state);}
  subscribe(fn:(s:TransportState)=>void){this.listeners.add(fn);fn(this.snapshot());return()=>{this.listeners.delete(fn);};}
}

export const transport=new Transport();
