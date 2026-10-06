import { SoundFontStudio } from './soundfontStudio';
import type { NoteEvent, Phrase, Song, TransportState } from './types';
import { prefetchRuntimeSoundFonts } from './sounds';

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

  private init(){if(!this.studio)this.studio=new SoundFontStudio();}

  prefetchWorld(_worldId:string){void prefetchRuntimeSoundFonts();}

  unlockAudio(worldId?:string,paletteIndex?:number){
    this.audioError=undefined;
    this.init();
    this.studio!.unlockFromGesture();
    if(worldId)void this.studio!.prepareWorld(worldId,paletteIndex).catch(err=>{
      this.audioError=err instanceof Error?err.message:'Unable to load DrawSounds audio';
      this.emit();
    });
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

    // A new world is not an edit to the current performance. It is a hard
    // musical boundary: cancel prepare/play races, stop both buses, reset the
    // clock and never preserve notes from the old orchestration.
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
      // Preserve the audio clock across edits. Notes already inside the tiny
      // look-ahead window finish; the rebuilt cursor takes over after it.
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
    else if(this.preparing){this.playRequest++;this.preparing=false;this.emit();}
    else void this.play();
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
    this.studio.stopTransport();
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
    this.studio?.stopTransport();
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

  auditionPhrase(phrase:Phrase,live=false,onset=false){
    this.init();
    this.studio!.resumeTransport();
    if(this.song)this.studio!.setStudioState({worldId:this.song.worldId,tempo:this.song.baseTempo});
    const ordered=phrase.events.slice().sort((a,b)=>a.timeOffset-b.timeOffset);
    if(!ordered.length)return;
    let events=ordered;
    if(live){
      if(onset){
        const firstTime=ordered[0].timeOffset;
        events=ordered.filter(e=>Math.abs(e.timeOffset-firstTime)<.03).slice(0,3);
        if(!events.length)events=[ordered[0]];
      }else{
        const last=ordered[ordered.length-1];
        events=ordered.filter(e=>Math.abs(e.timeOffset-last.timeOffset)<.03).slice(-3);
        if(!events.length)events=[last];
      }
    }else{
      const first=ordered[0].timeOffset;
      events=ordered.filter(e=>e.timeOffset-first<=1.8).slice(0,18);
    }
    const first=Math.min(...events.map(e=>e.timeOffset)),start=this.studio!.ctx.currentTime+.008;
    for(const e of events)this.studio!.playNote({...e,timeOffset:e.timeOffset-first,duration:live?Math.min(1.25,e.duration):e.duration},start+Math.max(0,e.timeOffset-first),'audition');
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
    // Web Audio owns timing; React only needs a low-cost playhead refresh.
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
    audioError:this.audioError,
    currentTime:this.currentTime(),
    totalDuration:this.song?.totalDuration??0,
  };}

  private emit(){const state=this.snapshot();for(const listener of this.listeners)listener(state);}
  subscribe(fn:(s:TransportState)=>void){this.listeners.add(fn);fn(this.snapshot());return()=>{this.listeners.delete(fn);};}
}

export const transport=new Transport();
