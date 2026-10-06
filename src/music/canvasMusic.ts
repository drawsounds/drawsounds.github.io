import type { NoteEvent, Phrase, Song } from '../audio/types';
import type { CanvasMark, CanvasPoint, CanvasTool, DrawTool, StampKind, WorldConfig, WorldId } from './canvasTypes';
import type { PhraseMotif } from './phraseEngine';
import { buildRelationshipGraph } from './relationships';
import { compileMarkPhrase, gestureStats, markBounds } from './phraseEngine';
import { WORLD_MAP, WORLDS } from './worlds/config';
export type { CanvasMark, CanvasPoint, CanvasTool, DrawTool, StampKind, WorldConfig, WorldId } from './canvasTypes';
export { WORLD_MAP, WORLDS } from './worlds/config';
export { createGestureStats, extendGestureStats } from './phraseEngine';
export { performFloodFill } from './floodFill';

function totalDuration(w:WorldConfig){return w.totalBeats*60/w.tempo;}

// Cache immutable base phrases; relationship overlays are applied afterward.
type CacheEntry={phrase:Phrase;motif?:PhraseMotif};
const phraseCache=new Map<string,CacheEntry>();
function cachePut(key:string,value:CacheEntry){phraseCache.set(key,value);if(phraseCache.size>768){const first=phraseCache.keys().next().value as string|undefined;if(first)phraseCache.delete(first);}}
function basePhrase(mark:CanvasMark,w:WorldConfig,total:number,voiceOrdinal:number,previous?:PhraseMotif){
  const key=`${w.id}|${mark.id}|${voiceOrdinal}|${previous?.signature??'-'}`;
  const hit=phraseCache.get(key);if(hit)return hit;
  const compiled=compileMarkPhrase(mark,w,total,voiceOrdinal,previous),entry={phrase:{...compiled.phrase,events:compiled.phrase.events.map(e=>({...e}))},motif:compiled.motif};cachePut(key,entry);return entry;
}
function cleanPhrase(mark:CanvasMark,phrase:Phrase){
  const b=markBounds(mark),holes=mark.erasures;
  const events=!holes?.length?phrase.events:phrase.events.filter(e=>{
    const x=e.canvasX??b.minX,y=e.canvasY??.5;
    for(const h of holes){const dx=x-h.x,dy=y-h.y,r=h.radius??.05;if(dx*dx+dy*dy<r*r)return false;}
    return true;
  });
  return{...phrase,events:events.map(e=>({...e}))};
}

function relationshipEvents(rel:{kind:string;strength:number},source:Phrase,target:Phrase,w:WorldConfig){
  const out:NoteEvent[]=[];if(!source.events.length||!target.events.length)return out;
  const beat=60/w.tempo,mode=w.feel.interaction;
  const profiles={
    float:{take:1,together:.20,harm:.19,respond:.17,delay:.82,intervals:[7,12],shifts:[0,7],dur:1.35},
    circle:{take:3,together:.48,harm:.28,respond:.38,delay:.12,intervals:[7,12],shifts:[0,0,0],dur:.72},
    hook:{take:3,together:.40,harm:.34,respond:.34,delay:.22,intervals:[7,4,12],shifts:[2,0,2],dur:.78},
    lock:{take:4,together:.50,harm:.31,respond:.36,delay:.08,intervals:[12,7],shifts:[0,0,-2],dur:.58},
    clave:{take:3,together:.47,harm:.28,respond:.38,delay:.28,intervals:[3,7],shifts:[0,2,-1],dur:.70},
    odd:{take:2,together:.32,harm:.31,respond:.32,delay:.41,intervals:[6,11,3],shifts:[5,-2,3],dur:.92},
    sway:{take:2,together:.36,harm:.29,respond:.31,delay:.36,intervals:[3,7],shifts:[0,2],dur:.96},
    compas:{take:2,together:.42,harm:.27,respond:.32,delay:.18,intervals:[3,7],shifts:[0,0],dur:.70},
    tension:{take:2,together:.38,harm:.29,respond:.31,delay:.16,intervals:[3,7,10],shifts:[-1,2,0],dur:.76},
  } as const;
  const profile=profiles[mode],base=source.events.slice(0,profile.take),targetStrong=target.events.slice(0,profile.take);
  if(rel.kind==='together'){
    base.forEach((e,k)=>{const t=targetStrong[k%targetStrong.length];out.push({...e,timeOffset:Math.max(0,(target.startTime+t.timeOffset)-source.startTime),duration:Math.min(e.duration,t.duration)*profile.dur,velocity:e.velocity*profile.together});});
  }else if(rel.kind==='harmonize'){
    base.forEach((e,k)=>{const t=targetStrong[k%targetStrong.length],interval=profile.intervals[k%profile.intervals.length];out.push({...e,midi:Math.max(0,Math.min(127,Math.round(t.midi+interval))),timeOffset:Math.max(0,(target.startTime+t.timeOffset)-source.startTime+(mode==='float'?beat*.45:.03)),duration:Math.min(e.duration,t.duration*1.1)*profile.dur,velocity:e.velocity*profile.harm,articulation:mode==='float'?'legato':e.articulation});});
  }else{
    const targetTail=target.events.slice(-profile.take),sourceSeed=base.slice().reverse();
    targetTail.forEach((t,k)=>{const e=sourceSeed[k%sourceSeed.length],shift=profile.shifts[k%profile.shifts.length],delay=beat*(profile.delay+(mode==='clave'&&k%2?.18:mode==='odd'?k*.11:0));out.push({...e,midi:Math.max(0,Math.min(127,e.midi+shift)),timeOffset:Math.max(0,(target.startTime+t.timeOffset+t.duration)-source.startTime+delay),duration:e.duration*profile.dur,velocity:e.velocity*profile.respond,articulation:mode==='float'?'legato':e.articulation});});
  }
  return out;
}

export function freezeMark(mark:CanvasMark){const g=gestureStats(mark);return{...mark,points:mark.points.map(p=>({...p})),gesture:{...g},bounds:{...markBounds(mark)},erasures:mark.erasures?.map(e=>({...e})),performance:mark.performance?{...mark.performance,events:mark.performance.events.map(e=>({...e}))}:undefined};}
export function eraseMarkAt(mark:CanvasMark,p:CanvasPoint,radius=.05){
  const b=mark.bounds;
  // Reject distant eraser samples before scanning stroke points.
  if(b&& (p.x<b.minX-radius||p.x>b.maxX+radius||p.y<b.minY-radius||p.y>b.maxY+radius))return mark;
  if(mark.tool==='fill'){
    const fb=b||{minX:0,maxX:1,minY:0,maxY:1};
    if(p.x<fb.minX-radius||p.x>fb.maxX+radius||p.y<fb.minY-radius||p.y>fb.maxY+radius)return mark;
    const erasures=[...(mark.erasures||[]),{...p,radius}];if(erasures.length>8)return null;return{...mark,erasures};
  }
  const hitRadius=radius*1.2,hitRadius2=hitRadius*hitRadius;
  let hit=false;
  for(const pt of mark.points){const dx=pt.x-p.x,dy=pt.y-p.y;if(dx*dx+dy*dy<hitRadius2){hit=true;break;}}
  if(!hit)return mark;
  const radius2=radius*radius,remaining=mark.points.filter(pt=>{const dx=pt.x-p.x,dy=pt.y-p.y;return dx*dx+dy*dy>=radius2;});
  const erasures=[...(mark.erasures||[]),{...p,radius}];if(remaining.length<2)return null;return{...mark,erasures};
}
export function interpretMark(mark:CanvasMark,worldId:WorldId){const w=WORLD_MAP[worldId],total=totalDuration(w),compiled=compileMarkPhrase(mark,w,total,0);return cleanPhrase(mark,compiled.phrase);}

export function interpretCanvas(marks:CanvasMark[],worldId:WorldId):Song{
  const w=WORLD_MAP[worldId],total=totalDuration(w),motifs=new Map<number,PhraseMotif>(),ordinals=new Map<number,number>(),phrases:Phrase[]=[];
  for(const mark of marks){const voice=mark.paletteIndex%w.palette.length,ordinal=ordinals.get(voice)??0,previous=motifs.get(voice),compiled=basePhrase(mark,w,total,ordinal,previous);ordinals.set(voice,ordinal+1);if(compiled.motif)motifs.set(voice,compiled.motif);phrases.push(cleanPhrase(mark,compiled.phrase));}
  const byId=new Map(phrases.map(p=>[p.sourceMarkId,p]));
  for(const rel of buildRelationshipGraph(marks,w)){const src=byId.get(rel.sourceId),tar=byId.get(rel.targetId);if(src&&tar)src.events.push(...relationshipEvents(rel,src,tar,w));}
  // Captured performances keep a higher event ceiling than generated phrases.
  const capturedIds=new Set<string>();for(const mark of marks)if(mark.performance?.worldId===worldId&&mark.performance.events.length)capturedIds.add(mark.id);
  for(const phrase of phrases){
    const cap=capturedIds.has(phrase.sourceMarkId)?192:40;
    phrase.events=phrase.events.filter(e=>Number.isFinite(e.timeOffset)&&Number.isFinite(e.midi)).sort((a,b)=>a.timeOffset-b.timeOffset).slice(0,cap);
  }
  return{worldId,baseTempo:w.tempo,totalDuration:total,phrases};
}
export function randomWorld(exclude?:WorldId):WorldId{const pool=exclude?WORLDS.filter(w=>w.id!==exclude):WORLDS;return pool[Math.floor(Math.random()*pool.length)].id;}
