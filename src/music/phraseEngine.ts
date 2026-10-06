import type { NoteEvent, Phrase } from '../audio/types';
import type { CanvasMark, CanvasPoint, GestureStats, Performer, WorldConfig } from './canvasTypes';

const clamp=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const rng=(seed:number)=>()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
type EventSource=Partial<NoteEvent>&Pick<NoteEvent,'sound'>;

export type PhraseContour='rise'|'fall'|'arch'|'valley'|'oscillate'|'still';
export type PhraseCadence='open'|'closed'|'continue';
export interface PhraseIntent {
  startTime:number;
  beats:number;
  register:number;
  contour:PhraseContour;
  energy:number;
  density:number;
  tension:number;
  curvature:number;
  cadence:PhraseCadence;
  centerY:number;
  seed:number;
}
export interface PhraseMotif {
  steps:number[];
  rhythm:number[];
  gate:number[];
  signature:string;
}
export interface CompileResult { phrase:Phrase; motif?:PhraseMotif; }

export function createGestureStats(p:CanvasPoint):GestureStats{return{pointCount:1,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,minX:p.x,maxX:p.x,minY:p.y,maxY:p.y,sumY:p.y,totalDistance:0,upDistance:0,downDistance:0,directionChanges:0,lastDx:0,lastDy:0,minYIndex:0,maxYIndex:0};}
export function extendGestureStats(g:GestureStats,p:CanvasPoint):GestureStats{
  const dx=p.x-g.lastX,dy=p.y-g.lastY,d=Math.hypot(dx,dy),lastD=Math.hypot(g.lastDx,g.lastDy),index=g.pointCount;
  if(d>.001&&lastD>.001){const dot=(dx*g.lastDx+dy*g.lastDy)/(d*lastD);if(dot<.25)g.directionChanges++;}
  if(p.y<g.minY){g.minY=p.y;g.minYIndex=index;}if(p.y>g.maxY){g.maxY=p.y;g.maxYIndex=index;}
  g.minX=Math.min(g.minX,p.x);g.maxX=Math.max(g.maxX,p.x);
  g.pointCount=index+1;g.lastX=p.x;g.lastY=p.y;g.sumY+=p.y;g.totalDistance+=d;g.upDistance+=Math.max(0,-dy);g.downDistance+=Math.max(0,dy);g.lastDx=dx;g.lastDy=dy;
  return g;
}
export function gestureStats(mark:CanvasMark):GestureStats{
  if(mark.gesture)return mark.gesture;
  const points=mark.points.length?mark.points:[{x:.5,y:.5}];let g=createGestureStats(points[0]);for(let i=1;i<points.length;i++)g=extendGestureStats(g,points[i]);return g;
}

export function markBounds(mark:CanvasMark){if(mark.bounds)return mark.bounds;if(mark.tool==='fill')return{minX:0,maxX:1,minY:0,maxY:1};const g=gestureStats(mark),pad=(mark.tool==='stamp'||mark.tool==='boom'?.04:.012)*mark.size;return{minX:clamp(g.minX-pad),maxX:clamp(g.maxX+pad),minY:clamp(g.minY-pad),maxY:clamp(g.maxY+pad)};}
function event(midi:number,timeOffset:number,duration:number,velocity:number,extra:EventSource):NoteEvent{return{midi:Math.max(0,Math.min(127,Math.round(midi))),timeOffset:Math.max(0,timeOffset),duration:Math.max(.04,duration),velocity:clamp(velocity,.05,.9),...extra};}
function beatSeconds(w:WorldConfig){return 60/w.tempo;}
function chord(w:WorldConfig,absolute:number,total:number){const i=Math.floor(clamp(absolute/total,0,.999)*Math.max(w.progression.length,Math.round(w.totalBeats/4)));return w.progression[i%w.progression.length];}
function nearest(w:WorldConfig,target:number,absolute:number,total:number,chordBias=false,previous?:number,maxLeap=7){
  const ds=chordBias?chord(w,absolute,total):w.scale;
  let best=w.key,bestDistance=Infinity,nearBest=w.key,nearDistance=Infinity,hasNear=false;
  for(let o=-3;o<=4;o++)for(const d of ds){
    const midi=w.key+d+o*12,distance=Math.abs(midi-target);
    if(distance<bestDistance){best=midi;bestDistance=distance;}
    if(previous!==undefined&&Math.abs(midi-previous)<=maxLeap&&distance<nearDistance){nearBest=midi;nearDistance=distance;hasNear=true;}
  }
  return previous!==undefined&&hasNear?nearBest:best;
}
function targetMidi(w:WorldConfig,p:Performer,y:number){return w.key+(p.octave-4)*12+(0.5-clamp(y))*18;}
function extra(p:Performer,i:number,pt:CanvasPoint):EventSource{return{sound:p.sound,channelIndex:i,channelRole:p.role,canvasX:pt.x,canvasY:pt.y,pan:p.pan,room:p.room,echo:p.echo};}
function pointAt(mark:CanvasMark,phase:number):CanvasPoint{
  const points=mark.points;
  if(!points.length)return{x:.5,y:.5};
  if(points.length===1)return points[0];
  const pos=clamp(phase)*(points.length-1),i=Math.min(points.length-2,Math.floor(pos)),f=pos-i,a=points[i],b=points[i+1];
  return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
function quantizeBeats(v:number,choices:number[]){return choices.reduce((best,x)=>Math.abs(x-v)<Math.abs(best-v)?x:best,choices[0]);}

export function phraseIntent(mark:CanvasMark,w:WorldConfig,total:number):PhraseIntent{
  const g=gestureStats(mark),b=markBounds(mark),span=Math.max(.015,b.maxX-b.minX),avgY=g.sumY/Math.max(1,g.pointCount),vertical=g.maxY-g.minY,delta=g.lastY-g.startY;
  let contour:PhraseContour='still';
  const both=Math.min(g.upDistance,g.downDistance),travel=Math.max(.001,g.upDistance+g.downDistance);
  if(g.directionChanges>=3||both/travel>.34)contour='oscillate';
  else if(Math.abs(delta)>.07)contour=delta<0?'rise':'fall';
  else if(vertical>.10){const minPos=g.minYIndex/Math.max(1,g.pointCount-1),maxPos=g.maxYIndex/Math.max(1,g.pointCount-1);contour=minPos>.18&&minPos<.82?'arch':maxPos>.18&&maxPos<.82?'valley':'oscillate';}
  const rawBeats=mark.tool==='fill'?w.totalBeats:span*w.totalBeats;
  const style=w.id==='dreamland'?'serene':w.id==='tango'||w.id==='flamenco'||w.id==='zouk'?'traditional':'wild';
  const choices=style==='serene'?[2,4,6,8,12]:style==='traditional'?[1,2,4,6,8]:[1,2,3,4,6,8];
  const beats=mark.tool==='boom'?2:mark.tool==='stamp'?Math.max(1,quantizeBeats(rawBeats,choices)):quantizeBeats(Math.max(1,rawBeats),choices);
  const normalizedTravel=clamp(g.totalDistance/Math.max(.08,span*1.5));
  const toolEnergy=mark.tool==='boom'?.95:mark.tool==='spray'?.78:mark.tool==='dots'?.62:mark.tool==='stamp'?.66:mark.tool==='fill'?.36:.52;
  const energy=clamp(toolEnergy*.72+normalizedTravel*.20+clamp(mark.size-0.8,0,.5)*.16);
  const density=clamp((g.pointCount/Math.max(2,beats))*0.10+(mark.tool==='spray'?.38:mark.tool==='dots'?.30:mark.tool==='boom'?.24:.10));
  const curvature=clamp(g.directionChanges/5+both/travel*.55);
  const tension=clamp(Math.abs(avgY-.5)*.55+curvature*.35+(contour==='oscillate'?.12:0));
  const cadence:PhraseCadence=b.maxX>.86||mark.tool==='boom'?'closed':beats>=6?'continue':'open';
  return{startTime:b.minX*total,beats,register:clamp(1-avgY),contour,energy,density,tension,curvature,cadence,centerY:avgY,seed:mark.seed};
}

function patternForContour(contour:PhraseContour,length:number){const base:Record<PhraseContour,number[]>={rise:[0,1,2,3,4,5],fall:[0,-1,-2,-3,-4,-5],arch:[0,1,3,4,2,0],valley:[0,-2,-3,-1,1,0],oscillate:[0,2,-1,3,-2,1],still:[0,1,0,-1,0,1]};const src=base[contour];return Array.from({length},(_,i)=>src[i%src.length]);}
function motifFromIntent(intent:PhraseIntent,length:number,rhythm:number[],previous:PhraseMotif|undefined,voiceOrdinal:number,wildness:number){const r=rng(intent.seed^hash(intent.contour)),phase=voiceOrdinal%4;let steps=patternForContour(intent.contour,length);const cycleSpan=Math.max(1,Math.ceil((rhythm[rhythm.length-1]??0)+.5));let useRhythm=Array.from({length},(_,i)=>(rhythm[i%rhythm.length]??0)+Math.floor(i/rhythm.length)*cycleSpan);
  if(previous&&phase!==0){steps=Array.from({length},(_,i)=>previous.steps[i%previous.steps.length]);useRhythm=Array.from({length},(_,i)=>previous.rhythm[i%previous.rhythm.length]);if(phase===1){const j=Math.min(length-1,1+Math.floor(r()*Math.max(1,length-2)));steps[j]+=r()>.5?1:-1;}else if(phase===2){steps=steps.map((s,i)=>i?Math.round(-s*.75+(i%2?1:0)):0);useRhythm=useRhythm.map((x,i)=>x+(i>0&&i%2?.125:0));}else{steps=steps.map((s,i)=>i===length-1?0:s);}}
  if(wildness>.55&&!previous){steps=steps.map((s,i)=>s+(i>1&&r()<wildness*.28?(r()>.5?2:-2):0));}
  const gate=Array.from({length},(_,i)=>i===length-1?.9:.58+r()*.20);const signature=`${steps.join(',')}|${useRhythm.map(x=>x.toFixed(3)).join(',')}`;return{steps,rhythm:useRhythm,gate,signature};}
function midiForStep(w:WorldConfig,p:Performer,intent:PhraseIntent,step:number,absolute:number,total:number,previous?:number,chordBias=false,maxLeap=8){const target=targetMidi(w,p,intent.centerY)+step*2;return nearest(w,target,absolute,total,chordBias,previous,maxLeap);}

// Traditional style vocabularies
function flamencoTechnique(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number){const beat=beatSeconds(w),pt=mark.points[0]||{x:.5,y:.5},base=w.key+(p.octave-4)*12,ch=chord(w,pt.x*total,total),choice=w.stamps.find(s=>s.id===mark.stampKind),id=choice?.technique||mark.stampKind||'rasgueado',out:NoteEvent[]=[];const chordalGuitar=(p.name==='guitar'||p.name==='falseta')&&['rasgueado','abanico','golpe','llamada','remate'].includes(id);const add=(m:number,t:number,d:number,v:number,art:NoteEvent['articulation']='accent')=>out.push(event(m,t,d,v,{...extra(p,i,pt),...(chordalGuitar?{sound:'flamenco_strum' as const}:{}),articulation:art}));if(p.role==='drums'){const notes=p.drumNotes||[59,61,60],pat=id==='remate'?[0,.25,.5,.75,1,1.25]:id==='llamada'?[0,.5,.75,1]:[0,.5,1,1.5];pat.forEach((b,k)=>out.push(event(notes[k%notes.length],b*beat,beat*.12,.5+(k===0?.1:0),extra(p,i,pt))));return out;}if(id==='picado'){let prev:number|undefined;for(let k=0;k<8;k++){const m=nearest(w,base+k,pt.x*total,total,k===7,prev,3);prev=m;add(m,k*beat*.18,beat*.16,.48,'staccato');}}else if(id==='alzapua'){[0,7,0,3,7,3].forEach((d,k)=>add(base+d,k*beat*.24,beat*.20,.5,k%3===0?'accent':'staccato'));}else if(id==='golpe'){add(base+ch[0],0,beat*.16,.66,'accent');add(base+ch[1],beat*.08,beat*.12,.38,'staccato');}else if(id==='llamada'){[0,1,2,0].forEach((x,k)=>add(base+ch[x%ch.length],k*beat*.42,beat*.30,.58,k===0?'accent':'marcato'));}else if(id==='remate'){[0,2,1,0].forEach((x,k)=>add(base+ch[x%ch.length],k*beat*.26,beat*.22,.55+k*.02,'accent'));}else{const pattern=id==='abanico'?[0,.11,.22,.38,.49,.60]:[0,.07,.14,.21,.36,.43];pattern.forEach((t,k)=>ch.slice(0,3).forEach((d,j)=>add(base+d,t*beat+j*.025,beat*.34,.38+(k===0?.08:0),id==='rasgueado'?'marcato':'accent')));}return out;}
function tangoTechnique(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number){const beat=beatSeconds(w),pt=mark.points[0]||{x:.5,y:.5},base=w.key+(p.octave-4)*12,ch=chord(w,pt.x*total,total),choice=w.stamps.find(s=>s.id===mark.stampKind),id=choice?.technique||mark.stampKind||'marcato4',out:NoteEvent[]=[];const addChord=(t:number,v=.5,d=beat*.42)=>ch.slice(0,3).forEach((x,j)=>out.push(event(base+x,t+j*.018,d,v-(j*.025),{...extra(p,i,pt),articulation:id.startsWith('marcato')?'marcato':'accent'})));if(id==='marcato2'){[0,2].forEach(b=>addChord(b*beat,.54,beat*.6));}else if(id==='marcato4'){[0,1,2,3].forEach(b=>addChord(b*beat,.49+(b===0?.07:0),beat*.42));}else if(id==='sincopa'){[0,.75,1.5,2.75].forEach((b,k)=>addChord(b*beat,.48+(k%2?.08:0),beat*.38));}else if(id==='arrastre'){const target=base+ch[0];for(let k=0;k<4;k++){const m=target-5+k*2;const e=event(m,k*beat*.12,beat*.26,.38+k*.05,{...extra(p,i,pt),articulation:'legato'});if(k<3)e.glideToMidi=m+2;out.push(e);}addChord(beat*.52,.58,beat*.7);}else if(id==='milonga'){[0,.75,1.5,2.0,2.75,3.5].forEach((b,k)=>addChord(b*beat,.44+(k%3===0?.07:0),beat*.28));}else if(id==='yumba'){[0,1,2,3].forEach((b,k)=>addChord(b*beat,k%2===0?.58:.40,beat*(k%2===0?.62:.30)));}else{[0,7,3,7,0,10].forEach((d,k)=>out.push(event(base+d,k*beat*.34,beat*.48,.45+(k===0?.08:0),{...extra(p,i,pt),articulation:'tenuto'})));}return out;}


// Stable stamp gestures are interpreted through each world's own musical vocabulary.
function worldStampPhrase(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent){
  if(w.id==='flamenco')return flamencoTechnique(mark,w,p,total,i);
  if(w.id==='tango')return tangoTechnique(mark,w,p,total,i);
  const beat=beatSeconds(w),pt=mark.points[0]||{x:.5,y:.5},abs=intent.startTime,kind=mark.stampKind||'star',out:NoteEvent[]=[],r=rng(intent.seed^0x57A6),base=w.key+(p.octave-4)*12;
  const flavor:Record<string,{cat:number[];frog:number[];panda:number[];burst:number[];rise:number[];hit:number[];burstGap:number;riseGap:number}>={
    dreamland:{cat:[0,2,0],frog:[-2,0,-2,3],panda:[0,1,0,2,1],burst:[0,2,4,7],rise:[0,1,3,5,7],hit:[0,7],burstGap:.34,riseGap:.44},
    drum_circle:{cat:[0,3,1],frog:[0,-1,0,2],panda:[0,1,0,1,2],burst:[0,3,1,4,2],rise:[0,1,2,3,4,5],hit:[0,0,3],burstGap:.24,riseGap:.22},
    pop_star:{cat:[0,4,2],frog:[0,-2,2,0],panda:[0,1,0,2,1],burst:[0,2,4,2],rise:[0,1,2,4,5],hit:[0,4,0],burstGap:.22,riseGap:.28},
    rock_monster:{cat:[0,3,0],frog:[0,-3,0,-2],panda:[0,0,2,0,3],burst:[0,0,3,5],rise:[0,2,3,5,7],hit:[0,0,5],burstGap:.18,riseGap:.20},
    salsa_party:{cat:[0,3,1],frog:[0,-1,3,0],panda:[0,2,1,3,2],burst:[0,3,1,4,2],rise:[0,1,3,4,6],hit:[0,3,0],burstGap:.19,riseGap:.24},
    weird_cabinet:{cat:[0,5,-2],frog:[0,-4,3,-1],panda:[0,3,-1,4,1],burst:[0,4,-2,5,1],rise:[0,3,1,6,4],hit:[0,-3,7],burstGap:.29,riseGap:.31},
    zouk:{cat:[0,2,0],frog:[0,-2,1,-1],panda:[0,1,0,2,1],burst:[0,2,1,4],rise:[0,1,2,3,5],hit:[0,2,0],burstGap:.26,riseGap:.34},
  };
  const f=flavor[w.id]??flavor.pop_star,notes=p.drumNotes?.length?p.drumNotes:[36,38,42];
  const addDrum=(idx:number,rb:number,v:number,d=.12)=>out.push(event(notes[((idx%notes.length)+notes.length)%notes.length],rb*beat,beat*d,v,extra(p,i,pt)));
  const melodic=(step:number,rb:number,vel:number,dur:number,art:NoteEvent['articulation']='tenuto',previous?:number)=>{
    const m=midiForStep(w,p,intent,step,abs+rb*beat,total,previous,rb===0,kind==='rocket'?12:8),e=event(m,rb*beat,beat*dur,vel,{...extra(p,i,pt),articulation:art});out.push(e);return e;
  };
  const sway=(rb:number,k:number)=>Math.max(0,rb+(k%2?w.feel.swing*w.feel.grid*.22:0));
  if(p.role==='drums'){
    if(kind==='cat')f.cat.forEach((_,k)=>addDrum(k===1?1:0,sway([0,.22,.68][k]??k*.24,k),k===0?.62:k===1?.45:.54,.09));
    else if(kind==='frog')f.frog.forEach((_,k)=>addDrum(k%2?1:0,sway([0,.48,1.0,1.55][k]??k*.5,k),k%2?.43:.57,.15));
    else if(kind==='panda')f.panda.forEach((_,k)=>addDrum(k%2?2:0,sway([0,.5,1,1.5,2.25][k]??k*.5,k),.40+(k===0?.12:0),.11));
    else if(kind==='star')f.burst.forEach((_,k)=>addDrum(k,sway(k*f.burstGap,k),.42+(k===0?.14:0)+(w.id==='drum_circle'?r()*.08:0),.10));
    else if(kind==='rocket')f.rise.forEach((_,k)=>addDrum(k,sway(k*f.riseGap,k),.34+k*.035,.10));
    else if(kind==='flower'){[0,.5,1,1.5,2,2.75].forEach((rb,k)=>addDrum(k,sway(rb,k),.36+(k===0||k===4?.12:0),.13));}
    else{[0,.18,.72].forEach((rb,k)=>addDrum(k===1?1:0,sway(rb,k),k===0?.66:k===1?.42:.54,.09));}
    return out;
  }
  if(kind==='cat'){
    let prev:number|undefined;f.cat.forEach((step,k)=>{const rb=sway([0,.22,.68][k]??k*.24,k),e=melodic(step,rb,k===0?.58:.43,w.id==='dreamland'?.9:.24,k===0?'accent':'staccato',prev);prev=e.midi;});
  }else if(kind==='frog'){
    let prev:number|undefined;f.frog.forEach((step,k)=>{const rb=sway([0,.48,1.0,1.55][k]??k*.5,k),e=melodic(step,rb,k%2===0?.50:.38,w.id==='dreamland'?1.15:.42,k===0?'accent':'tenuto',prev);if(k%2===0&&out.length>1){const prior=out[out.length-2];if(Math.abs(e.midi-prior.midi)<=5)prior.glideToMidi=e.midi;}prev=e.midi;});
  }else if(kind==='panda'){
    let prev:number|undefined;f.panda.forEach((step,k)=>{const rb=sway([0,.5,1,1.5,2.25][k]??k*.5,k),e=melodic(step,rb,.40+(k===0?.10:0),w.id==='dreamland'?.82:.32,k===0?'accent':'tenuto',prev);prev=e.midi;});
  }else if(kind==='star'){
    let prev:number|undefined;f.burst.forEach((step,k)=>{const e=melodic(step,sway(k*f.burstGap,k),.42+(k===0?.08:0),w.id==='dreamland'?1.45:.42,k===0?'accent':'staccato',prev);prev=e.midi;});
  }else if(kind==='rocket'){
    let prev:number|undefined;f.rise.forEach((step,k)=>{const e=melodic(step,sway(k*f.riseGap,k),.37+k*.025,w.id==='dreamland'?1.6:.58,k===0?'accent':'legato',prev);if(out.length>1){const prior=out[out.length-2];if(Math.abs(e.midi-prior.midi)<=7)prior.glideToMidi=e.midi;}prev=e.midi;});
  }else if(kind==='flower'){
    const ch=chord(w,abs,total),spread=p.role==='bass'?[ch[0],(ch[0]??0)+12]:[ch[0],ch[1]??4,ch[2]??7,(ch[0]??0)+12];
    spread.forEach((degree,k)=>out.push(event(base+degree,sway(k*(w.id==='dreamland'?.24:.07),k)*beat,beat*(w.id==='dreamland'?2.8:w.id==='weird_cabinet'?1.9:1.25),.32+intent.energy*.12-k*.018,{...extra(p,i,pt),articulation:'legato'})));
  }else{
    const steps=f.hit;let prev:number|undefined;steps.forEach((step,k)=>{const rb=sway(k===0?0:k===1?.16:.62,k),e=melodic(step,rb,k===0?.68:.45,k===0?.28:.20,'accent',prev);prev=e.midi;});
  }
  return out;
}

function traditionalMelody(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent){const beat=beatSeconds(w),count=Math.max(3,Math.min(7,Math.round(intent.beats*1.1))),rhythm=w.id==='zouk'?[0,.75,1.5,2.5,3.25,4.25]:w.id==='flamenco'?[0,.5,1,1.5,2.25,3]:[0,.75,1.25,2,2.75,3.5],motif=motifFromIntent(intent,count,rhythm,undefined,0,.15),out:NoteEvent[]=[];let prev:number|undefined;for(let k=0;k<count;k++){let rb=motif.rhythm[k%motif.rhythm.length];if(rb>=intent.beats)break;const pt=pointAt(mark,rb/Math.max(1,intent.beats)),abs=intent.startTime+rb*beat,m=midiForStep(w,p,intent,motif.steps[k],abs,total,prev,k===0||k===count-1, w.id==='flamenco'?5:6);prev=m;const next=motif.rhythm[k+1]??Math.min(intent.beats,rb+1),dur=Math.max(.12,Math.min(beat*1.25,(next-rb)*beat*(mark.tool==='crayon'?.92:.66)));const art:NoteEvent['articulation']=mark.tool==='crayon'?'legato':k===0?'accent':'tenuto';const e=event(m,rb*beat,dur,.40+intent.energy*.16+(k===0?.05:0),{...extra(p,i,pt),articulation:art});if(mark.tool==='crayon'&&k<count-1){const nm=midiForStep(w,p,intent,motif.steps[k+1]??0,intent.startTime+next*beat,total,m,false,5);if(Math.abs(nm-m)<=3)e.glideToMidi=nm;}out.push(e);}return{events:out,motif};}
function traditionalBass(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent){const beat=beatSeconds(w),out:NoteEvent[]=[];const pattern=w.id==='zouk'?[0,1.5,2.5,3.5]:w.id==='flamenco'?[0,1,2.5,3]:[0,1,2,3];let prev:number|undefined;for(let k=0;k<Math.max(2,Math.ceil(intent.beats/4)*pattern.length);k++){const cycle=Math.floor(k/pattern.length)*4,rb=cycle+pattern[k%pattern.length];if(rb>=intent.beats)break;const abs=intent.startTime+rb*beat,pt=pointAt(mark,rb/Math.max(1,intent.beats)),step=w.id==='zouk'?[0,2,4,1][k%4]:[0,3,2,0][k%4],m=midiForStep(w,p,intent,step,abs,total,prev,true,5);prev=m;out.push(event(m,rb*beat,beat*(w.id==='zouk'?.68:.72),.43+intent.energy*.12,{...extra(p,i,pt),articulation:k%4===0?'accent':'tenuto'}));}return out;}
function traditionalHarmony(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent){const beat=beatSeconds(w),out:NoteEvent[]=[];const times=w.id==='zouk'?[0,.75,1.75,2.75,3.5]:w.id==='tango'?[0,1,2,3]:w.id==='flamenco'?[0,.5,1.5,2.5,3.25]:[0,1,2,3];for(let cycle=0;cycle<intent.beats;cycle+=4)for(const offset of times){const rb=cycle+offset;if(rb>=intent.beats)continue;const abs=intent.startTime+rb*beat,ch=chord(w,abs,total),base=w.key+(p.octave-4)*12,pt=pointAt(mark,rb/Math.max(1,intent.beats));ch.slice(0,3).forEach((d,j)=>out.push(event(base+d,rb*beat+j*.018,beat*(w.id==='zouk'?.42:w.id==='tango'?.48:.32),.34+intent.energy*.15-(j*.02),{...extra(p,i,pt),articulation:w.id==='tango'?'marcato':'accent'})));}return out;}
function traditionalDrums(mark:CanvasMark,w:WorldConfig,p:Performer,i:number,intent:PhraseIntent){const beat=beatSeconds(w),notes=p.drumNotes?.length?p.drumNotes:[36,38,42],out:NoteEvent[]=[];const add=(rb:number,k:number,v:number)=>{if(rb>=intent.beats)return;out.push(event(notes[k%notes.length],rb*beat,beat*.11,v,extra(p,i,pointAt(mark,rb/Math.max(1,intent.beats)))));};for(let cycle=0;cycle<intent.beats;cycle+=4){if(w.id==='flamenco'){[0,.5,1,1.5,2,2.5,3,3.5].forEach((x,k)=>add(cycle+x,k,.38+(k%4===0?.12:0)));}else{[0,.5,1,1.5,2,2.5,3,3.5].forEach((x,k)=>add(cycle+x,k===0?0:k===4?1:2,.35+(k===0||k===4?.14:0)));}}return out;}

/**
 * Rebuild a continuous mark from the notes the player actually heard while
 * drawing it. This is deliberately a timing pass, not a recomposition pass:
 * pitch, instrument, velocity, articulation, pan and sends remain intact.
 *
 * Path position provides the main musical clock so playback flows across the
 * canvas; a small amount of the original finger timing keeps human feel. The
 * only groove operation is a gentle pull toward a local grid.
 */
function capturedPerformancePhrase(mark:CanvasMark,w:WorldConfig,intent:PhraseIntent):CompileResult|null{
  const capture=mark.performance;
  if(!capture||capture.worldId!==w.id||capture.events.length<1)return null;
  const source=capture.events.filter(e=>Number.isFinite(e.midi)&&Number.isFinite(e.velocity)&&Number.isFinite(e.gestureTime)&&Number.isFinite(e.pointIndex));
  if(!source.length)return null;
  const beat=beatSeconds(w),phraseSeconds=Math.max(beat*.5,intent.beats*beat);
  const maxPoint=Math.max(1,mark.points.length-1,...source.map(e=>e.pointIndex));
  const maxGesture=Math.max(.08,...source.map(e=>e.gestureTime));
  const traditional=w.id==='tango'||w.id==='flamenco'||w.id==='zouk';
  const flowStretch=w.id==='dreamland'?1.22:traditional?1.12:1.08;
  const desiredSeconds=Math.min(phraseSeconds,Math.max(beat,maxGesture*flowStretch));
  const rawPlaybackBeats=desiredSeconds/beat;
  const playbackBeats=clamp(Math.round(rawPlaybackBeats*2)/2,Math.min(1,intent.beats),intent.beats);
  const playbackSeconds=Math.max(beat*.5,playbackBeats*beat);
  const timeScale=playbackSeconds/maxGesture;
  const durationScale=source.length<2?1:clamp(Math.max(1,timeScale),1,w.id==='dreamland'?2.35:1.75);
  const {grid,snap,swing,sustain,pulse,pulseStep}=w.feel;
  const maxBeat=Math.max(.05,playbackBeats-.04),bounds=markBounds(mark),spanX=Math.max(.01,bounds.maxX-bounds.minX),out:NoteEvent[]=[];
  for(const captured of source){
    const pathPhase=clamp(captured.pointIndex/maxPoint),gesturePhase=clamp(captured.gestureTime/maxGesture);
    const xPhase=clamp(((captured.canvasX??pointAt(mark,pathPhase).x)-bounds.minX)/spanX);
    const phase=clamp(pathPhase*.74+gesturePhase*.16+xPhase*.10);
    const rawBeat=phase*maxBeat,snapped=Math.round(rawBeat/grid)*grid,slot=Math.round(snapped/grid);
    const swingOffset=(slot&1)?swing*grid:0;
    const beatPos=clamp(rawBeat+(snapped-rawBeat)*snap+swingOffset,0,maxBeat);
    const pulseIndex=Math.floor(Math.max(0,beatPos)/Math.max(.125,pulseStep))%Math.max(1,pulse.length),pulseGain=pulse[pulseIndex]??1;
    const pt={x:captured.canvasX??pointAt(mark,pathPhase).x,y:captured.canvasY??pointAt(mark,pathPhase).y};
    out.push({
      ...captured,
      timeOffset:Math.max(0,beatPos*beat+captured.timeOffset),
      duration:Math.max(.05,Math.min(w.id==='dreamland'?beat*4.8:beat*2.9,captured.duration*durationScale*sustain)),
      velocity:clamp(captured.velocity*pulseGain,.05,.9),
      canvasX:pt.x,canvasY:pt.y,
    });
  }
  out.sort((a,b)=>a.timeOffset-b.timeOffset);
  return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:out}};
}

// Dreamland fallback for uncaptured marks
function dreamPhrase(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent):CompileResult{const beat=beatSeconds(w),out:NoteEvent[]=[],r=rng(intent.seed^0xD3EA),pt=(rb:number)=>pointAt(mark,rb/Math.max(1,intent.beats)),midiAt=(rb:number,step:number,absolute:number,previous?:number,chordBias=false,maxLeap=8)=>nearest(w,targetMidi(w,p,pt(rb).y)+step*2,absolute,total,chordBias,previous,maxLeap);if(p.role==='bass'){const times=[0,Math.min(intent.beats*.55,4),Math.max(0,intent.beats-1.2)].filter((x,k,a)=>k===0||Math.abs(x-a[k-1])>.7);let prev:number|undefined;times.forEach((rb,k)=>{const abs=intent.startTime+rb*beat,m=midiAt(rb,[0,3,1][k%3],abs,prev,true,6);prev=m;out.push(event(m,rb*beat,beat*(1.8+r()*.8),.25+intent.energy*.10,{...extra(p,i,pt(rb)),articulation:'legato'}));});return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:out}};}
  if(p.role==='harmony'){const anchors=[0,Math.min(intent.beats*.58,5)];for(const rb of anchors){const abs=intent.startTime+rb*beat,ch=chord(w,abs,total),base=w.key+(p.octave-4)*12;[ch[0],ch[1]??5,(ch[2]??7)+12].forEach((d,j)=>out.push(event(base+d,rb*beat+j*beat*.28,beat*(2.4+r()*1.4),.20+intent.energy*.10-j*.015,{...extra(p,i,pt(rb)),articulation:'legato'})));}return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:out}};}
  const count=p.role==='texture'||p.role==='human'?Math.max(1,Math.min(3,Math.round(intent.beats/3))):Math.max(2,Math.min(5,Math.round(intent.beats/2)+1)),rhythm=[0,1.5,3.5,5.75,8.5],motif=motifFromIntent(intent,count,rhythm,undefined,0,.05);let prev:number|undefined;for(let k=0;k<count;k++){const rb=Math.min(intent.beats-.05,motif.rhythm[k]??k*2);if(rb<0)continue;const step=motif.steps[k]+(k%3===1?2:0),abs=intent.startTime+rb*beat,m=midiAt(rb,step,abs,prev,k===0||intent.cadence==='closed'&&k===count-1,8);prev=m;const dur=beat*((p.role==='texture'||p.role==='human'?3.2:1.55)+r()*1.6),e=event(m,rb*beat,dur,.19+intent.energy*.13,{...extra(p,i,pt(rb)),articulation:'legato'});if(p.role==='texture'&&k<count-1&&r()>.45){const nm=midiAt(Math.min(intent.beats,rb+1),step+(intent.contour==='fall'?-1:1),abs+beat,m,false,4);if(Math.abs(nm-m)<=4)e.glideToMidi=nm;}out.push(e);}return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:out},motif};}

// Generated phrase vocabularies
const WILDNESS:Record<string,number>={drum_circle:.66,pop_star:.58,rock_monster:.72,salsa_party:.64,weird_cabinet:.94};
function wildRhythm(w:WorldConfig,intent:PhraseIntent){if(w.id==='salsa_party')return[0,.5,1.5,2,2.75,3.5,4.5,5.5];if(w.id==='rock_monster')return[0,.5,1,1.5,2.5,3,3.5,4.5];if(w.id==='pop_star')return[0,.75,1.5,2,2.75,3.5,4.25,5.5];if(w.id==='weird_cabinet')return[0,.375,1.25,2.125,2.5,3.75,5.125,6];return[0,.5,1.25,2,2.5,3.25,4,5];}
function wildMelody(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent,previous:PhraseMotif|undefined,voiceOrdinal:number){const beat=beatSeconds(w),wild=WILDNESS[w.id]??.65,count=Math.max(4,Math.min(10,Math.round(4+intent.density*4+intent.energy*2))),motif=motifFromIntent(intent,count,wildRhythm(w,intent),previous,voiceOrdinal,wild),out:NoteEvent[]=[],r=rng(intent.seed^0x51A7);let prev:number|undefined;for(let k=0;k<count;k++){const rb=motif.rhythm[k];if(rb>=intent.beats)break;let step=motif.steps[k];if(w.id==='rock_monster')step=Math.round(step/2)*2;if(w.id==='weird_cabinet'&&k%3===2)step+=r()>.5?3:-3;const abs=intent.startTime+rb*beat,pt=pointAt(mark,rb/Math.max(1,intent.beats)),m=midiForStep(w,p,intent,step,abs,total,prev,k===0||intent.cadence==='closed'&&k===count-1,w.id==='weird_cabinet'?12:8);const next=motif.rhythm[k+1]??Math.min(intent.beats,rb+1),dur=Math.max(.08,(next-rb)*beat*motif.gate[k]);const art:NoteEvent['articulation']=w.id==='rock_monster'?(k%3===0?'accent':'staccato'):mark.tool==='crayon'?'legato':k%4===0?'accent':'tenuto',e=event(m,rb*beat,dur,.34+intent.energy*.24+(k===0?.04:0),{...extra(p,i,pt),articulation:art});if((w.id==='weird_cabinet'||mark.tool==='crayon')&&prev!==undefined&&Math.abs(m-prev)<=5&&k%2===1)e.glideToMidi=midiForStep(w,p,intent,motif.steps[Math.min(k+1,motif.steps.length-1)],abs+beat*.3,total,m,false,6);out.push(e);prev=m;}return{events:out,motif};}
function wildHarmony(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent,voiceOrdinal:number){const beat=beatSeconds(w),out:NoteEvent[]=[],r=rng(intent.seed^0xA11CE),patterns=w.id==='rock_monster'?[[0,1,2.5,3],[0,.75,2,3.25]]:w.id==='salsa_party'?[[0,.75,1.5,2.5,3.25],[0,.5,1.75,2.25,3.5]]:w.id==='pop_star'?[[0,1.5,2.5,3.5],[0,.75,2,3]]:[[0,.625,1.75,2.875,4.25],[0,1.125,2.375,3.125]],phase=voiceOrdinal%4,pat=patterns[phase===2?Math.min(1,patterns.length-1):Math.floor(r()*patterns.length)];for(let cycle=0;cycle<intent.beats;cycle+=4){for(let n=0;n<pat.length;n++){const rb=cycle+pat[n];if(rb>=intent.beats)continue;const abs=intent.startTime+rb*beat,ch=chord(w,abs,total),base=w.key+(p.octave-4)*12,pt=pointAt(mark,rb/Math.max(1,intent.beats)),tones=w.id==='rock_monster'?[ch[0],ch[2]??7,(ch[0]??0)+12]:ch.slice(0,3);tones.forEach((d,j)=>{const arp=w.id==='weird_cabinet'?(j*beat*.13):j*.018;out.push(event(base+d,rb*beat+arp,beat*(w.id==='pop_star'?.46:w.id==='rock_monster'?.34:.55),.31+intent.energy*.20-(j*.018),{...extra(p,i,pt),articulation:n===0?'accent':'tenuto'}));});}}return out;}
function wildBass(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent,voiceOrdinal:number){const beat=beatSeconds(w),out:NoteEvent[]=[],phase=voiceOrdinal%4,patterns=w.id==='salsa_party'?(phase===2?[0,.75,2,3.25]:[0,1.5,2.5,3.5]):w.id==='rock_monster'?(phase===2?[0,.5,1.75,2.5,3.5]:[0,.75,1.5,2.5,3.25]):w.id==='pop_star'?(phase===2?[0,1,2.25,3.25]:[0,1.5,2.75,3.5]):w.id==='weird_cabinet'?(phase===2?[0,.625,2.375,3.125]:[0,1.25,2.125,3.75]):(phase===2?[0,.5,1.75,3]:[0,1,2.5,3.25]);let prev:number|undefined;for(let cycle=0;cycle<intent.beats;cycle+=4)for(let k=0;k<patterns.length;k++){const rb=cycle+patterns[k];if(rb>=intent.beats)continue;const abs=intent.startTime+rb*beat,rawStep=w.id==='rock_monster'?[0,0,3,0,2][k%5]:w.id==='salsa_party'?[0,3,1,4][k%4]:w.id==='weird_cabinet'?[0,4,-2,3][k%4]:[0,2,4,1][k%4],step=phase===3&&rb>=intent.beats-1?0:rawStep,pt=pointAt(mark,rb/Math.max(1,intent.beats)),m=midiForStep(w,p,intent,step,abs,total,prev,k===0,7);prev=m;out.push(event(m,rb*beat,beat*.62,.38+intent.energy*.18,{...extra(p,i,pt),articulation:k===0?'accent':'tenuto'}));}return out;}
function wildDrums(mark:CanvasMark,w:WorldConfig,p:Performer,i:number,intent:PhraseIntent,voiceOrdinal:number){const beat=beatSeconds(w),notes=p.drumNotes?.length?p.drumNotes:[36,38,42],out:NoteEvent[]=[],r=rng(intent.seed^0xD00D),phase=voiceOrdinal%4;const hit=(rb:number,index:number,v:number)=>{if(rb>=intent.beats)return;out.push(event(notes[((index%notes.length)+notes.length)%notes.length],rb*beat,beat*.10,v,extra(p,i,pointAt(mark,rb/Math.max(1,intent.beats)))));};for(let cycle=0;cycle<intent.beats;cycle+=4){if(w.id==='pop_star'){for(let x=0;x<4;x+=.5)hit(cycle+x,x%1===0?(x===0||x===2?0:1):2,.32+(x===0?.20:0));if(intent.energy>.65||phase===3){hit(cycle+2.75,3,.38);hit(cycle+3.5,4,.42);if(phase===3)hit(cycle+3.75,1,.52);}}else if(w.id==='rock_monster'){[0,.5,1,1.5,2,2.5,3,3.5].forEach((x,k)=>hit(cycle+x,k%2?2:(k===0||k===4?0:1),.37+(k===0||k===4?.19:0)));if(intent.energy>.6||phase===3){hit(cycle+1.75,3,.45);hit(cycle+3.75,4,.48);if(phase===3)hit(cycle+3.875,1,.56);}}else if(w.id==='salsa_party'){[0,.5,1,1.5,2,2.5,3,3.5].forEach((x,k)=>hit(cycle+x,k%notes.length,.32+(k===0||k===5?.14:0)));[1.25,2.75].forEach((x,k)=>hit(cycle+x,4+k,.38));if(phase===2)hit(cycle+3.75,6,.44);}else if(w.id==='drum_circle'){const rotation=Math.floor(r()*notes.length);for(let x=0;x<4;x+=.5){if(r()<.16&&x!==0)continue;hit(cycle+x,rotation+Math.round(x*2),.30+(x===0?.19:0)+r()*.07);}}else{[0,.75,1.5,2.25,3.25].forEach((x,k)=>hit(cycle+x,k,.28+r()*.20));if(intent.energy>.55||phase===3)hit(cycle+3.625,Math.floor(r()*notes.length),phase===3?.54:.46);}}return out.slice(0,24);}

function compileTraditional(mark:CanvasMark,w:WorldConfig,p:Performer,total:number,i:number,intent:PhraseIntent):CompileResult{let events:NoteEvent[],motif:PhraseMotif|undefined;if(p.role==='drums')events=traditionalDrums(mark,w,p,i,intent);else if(p.role==='bass')events=traditionalBass(mark,w,p,total,i,intent);else if(p.role==='harmony')events=traditionalHarmony(mark,w,p,total,i,intent);else{const m=traditionalMelody(mark,w,p,total,i,intent);events=m.events;motif=m.motif;}return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events},motif};}

export function compileMarkPhrase(mark:CanvasMark,w:WorldConfig,total:number,voiceOrdinal=0,previous?:PhraseMotif):CompileResult{const p=w.palette[mark.paletteIndex%w.palette.length],i=mark.paletteIndex%w.palette.length,intent=phraseIntent(mark,w,total),captured=capturedPerformancePhrase(mark,w,intent);if(captured)return captured;if(mark.tool==='stamp')return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:worldStampPhrase(mark,w,p,total,i,intent)}};if(w.id==='dreamland')return dreamPhrase(mark,w,p,total,i,intent);if(w.id==='tango'||w.id==='flamenco'||w.id==='zouk')return compileTraditional(mark,w,p,total,i,intent);if(p.role==='drums')return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:wildDrums(mark,w,p,i,intent,voiceOrdinal)}};if(p.role==='bass')return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:wildBass(mark,w,p,total,i,intent,voiceOrdinal)}};if(p.role==='harmony')return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:wildHarmony(mark,w,p,total,i,intent,voiceOrdinal)}};const m=wildMelody(mark,w,p,total,i,intent,previous,voiceOrdinal);return{phrase:{sourceMarkId:mark.id,startTime:intent.startTime,events:m.events},motif:m.motif};}
