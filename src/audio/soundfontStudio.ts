import { WorkletSynthesizer } from 'spessasynth_lib';
import type { NoteEvent, PerformerRole, StudioState, SoundBank } from './types';
import { WORLD_MAP } from '../music/worlds/config';

const BANK_URLS:Record<SoundBank,string>={
  gm:'/soundfonts/TimGM6mb.sf3',
  odd:'/soundfonts/Aura-Oddities.sf3',
  bandoneon:'/soundfonts/Aura-Bandoneon.sf3',
  nylon:'/soundfonts/Aura-NylonGuitar.sf3',
  finger_bass:'/soundfonts/Aura-FingerBass.sf3',
  world_perc:'/soundfonts/Aura-WorldPercussion.sf3',
  clean_guitar:'/soundfonts/Aura-CleanGuitar.sf3',
  flamenco_strum:'/soundfonts/Aura-FlamencoStrum-DrJass.sf3',
  piano_kw:'/soundfonts/optional/UprightPianoKW-small.sf3',
  tenor_sax:'/soundfonts/optional/TenorSaxophone-small.sf3',
  harp:'/soundfonts/optional/ConcertHarp-small.sf3',
  tubular_bells:'/soundfonts/optional/TubularBells-small.sf3',
  ocarina:'/soundfonts/optional/Ocarina.sf3',
  lately_bass:'/soundfonts/optional/LatelyBass.sf3',
  acoustic_drums:'/soundfonts/optional/MuldjordKit.sf3',
};

// Each specialist bank lives in its own MIDI bank MSB, avoiding preset collisions.
const BANK_OFFSET:Record<SoundBank,number>={gm:0,odd:1,bandoneon:2,nylon:3,finger_bass:4,world_perc:5,clean_guitar:6,flamenco_strum:7,piano_kw:8,tenor_sax:9,harp:10,tubular_bells:11,ocarina:12,lately_bass:13,acoustic_drums:14};
const PROGRAM_OVERRIDE:Partial<Record<SoundBank,number>>={flamenco_strum:24};
const midi=(f:number)=>Math.max(0,Math.min(127,Math.round(69+12*Math.log2(Math.max(8,f)/440))));
function driveCurve(amount=1){const n=1024,c=new Float32Array(n),k=10+amount*12;for(let i=0;i<n;i++){const x=i*2/(n-1)-1;c[i]=((1+k)*x)/(1+k*Math.abs(x));}return c;}
const ROLE:Record<PerformerRole,{hp:number;body:number;db:number;pan:number;dry:number;drive:number;room:number;echo:number}>={
  drums:{hp:34,body:210,db:1.4,pan:.08,dry:1.05,drive:.07,room:.13,echo:.025},
  bass:{hp:27,body:170,db:2.3,pan:0,dry:1.08,drive:.055,room:.06,echo:.025},
  harmony:{hp:58,body:650,db:1.2,pan:.15,dry:1,drive:.05,room:.14,echo:.07},
  melody:{hp:78,body:1700,db:1.7,pan:.20,dry:1.02,drive:.055,room:.15,echo:.09},
  texture:{hp:90,body:2200,db:.5,pan:.34,dry:.90,drive:.04,room:.24,echo:.17},
  human:{hp:76,body:1200,db:1.4,pan:.12,dry:.98,drive:.045,room:.18,echo:.10},
};
type Strip={key:string;channel:number;input:GainNode;hp:BiquadFilterNode;body:BiquadFilterNode;lp:BiquadFilterNode;pan:StereoPannerNode;dry:GainNode;drive:WaveShaperNode;driveWet:GainNode;room:GainNode;echo:GainNode;active:Array<{m:number;end:number}>;role:PerformerRole};

export class SoundFontStudio{
  readonly ctx=new AudioContext({latencyHint:'interactive'});readonly analyser=this.ctx.createAnalyser();
  private master=this.ctx.createGain();private safety=this.ctx.createDynamicsCompressor();private roomIn=this.ctx.createGain();private echoIn=this.ctx.createGain();private strips=new Map<number,Strip>();private generation=0;private worldId='dreamland';
  private roomL=this.ctx.createDelay(.35);private roomR=this.ctx.createDelay(.35);private roomWetL=this.ctx.createGain();private roomWetR=this.ctx.createGain();private echoL=this.ctx.createDelay(2.5);private echoR=this.ctx.createDelay(2.5);private echoFbL=this.ctx.createGain();private echoFbR=this.ctx.createGain();private echoWetL=this.ctx.createGain();private echoWetR=this.ctx.createGain();private echoFilterL=this.ctx.createBiquadFilter();private echoFilterR=this.ctx.createBiquadFilter();private panL=this.ctx.createStereoPanner();private panR=this.ctx.createStereoPanner();
  private synthPromise:Promise<WorkletSynthesizer>|null=null;private loadedBanks=new Map<SoundBank,Promise<void>>();
  constructor(){this.master.gain.value=.8;this.safety.threshold.value=-8;this.safety.knee.value=14;this.safety.ratio.value=3;this.safety.attack.value=.008;this.safety.release.value=.18;this.master.connect(this.safety);this.safety.connect(this.analyser);this.analyser.connect(this.ctx.destination);this.panL.pan.value=-.5;this.panR.pan.value=.5;this.roomL.connect(this.panL);this.roomR.connect(this.panR);this.panL.connect(this.roomWetL);this.panR.connect(this.roomWetR);this.roomWetL.connect(this.master);this.roomWetR.connect(this.master);this.roomIn.connect(this.roomL);this.roomIn.connect(this.roomR);this.echoFilterL.type=this.echoFilterR.type='lowpass';this.echoL.connect(this.echoFilterL);this.echoR.connect(this.echoFilterR);this.echoFilterL.connect(this.echoWetL);this.echoFilterR.connect(this.echoWetR);this.echoWetL.connect(this.master);this.echoWetR.connect(this.master);this.echoFilterL.connect(this.echoFbL);this.echoFbL.connect(this.echoR);this.echoFilterR.connect(this.echoFbR);this.echoFbR.connect(this.echoL);this.echoIn.connect(this.echoL);this.echoIn.connect(this.echoR);}
  resumeTransport(){if(this.ctx.state==='suspended')void this.ctx.resume();}
  private ensureSynth(){if(!this.synthPromise)this.synthPromise=(async()=>{await this.ctx.audioWorklet.addModule('/spessasynth_processor.min.js');const synth=new WorkletSynthesizer(this.ctx,{eventsEnabled:false});await synth.isReady;synth.setLogLevel(false,true,false);return synth;})();return this.synthPromise;}
  private async ensureBank(bank:SoundBank){let p=this.loadedBanks.get(bank);if(!p){p=(async()=>{const synth=await this.ensureSynth();const r=await fetch(BANK_URLS[bank]);if(!r.ok)throw new Error(`${bank} SF3 ${r.status}`);await synth.soundBankManager.addSoundBank(await r.arrayBuffer(),bank,BANK_OFFSET[bank]);})();this.loadedBanks.set(bank,p);}return p;}
  private channelFor(e:NoteEvent){return (e.bank??'gm')==='gm'&&e.channelRole==='drums'?9:Math.max(0,Math.min(8,e.channelIndex??0));}
  private async ensureStrip(e:NoteEvent){const channel=this.channelFor(e),old=this.strips.get(channel);if(old)return old;const synth=await this.ensureSynth(),idx=Math.max(0,Math.min(8,e.channelIndex??0)),role=e.channelRole??'melody',input=this.ctx.createGain(),hp=this.ctx.createBiquadFilter(),body=this.ctx.createBiquadFilter(),lp=this.ctx.createBiquadFilter(),pan=this.ctx.createStereoPanner(),dry=this.ctx.createGain(),drive=this.ctx.createWaveShaper(),driveWet=this.ctx.createGain(),room=this.ctx.createGain(),echo=this.ctx.createGain(),base=ROLE[role];hp.type='highpass';hp.frequency.value=base.hp;body.type='peaking';body.frequency.value=base.body;body.Q.value=.72;body.gain.value=base.db;lp.type='lowpass';lp.frequency.value=11000;pan.pan.value=(idx%2?1:-1)*base.pan;dry.gain.value=base.dry;drive.curve=driveCurve(1.1);drive.oversample='2x';driveWet.gain.value=base.drive;room.gain.value=base.room;echo.gain.value=base.echo;synth.connectChannel(input,channel);input.connect(hp);hp.connect(body);body.connect(lp);lp.connect(pan);pan.connect(dry);dry.connect(this.master);lp.connect(drive);drive.connect(driveWet);driveWet.connect(this.master);lp.connect(room);room.connect(this.roomIn);lp.connect(echo);echo.connect(this.echoIn);const strip={key:String(channel),channel,input,hp,body,lp,pan,dry,drive,driveWet,room,echo,active:[],role};this.strips.set(channel,strip);return strip;}
  setStudioState(state:StudioState){this.worldId=state.worldId;const w=WORLD_MAP[state.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland,p=w.studio,energy=Math.max(0,Math.min(1,state.sectionEnergy)),beat=60/Math.max(50,state.tempo),now=this.ctx.currentTime;this.master.gain.setTargetAtTime(p.master*(1-Math.max(0,energy-.72)*.14),now,.04);this.roomL.delayTime.setTargetAtTime(.026+p.room*.035,now,.04);this.roomR.delayTime.setTargetAtTime(.044+p.room*.055,now,.04);this.roomWetL.gain.setTargetAtTime(p.room*(.82+energy*.20),now,.04);this.roomWetR.gain.setTargetAtTime(p.room*.92*(.82+energy*.20),now,.04);this.echoL.delayTime.setTargetAtTime(Math.min(2.2,beat*p.echoBeats[0]),now,.05);this.echoR.delayTime.setTargetAtTime(Math.min(2.2,beat*p.echoBeats[1]),now,.05);this.echoWetL.gain.setTargetAtTime(p.echo*(.86+energy*.22),now,.04);this.echoWetR.gain.setTargetAtTime(p.echo*.94*(.86+energy*.22),now,.04);this.echoFbL.gain.setTargetAtTime(Math.min(.62,p.feedback+energy*.035),now,.05);this.echoFbR.gain.setTargetAtTime(Math.min(.62,p.feedback+energy*.05),now,.05);this.echoFilterL.frequency.setTargetAtTime(p.lowpass,now,.05);this.echoFilterR.frequency.setTargetAtTime(p.lowpass*.88,now,.05);}
  private shape(strip:Strip,e:NoteEvent,start:number,duration:number){const b=ROLE[e.channelRole??strip.role],tone=e.tone??'clean',cut={dark:4300,warm:6500,clean:10500,bright:14500,wide:12000,soft:5600,gritty:8200}[tone],prod=e.production??'dry',tool=e.sourceTool;const p=prod==='bloom'?{room:.14,echo:.11,drive:.01,dry:.96}:prod==='smear'?{room:.11,echo:.18,drive:.02,dry:.93}:{room:0,echo:0,drive:.02,dry:1},tf=tool==='boom'?{room:.12,echo:.07,drive:.10}:tool==='spray'?{room:.07,echo:.08,drive:.01}:tool==='stamp'?{room:.04,echo:.02,drive:.04}:tool==='crayon'?{room:.03,echo:.04,drive:.01}:{room:0,echo:0,drive:0},now=Math.max(this.ctx.currentTime,start-.002);strip.hp.frequency.setTargetAtTime(b.hp,now,.01);strip.body.gain.setTargetAtTime(b.db+(tone==='gritty'?1.1:tone==='warm'?.6:0),now,.01);strip.lp.frequency.setTargetAtTime(cut,now,.01);strip.pan.pan.setTargetAtTime(Math.max(-.75,Math.min(.75,e.pan??((Number(strip.key)%2?1:-1)*b.pan))),now,.01);strip.dry.gain.setTargetAtTime(b.dry*p.dry,now,.01);strip.driveWet.gain.setTargetAtTime(Math.min(.38,b.drive+(e.drive??0)+p.drive+tf.drive),now,.01);strip.room.gain.setTargetAtTime(Math.min(.62,b.room+(e.room??0)+p.room+tf.room),now,.01);strip.echo.gain.setTargetAtTime(Math.min(.58,b.echo+(e.echo??0)+p.echo+tf.echo),now,.01);if((e.motion??0)>.02){strip.lp.frequency.cancelScheduledValues(now);strip.lp.frequency.setValueAtTime(cut,now);strip.lp.frequency.exponentialRampToValueAtTime(Math.max(1800,cut*(.82+(e.motion??0)*.38)),now+Math.max(.08,duration*.7));}}
  playNote(e:NoteEvent,when:number){const gen=this.generation,start=Math.max(this.ctx.currentTime+.006,when),w=WORLD_MAP[this.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland,duration=Math.max(.045,e.duration*w.studio.release*(e.articulation==='staccato'?.62:e.articulation==='legato'?1.12:1)),vel=Math.max(8,Math.min(124,Math.round(e.velocity*128))),m=e.drumMidi??midi(e.frequency),bank=e.bank??'gm';void Promise.all([this.ensureBank(bank),this.ensureStrip(e),this.ensureSynth()]).then(([_,s,synth])=>{if(gen!==this.generation)return;this.shape(s,e,start,duration);const channel=s.channel,setup=Math.max(this.ctx.currentTime,start-.004),program=PROGRAM_OVERRIDE[bank]??e.program??0;if(bank==='gm'&&e.channelRole==='drums'){
      // Standard GM percussion lives on channel 10 (zero-based 9).
      synth.controllerChange(channel,0,0,{time:setup});synth.programChange(channel,0,{time:setup});
    }else{
      synth.controllerChange(channel,0,BANK_OFFSET[bank],{time:setup});synth.controllerChange(channel,32,0,{time:setup});synth.programChange(channel,program,{time:setup});
    }
    s.active=s.active.filter(n=>n.end>start-.01);while(s.active.length>=16){const old=s.active.shift();if(old)synth.noteOff(channel,old.m,{time:start});}
    const on=(mm:number,v:number,t:number,off:number)=>{synth.noteOn(channel,mm,v,{time:t});synth.noteOff(channel,mm,{time:off});s.active.push({m:mm,end:off});};
    const target=e.glideToFrequency?midi(e.glideToFrequency):null;if(target!==null&&target!==m&&e.drumMidi===undefined){const steps=Math.min(5,Math.max(2,Math.abs(target-m)+1)),span=Math.min(duration*.55,.42);for(let i=0;i<steps;i++){const mm=Math.round(m+(target-m)*i/(steps-1)),t=start+span*i/(steps-1),off=Math.min(start+duration,t+Math.max(.08,span/(steps-1)*1.5));on(mm,Math.round(vel*(1-i*.04)),t,off);}}else if(e.articulation==='tremolo'&&e.drumMidi===undefined){const pulses=Math.max(2,Math.min(6,Math.round(duration/.12)));for(let i=0;i<pulses;i++){const t=start+i*duration/pulses,off=Math.min(start+duration,t+duration/pulses*.7);on(m,Math.round(vel*(i%2?.82:1)),t,off);}}else on(m,vel,start,start+duration);
  }).catch(console.error);}
  stopTransport(){this.generation++;const now=this.ctx.currentTime;void this.ensureSynth().then(s=>s.stopAll(true));for(const s of this.strips.values())s.active=[];this.echoFbL.gain.cancelScheduledValues(now);this.echoFbR.gain.cancelScheduledValues(now);this.echoFbL.gain.setValueAtTime(0,now);this.echoFbR.gain.setValueAtTime(0,now);window.setTimeout(()=>{const w=WORLD_MAP[this.worldId as keyof typeof WORLD_MAP]??WORLD_MAP.dreamland;this.echoFbL.gain.setValueAtTime(w.studio.feedback,this.ctx.currentTime);this.echoFbR.gain.setValueAtTime(w.studio.feedback,this.ctx.currentTime);},30);}
  close(){this.stopTransport();void this.synthPromise?.then(s=>s.destroy());this.strips.clear();if(this.ctx.state!=='closed')void this.ctx.close();}
}
