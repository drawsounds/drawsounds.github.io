import type { CanvasMark, Performer, WorldConfig } from './canvasTypes';

export type RelationshipKind='together'|'respond'|'harmonize';
export interface MarkRelationship { sourceId:string; targetId:string; kind:RelationshipKind; strength:number; }

function bounds(mark:CanvasMark){
  if(mark.tool==='fill')return{minX:0,maxX:1,minY:0,maxY:1};
  const pts=mark.points.length?mark.points:[{x:.5,y:.5}];let minX=1,maxX=0,minY=1,maxY=0;
  for(const p of pts){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  const pad=(mark.tool==='stamp'||mark.tool==='boom'?.04:.014)*mark.size;return{minX:minX-pad,maxX:maxX+pad,minY:minY-pad,maxY:maxY+pad};
}
function overlapAmount(a:CanvasMark,b:CanvasMark){const A=bounds(a),B=bounds(b);const ix=Math.max(0,Math.min(A.maxX,B.maxX)-Math.max(A.minX,B.minX)),iy=Math.max(0,Math.min(A.maxY,B.maxY)-Math.max(A.minY,B.minY));return ix*iy;}
function distance(a:CanvasMark,b:CanvasMark){const A=bounds(a),B=bounds(b);const dx=Math.max(0,Math.max(A.minX-B.maxX,B.minX-A.maxX)),dy=Math.max(0,Math.max(A.minY-B.maxY,B.minY-A.maxY));return Math.hypot(dx*1.2,dy);}
function kindFor(a:Performer,b:Performer,overlap:number):RelationshipKind{
  if(overlap>.004)return 'harmonize';
  if((a.role==='drums'&&b.role==='bass')||(b.role==='drums'&&a.role==='bass'))return 'together';
  if(a.role==='harmony'||b.role==='harmony')return 'harmonize';
  return 'respond';
}
export function buildRelationshipGraph(marks:CanvasMark[],world:WorldConfig){
  const out:MarkRelationship[]=[];const bySource=new Map<string,MarkRelationship[]>();
  for(let i=0;i<marks.length;i++)for(let j=i+1;j<marks.length;j++){
    const a=marks[i],b=marks[j],d=distance(a,b);if(d>world.relationReach)continue;
    const pa=world.palette[a.paletteIndex%world.palette.length],pb=world.palette[b.paletteIndex%world.palette.length],ov=overlapAmount(a,b),kind=kindFor(pa,pb,ov),strength=Math.max(.2,Math.min(1,1-d/world.relationReach+(ov>0?.18:0)));
    const rels:MarkRelationship[]=kind==='respond'?[{sourceId:b.id,targetId:a.id,kind,strength}]:[{sourceId:a.id,targetId:b.id,kind,strength},{sourceId:b.id,targetId:a.id,kind,strength}];
    for(const r of rels){const arr=bySource.get(r.sourceId)||[];arr.push(r);bySource.set(r.sourceId,arr);}
  }
  for(const arr of bySource.values())out.push(...arr.sort((a,b)=>b.strength-a.strength).slice(0,3));
  return out;
}
