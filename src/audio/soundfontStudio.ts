import { WorkletSynthesizer } from 'spessasynth_lib';
import type { NoteEvent, PerformerRole, Song, StudioState } from './types';
import { WORLD_MAP } from '../music/worlds/config';
import {
  bankOffset,
  fetchRuntimeBank,
  soundSpec,
  type RuntimeBank,
} from './sounds';

function resolveAssetUrl(relPath:string){
  const base=import.meta.env.BASE_URL||'./';
  const prefix=base.endsWith('/')?base:`${base}/`;
  return `${prefix}${relPath.startsWith('/')?relPath.slice(1):relPath}`;
}

const TRANSPORT_CHANNELS=[0,1,2,3,4,5,6,7,8];
const AUDITION_CHANNELS=[10,11,12,13,14,15];

const ROLE_MIX:Record<PerformerRole,{pan:number;room:number;echo:number;level:number}>={
  drums:{pan:.05,room:.07,echo:.015,level:1.08},
  bass:{pan:0,room:.04,echo:.015,level:1.07},
  harmony:{pan:.12,room:.11,echo:.05,level:1.12},
  melody:{pan:.18,room:.13,echo:.07,level:1.16},
  texture:{pan:.26,room:.20,echo:.13,level:1.08},
  human:{pan:.10,room:.15,echo:.08,level:1.12},
};

type PlayBus='transport'|'audition';
type ActiveNote={m:number;end:number;bus:PlayBus};
type Strip={channel:number;input:GainNode;pan:StereoPannerNode;room:GainNode;echo:GainNode;active:ActiveNote[];mixPan:number;mixRoom:number;mixEcho:number;mixLevel:number};

export class SoundFontStudio{
  readonly ctx=new AudioContext({latencyHint:'interactive'});
  private master=this.ctx.createGain();
  private safety=this.ctx.createDynamicsCompressor();
  // Rebuild time-based effects to discard delay/feedback tails on hard stop.
  private roomL!:DelayNode;private roomR!:DelayNode;private roomWetL!:GainNode;private roomWetR!:GainNode;
  private echoL!:DelayNode;private echoR!:DelayNode;private echoFbL!:GainNode;private echoFbR!:GainNode;private echoWetL!:GainNode;private echoWetR!:GainNode;private echoFilterL!:BiquadFilterNode;private echoFilterR!:BiquadFilterNode;private panL!:StereoPannerNode;private panR!:StereoPannerNode;
  private workletModulePromise:Promise<void>|null=null;
  private synthPromise:Promise<WorkletSynthesizer>|null=null;
  private synth:WorkletSynthesizer|null=null;
  private loadingBanks=new Map<RuntimeBank,Promise<void>>();
  private readyBanks=new Set<RuntimeBank>();
  private strips=new Map<number,Strip>();
  private channelSetup=new Map<number,number>();
  private generations:Record<PlayBus,number>={transport:0,audition:0};
  private worldId='dreamland';
  private studioKey='';
  private studioState:StudioState|null=null;
  private preparedSongs=new WeakSet<Song>();

  constructor(){
    this.master.gain.value=.8;
    this.safety.threshold.value=-8;this.safety.knee.value=12;this.safety.ratio.value=3;this.safety.attack.value=.008;this.safety.release.value=.18;
    this.master.connect(this.safety);this.safety.connect(this.ctx.destination);
    this.rebuildFxGraph(false);
  }

  /**
   * Replace the actual delay/reverb layer rather than merely turning its gain
   * down. A fresh graph has empty delay buffers, so a quick stop -> play cannot
   * resurrect an old echo tail. Existing performer sends are reattached to the
   * new graph while their dry path remains untouched.
   */
  private rebuildFxGraph(reconnectStrips=true){
    if(reconnectStrips){
      for(const strip of this.strips.values()){
        try{strip.room.disconnect();}catch{/* noop */}
        try{strip.echo.disconnect();}catch{/* noop */}
      }
    }
    const oldNodes:AudioNode[]=[];
    if(this.roomL)oldNodes.push(this.roomL,this.roomR,this.roomWetL,this.roomWetR,this.echoL,this.echoR,this.echoFbL,this.echoFbR,this.echoWetL,this.echoWetR,this.echoFilterL,this.echoFilterR,this.panL,this.panR);
    for(const node of oldNodes)try{node.disconnect();}catch{/* noop */}

    this.roomL=this.ctx.createDelay(.35);this.roomR=this.ctx.createDelay(.35);this.roomWetL=this.ctx.createGain();this.roomWetR=this.ctx.createGain();
    this.echoL=this.ctx.createDelay(2.5);this.echoR=this.ctx.createDelay(2.5);this.echoFbL=this.ctx.createGain();this.echoFbR=this.ctx.createGain();this.echoWetL=this.ctx.createGain();this.echoWetR=this.ctx.createGain();this.echoFilterL=this.ctx.createBiquadFilter();this.echoFilterR=this.ctx.createBiquadFilter();this.panL=this.ctx.createStereoPanner();this.panR=this.ctx.createStereoPanner();
    this.panL.pan.value=-.5;this.panR.pan.value=.5;
    this.roomWetL.gain.value=0;this.roomWetR.gain.value=0;this.echoWetL.gain.value=0;this.echoWetR.gain.value=0;this.echoFbL.gain.value=0;this.echoFbR.gain.value=0;
    this.roomL.connect(this.panL);this.roomR.connect(this.panR);this.panL.connect(this.roomWetL);this.panR.connect(this.roomWetR);this.roomWetL.connect(this.master);this.roomWetR.connect(this.master);
    this.echoFilterL.type=this.echoFilterR.type='lowpass';this.echoL.connect(this.echoFilterL);this.echoR.connect(this.echoFilterR);this.echoFilterL.connect(this.echoWetL);this.echoFilterR.connect(this.echoWetR);this.echoWetL.connect(this.master);this.echoWetR.connect(this.master);this.echoFilterL.connect(this.echoFbL);this.echoFbL.connect(this.echoR);this.echoFilterR.connect(this.echoFbR);this.echoFbR.connect(this.echoL);
    if(reconnectStrips){for(const strip of this.strips.values()){strip.room.connect(this.roomL);strip.room.connect(this.roomR);strip.echo.connect(this.echoL);strip.echo.connect(this.echoR);}}

    this.studioKey='';
    if(this.studioState)this.setStudioState(this.studioState);
  }

  unlockFromGesture(){
    if(this.ctx.state==='closed')return Promise.reject(new Error('Audio engine is closed'));
    const needsUnlock=this.ctx.state!=='running';
    const resumed=!needsUnlock
      ? Promise.resolve()
      : this.ctx.resume().then(()=>undefined);
    if(needsUnlock){
      try{
        const source=this.ctx.createBufferSource();
        source.buffer=this.ctx.createBuffer(1,1,this.ctx.sampleRate);
        source.connect(this.ctx.destination);source.start(0);
        source.onended=()=>{try{source.disconnect();}catch{/* noop */}};
      }catch{/* A later gesture retries. */}
    }
    return resumed;
  }

  resumeTransport(){if(this.ctx.state!=='running')void this.ctx.resume().catch(()=>{});}

  private ensureWorkletModule(){
    if(!this.workletModulePromise){
      const job=this.ctx.audioWorklet.addModule(resolveAssetUrl('spessasynth_processor.min.js'));
      this.workletModulePromise=job;
      void job.catch(()=>{if(this.workletModulePromise===job)this.workletModulePromise=null;});
    }
    return this.workletModulePromise;
  }


  private ensureSynth(){
    if(!this.synthPromise){
      const job=(async()=>{
        await this.ensureWorkletModule();
        const synth=new WorkletSynthesizer(this.ctx,{eventsEnabled:false});
        await synth.isReady;
        synth.setLogLevel(false,true,false);
        this.synth=synth;
        return synth;
      })();
      this.synthPromise=job;
      void job.catch(()=>{if(this.synthPromise===job)this.synthPromise=null;});
    }
    return this.synthPromise;
  }

  private ensureBank(bank:RuntimeBank){
    if(this.readyBanks.has(bank))return Promise.resolve();
    let job=this.loadingBanks.get(bank);
    if(!job){
      job=(async()=>{
        const synth=await this.ensureSynth();
        const data=await fetchRuntimeBank(bank);
        await synth.soundBankManager.addSoundBank(data,bank,bankOffset(bank));
        this.readyBanks.add(bank);
      })();
      this.loadingBanks.set(bank,job);
      void job.catch(()=>{if(this.loadingBanks.get(bank)===job)this.loadingBanks.delete(bank);});
    }
    return job;
  }

  async prepareWorld(worldId:string,paletteIndex=0){
    const world=WORLD_MAP[worldId as keyof typeof WORLD_MAP];if(!world)return;
    const index=Math.max(0,Math.min(world.palette.length-1,paletteIndex)),performer=world.palette[index];
    if(!performer)return;
    const spec=soundSpec(performer.sound);
    await this.ensureBank(spec.bank);
    const strip=await this.ensureStrip(AUDITION_CHANNELS[index%AUDITION_CHANNELS.length]);
    if(this.synth)this.configureChannel(this.synth,strip.channel,spec.bank,spec.program,this.ctx.currentTime+.003);
  }

  async prepareSong(song:Song){
    if(this.preparedSongs.has(song))return;
    const banks=new Set<RuntimeBank>(),channels=new Set<number>();
    for(const phrase of song.phrases)for(const event of phrase.events){
      banks.add(soundSpec(event.sound).bank);
      channels.add(this.channelFor(event,'transport'));
    }
    await this.ensureSynth();
    await Promise.all([...banks].map(bank=>this.ensureBank(bank)));
    await Promise.all([...channels].map(channel=>this.ensureStrip(channel)));
    this.preparedSongs.add(song);
  }

  private channelFor(e:NoteEvent,bus:PlayBus){
    const pool=bus==='transport'?TRANSPORT_CHANNELS:AUDITION_CHANNELS;
    return pool[Math.abs(e.channelIndex??0)%pool.length];
  }

  private async ensureStrip(channel:number){
    const existing=this.strips.get(channel);if(existing)return existing;
    const synth=await this.ensureSynth(),input=this.ctx.createGain(),pan=this.ctx.createStereoPanner(),room=this.ctx.createGain(),echo=this.ctx.createGain();
    room.gain.value=0;echo.gain.value=0;
    synth.connectChannel(input,channel);
    input.connect(pan);pan.connect(this.master);pan.connect(room);room.connect(this.roomL);room.connect(this.roomR);pan.connect(echo);echo.connect(this.echoL);echo.connect(this.echoR);
    const strip={channel,input,pan,room,echo,active:[],mixPan:NaN,mixRoom:NaN,mixEcho:NaN,mixLevel:NaN};this.strips.set(channel,strip);return strip;
  }

  setStudioState(state:StudioState){
    this.studioState=state;
    const key=`${state.worldId}:${state.tempo}`;if(key===this.studioKey)return;this.studioKey=key;
    this.worldId=state.worldId;
    const world=WORLD_MAP[state.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland,p=world.studio,beat=60/Math.max(50,state.tempo),now=this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p.master,now,.04);
    this.roomL.delayTime.setTargetAtTime(.026+p.room*.035,now,.04);this.roomR.delayTime.setTargetAtTime(.044+p.room*.055,now,.04);
    this.roomWetL.gain.setTargetAtTime(p.room,now,.04);this.roomWetR.gain.setTargetAtTime(p.room*.92,now,.04);
    this.echoL.delayTime.setTargetAtTime(Math.min(2.2,beat*p.echoBeats[0]),now,.05);this.echoR.delayTime.setTargetAtTime(Math.min(2.2,beat*p.echoBeats[1]),now,.05);
    this.echoWetL.gain.setTargetAtTime(p.echo,now,.04);this.echoWetR.gain.setTargetAtTime(p.echo*.94,now,.04);
    this.echoFbL.gain.setTargetAtTime(Math.min(.60,p.feedback),now,.05);this.echoFbR.gain.setTargetAtTime(Math.min(.60,p.feedback*.96),now,.05);
    this.echoFilterL.frequency.setTargetAtTime(p.lowpass,now,.05);this.echoFilterR.frequency.setTargetAtTime(p.lowpass*.9,now,.05);
  }

  private mix(strip:Strip,e:NoteEvent,start:number){
    const role=ROLE_MIX[e.channelRole??'melody'],idx=e.channelIndex??0,side=idx%2?1:-1;
    const pan=Math.max(-.7,Math.min(.7,e.pan??side*role.pan));
    const room=Math.max(0,Math.min(.44,e.room??role.room));
    const echo=Math.max(0,Math.min(.40,e.echo??role.echo));
    const level=role.level;
    if(strip.mixPan===pan&&strip.mixRoom===room&&strip.mixEcho===echo&&strip.mixLevel===level)return;
    strip.mixPan=pan;strip.mixRoom=room;strip.mixEcho=echo;strip.mixLevel=level;
    const now=Math.max(this.ctx.currentTime,start-.002);
    strip.input.gain.setTargetAtTime(level,now,.012);
    strip.pan.pan.setTargetAtTime(pan,now,.01);strip.room.gain.setTargetAtTime(room,now,.015);strip.echo.gain.setTargetAtTime(echo,now,.015);
  }

  private configureChannel(synth:WorkletSynthesizer,channel:number,bank:RuntimeBank,program:number,time:number){
    const key=bankOffset(bank)*128+program;if(this.channelSetup.get(channel)===key)return;
    synth.controllerChange(channel,0,bankOffset(bank),{time});
    synth.controllerChange(channel,32,0,{time});
    synth.programChange(channel,program,{time});
    this.channelSetup.set(channel,key);
  }

  private playReady(e:NoteEvent,requested:number,bus:PlayBus,generation:number){
    if(generation!==this.generations[bus]||!this.synth)return false;
    const spec=soundSpec(e.sound),channel=this.channelFor(e,bus),strip=this.strips.get(channel);if(!this.readyBanks.has(spec.bank)||!strip)return false;
    const world=WORLD_MAP[this.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland;
    const duration=Math.max(.045,e.duration*world.studio.release*(e.articulation==='staccato'?.62:e.articulation==='legato'?1.10:1));
    const maxVelocity=spec.bank==='percussion'?92:104,velocity=Math.max(12,Math.min(maxVelocity,Math.round(10+e.velocity*132))),note=Math.max(0,Math.min(127,Math.round(e.midi)));
    const start=Math.max(requested,this.ctx.currentTime+.006),setup=Math.max(this.ctx.currentTime,start-.004),synth=this.synth;
    this.configureChannel(synth,channel,spec.bank,spec.program,setup);this.mix(strip,e,start);
    let write=0,busVoices=0;
    for(let i=0;i<strip.active.length;i++){
      const n=strip.active[i];if(n.end<=start-.01)continue;
      strip.active[write++]=n;if(n.bus===bus)busVoices++;
    }
    strip.active.length=write;
    // Give transport a little more headroom than the audition bus so preserving
    // that captured stack does not cause playback-only voice stealing.
    const voiceLimit=bus==='transport'?(world.id==='dreamland'?28:22):18;
    while(busVoices>=voiceLimit){const index=strip.active.findIndex(n=>n.bus===bus);if(index<0)break;const old=strip.active[index];strip.active.splice(index,1);busVoices--;synth.noteOff(channel,old.m,{time:start});}
    const on=(m:number,v:number,t:number,off:number)=>{synth.noteOn(channel,m,v,{time:t});synth.noteOff(channel,m,{time:off});strip.active.push({m,end:off,bus});};
    const target=e.glideToMidi===undefined?null:Math.max(0,Math.min(127,Math.round(e.glideToMidi)));
    if(target!==null&&target!==note&&spec.bank!=='percussion'){
      const steps=Math.min(4,Math.max(2,Math.abs(target-note)+1)),span=Math.min(duration*.5,.34);
      for(let i=0;i<steps;i++){const m=Math.round(note+(target-note)*i/(steps-1)),t=start+span*i/(steps-1),off=Math.min(start+duration,t+Math.max(.08,span/(steps-1)*1.5));on(m,Math.round(velocity*(1-i*.04)),t,off);}
    }else on(note,velocity,start,start+duration);
    return true;
  }

  playNote(e:NoteEvent,when:number,bus:PlayBus='transport'){
    const generation=this.generations[bus],requested=Math.max(this.ctx.currentTime+.006,when);
    if(this.playReady(e,requested,bus,generation))return;
    const spec=soundSpec(e.sound),channel=this.channelFor(e,bus);
    void (async()=>{
      await this.ensureBank(spec.bank);await this.ensureStrip(channel);await this.ensureSynth();
      this.playReady(e,Math.max(requested,this.ctx.currentTime+.008),bus,generation);
    })().catch(err=>console.warn('DrawSounds note failed',err));
  }

  private stopBus(bus:PlayBus){
    this.generations[bus]++;const now=this.ctx.currentTime;
    // Transport and audition own disjoint MIDI channel pools. Gate the target
    // pool at its strip input as well as sending note-offs. This also defeats
    // noteOns that were already posted to the AudioWorklet a few ms ahead.
    for(const strip of this.strips.values()){
      const stripBus=TRANSPORT_CHANNELS.includes(strip.channel)?'transport':'audition';
      if(stripBus!==bus)continue;
      try{strip.input.gain.cancelScheduledValues(now);strip.input.gain.setValueAtTime(0,now);}catch{/* noop */}
      strip.mixPan=strip.mixRoom=strip.mixEcho=strip.mixLevel=NaN;
    }
    void this.ensureSynth().then(synth=>{
      for(const strip of this.strips.values()){
        const keep:ActiveNote[]=[];
        for(const note of strip.active){if(note.bus===bus){try{synth.noteOff(strip.channel,note.m,{time:now});}catch{/* noop */}}else keep.push(note);}
        strip.active=keep;
      }
    }).catch(()=>{});
  }

  stopTransport(){this.stopBus('transport');}
  stopAudition(){this.stopBus('audition');}

  /**
   * Absolute silence boundary: invalidate both ownership buses, kill every
   * synth voice (including already-scheduled ones), and replace the shared FX
   * graph so room/echo layers cannot continue after stop/bomb.
   */
  hardStop(){
    this.generations.transport++;this.generations.audition++;
    const now=this.ctx.currentTime;
    for(const strip of this.strips.values()){
      strip.active=[];strip.mixPan=strip.mixRoom=strip.mixEcho=strip.mixLevel=NaN;
      try{strip.input.gain.cancelScheduledValues(now);strip.input.gain.setValueAtTime(0,now);}catch{/* noop */}
    }
    this.channelSetup.clear();
    try{this.synth?.stopAll(true);}catch{/* a later note can recover normally */}
    if(this.ctx.state!=='closed')this.rebuildFxGraph();
  }

  close(){
    this.stopBus('transport');this.stopBus('audition');
    void this.synthPromise?.then(s=>s.stopAll(true)).then(()=>this.synthPromise?.then(s=>s.destroy())).catch(()=>{});
    this.synth=null;this.strips.clear();if(this.ctx.state!=='closed')void this.ctx.close();
  }
}
