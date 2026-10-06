import type { CanvasMark, Performer, WorldConfig } from './canvasTypes';

export type RelationshipKind='together'|'respond'|'harmonize';
export interface MarkRelationship { sourceId:string; targetId:string; kind:RelationshipKind; strength:number; }

type Bounds={minX:number;maxX:number;minY:number;maxY:number};
function bounds(mark:CanvasMark):Bounds{
  if(mark.bounds)return mark.bounds;
  if(mark.tool==='fill')return{minX:0,maxX:1,minY:0,maxY:1};
  const pts=mark.points.length?mark.points:[{x:.5,y:.5}];let minX=1,maxX=0,minY=1,maxY=0;
  for(const p of pts){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  const pad=(mark.tool==='stamp'||mark.tool==='boom'?.04:.014)*mark.size;return{minX:minX-pad,maxX:maxX+pad,minY:minY-pad,maxY:maxY+pad};
}
function overlapBounds(A:Bounds,B:Bounds){const ix=Math.max(0,Math.min(A.maxX,B.maxX)-Math.max(A.minX,B.minX)),iy=Math.max(0,Math.min(A.maxY,B.maxY)-Math.max(A.minY,B.minY));return ix*iy;}
function distanceBounds(A:Bounds,B:Bounds){const dx=Math.max(0,Math.max(A.minX-B.maxX,B.minX-A.maxX)),dy=Math.max(0,Math.max(A.minY-B.maxY,B.minY-A.maxY));return Math.hypot(dx*1.2,dy);}
function kindFor(a:Performer,b:Performer,overlap:number,world:WorldConfig):RelationshipKind{
  // Percussion has a finite key map. Spatial relationships can synchronize it,
  // but must never turn proximity into chromatic drum-note transposition.
  if(a.role==='drums'||b.role==='drums')return 'together';
  const mode=world.feel.interaction,hasHarmony=a.role==='harmony'||b.role==='harmony',hasBass=a.role==='bass'||b.role==='bass',hasHuman=a.role==='human'||b.role==='human';
  if(mode==='circle')return hasHuman?'respond':'together';
  if(mode==='float')return overlap>.002||hasHarmony?'harmonize':'respond';
  if(mode==='hook')return hasHarmony||overlap>.006?'harmonize':'respond';
  if(mode==='lock')return overlap>.002||hasBass||hasHarmony?'together':'respond';
  if(mode==='clave')return overlap>.008&&hasHarmony?'harmonize':'respond';
  if(mode==='odd')return overlap>.006?'harmonize':'respond';
  if(mode==='sway')return hasHarmony||overlap>.004?'harmonize':'respond';
  if(mode==='compas')return hasHuman?'respond':overlap>.004||hasHarmony?'harmonize':'respond';
  if(mode==='tension')return overlap>.003||hasHarmony?'harmonize':'respond';
  return overlap>.004||hasHarmony?'harmonize':'respond';
}
function pairRelations(a:CanvasMark,b:CanvasMark,world:WorldConfig,A=bounds(a),B=bounds(b)){
  const d=distanceBounds(A,B),reach=Math.max(.02,world.relationReach);if(d>reach)return[];
  const pa=world.palette[a.paletteIndex%world.palette.length],pb=world.palette[b.paletteIndex%world.palette.length],ov=overlapBounds(A,B),kind=kindFor(pa,pb,ov,world),strength=Math.max(.2,Math.min(1,1-d/reach+(ov>0?.18:0)));
  return kind==='respond'?[{sourceId:b.id,targetId:a.id,kind,strength}]:[{sourceId:a.id,targetId:b.id,kind,strength},{sourceId:b.id,targetId:a.id,kind,strength}];
}
function capBySource(rels:MarkRelationship[]){const bySource=new Map<string,MarkRelationship[]>();for(const rel of rels){const arr=bySource.get(rel.sourceId)||[];arr.push(rel);bySource.set(rel.sourceId,arr);}const out:MarkRelationship[]=[];for(const arr of bySource.values())out.push(...arr.sort((a,b)=>b.strength-a.strength).slice(0,3));return out;}

export function buildRelationshipGraph(marks:CanvasMark[],world:WorldConfig){
  if(marks.length<2)return[];
  const out:MarkRelationship[]=[],bs=marks.map(bounds);
  for(let i=0;i<marks.length-1;i++)for(let j=i+1;j<marks.length;j++){
    out.push(...pairRelations(marks[i],marks[j],world,bs[i],bs[j]));
  }
  return capBySource(out);
}
