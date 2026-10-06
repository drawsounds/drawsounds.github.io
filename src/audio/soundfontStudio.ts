import { WorkletSynthesizer } from 'spessasynth_lib';
import type { NoteEvent, PerformerRole, Song, StudioState } from './types';
import { WORLD_MAP } from '../music/worlds/config';
import {
  bankOffset,
  fetchRuntimeBank,
  prefetchRuntimeSoundFonts,
  requestPersistentAudioStorage,
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
type Strip={channel:number;input:GainNode;pan:StereoPannerNode;room:GainNode;echo:GainNode;active:ActiveNote[];mixKey:string};

export class SoundFontStudio{
  readonly ctx=new AudioContext({latencyHint:'interactive'});
  private master=this.ctx.createGain();
  private safety=this.ctx.createDynamicsCompressor();
  private roomL=this.ctx.createDelay(.35);private roomR=this.ctx.createDelay(.35);private roomWetL=this.ctx.createGain();private roomWetR=this.ctx.createGain();
  private echoL=this.ctx.createDelay(2.5);private echoR=this.ctx.createDelay(2.5);private echoFbL=this.ctx.createGain();private echoFbR=this.ctx.createGain();private echoWetL=this.ctx.createGain();private echoWetR=this.ctx.createGain();private echoFilterL=this.ctx.createBiquadFilter();private echoFilterR=this.ctx.createBiquadFilter();private panL=this.ctx.createStereoPanner();private panR=this.ctx.createStereoPanner();
  private synthPromise:Promise<WorkletSynthesizer>|null=null;
  private synth:WorkletSynthesizer|null=null;
  private loadingBanks=new Map<RuntimeBank,Promise<void>>();
  private readyBanks=new Set<RuntimeBank>();
  private strips=new Map<number,Strip>();
  private channelSetup=new Map<number,string>();
  private generations:Record<PlayBus,number>={transport:0,audition:0};
  private worldId='dreamland';
  private studioKey='';

  constructor(){
    this.master.gain.value=.8;
    this.safety.threshold.value=-8;this.safety.knee.value=12;this.safety.ratio.value=3;this.safety.attack.value=.008;this.safety.release.value=.18;
    this.master.connect(this.safety);this.safety.connect(this.ctx.destination);
    this.panL.pan.value=-.5;this.panR.pan.value=.5;
    this.roomL.connect(this.panL);this.roomR.connect(this.panR);this.panL.connect(this.roomWetL);this.panR.connect(this.roomWetR);this.roomWetL.connect(this.master);this.roomWetR.connect(this.master);
    this.echoFilterL.type=this.echoFilterR.type='lowpass';this.echoL.connect(this.echoFilterL);this.echoR.connect(this.echoFilterR);this.echoFilterL.connect(this.echoWetL);this.echoFilterR.connect(this.echoWetR);this.echoWetL.connect(this.master);this.echoWetR.connect(this.master);this.echoFilterL.connect(this.echoFbL);this.echoFbL.connect(this.echoR);this.echoFilterR.connect(this.echoFbR);this.echoFbR.connect(this.echoL);
  }

  unlockFromGesture(){
    if(this.ctx.state==='closed')return;
    if(this.ctx.state!=='running')void this.ctx.resume().catch(()=>{});
    try{
      const source=this.ctx.createBufferSource();
      source.buffer=this.ctx.createBuffer(1,1,this.ctx.sampleRate);
      source.connect(this.ctx.destination);source.start(0);
      source.onended=()=>{try{source.disconnect();}catch{/* noop */}};
    }catch{/* A later gesture retries. */}
    void requestPersistentAudioStorage();
    void this.ensureSynth().catch(()=>{});
    void prefetchRuntimeSoundFonts();
  }

  resumeTransport(){if(this.ctx.state!=='running')void this.ctx.resume().catch(()=>{});}

  private ensureSynth(){
    if(!this.synthPromise){
      const job=(async()=>{
        await this.ctx.audioWorklet.addModule(resolveAssetUrl('spessasynth_processor.min.js'));
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
    await this.ensureBank(soundSpec(performer.sound).bank);
    await this.ensureStrip(AUDITION_CHANNELS[index%AUDITION_CHANNELS.length]);
  }

  async prepareSong(song:Song){
    const banks=new Set<RuntimeBank>(),channels=new Set<number>();
    for(const phrase of song.phrases)for(const event of phrase.events){
      banks.add(soundSpec(event.sound).bank);
      channels.add(this.channelFor(event,'transport'));
    }
    await this.ensureSynth();
    await Promise.all([...banks].map(bank=>this.ensureBank(bank)));
    await Promise.all([...channels].map(channel=>this.ensureStrip(channel)));
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
    const strip={channel,input,pan,room,echo,active:[],mixKey:''};this.strips.set(channel,strip);return strip;
  }

  setStudioState(state:StudioState){
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
    // Performer room/echo values are explicit mix choices, not extra send amounts.
    // Adding them to the role defaults made full playback much wetter than the
    // isolated drawing audition and buried melodic/harmonic tools.
    const pan=Math.max(-.7,Math.min(.7,e.pan??side*role.pan));
    const room=Math.max(0,Math.min(.44,e.room??role.room));
    const echo=Math.max(0,Math.min(.40,e.echo??role.echo));
    const level=role.level;
    const key=`${pan.toFixed(3)}:${room.toFixed(3)}:${echo.toFixed(3)}:${level.toFixed(3)}`;if(key===strip.mixKey)return;strip.mixKey=key;
    const now=Math.max(this.ctx.currentTime,start-.002);
    strip.input.gain.setTargetAtTime(level,now,.012);
    strip.pan.pan.setTargetAtTime(pan,now,.01);strip.room.gain.setTargetAtTime(room,now,.015);strip.echo.gain.setTargetAtTime(echo,now,.015);
  }

  private configureChannel(synth:WorkletSynthesizer,channel:number,bank:RuntimeBank,program:number,time:number){
    const key=`${bank}:${program}`;if(this.channelSetup.get(channel)===key)return;
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
    strip.active=strip.active.filter(n=>n.end>start-.01);
    let busVoices=0;for(const n of strip.active)if(n.bus===bus)busVoices++;
    while(busVoices>=18){const index=strip.active.findIndex(n=>n.bus===bus);if(index<0)break;const old=strip.active[index];strip.active.splice(index,1);busVoices--;synth.noteOff(channel,old.m,{time:start});}
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
   * World changes are a true musical boundary. Kill both ownership buses and
   * invalidate anything still waiting on an async bank/strip preparation.
   * stopAll is intentionally reserved for this rare boundary; normal pause/
   * stop keeps audition independent from transport.
   */
  hardStop(){
    this.generations.transport++;this.generations.audition++;
    for(const strip of this.strips.values())strip.active=[];
    this.channelSetup.clear();
    try{this.synth?.stopAll(true);}catch{/* a later note can recover normally */}
  }

  close(){
    this.stopBus('transport');this.stopBus('audition');
    void this.synthPromise?.then(s=>s.stopAll(true)).then(()=>this.synthPromise?.then(s=>s.destroy())).catch(()=>{});
    this.synth=null;this.strips.clear();if(this.ctx.state!=='closed')void this.ctx.close();
  }
}
