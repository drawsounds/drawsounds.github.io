import type { NoteEvent, Phrase, Song } from '../audio/types';
import type { CanvasMark, CanvasPoint, CanvasTool, DrawTool, StampKind, WorldConfig, WorldId } from './canvasTypes';
import type { PhraseMotif } from './phraseEngine';
import { appendRelationshipGraph, buildRelationshipGraph, type MarkRelationship } from './relationships';
import { compileMarkPhrase, gestureStats, markBounds } from './phraseEngine';
import { WORLD_MAP, WORLDS } from './worlds/config';
export type { CanvasMark, CanvasPoint, CanvasTool, DrawTool, StampKind, WorldConfig, WorldId } from './canvasTypes';
export { WORLD_MAP, WORLDS } from './worlds/config';
export { createGestureStats, extendGestureStats } from './phraseEngine';
export { performFloodFill } from './floodFill';

function totalDuration(w:WorldConfig){return w.totalBeats*60/w.tempo;}

// Base phrases are immutable and cached. Adding a new mark recompiles only that
// voice's new phrase; old phrases are reused unless their own geometry or motif
// dependency changed. Relationship overlays are applied to clones below.
type CacheEntry={phrase:Phrase;motif?:PhraseMotif};
const phraseCache=new Map<string,CacheEntry>();
function cachePut(key:string,value:CacheEntry){phraseCache.set(key,value);if(phraseCache.size>768){const first=phraseCache.keys().next().value as string|undefined;if(first)phraseCache.delete(first);}}
function markFingerprint(mark:CanvasMark){const g=gestureStats(mark),b=markBounds(mark);return[mark.id,mark.paletteIndex,mark.tool,mark.stampKind??'',mark.seed,g.pointCount,g.startX.toFixed(3),g.startY.toFixed(3),g.lastX.toFixed(3),g.lastY.toFixed(3),g.totalDistance.toFixed(3),g.upDistance.toFixed(3),g.downDistance.toFixed(3),g.sumY.toFixed(3),g.directionChanges,g.minYIndex,g.maxYIndex,b.minX.toFixed(3),b.maxX.toFixed(3),b.minY.toFixed(3),b.maxY.toFixed(3)].join(':');}
function basePhrase(mark:CanvasMark,w:WorldConfig,total:number,voiceOrdinal:number,previous?:PhraseMotif){const key=`${w.id}|${markFingerprint(mark)}|${voiceOrdinal}|${previous?.signature??'-'}`;const hit=phraseCache.get(key);if(hit)return hit;const compiled=compileMarkPhrase(mark,w,total,voiceOrdinal,previous),entry={phrase:{...compiled.phrase,events:compiled.phrase.events.map(e=>({...e}))},motif:compiled.motif};cachePut(key,entry);return entry;}
function cleanPhrase(mark:CanvasMark,phrase:Phrase){const b=markBounds(mark),events=phrase.events.filter(e=>!mark.erasures?.some(h=>Math.hypot((e.canvasX??b.minX)-h.x,(e.canvasY??.5)-h.y)<(h.radius??.05)));return{...phrase,events:events.map(e=>({...e}))};}

let relationCache:{worldId:WorldId;ids:string[];rels:MarkRelationship[]}|null=null;
function relationshipsFor(marks:CanvasMark[],w:WorldConfig){
  const ids=marks.map(m=>m.id);
  if(relationCache?.worldId===w.id){
    const prev=relationCache.ids;
    if(ids.length===prev.length&&ids.every((id,i)=>id===prev[i]))return relationCache.rels;
    if(ids.length===prev.length+1&&prev.every((id,i)=>id===ids[i])){
      const rels=appendRelationshipGraph(relationCache.rels,marks,w);relationCache={worldId:w.id,ids,rels};return rels;
    }
    if(ids.length<prev.length&&ids.every((id,i)=>id===prev[i])){
      const keep=new Set(ids),rels=relationCache.rels.filter(r=>keep.has(r.sourceId)&&keep.has(r.targetId));relationCache={worldId:w.id,ids,rels};return rels;
    }
  }
  const rels=buildRelationshipGraph(marks,w);relationCache={worldId:w.id,ids,rels};return rels;
}

function relationshipEvents(rel:{kind:string;strength:number},source:Phrase,target:Phrase,w:WorldConfig){const out:NoteEvent[]=[];if(!source.events.length||!target.events.length)return out;const beat=60/w.tempo,traditional=w.id==='tango'||w.id==='flamenco'||w.id==='zouk',dream=w.id==='dreamland',base=source.events.slice(0,dream?2:traditional?3:5),targetStrong=target.events.slice(0,dream?2:traditional?3:5);if(rel.kind==='together'){
    base.slice(0,dream?1:traditional?2:4).forEach((e,k)=>{const t=targetStrong[k%targetStrong.length];out.push({...e,timeOffset:Math.max(0,(target.startTime+t.timeOffset)-source.startTime),duration:Math.min(e.duration,t.duration),velocity:e.velocity*(dream?.22:traditional?.30:.42)});});
  }else if(rel.kind==='harmonize'){
    base.slice(0,dream?1:traditional?2:4).forEach((e,k)=>{const t=targetStrong[k%targetStrong.length],interval=dream?(k%2?12:7):traditional?(k%2?3:7):(k%3===0?7:k%3===1?3:12);out.push({...e,midi:Math.max(0,Math.min(127,Math.round(t.midi+interval))),timeOffset:Math.max(0,(target.startTime+t.timeOffset)-source.startTime+(dream?beat*.45:.03)),duration:Math.min(e.duration*(dream?1.5:1),t.duration*(dream?1.8:1.1)),velocity:e.velocity*(dream?.20:traditional?.27:.39),articulation:dream?'legato':e.articulation});});
  }else{
    const take=dream?1:traditional?2:3,targetTail=target.events.slice(-take),sourceSeed=base.slice(0,take).reverse();targetTail.forEach((t,k)=>{const e=sourceSeed[k%sourceSeed.length],delay=dream?beat*.85:traditional?beat*.18:beat*(.12+k*.16),shift=dream?(k%2?7:0):traditional?0:(k%2?2:-1);out.push({...e,midi:Math.max(0,Math.min(127,e.midi+shift)),timeOffset:Math.max(0,(target.startTime+t.timeOffset+t.duration)-source.startTime+delay),duration:e.duration*(dream?1.35:traditional?.72:.62),velocity:e.velocity*(dream?.18:traditional?.30:.40),articulation:dream?'legato':e.articulation});});
  }return out;
}

export function freezeMark(mark:CanvasMark,_worldId:WorldId){const g=gestureStats(mark);return{...mark,points:mark.points.map(p=>({...p})),gesture:{...g},bounds:{...markBounds(mark)},erasures:mark.erasures?.map(e=>({...e}))};}
export function eraseMarkAt(mark:CanvasMark,p:CanvasPoint,_worldId:WorldId,radius=.05){if(mark.tool==='fill'){const b=mark.bounds||{minX:0,maxX:1,minY:0,maxY:1};if(p.x<b.minX-radius||p.x>b.maxX+radius||p.y<b.minY-radius||p.y>b.maxY+radius)return mark;const erasures=[...(mark.erasures||[]),{...p,radius}];if(erasures.length>8)return null;return{...mark,erasures};}if(mark.points.some(pt=>Math.hypot(pt.x-p.x,pt.y-p.y)<radius*1.2)){const erasures=[...(mark.erasures||[]),{...p,radius}],remaining=mark.points.filter(pt=>Math.hypot(pt.x-p.x,pt.y-p.y)>=radius);if(remaining.length<2)return null;return{...mark,erasures};}return mark;}
export function interpretMark(mark:CanvasMark,worldId:WorldId){const w=WORLD_MAP[worldId],total=totalDuration(w),compiled=compileMarkPhrase(mark,w,total,0);return cleanPhrase(mark,compiled.phrase);}

export function interpretCanvas(marks:CanvasMark[],worldId:WorldId):Song{
  const w=WORLD_MAP[worldId],total=totalDuration(w),motifs=new Map<number,PhraseMotif>(),ordinals=new Map<number,number>(),phrases:Phrase[]=[];
  for(const mark of marks){const voice=mark.paletteIndex%w.palette.length,ordinal=ordinals.get(voice)??0,previous=motifs.get(voice),compiled=basePhrase(mark,w,total,ordinal,previous);ordinals.set(voice,ordinal+1);if(compiled.motif)motifs.set(voice,compiled.motif);phrases.push(cleanPhrase(mark,compiled.phrase));}
  const byId=new Map(phrases.map(p=>[p.sourceMarkId,p]));
  for(const rel of relationshipsFor(marks,w)){const src=byId.get(rel.sourceId),tar=byId.get(rel.targetId);if(src&&tar)src.events.push(...relationshipEvents(rel,src,tar,w));}
  // Hard bound protects the scheduler from pathological canvases while leaving
  // normal phrase density untouched. The phrase compiler itself is already small.
  for(const phrase of phrases){phrase.events=phrase.events.filter(e=>Number.isFinite(e.timeOffset)&&Number.isFinite(e.midi)).sort((a,b)=>a.timeOffset-b.timeOffset).slice(0,40);}
  return{worldId,baseTempo:w.tempo,totalDuration:total,phrases};
}
export function randomWorld(exclude?:WorldId):WorldId{const pool=exclude?WORLDS.filter(w=>w.id!==exclude):WORLDS;return pool[Math.floor(Math.random()*pool.length)].id;}
