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
function kindFor(a:Performer,b:Performer,overlap:number):RelationshipKind{
  // Percussion has a finite key map. Spatial relationships can synchronize it,
  // but must never turn proximity into chromatic drum-note transposition.
  if(a.role==='drums'||b.role==='drums')return 'together';
  if(overlap>.004)return 'harmonize';
  if(a.role==='harmony'||b.role==='harmony')return 'harmonize';
  return 'respond';
}
function pairRelations(a:CanvasMark,b:CanvasMark,world:WorldConfig,A=bounds(a),B=bounds(b)){
  const d=distanceBounds(A,B),reach=Math.max(.02,world.relationReach);if(d>reach)return[];
  const pa=world.palette[a.paletteIndex%world.palette.length],pb=world.palette[b.paletteIndex%world.palette.length],ov=overlapBounds(A,B),kind=kindFor(pa,pb,ov),strength=Math.max(.2,Math.min(1,1-d/reach+(ov>0?.18:0)));
  return kind==='respond'?[{sourceId:b.id,targetId:a.id,kind,strength}]:[{sourceId:a.id,targetId:b.id,kind,strength},{sourceId:b.id,targetId:a.id,kind,strength}];
}
function capBySource(rels:MarkRelationship[]){const bySource=new Map<string,MarkRelationship[]>();for(const rel of rels){const arr=bySource.get(rel.sourceId)||[];arr.push(rel);bySource.set(rel.sourceId,arr);}const out:MarkRelationship[]=[];for(const arr of bySource.values())out.push(...arr.sort((a,b)=>b.strength-a.strength).slice(0,3));return out;}

/** Initial spatial-bucket build. Each source keeps only its three strongest
 * musical relationships, which also bounds phrase-overlay work. */
export function buildRelationshipGraph(marks:CanvasMark[],world:WorldConfig){
  if(marks.length<2)return[];
  const out:MarkRelationship[]=[],reach=Math.max(.02,world.relationReach),cell=Math.max(.055,reach*1.35),cols=Math.ceil(1/cell),rows=cols,bs=marks.map(bounds),buckets=new Map<number,number[]>();
  for(let i=0;i<marks.length;i++){const b=bs[i],minX=Math.max(0,Math.floor((b.minX-reach)/cell)),maxX=Math.min(cols-1,Math.floor((b.maxX+reach)/cell)),minY=Math.max(0,Math.floor((b.minY-reach)/cell)),maxY=Math.min(rows-1,Math.floor((b.maxY+reach)/cell));for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const key=y*cols+x,arr=buckets.get(key)||[];arr.push(i);buckets.set(key,arr);}}
  const pairs=new Set<number>(),n=marks.length;for(const bucket of buckets.values())for(let a=0;a<bucket.length;a++)for(let b=a+1;b<bucket.length;b++){const i=bucket[a],j=bucket[b],lo=Math.min(i,j),hi=Math.max(i,j);pairs.add(lo*n+hi);}
  for(const pair of pairs){const i=Math.floor(pair/n),j=pair%n;out.push(...pairRelations(marks[i],marks[j],world,bs[i],bs[j]));}
  return capBySource(out);
}

/** Append-only fast path. Existing mark geometry is immutable, so adding one
 * mark only creates relationships touching that mark. Merging and re-capping
 * can displace a weaker old relationship without rebuilding the whole graph. */
export function appendRelationshipGraph(previous:MarkRelationship[],marks:CanvasMark[],world:WorldConfig){
  if(marks.length<2)return[];const newest=marks[marks.length-1],fresh:MarkRelationship[]=[];for(let i=0;i<marks.length-1;i++)fresh.push(...pairRelations(marks[i],newest,world));return capBySource([...previous,...fresh]);
}
