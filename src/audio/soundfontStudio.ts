import { WorkletSynthesizer } from 'spessasynth_lib';
import type { NoteEvent, PerformerRole, StudioState } from './types';
import { WORLD_MAP } from '../music/worlds/config';
import { bankOffset, fetchRuntimeBank, soundSpec } from './sounds';

function resolveAssetUrl(relPath:string){
  const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  try {
    return new URL(clean, document.baseURI || window.location.href).href;
  } catch {
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    return `${prefix}${clean}`;
  }
}

const TRANSPORT_CHANNELS=[0,1,2,3,4,5];
const AUDITION_CHANNELS=[10,11,12,13,14,15];

const ROLE_MIX:Record<PerformerRole,{pan:number;room:number;echo:number;level:number}>={
  drums:{pan:.05,room:.07,echo:.015,level:1.08},
  bass:{pan:0,room:.04,echo:.015,level:1.07},
  harmony:{pan:.12,room:.11,echo:.05,level:1.12},
  melody:{pan:.18,room:.13,echo:.07,level:1.16},
  texture:{pan:.26,room:.20,echo:.13,level:1.08},
  human:{pan:.10,room:.15,echo:.08,level:1.12},
};

const CC_VOLUME=7;
const CC_PAN=10;
const CC_REVERB=91;
const CC_CHORUS=93;

type PlayBus='transport'|'audition';
type ChannelMix={volume:number;pan:number;reverb:number;chorus:number};

export class SoundFontStudio{
  readonly ctx=new AudioContext({latencyHint:'interactive'});
  private synthBus=this.ctx.createGain();
  private master=this.ctx.createGain();
  private safety=this.ctx.createDynamicsCompressor();
  private roomL!:DelayNode;private roomR!:DelayNode;private roomWetL!:GainNode;private roomWetR!:GainNode;
  private echoL!:DelayNode;private echoR!:DelayNode;private echoFbL!:GainNode;private echoFbR!:GainNode;private echoWetL!:GainNode;private echoWetR!:GainNode;private echoFilterL!:BiquadFilterNode;private echoFilterR!:BiquadFilterNode;private panL!:StereoPannerNode;private panR!:StereoPannerNode;
  private synth:WorkletSynthesizer|null=null;
  private initialization:Promise<void>|null=null;
  private generation=0;
  private channelSetup=new Map<number,number>();
  private channelMix=new Map<number,ChannelMix>();
  private studioKey='';
  private studioState:StudioState|null=null;

  constructor(){
    this.master.gain.value=.8;
    this.safety.threshold.value=-8;this.safety.knee.value=12;this.safety.ratio.value=3;this.safety.attack.value=.008;this.safety.release.value=.18;
    this.synthBus.connect(this.master);
    this.master.connect(this.safety);this.safety.connect(this.ctx.destination);
    this.resetEffects();
    void this.ready().catch(err=>console.warn('DrawSounds audio initialization failed',err));
  }

  private async initialize(){
    const banks=Promise.all([fetchRuntimeBank('instruments'),fetchRuntimeBank('percussion')]);
    await this.ctx.audioWorklet.addModule(resolveAssetUrl('spessasynth_processor.min.js'));
    const synth=new WorkletSynthesizer(this.ctx,{eventsEnabled:false});
    await synth.isReady;
    synth.setLogLevel(false,true,false);
    synth.connect(this.synthBus);
    const [instruments,percussion]=await banks;
    await synth.soundBankManager.addSoundBank(instruments,'instruments',bankOffset('instruments'));
    await synth.soundBankManager.addSoundBank(percussion,'percussion',bankOffset('percussion'));
    this.synth=synth;
  }

  ready(){
    if(!this.initialization){
      this.initialization=this.initialize().catch(err=>{
        this.initialization=null;
        throw err;
      });
    }
    return this.initialization;
  }

  async unlockFromGesture(){
    if(this.ctx.state==='closed')return;
    if(this.ctx.state!=='running'){
      try{
        await this.ctx.resume();
      }catch(err){
        console.warn('DrawSounds audio resume failed',err);
      }
    }
    try{
      const source=this.ctx.createBufferSource();
      source.buffer=this.ctx.createBuffer(1,1,this.ctx.sampleRate);
      source.connect(this.ctx.destination);source.start(0);
      source.onended=()=>{try{source.disconnect();}catch{}};
    }catch{}
    return this.ready();
  }

  private resetEffects(){
    if(this.roomL){
      try{this.synthBus.disconnect(this.roomL);}catch{}
      try{this.synthBus.disconnect(this.roomR);}catch{}
      try{this.synthBus.disconnect(this.echoL);}catch{}
      try{this.synthBus.disconnect(this.echoR);}catch{}
      for(const node of [this.roomL,this.roomR,this.roomWetL,this.roomWetR,this.echoL,this.echoR,this.echoFbL,this.echoFbR,this.echoWetL,this.echoWetR,this.echoFilterL,this.echoFilterR,this.panL,this.panR])try{node.disconnect();}catch{}
    }

    this.roomL=this.ctx.createDelay(.35);this.roomR=this.ctx.createDelay(.35);this.roomWetL=this.ctx.createGain();this.roomWetR=this.ctx.createGain();
    this.echoL=this.ctx.createDelay(2.5);this.echoR=this.ctx.createDelay(2.5);this.echoFbL=this.ctx.createGain();this.echoFbR=this.ctx.createGain();this.echoWetL=this.ctx.createGain();this.echoWetR=this.ctx.createGain();this.echoFilterL=this.ctx.createBiquadFilter();this.echoFilterR=this.ctx.createBiquadFilter();this.panL=this.ctx.createStereoPanner();this.panR=this.ctx.createStereoPanner();
    this.panL.pan.value=-.5;this.panR.pan.value=.5;
    this.roomWetL.gain.value=0;this.roomWetR.gain.value=0;this.echoWetL.gain.value=0;this.echoWetR.gain.value=0;this.echoFbL.gain.value=0;this.echoFbR.gain.value=0;
    this.roomL.connect(this.panL);this.roomR.connect(this.panR);this.panL.connect(this.roomWetL);this.panR.connect(this.roomWetR);this.roomWetL.connect(this.master);this.roomWetR.connect(this.master);
    this.echoFilterL.type=this.echoFilterR.type='lowpass';this.echoL.connect(this.echoFilterL);this.echoR.connect(this.echoFilterR);this.echoFilterL.connect(this.echoWetL);this.echoFilterR.connect(this.echoWetR);this.echoWetL.connect(this.master);this.echoWetR.connect(this.master);this.echoFilterL.connect(this.echoFbL);this.echoFbL.connect(this.echoR);this.echoFilterR.connect(this.echoFbR);this.echoFbR.connect(this.echoL);
    this.synthBus.connect(this.roomL);this.synthBus.connect(this.roomR);this.synthBus.connect(this.echoL);this.synthBus.connect(this.echoR);
    this.studioKey='';
    if(this.studioState)this.setStudioState(this.studioState);
  }

  setStudioState(state:StudioState){
    this.studioState=state;
    const key=`${state.worldId}:${state.tempo}`;if(key===this.studioKey)return;this.studioKey=key;
    const world=WORLD_MAP[state.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland,p=world.studio,beat=60/Math.max(50,state.tempo),now=this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p.master,now,.04);
    this.roomL.delayTime.setTargetAtTime(.026+p.room*.035,now,.04);this.roomR.delayTime.setTargetAtTime(.044+p.room*.055,now,.04);
    this.roomWetL.gain.setTargetAtTime(p.room*.52,now,.04);this.roomWetR.gain.setTargetAtTime(p.room*.48,now,.04);
    this.echoL.delayTime.setTargetAtTime(Math.min(2.2,beat*p.echoBeats[0]),now,.05);this.echoR.delayTime.setTargetAtTime(Math.min(2.2,beat*p.echoBeats[1]),now,.05);
    this.echoWetL.gain.setTargetAtTime(p.echo*.52,now,.04);this.echoWetR.gain.setTargetAtTime(p.echo*.49,now,.04);
    this.echoFbL.gain.setTargetAtTime(Math.min(.60,p.feedback),now,.05);this.echoFbR.gain.setTargetAtTime(Math.min(.60,p.feedback*.96),now,.05);
    this.echoFilterL.frequency.setTargetAtTime(p.lowpass,now,.05);this.echoFilterR.frequency.setTargetAtTime(p.lowpass*.9,now,.05);
  }

  private channelFor(e:NoteEvent,bus:PlayBus){
    const pool=bus==='transport'?TRANSPORT_CHANNELS:AUDITION_CHANNELS;
    return pool[Math.abs(e.channelIndex??0)%pool.length];
  }

  private configureChannel(synth:WorkletSynthesizer,channel:number,bank:'instruments'|'percussion',program:number,time:number){
    const key=bankOffset(bank)*128+program;if(this.channelSetup.get(channel)===key)return;
    synth.controllerChange(channel,0,bankOffset(bank),{time});
    synth.controllerChange(channel,32,0,{time});
    synth.programChange(channel,program,{time});
    this.channelSetup.set(channel,key);
  }

  private configureMix(synth:WorkletSynthesizer,channel:number,e:NoteEvent,time:number){
    const role=ROLE_MIX[e.channelRole??'melody'],idx=e.channelIndex??0,side=idx%2?1:-1;
    const pan=Math.max(-.7,Math.min(.7,e.pan??side*role.pan));
    const room=Math.max(0,Math.min(.44,e.room??role.room));
    const echo=Math.max(0,Math.min(.40,e.echo??role.echo));
    const next:ChannelMix={
      volume:Math.max(1,Math.min(127,Math.round(104*role.level))),
      pan:Math.max(0,Math.min(127,Math.round(64+pan*63))),
      reverb:Math.max(0,Math.min(127,Math.round(room*220))),
      chorus:Math.max(0,Math.min(127,Math.round(echo*150))),
    };
    const previous=this.channelMix.get(channel);
    if(!previous||previous.volume!==next.volume)synth.controllerChange(channel,CC_VOLUME,next.volume,{time});
    if(!previous||previous.pan!==next.pan)synth.controllerChange(channel,CC_PAN,next.pan,{time});
    if(!previous||previous.reverb!==next.reverb)synth.controllerChange(channel,CC_REVERB,next.reverb,{time});
    if(!previous||previous.chorus!==next.chorus)synth.controllerChange(channel,CC_CHORUS,next.chorus,{time});
    this.channelMix.set(channel,next);
  }

  private playReady(e:NoteEvent,requested:number,bus:PlayBus,generation:number){
    const synth=this.synth;if(!synth||generation!==this.generation)return false;
    const spec=soundSpec(e.sound),channel=this.channelFor(e,bus);
    const world=this.studioState?(WORLD_MAP[this.studioState.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland):WORLD_MAP.dreamland;
    const duration=Math.max(.045,e.duration*world.studio.release*(e.articulation==='staccato'?.62:e.articulation==='legato'?1.10:1));
    const maxVelocity=spec.bank==='percussion'?92:104,velocity=Math.max(12,Math.min(maxVelocity,Math.round(10+e.velocity*132))),note=Math.max(0,Math.min(127,Math.round(e.midi)));
    const start=Math.max(requested,this.ctx.currentTime+.006),setup=Math.max(this.ctx.currentTime,start-.004);
    this.configureChannel(synth,channel,spec.bank,spec.program,setup);this.configureMix(synth,channel,e,setup);
    const on=(m:number,v:number,t:number,off:number)=>{synth.noteOn(channel,m,v,{time:t});synth.noteOff(channel,m,{time:off});};
    const target=e.glideToMidi===undefined?null:Math.max(0,Math.min(127,Math.round(e.glideToMidi)));
    if(target!==null&&target!==note&&spec.bank!=='percussion'){
      const steps=Math.min(4,Math.max(2,Math.abs(target-note)+1)),span=Math.min(duration*.5,.34);
      for(let i=0;i<steps;i++){const m=Math.round(note+(target-note)*i/(steps-1)),t=start+span*i/(steps-1),off=Math.min(start+duration,t+Math.max(.08,span/(steps-1)*1.5));on(m,Math.round(velocity*(1-i*.04)),t,off);}
    }else on(note,velocity,start,start+duration);
    return true;
  }

  playNote(e:NoteEvent,when:number,bus:PlayBus='transport'){
    const requested=Math.max(this.ctx.currentTime+.006,when);
    if(this.playReady(e,requested,bus,this.generation))return;
    void this.ready().then(()=>{
      if(this.synth){
        this.playReady(e,Math.max(requested,this.ctx.currentTime+.008),bus,this.generation);
      }
    }).catch(err=>console.warn('DrawSounds note failed',err));
  }

  panic(clearEffects=false){
    this.generation++;
    if(this.synth)this.synth.stopAll(true);
    if(clearEffects){
      const now=this.ctx.currentTime;
      try{
        this.synthBus.gain.cancelScheduledValues(now);
        this.synthBus.gain.setValueAtTime(0,now);
        this.synthBus.gain.setValueAtTime(1,now+0.015);
      }catch{}
      this.resetEffects();
    }
  }
}
