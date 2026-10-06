import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bomb, Eraser, PaintBucket, Pause, Pencil, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { transport } from './audio/engine';
import { TransportState } from './audio/types';
import {
  CanvasMark,
  CanvasPoint,
  CanvasTool,
  StampKind,
  WORLD_MAP,
  WORLDS,
  WorldId,
  createGestureStats,
  eraseMarkAt,
  extendGestureStats,
  freezeMark,
  interpretCanvas,
  interpretMark,
  performFloodFill,
  randomWorld,
  recolorFillDataUrl,
} from './music/canvasMusic';

function initialTransport(): TransportState { return {isPlaying:false,isPreparing:false,currentTime:0,totalDuration:0}; }

const TOOLS: {id:CanvasTool; label:string}[] = [
  {id:'crayon',label:'Crayon'},
  {id:'dots',label:'Dots'},
  {id:'spray',label:'Spray'},
  {id:'stamp',label:'Animal Stamp'},
  {id:'boom',label:'Boom'},
  {id:'fill',label:'Fill'},
  {id:'eraser',label:'Eraser'},
];
type CanvasFx = {id:string;x:number;y:number;color:string;ink:string;kind:'scribble'|'stamp'|'boom'|'fill';seed:number;stampKind?:StampKind};
function seeded(seed:number){let s=seed||1;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function markBounds(mark:CanvasMark){
  if(mark.bounds) return mark.bounds;
  const pts=mark.points.length?mark.points:[{x:.5,y:.5}];let minX=1,maxX=0,minY=1,maxY=0;
  pts.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
  const pad=(mark.tool==='boom'||mark.tool==='stamp'?.05:.014)*mark.size;
  return {minX:Math.max(0,minX-pad),maxX:Math.min(1,maxX+pad),minY:Math.max(0,minY-pad),maxY:Math.min(1,maxY+pad)};
}
function pathFrom(points:CanvasPoint[],dx=0,dy=0){if(!points.length)return'';if(points.length===1)return`M ${points[0].x*1000+dx} ${points[0].y*700+dy} l .01 .01`;return points.map((p,i)=>`${i?'L':'M'} ${p.x*1000+dx} ${p.y*700+dy}`).join(' ');}
function starPoints(cx:number,cy:number,r:number,n=5){const pts:string[]=[];for(let i=0;i<n*2;i++){const a=-Math.PI/2+i*Math.PI/n,rr=i%2===0?r:r*.43;pts.push(`${cx+Math.cos(a)*rr},${cy+Math.sin(a)*rr}`);}return pts.join(' ');}

function CuteStamp({kind,cx,cy,r,color,ink}:{kind:StampKind;cx:number;cy:number;r:number;color:string;ink:string}){
  if(kind==='cat'){
    return <g>
      <path d={`M ${cx-r*.62} ${cy-r*.26} L ${cx-r*.58} ${cy-r*.94} L ${cx-r*.16} ${cy-r*.58} Q ${cx} ${cy-r*.68} ${cx+r*.16} ${cy-r*.58} L ${cx+r*.58} ${cy-r*.94} L ${cx+r*.62} ${cy-r*.26} Q ${cx+r*.74} ${cy+r*.66} ${cx} ${cy+r*.72} Q ${cx-r*.74} ${cy+r*.66} ${cx-r*.62} ${cy-r*.26} Z`} fill={color}/>
      <polygon points={`${cx-r*.46},${cy-r*.36} ${cx-r*.46},${cy-r*.76} ${cx-r*.22},${cy-r*.52}`} fill={ink} opacity=".25"/>
      <polygon points={`${cx+r*.46},${cy-r*.36} ${cx+r*.46},${cy-r*.76} ${cx+r*.22},${cy-r*.52}`} fill={ink} opacity=".25"/>
      <circle cx={cx-r*.38} cy={cy+r*.22} r={r*.13} fill={ink} opacity=".15"/>
      <circle cx={cx+r*.38} cy={cy+r*.22} r={r*.13} fill={ink} opacity=".15"/>
      <circle cx={cx-r*.24} cy={cy-r*.06} r={r*.085} fill={ink}/>
      <circle cx={cx-r*.21} cy={cy-r*.09} r={r*.03} fill="#fff"/>
      <circle cx={cx+r*.24} cy={cy-r*.06} r={r*.085} fill={ink}/>
      <circle cx={cx+r*.27} cy={cy-r*.09} r={r*.03} fill="#fff"/>
      <polygon points={`${cx-r*.07},${cy+r*.10} ${cx+r*.07},${cy+r*.10} ${cx},${cy+r*.18}`} fill={ink}/>
      <path d={`M ${cx-r*.14} ${cy+r*.25} Q ${cx-r*.07} ${cy+r*.34} ${cx} ${cy+r*.24} Q ${cx+r*.07} ${cy+r*.34} ${cx+r*.14} ${cy+r*.25}`} fill="none" stroke={ink} strokeWidth={Math.max(1.8,r*.05)} strokeLinecap="round"/>
      {[-1,1].map(side=><g key={side}>
        <path d={`M ${cx+side*r*.20} ${cy+r*.15} L ${cx+side*r*.72} ${cy+r*.08}`} stroke={ink} strokeWidth={Math.max(1.5,r*.035)} strokeLinecap="round"/>
        <path d={`M ${cx+side*r*.20} ${cy+r*.24} L ${cx+side*r*.74} ${cy+r*.26}`} stroke={ink} strokeWidth={Math.max(1.5,r*.035)} strokeLinecap="round"/>
      </g>)}
    </g>;
  }
  if(kind==='bunny'){
    return <g>
      <path d={`M ${cx-r*.36} ${cy-r*.16} C ${cx-r*.54} ${cy-r*.95}, ${cx-r*.20} ${cy-r*1.12}, ${cx-r*.06} ${cy-r*.34} Z`} fill={color}/>
      <path d={`M ${cx-r*.32} ${cy-r*.22} C ${cx-r*.44} ${cy-r*.88}, ${cx-r*.20} ${cy-r*1.0}, ${cx-r*.10} ${cy-r*.34} Z`} fill={ink} opacity=".25"/>
      <path d={`M ${cx+r*.36} ${cy-r*.16} C ${cx+r*.54} ${cy-r*.95}, ${cx+r*.20} ${cy-r*1.12}, ${cx+r*.06} ${cy-r*.34} Z`} fill={color}/>
      <path d={`M ${cx+r*.32} ${cy-r*.22} C ${cx+r*.44} ${cy-r*.88}, ${cx+r*.20} ${cy-r*1.0}, ${cx+r*.10} ${cy-r*.34} Z`} fill={ink} opacity=".25"/>
      <ellipse cx={cx} cy={cy+r*.20} rx={r*.68} ry={r*.56} fill={color}/>
      <circle cx={cx-r*.38} cy={cy+r*.28} r={r*.14} fill={ink} opacity=".18"/>
      <circle cx={cx+r*.38} cy={cy+r*.28} r={r*.14} fill={ink} opacity=".18"/>
      <ellipse cx={cx-r*.24} cy={cy+r*.05} rx={r*.08} ry={r*.10} fill={ink}/>
      <circle cx={cx-r*.21} cy={cy+r*.01} r={r*.035} fill="#fff"/>
      <ellipse cx={cx+r*.24} cy={cy+r*.05} rx={r*.08} ry={r*.10} fill={ink}/>
      <circle cx={cx+r*.27} cy={cy+r*.01} r={r*.035} fill="#fff"/>
      <ellipse cx={cx} cy={cy+r*.20} rx={r*.07} ry={r*.05} fill={ink}/>
      <path d={`M ${cx-r*.12} ${cy+r*.30} Q ${cx-r*.06} ${cy+r*.38} ${cx} ${cy+r*.28} Q ${cx+r*.06} ${cy+r*.38} ${cx+r*.12} ${cy+r*.30}`} fill="none" stroke={ink} strokeWidth={Math.max(1.8,r*.05)} strokeLinecap="round"/>
    </g>;
  }
  if(kind==='bear'){
    return <g>
      <circle cx={cx-r*.52} cy={cy-r*.42} r={r*.26} fill={color}/>
      <circle cx={cx-r*.52} cy={cy-r*.42} r={r*.14} fill={ink} opacity=".25"/>
      <circle cx={cx+r*.52} cy={cy-r*.42} r={r*.26} fill={color}/>
      <circle cx={cx+r*.52} cy={cy-r*.42} r={r*.14} fill={ink} opacity=".25"/>
      <circle cx={cx} cy={cy+r*.08} r={r*.66} fill={color}/>
      <ellipse cx={cx} cy={cy+r*.26} rx={r*.30} ry={r*.22} fill={ink} opacity=".14"/>
      <ellipse cx={cx} cy={cy+r*.18} rx={r*.11} ry={r*.08} fill={ink}/>
      <path d={`M ${cx} ${cy+r*.25} L ${cx} ${cy+r*.34} M ${cx-r*.12} ${cy+r*.33} Q ${cx} ${cy+r*.44} ${cx+r*.12} ${cy+r*.33}`} fill="none" stroke={ink} strokeWidth={Math.max(1.8,r*.05)} strokeLinecap="round"/>
      <circle cx={cx-r*.25} cy={cy} r={r*.085} fill={ink}/>
      <circle cx={cx-r*.22} cy={cy-r*.03} r={r*.03} fill="#fff"/>
      <circle cx={cx+r*.25} cy={cy} r={r*.085} fill={ink}/>
      <circle cx={cx+r*.28} cy={cy-r*.03} r={r*.03} fill="#fff"/>
      <circle cx={cx-r*.38} cy={cy+r*.22} r={r*.12} fill={ink} opacity=".15"/>
      <circle cx={cx+r*.38} cy={cy+r*.22} r={r*.12} fill={ink} opacity=".15"/>
    </g>;
  }
  if(kind==='frog'){
    return <g>
      <circle cx={cx-r*.40} cy={cy-r*.28} r={r*.30} fill={color}/>
      <circle cx={cx+r*.40} cy={cy-r*.28} r={r*.30} fill={color}/>
      <ellipse cx={cx} cy={cy+r*.18} rx={r*.75} ry={r*.54} fill={color}/>
      <circle cx={cx-r*.40} cy={cy-r*.28} r={r*.14} fill={ink}/>
      <circle cx={cx-r*.36} cy={cy-r*.32} r={r*.05} fill="#fff"/>
      <circle cx={cx+r*.40} cy={cy-r*.28} r={r*.14} fill={ink}/>
      <circle cx={cx+r*.44} cy={cy-r*.32} r={r*.05} fill="#fff"/>
      <circle cx={cx-r*.07} cy={cy+r*.08} r={r*.025} fill={ink} opacity=".6"/>
      <circle cx={cx+r*.07} cy={cy+r*.08} r={r*.025} fill={ink} opacity=".6"/>
      <path d={`M ${cx-r*.44} ${cy+r*.18} Q ${cx} ${cy+r*.55} ${cx+r*.44} ${cy+r*.18}`} fill="none" stroke={ink} strokeWidth={Math.max(2.2,r*.065)} strokeLinecap="round"/>
      <ellipse cx={cx-r*.46} cy={cy+r*.28} rx={r*.12} ry={r*.08} fill={ink} opacity=".22"/>
      <ellipse cx={cx+r*.46} cy={cy+r*.28} rx={r*.12} ry={r*.08} fill={ink} opacity=".22"/>
    </g>;
  }
  if(kind==='panda'){
    return <g>
      <circle cx={cx-r*.52} cy={cy-r*.44} r={r*.24} fill={ink}/>
      <circle cx={cx+r*.52} cy={cy-r*.44} r={r*.24} fill={ink}/>
      <circle cx={cx} cy={cy+r*.08} r={r*.66} fill={color}/>
      <g transform={`rotate(-18 ${cx-r*.26} ${cy-r*.02})`}><ellipse cx={cx-r*.26} cy={cy-r*.02} rx={r*.16} ry={r*.22} fill={ink}/></g>
      <g transform={`rotate(18 ${cx+r*.26} ${cy-r*.02})`}><ellipse cx={cx+r*.26} cy={cy-r*.02} rx={r*.16} ry={r*.22} fill={ink}/></g>
      <circle cx={cx-r*.23} cy={cy-r*.02} r={r*.06} fill="#fff"/>
      <circle cx={cx-r*.21} cy={cy-r*.02} r={r*.03} fill={ink}/>
      <circle cx={cx+r*.23} cy={cy-r*.02} r={r*.06} fill="#fff"/>
      <circle cx={cx+r*.21} cy={cy-r*.02} r={r*.03} fill={ink}/>
      <ellipse cx={cx} cy={cy+r*.20} rx={r*.11} ry={r*.07} fill={ink}/>
      <path d={`M ${cx-r*.12} ${cy+r*.32} Q ${cx-r*.05} ${cy+r*.40} ${cx} ${cy+r*.28} Q ${cx+r*.05} ${cy+r*.40} ${cx+r*.12} ${cy+r*.32}`} fill="none" stroke={ink} strokeWidth={Math.max(1.8,r*.05)} strokeLinecap="round"/>
      <circle cx={cx-r*.42} cy={cy+r*.26} r={r*.12} fill={ink} opacity=".14"/>
      <circle cx={cx+r*.42} cy={cy+r*.26} r={r*.12} fill={ink} opacity=".14"/>
    </g>;
  }
  if(kind==='puppy'){
    return <g>
      <path d={`M ${cx-r*.42} ${cy-r*.32} Q ${cx-r*.88} ${cy} ${cx-r*.68} ${cy+r*.52} Q ${cx-r*.42} ${cy+r*.55} ${cx-r*.35} ${cy+r*.12} Z`} fill={color}/>
      <path d={`M ${cx-r*.40} ${cy-r*.24} Q ${cx-r*.78} ${cy} ${cx-r*.62} ${cy+r*.42} Q ${cx-r*.44} ${cy+r*.44} ${cx-r*.36} ${cy+r*.12} Z`} fill={ink} opacity=".2"/>
      <path d={`M ${cx+r*.42} ${cy-r*.32} Q ${cx+r*.88} ${cy} ${cx+r*.68} ${cy+r*.52} Q ${cx+r*.42} ${cy+r*.55} ${cx+r*.35} ${cy+r*.12} Z`} fill={color}/>
      <path d={`M ${cx+r*.40} ${cy-r*.24} Q ${cx+r*.78} ${cy} ${cx+r*.62} ${cy+r*.42} Q ${cx+r*.44} ${cy+r*.44} ${cx+r*.36} ${cy+r*.12} Z`} fill={ink} opacity=".2"/>
      <circle cx={cx} cy={cy+r*.06} r={r*.62} fill={color}/>
      <ellipse cx={cx} cy={cy+r*.24} rx={r*.30} ry={r*.20} fill={ink} opacity=".12"/>
      <ellipse cx={cx} cy={cy+r*.16} rx={r*.12} ry={r*.085} fill={ink}/>
      <path d={`M ${cx-r*.14} ${cy+r*.28} Q ${cx} ${cy+r*.38} ${cx+r*.14} ${cy+r*.28}`} fill="none" stroke={ink} strokeWidth={Math.max(1.8,r*.05)} strokeLinecap="round"/>
      <path d={`M ${cx-r*.06} ${cy+r*.32} Q ${cx} ${cy+r*.48} ${cx+r*.06} ${cy+r*.32} Z`} fill={ink} opacity=".4"/>
      <ellipse cx={cx-r*.22} cy={cy-r*.02} rx={r*.085} ry={r*.10} fill={ink}/>
      <circle cx={cx-r*.19} cy={cy-r*.05} r={r*.035} fill="#fff"/>
      <ellipse cx={cx+r*.22} cy={cy-r*.02} rx={r*.085} ry={r*.10} fill={ink}/>
      <circle cx={cx+r*.25} cy={cy-r*.05} r={r*.035} fill="#fff"/>
    </g>;
  }
  if(kind==='chick'){
    return <g>
      <path d={`M ${cx-r*.1} ${cy-r*.58} Q ${cx} ${cy-r*.88} ${cx+r*.08} ${cy-r*.62} Q ${cx+r*.18} ${cy-r*.85} ${cx+r*.20} ${cy-r*.52}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.06)} strokeLinecap="round"/>
      <circle cx={cx} cy={cy+r*.1} r={r*.66} fill={color}/>
      <path d={`M ${cx-r*.58} ${cy+r*.12} Q ${cx-r*.78} ${cy+r*.32} ${cx-r*.52} ${cy+r*.44}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.06)} strokeLinecap="round"/>
      <path d={`M ${cx+r*.58} ${cy+r*.12} Q ${cx+r*.78} ${cy+r*.32} ${cx+r*.52} ${cy+r*.44}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.06)} strokeLinecap="round"/>
      <circle cx={cx-r*.24} cy={cy+r*.02} r={r*.085} fill={ink}/>
      <circle cx={cx-r*.21} cy={cy-r*.02} r={r*.03} fill="#fff"/>
      <circle cx={cx+r*.24} cy={cy+r*.02} r={r*.085} fill={ink}/>
      <circle cx={cx+r*.27} cy={cy-r*.02} r={r*.03} fill="#fff"/>
      <polygon points={`${cx-r*.12},${cy+r*.14} ${cx+r*.12},${cy+r*.14} ${cx},${cy+r*.30}`} fill={ink}/>
      <circle cx={cx-r*.38} cy={cy+r*.20} r={r*.12} fill={ink} opacity=".2"/>
      <circle cx={cx+r*.38} cy={cy+r*.20} r={r*.12} fill={ink} opacity=".2"/>
    </g>;
  }
  if(kind==='fox'){
    return <g>
      <path d={`M ${cx-r*.24} ${cy-r*.38} L ${cx-r*.65} ${cy-r*.94} L ${cx-r*.48} ${cy-r*.18} Q ${cx-r*.82} ${cy+r*.18} ${cx-r*.44} ${cy+r*.46} L ${cx} ${cy+r*.72} L ${cx+r*.44} ${cy+r*.46} Q ${cx+r*.82} ${cy+r*.18} ${cx+r*.48} ${cy-r*.18} L ${cx+r*.65} ${cy-r*.94} L ${cx+r*.24} ${cy-r*.38} Z`} fill={color}/>
      <polygon points={`${cx-r*.52},${cy-r*.36} ${cx-r*.56},${cy-r*.84} ${cx-r*.32},${cy-r*.48}`} fill={ink} opacity=".28"/>
      <polygon points={`${cx+r*.52},${cy-r*.36} ${cx+r*.56},${cy-r*.84} ${cx+r*.32},${cy-r*.48}`} fill={ink} opacity=".28"/>
      <polygon points={`${cx-r*.08},${cy+r*.48} ${cx+r*.08},${cy+r*.48} ${cx},${cy+r*.58}`} fill={ink}/>
      <ellipse cx={cx-r*.24} cy={cy+r*.05} rx={r*.08} ry={r*.07} fill={ink}/>
      <circle cx={cx-r*.22} cy={cy+r*.03} r={r*.025} fill="#fff"/>
      <ellipse cx={cx+r*.24} cy={cy+r*.05} rx={r*.08} ry={r*.07} fill={ink}/>
      <circle cx={cx+r*.26} cy={cy+r*.03} r={r*.025} fill="#fff"/>
      <circle cx={cx-r*.38} cy={cy+r*.26} r={r*.11} fill={ink} opacity=".18"/>
      <circle cx={cx+r*.38} cy={cy+r*.26} r={r*.11} fill={ink} opacity=".18"/>
    </g>;
  }
  if(kind==='penguin'){
    return <g>
      <ellipse cx={cx} cy={cy+r*.1} rx={r*.65} ry={r*.68} fill={color}/>
      <path d={`M ${cx} ${cy-r*.22} Q ${cx-r*.35} ${cy-r*.20} ${cx-r*.44} ${cy+r*.18} Q ${cx-r*.36} ${cy+r*.62} ${cx} ${cy+r*.66} Q ${cx+r*.36} ${cy+r*.62} ${cx+r*.44} ${cy+r*.18} Q ${cx+r*.35} ${cy-r*.20} ${cx} ${cy-r*.22} Z`} fill={ink} opacity=".16"/>
      <circle cx={cx-r*.22} cy={cy+r*.04} r={r*.08} fill={ink}/>
      <circle cx={cx-r*.19} cy={cy+r*.01} r={r*.03} fill="#fff"/>
      <circle cx={cx+r*.22} cy={cy+r*.04} r={r*.08} fill={ink}/>
      <circle cx={cx+r*.25} cy={cy+r*.01} r={r*.03} fill="#fff"/>
      <polygon points={`${cx-r*.11},${cy+r*.18} ${cx+r*.11},${cy+r*.18} ${cx},${cy+r*.34}`} fill={ink}/>
      <circle cx={cx-r*.34} cy={cy+r*.24} r={r*.11} fill={ink} opacity=".22"/>
      <circle cx={cx+r*.34} cy={cy+r*.24} r={r*.11} fill={ink} opacity=".22"/>
    </g>;
  }
  if(kind==='star') return <g><polygon points={starPoints(cx,cy,r,5)} fill={color}/><circle cx={cx-r*.22} cy={cy-r*.05} r={r*.07} fill={ink}/><circle cx={cx+r*.22} cy={cy-r*.05} r={r*.07} fill={ink}/><path d={`M ${cx-r*.2} ${cy+r*.18} Q ${cx} ${cy+r*.35} ${cx+r*.2} ${cy+r*.18}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.06)} strokeLinecap="round"/></g>;
  if(kind==='rocket') return <g transform={`translate(${cx} ${cy}) rotate(12)`}><path d={`M 0 ${-r} Q ${r*.58} ${-r*.18} ${r*.35} ${r*.62} L 0 ${r*.42} L ${-r*.35} ${r*.62} Q ${-r*.58} ${-r*.18} 0 ${-r}`} fill={color}/><circle cy={-r*.2} r={r*.2} fill={ink} opacity=".18"/><path d={`M ${-r*.2} ${r*.48} L 0 ${r*1.06} L ${r*.2} ${r*.48}`} fill={ink} opacity=".45"/></g>;
  if(kind==='flower') return <g>{Array.from({length:7},(_,i)=>{const a=i*Math.PI*2/7;return <ellipse key={i} cx={cx+Math.cos(a)*r*.45} cy={cy+Math.sin(a)*r*.45} rx={r*.28} ry={r*.42} transform={`rotate(${a*180/Math.PI+90} ${cx+Math.cos(a)*r*.45} ${cy+Math.sin(a)*r*.45})`} fill={color}/>})}<circle cx={cx} cy={cy} r={r*.3} fill={ink} opacity=".25"/><circle cx={cx} cy={cy} r={r*.14} fill={color}/></g>;
  if(kind==='lightning') return <g transform={`translate(${cx} ${cy}) rotate(8)`}><path d={`M ${r*.12} ${-r} L ${-r*.56} ${r*.03} L ${-r*.08} ${r*.03} L ${-r*.32} ${r} L ${r*.62} ${-r*.18} L ${r*.1} ${-r*.18} Z`} fill={color}/><path d={`M ${r*.05} ${-r*.75} L ${-r*.28} ${-r*.06}`} stroke={ink} strokeWidth={Math.max(2,r*.06)} opacity=".28"/></g>;
  const choice=WORLDS.flatMap(w=>w.stamps).find(s=>s.id===kind);
  return <g><path d={`M ${cx-r*.72} ${cy-r*.08} Q ${cx-r*.4} ${cy-r*.78} ${cx+r*.06} ${cy-r*.6} Q ${cx+r*.78} ${cy-r*.28} ${cx+r*.6} ${cy+r*.45} Q ${cx} ${cy+r*.82} ${cx-r*.62} ${cy+r*.38} Z`} fill={color}/><text x={cx} y={cy+r*.12} textAnchor="middle" fontSize={r*.72} fontWeight="900" fill={ink}>{choice?.glyph||'🐾'}</text></g>;
}

function StampCardPreview({kind,active,color}:{kind:StampKind;active:boolean;color:string}){
  return (
    <svg viewBox="0 0 60 60" width="46" height="46" className="stamp-preview-svg" aria-hidden="true">
      <CuteStamp
        kind={kind}
        cx={30}
        cy={30}
        r={22}
        color={color}
        ink={active ? 'var(--canvas)' : 'var(--ink)'}
      />
    </svg>
  );
}

const MarkArt=React.memo(function MarkArt({mark,color,ink}:{mark:CanvasMark;color:string;ink:string}){
  const p=mark.points[0]||{x:.5,y:.5},path=pathFrom(mark.points),sw=Math.max(14,22*mark.size),rnd=seeded(mark.seed),cls=`mark mark-${mark.tool}`;
  if(mark.tool==='fill'){
    if(mark.fillDataUrl){
      return <g className={cls}>
        <image href={mark.fillDataUrl} x="0" y="0" width="1000" height="700" preserveAspectRatio="none"/>
      </g>;
    }
    return <g className={cls}>
      <rect width="1000" height="700" fill={color}/>
    </g>;
  }
  if(mark.tool==='crayon'){
    return <g className={cls}>
      <path d={path} fill="none" stroke={color} strokeWidth={sw*1.08} strokeLinecap="round" strokeLinejoin="round" opacity=".22"/>
      <path d={path} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity=".98"/>
      <path d={path} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={Math.max(1.8,sw*0.24)} strokeLinecap="round" strokeLinejoin="round"/>
    </g>;
  }
  if(mark.tool==='dots')return <g className={cls}>{mark.points.map((pt,i)=>{const r=7+mark.size*7+(i%3);return <g key={i}><circle cx={pt.x*1000} cy={pt.y*700} r={r} fill={color}/>{i%3===0&&<circle cx={pt.x*1000} cy={pt.y*700} r={r*1.7} fill="none" stroke={color} strokeWidth={2.3} opacity=".26"/>}{i%5===0&&<circle cx={pt.x*1000+r*1.4} cy={pt.y*700-r*.8} r={r*.25} fill={color} opacity=".55"/>}</g>})}</g>;
  if(mark.tool==='spray'){
    const dots:Array<{x:number;y:number;r:number;op:number;dash?:boolean}>=[];
    mark.points.forEach((pt,pi)=>{const burst=2+Math.floor(rnd()*10)+(pi%5===0?4:0),lean=(rnd()-.5)*1.3;for(let i=0;i<burst;i++){const a=rnd()*Math.PI*2+lean,d=Math.pow(rnd(),1.65)*(18+rnd()*58)*mark.size;dots.push({x:pt.x*1000+Math.cos(a)*d+(rnd()-.5)*10,y:pt.y*700+Math.sin(a)*d+(rnd()-.5)*7,r:.8+Math.pow(rnd(),2)*8.5,op:.18+rnd()*.7,dash:i===0&&pi%3===0});}if(rnd()>.58)dots.push({x:pt.x*1000+(rnd()-.5)*14,y:pt.y*700+(rnd()-.5)*12,r:3+rnd()*9,op:.48+rnd()*.4});});
    return <g className={cls}>{dots.map((d,i)=>d.dash?<path key={i} d={`M ${d.x-8} ${d.y+4} l ${16+rnd()*9} ${-8-rnd()*6}`} stroke={color} strokeWidth={2+rnd()*3} strokeLinecap="round" opacity={d.op}/>:<circle key={i} cx={d.x} cy={d.y} r={d.r} fill={color} opacity={d.op}/>)}</g>;
  }
  if(mark.tool==='boom'){
    const cx=p.x*1000,cy=p.y*700,r=36+mark.size*29;
    return <g className={cls} transform={`translate(${cx} ${cy}) rotate(${(mark.seed%17)-8})`}><circle r={r*.42} fill={color} opacity=".92"/><circle r={r*.76} fill="none" stroke={color} strokeWidth={5} opacity=".3"/>{Array.from({length:14},(_,i)=>{const a=i/14*Math.PI*2,a2=a+(rnd()-.5)*.18,len=r*(.85+rnd()*.55);return <path key={i} d={`M ${Math.cos(a)*r*.45} ${Math.sin(a)*r*.45} L ${Math.cos(a2)*len} ${Math.sin(a2)*len}`} stroke={color} strokeWidth={4+rnd()*7} strokeLinecap="round"/>})}{Array.from({length:10},(_,i)=>{const a=rnd()*Math.PI*2,d=r*(.7+rnd()*.8);return <circle key={`d${i}`} cx={Math.cos(a)*d} cy={Math.sin(a)*d} r={2+rnd()*7} fill={color} opacity={.35+rnd()*.5}/>})}<circle r={r*.14} fill={ink} opacity=".18"/></g>;
  }
  const stampPool=WORLDS.flatMap(w=>w.stamps), cx=p.x*1000,cy=p.y*700,r=36+mark.size*25,kind=mark.stampKind||stampPool[mark.seed%stampPool.length]?.id||'star';
  return <g className={cls}>
    <CuteStamp kind={kind} cx={cx} cy={cy} r={r} color={color} ink={ink}/>
  </g>;
});

function FxArt({fx}:{fx:CanvasFx}){
  const rnd=seeded(fx.seed),cx=fx.x*1000,cy=fx.y*700;
  if(fx.kind==='fill')return <g className="canvas-fx fx-fill"><circle cx={cx} cy={cy} r="60" fill={fx.color} opacity=".85"/><circle cx={cx} cy={cy} r="120" fill="none" stroke={fx.color} strokeWidth="36" opacity=".5"/></g>;
  if(fx.kind==='boom')return <g className="canvas-fx fx-boom">{Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2,len=45+rnd()*60;return <path key={i} d={`M ${cx+Math.cos(a)*12} ${cy+Math.sin(a)*12} L ${cx+Math.cos(a)*len} ${cy+Math.sin(a)*len}`} stroke={fx.color} strokeWidth={3+rnd()*5} strokeLinecap="round"/>})}<circle cx={cx} cy={cy} r="22" fill="none" stroke={fx.color} strokeWidth="6"/></g>;
  if(fx.kind==='stamp'){
    const kind=fx.stampKind||'cat';
    if(kind==='cat')return <g className="canvas-fx fx-stamp fx-cat"><circle cx={cx-35} cy={cy+28} r="8" fill={fx.color}/><circle cx={cx-8} cy={cy+40} r="6" fill={fx.color}/><path d={`M ${cx-76} ${cy-8} Q ${cx} ${cy-34} ${cx+76} ${cy-8}`} fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="9 10"/><path d={`M ${cx-68} ${cy+8} Q ${cx} ${cy+32} ${cx+68} ${cy+8}`} fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="9 10"/></g>;
    if(kind==='bunny')return <g className="canvas-fx fx-stamp fx-bunny">{Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,d=36+rnd()*28;return <circle key={i} cx={cx+Math.cos(a)*d} cy={cy+Math.sin(a)*d} r={3+rnd()*4} fill={fx.color}/>;})}<ellipse cx={cx} cy={cy} rx="40" ry="34" fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="6 8"/></g>;
    if(kind==='bear')return <g className="canvas-fx fx-stamp fx-bear">{Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return <circle key={i} cx={cx+Math.cos(a)*42} cy={cy+Math.sin(a)*42} r={7+rnd()*5} fill={fx.color} opacity=".4"/>;})}<circle cx={cx} cy={cy} r="32" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
    if(kind==='frog')return <g className="canvas-fx fx-stamp fx-frog">{[28,48,70].map((r,i)=><ellipse key={r} cx={cx} cy={cy+i*3} rx={r} ry={r*.55} fill="none" stroke={fx.color} strokeWidth={4-i} opacity={.65-i*.14}/>)}</g>;
    if(kind==='panda')return <g className="canvas-fx fx-stamp fx-panda">{Array.from({length:6},(_,i)=>{const a=i*Math.PI/3+rnd()*.2;return <path key={i} d={`M ${cx} ${cy} Q ${cx+Math.cos(a)*30} ${cy+Math.sin(a)*30-15} ${cx+Math.cos(a)*52} ${cy+Math.sin(a)*52}`} fill="none" stroke={fx.color} strokeWidth="3.5" strokeLinecap="round"/>;})}<circle cx={cx} cy={cy} r="26" fill="none" stroke={fx.color} strokeWidth="3"/></g>;
    if(kind==='puppy')return <g className="canvas-fx fx-stamp fx-puppy">{Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <circle key={i} cx={cx+Math.cos(a)*46} cy={cy+Math.sin(a)*46} r={4+rnd()*4} fill={fx.color}/>;})}<path d={`M ${cx-20} ${cy-10} Q ${cx} ${cy-30} ${cx+20} ${cy-10} Q ${cx} ${cy+25} ${cx-20} ${cy-10}`} fill="none" stroke={fx.color} strokeWidth="3"/></g>;
    if(kind==='chick')return <g className="canvas-fx fx-stamp fx-chick">{Array.from({length:7},(_,i)=><path key={i} d={`M ${cx+(i-3)*14} ${cy-35+Math.sin(i)*10} l 4 -12 l 6 4`} fill="none" stroke={fx.color} strokeWidth="2.5" strokeLinecap="round"/>)}<circle cx={cx} cy={cy} r="35" fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="5 7"/></g>;
    if(kind==='fox')return <g className="canvas-fx fx-stamp fx-fox">{Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return <path key={i} d={`M ${cx} ${cy} C ${cx+Math.cos(a)*25} ${cy+Math.sin(a)*25}, ${cx+Math.cos(a+.5)*45} ${cy+Math.sin(a+.5)*45}, ${cx+Math.cos(a)*60} ${cy+Math.sin(a)*60}`} fill="none" stroke={fx.color} strokeWidth="3" strokeLinecap="round"/>;})}</g>;
    if(kind==='penguin')return <g className="canvas-fx fx-stamp fx-penguin">{Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return <g key={i} transform={`translate(${cx} ${cy}) rotate(${a*180/Math.PI})`}><path d="M 0 0 L 0 45 M -8 30 L 0 38 L 8 30" stroke={fx.color} strokeWidth="2.5" strokeLinecap="round"/></g>;})}</g>;
    if(kind==='rocket')return <g className="canvas-fx fx-stamp fx-rocket">{Array.from({length:6},(_,i)=><path key={i} d={`M ${cx+(i-2.5)*7} ${cy+18+i*3} l ${-(i-2.5)*4} ${42+rnd()*25}`} stroke={fx.color} strokeWidth={3+rnd()*4} strokeLinecap="round" opacity={.35+rnd()*.4}/>)}<circle cx={cx} cy={cy} r="42" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
    if(kind==='flower')return <g className="canvas-fx fx-stamp fx-flower">{Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <circle key={i} cx={cx+Math.cos(a)*42} cy={cy+Math.sin(a)*42} r={9+rnd()*7} fill={fx.color} opacity=".42"/>})}<circle cx={cx} cy={cy} r="26" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
    if(kind==='lightning')return <g className="canvas-fx fx-stamp fx-lightning">{Array.from({length:5},(_,i)=><path key={i} d={`M ${cx-18+rnd()*36} ${cy-48-rnd()*20} l ${-8+rnd()*16} ${28+rnd()*15} l ${12-rnd()*24} ${26+rnd()*20}`} fill="none" stroke={fx.color} strokeWidth={3+rnd()*4} strokeLinecap="round" strokeLinejoin="round"/> )}</g>;
    return <g className="canvas-fx fx-stamp fx-star">{Array.from({length:10},(_,i)=>{const a=i*Math.PI/5,r=48+rnd()*35;return <path key={i} d={`M ${cx+Math.cos(a)*18} ${cy+Math.sin(a)*18} L ${cx+Math.cos(a)*r} ${cy+Math.sin(a)*r}`} stroke={fx.color} strokeWidth={2.5+rnd()*3.5} strokeLinecap="round"/>})}<circle cx={cx} cy={cy} r="25" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
  }
  return <g className="canvas-fx fx-scribble">{Array.from({length:8},(_,i)=>{const a=rnd()*Math.PI*2,d=18+rnd()*42;return <circle key={i} cx={cx+Math.cos(a)*d} cy={cy+Math.sin(a)*d} r={2+rnd()*5} fill={fx.color}/>})}</g>;
}

function WorldSheet({current,onPick,onClose}:{current:WorldId;onPick:(id:WorldId)=>void;onClose:()=>void}){
  return <div className="world-sheet-backdrop" onPointerDown={onClose}>
    <section className="world-sheet" onPointerDown={e=>e.stopPropagation()}>
      <div className="world-sheet-head"><div><small>same picture, new band</small><strong>pick a world</strong></div><button onClick={onClose} aria-label="Close worlds"><X size={20}/></button></div>
      <button className="surprise-world" onClick={()=>onPick(randomWorld(current))}><Sparkles size={18}/><span>surprise me</span></button>
      <div className="world-grid">
        {WORLDS.map(w=><button key={w.id} className={`world-card ${current===w.id?'active':''}`} onClick={()=>onPick(w.id)} style={{'--world-bg':w.canvas,'--world-ink':w.canvasInk} as React.CSSProperties}>
          <div className="mini-palette">{w.palette.slice(0,6).map((c,i)=><i key={i} style={{background:c.color}}/>)}</div>
          <b>{w.label}</b><span>{w.littleName}</span>
        </button>)}
      </div>
    </section>
  </div>;
}

export default function App(){
  const [worldId,setWorldId]=useState<WorldId>(()=>randomWorld());
  const world=WORLD_MAP[worldId];
  const [marks,setMarks]=useState<CanvasMark[]>([]);
  const [draft,setDraft]=useState<CanvasMark|null>(null);
  const [tool,setTool]=useState<CanvasTool>('crayon');
  const [stampKind,setStampKind]=useState<StampKind>('cat');
  const [paletteIndex,setPaletteIndex]=useState(0);
  const [state,setState]=useState<TransportState>(()=>initialTransport());
  const [showWorlds,setShowWorlds]=useState(false);
  const [hoverPoint,setHoverPoint]=useState<CanvasPoint|null>(null);
  const [effects,setEffects]=useState<CanvasFx[]>([]);
  const [bombState,setBombState]=useState<'idle'|'arming'|'boom'>('idle');
  const lastLiveAudition=useRef(0);
  const bombTimer=useRef<number|null>(null);
  const activePointerId=useRef<number|null>(null);
  const draftRef=useRef<CanvasMark|null>(null);
  const draftFrame=useRef<number|null>(null);
  const eraseQueue=useRef<CanvasPoint[]>([]);
  const eraseFrame=useRef<number|null>(null);
  const hoverRef=useRef<CanvasPoint|null>(null);
  const hoverFrame=useRef<number|null>(null);

  const song=useMemo(()=>interpretCanvas(marks,worldId),[marks,worldId]);
  useEffect(()=>{ if(!world.stamps.some(s=>s.id===stampKind)) setStampKind(world.stamps[0]?.id||'cat'); },[worldId]);
  useEffect(()=>{transport.prefetchWorld(worldId);},[worldId]);

  useEffect(()=>{transport.setSong(song,true,true);},[song]);
  useEffect(()=>transport.subscribe(setState),[]);
  useEffect(()=>()=>transport.stop(),[]);
  useEffect(()=>{
    const root=document.documentElement;
    let frame=0;
    const syncViewport=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const height=window.visualViewport?.height??window.innerHeight;
        root.style.setProperty('--app-height',`${Math.max(1,Math.round(height))}px`);
      });
    };
    syncViewport();
    window.addEventListener('resize',syncViewport,{passive:true});
    window.addEventListener('orientationchange',syncViewport);
    window.visualViewport?.addEventListener('resize',syncViewport,{passive:true});
    return()=>{
      cancelAnimationFrame(frame);
      window.removeEventListener('resize',syncViewport);
      window.removeEventListener('orientationchange',syncViewport);
      window.visualViewport?.removeEventListener('resize',syncViewport);
      root.style.removeProperty('--app-height');
    };
  },[]);

  const pointFromEvent=(e:React.PointerEvent<SVGSVGElement>):CanvasPoint=>{const r=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  const addEffect=useCallback((mark:CanvasMark,kind:CanvasFx['kind'])=>{const p=mark.points[mark.points.length-1]||mark.points[0]||{x:.5,y:.5};const sound=WORLD_MAP[worldId].palette[mark.paletteIndex%WORLD_MAP[worldId].palette.length];const fx={id:`fx_${Date.now()}_${Math.random()}`,x:p.x,y:p.y,color:sound.color,ink:sound.ink,kind,seed:mark.seed,stampKind:mark.stampKind};setEffects(prev=>[...prev.slice(-10),fx]);window.setTimeout(()=>setEffects(prev=>prev.filter(x=>x.id!==fx.id)),650);},[worldId]);
  const audition=useCallback((mark:CanvasMark,live=false,onset=false)=>{transport.auditionPhrase(interpretMark(mark,worldId),live,onset);},[worldId]);
  const commit=useCallback((mark:CanvasMark,kind:CanvasFx['kind'])=>{const frozen=freezeMark(mark,worldId);setMarks(prev=>[...prev,frozen]);audition(frozen,false);addEffect(frozen,kind);},[addEffect,audition,worldId]);

  const publishDraft=useCallback((mark:CanvasMark|null,immediate=false)=>{
    draftRef.current=mark;
    if(immediate){
      if(draftFrame.current!==null){cancelAnimationFrame(draftFrame.current);draftFrame.current=null;}
      setDraft(mark?{...mark,points:[...mark.points],gesture:mark.gesture?{...mark.gesture}:undefined}:null);return;
    }
    if(draftFrame.current!==null)return;
    draftFrame.current=requestAnimationFrame(()=>{draftFrame.current=null;const value=draftRef.current;setDraft(value?{...value,points:[...value.points]}:null);});
  },[]);

  const publishHover=useCallback((point:CanvasPoint|null,immediate=false)=>{
    hoverRef.current=point;
    if(immediate){if(hoverFrame.current!==null){cancelAnimationFrame(hoverFrame.current);hoverFrame.current=null;}setHoverPoint(point);return;}
    if(hoverFrame.current!==null)return;
    hoverFrame.current=requestAnimationFrame(()=>{hoverFrame.current=null;setHoverPoint(hoverRef.current);});
  },[]);

  const flushErase=useCallback(()=>{
    if(eraseFrame.current!==null){cancelAnimationFrame(eraseFrame.current);eraseFrame.current=null;}
    const points=eraseQueue.current.splice(0);if(!points.length)return;
    setMarks(prev=>{
      let next=prev;
      for(const p of points)next=next.map(mark=>eraseMarkAt(mark,p,worldId,.050)).filter((mark):mark is CanvasMark=>Boolean(mark));
      return next;
    });
  },[worldId]);
  const eraseAt=useCallback((p:CanvasPoint)=>{
    eraseQueue.current.push(p);
    if(eraseFrame.current!==null)return;
    eraseFrame.current=requestAnimationFrame(()=>{eraseFrame.current=null;flushErase();});
  },[flushErase]);

  const cancelBomb=useCallback(()=>{if(bombTimer.current!==null){window.clearTimeout(bombTimer.current);bombTimer.current=null;}setBombState(state=>state==='boom'?state:'idle');},[]);
  const startBomb=useCallback(()=>{
    if(!marks.length||bombState!=='idle')return;
    setBombState('arming');
    bombTimer.current=window.setTimeout(()=>{
      bombTimer.current=null;setBombState('boom');transport.stop();
      window.setTimeout(()=>{setMarks([]);publishDraft(null,true);setEffects([]);},160);
      window.setTimeout(()=>setBombState('idle'),650);
    },1000);
  },[marks.length,bombState,publishDraft]);
  useEffect(()=>()=>{
    if(bombTimer.current!==null)window.clearTimeout(bombTimer.current);
    if(draftFrame.current!==null)cancelAnimationFrame(draftFrame.current);
    if(eraseFrame.current!==null)cancelAnimationFrame(eraseFrame.current);
    if(hoverFrame.current!==null)cancelAnimationFrame(hoverFrame.current);
  },[]);

  const pointerDown=(e:React.PointerEvent<SVGSVGElement>)=>{
    const p=pointFromEvent(e);
    if(bombState==='arming'){cancelBomb();return;}
    if(activePointerId.current!==null&&activePointerId.current!==e.pointerId)return;
    activePointerId.current=e.pointerId;
    // iOS/iPadOS Safari and iOS Chrome require Web Audio to be unlocked by
    // the same real user gesture that starts the interaction. Do this before
    // any async SoundFont/worklet loading or later pointermove audition.
    transport.unlockAudio(worldId,paletteIndex);
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* implicit touch capture is enough */}
    if(e.pointerType!=='touch')publishHover(p,true);
    if(tool==='eraser'){eraseAt(p);return;}
    if(tool==='fill'){
      const sound=world.palette[paletteIndex%world.palette.length];
      const result=performFloodFill(marks,p,sound.color,world);
      const next:CanvasMark={
        id:`m_${Date.now()}_${Math.floor(Math.random()*1e5)}`,
        paletteIndex,
        tool:'fill',
        points:[p],
        size:1,
        seed:Math.floor(Math.random()*1e9),
        fillDataUrl:result.fillDataUrl,
        fillMaskDataUrl:result.fillMaskDataUrl,
        bounds:result.bounds,
        gesture:createGestureStats(p),
      };
      const frozen=freezeMark(next,worldId);
      setMarks(prev=>[...prev,frozen]);
      audition(frozen,false);
      addEffect(next,'fill');
      publishDraft(null,true);
      return;
    }
    const next:CanvasMark={id:`m_${Date.now()}_${Math.floor(Math.random()*1e5)}`,paletteIndex,tool,points:[p],size:.86+Math.random()*.26,seed:Math.floor(Math.random()*1e9),stampKind:tool==='stamp'?stampKind:undefined,gesture:createGestureStats(p)};
    if(tool==='stamp'||tool==='boom'){commit(next,tool==='boom'?'boom':'stamp');publishDraft(null,true);return;}
    publishDraft(next,true);audition(next,true,true);lastLiveAudition.current=performance.now();
  };
  const pointerMove=(e:React.PointerEvent<SVGSVGElement>)=>{
    const p=pointFromEvent(e);if(e.pointerType!=='touch')publishHover(p);
    const isDrawing=activePointerId.current===e.pointerId;
    if(tool==='eraser'&&isDrawing){eraseAt(p);return;}
    const current=draftRef.current;
    if(!current||!isDrawing)return;
    const last=current.points[current.points.length-1],min=current.tool==='dots'?.034:current.tool==='spray'?.019:.012;if(Math.hypot(last.x-p.x,last.y-p.y)<min)return;
    // Pointer events can arrive at 120Hz+ on phones. Keep the complete stroke in
    // a ref for musical accuracy, but publish it to React at most once per frame.
    current.points.push(p);
    current.gesture=extendGestureStats(current.gesture??createGestureStats(current.points[0]),p);
    const next=current;publishDraft(next);
    const now=performance.now();
    const role=world.palette[next.paletteIndex%world.palette.length]?.role;
    const heavyLine=next.tool==='crayon'&&(role==='bass'||role==='harmony');
    const interval=heavyLine?145:next.tool==='crayon'?90:next.tool==='dots'?100:112;
    if(now-lastLiveAudition.current>interval){
      const tiny={...next,id:`live_${next.id}`,points:next.points.slice(heavyLine?-2:-5),gesture:undefined};
      audition(tiny,true);lastLiveAudition.current=now;
    }
  };
  const pointerUp=(e:React.PointerEvent<SVGSVGElement>)=>{
    if(activePointerId.current!==e.pointerId)return;
    // Retry on release as a defensive WebKit path after a drag gesture.
    transport.unlockAudio(worldId,paletteIndex);
    if(tool==='eraser')flushErase();
    if(e.pointerType==='touch')publishHover(null,true);
    activePointerId.current=null;
    try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{/* noop */}
    const finalDraft=draftRef.current;
    if(finalDraft){commit(finalDraft,'scribble');publishDraft(null,true);}
  };

  const chooseWorld=(id:WorldId)=>{
    transport.stop();
    transport.unlockAudio(id,0);
    setWorldId(id);
    setShowWorlds(false);
    setPaletteIndex(0);
    setStampKind(WORLD_MAP[id].stamps[0]?.id||'cat');
    setMarks(prev=>prev.map(m=>{
      if(m.tool==='fill'&&m.fillMaskDataUrl){
        const sound=WORLD_MAP[id].palette[m.paletteIndex%WORLD_MAP[id].palette.length];
        const newUrl=recolorFillDataUrl(m.fillMaskDataUrl,sound.color);
        return {...m,fillDataUrl:newUrl};
      }
      return m;
    }));
  };
  const undo=()=>{setMarks(prev=>prev.slice(0,-1));};
  const progress=song.totalDuration?Math.max(0,Math.min(1,state.currentTime/song.totalDuration)):0;
  const displayMarks=useMemo(()=>{const raw=draft?[...marks,draft]:marks;return [...raw].sort((a,b)=>(a.tool==='fill'?0:1)-(b.tool==='fill'?0:1));},[marks,draft]),palette=world.palette;

  return <div className={`paint-app world-${worldId}`} style={{'--canvas':world.canvas,'--ink':world.canvasInk,'--accent':world.accent} as React.CSSProperties} onPointerDownCapture={e=>{if(bombState==='arming' && !(e.target as HTMLElement).closest('.bomb-reset')) cancelBomb();}}>
    <header className="tiny-topbar">
      <div className="little-brand"><span>d</span><b>draw sounds</b></div>
      <div className="tiny-actions">
        <button onClick={undo} disabled={!marks.length||bombState!=='idle'} aria-label="Undo last mark"><RotateCcw size={18}/></button>
        <button className={`bomb-reset ${bombState!=='idle'?`is-${bombState}`:''}`} disabled={!marks.length&&bombState==='idle'} aria-label={bombState==='arming'?'Bomb lit. Touch anywhere to cancel':'Clear the whole drawing'} onClick={e=>{e.stopPropagation();bombState==='arming'?cancelBomb():startBomb();}}><Bomb size={19}/><i/></button>
      </div>
    </header>

    <main className="canvas-stage">
      <div className={`music-paper ${marks.length?'has-marks':''} ${state.isPlaying?'playing':''}`}>
        {bombState==='boom'&&<div className="reset-boom" aria-hidden="true"><b>✹</b><i/><i/><i/><i/><i/><i/></div>}
        {!marks.length&&!draft&&<div className="empty-whisper" aria-hidden="true"><i/><span>draw something noisy</span><i/></div>}
        <svg className="music-canvas" viewBox="0 0 1000 700" preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp} onPointerLeave={e=>{if(activePointerId.current!==e.pointerId)publishHover(null,true);}}>
          <rect width="1000" height="700" fill="transparent"/>
          {displayMarks.map(mark=>{const sound=palette[mark.paletteIndex%palette.length],maskId=`erase_${mark.id.replace(/[^a-zA-Z0-9_]/g,'_')}`;return <g key={mark.id}>{mark.erasures?.length?<defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="700"><rect width="1000" height="700" fill="white"/>{mark.erasures.map((hole,i)=><ellipse key={i} cx={hole.x*1000} cy={hole.y*700} rx={(hole.radius??.05)*820} ry={(hole.radius??.05)*700} fill="black"/>)}</mask></defs>:null}<g mask={mark.erasures?.length?`url(#${maskId})`:undefined}><MarkArt mark={mark} color={sound.color} ink={sound.ink}/></g></g>;})}
          {effects.map(fx=><FxArt key={fx.id} fx={fx}/>)}
          {hoverPoint&&tool!=='eraser'&&<circle className="brush-cursor" cx={hoverPoint.x*1000} cy={hoverPoint.y*700} r={tool==='boom'?35:tool==='stamp'?29:tool==='fill'?24:12} fill={palette[paletteIndex%palette.length].color}/>} 
          {hoverPoint&&tool==='eraser'&&<g className="eraser-cursor"><circle cx={hoverPoint.x*1000} cy={hoverPoint.y*700} r="36"/><path d={`M ${hoverPoint.x*1000-15} ${hoverPoint.y*700+8} l 30 -16`}/></g>}
        </svg>
        <div className="playhead" style={{left:`${progress*100}%`,opacity:state.isPlaying?1:.16}}><i/></div>
      </div>
    </main>

    <section className="playground-dock" aria-label="Musical drawing toys">
      <div className="toy-shelf">
        <div className="shelf-colors" role="group" aria-label="Sound colors">
          {palette.map((c,i)=>(
            <button
              key={`${worldId}_${i}`}
              className={`paint-pot ${paletteIndex===i?'active':''}`}
              onPointerDown={()=>transport.preparePalette(worldId,i)}
              onClick={()=>{
                setPaletteIndex(i);
                if(tool==='eraser')setTool('crayon');
              }}
              aria-label={c.name}
              title={c.name}
            >
              <span style={{background:c.color}}/>
            </button>
          ))}
        </div>
        <div className="shelf-tools" role="group" aria-label="Drawing toys">
          {TOOLS.map(t=>(
            <button
              key={t.id}
              className={`toy-tool ${tool===t.id?'active':''}`}
              onClick={()=>setTool(t.id)}
              aria-label={t.label}
              title={t.label}
            >
              {t.id==='crayon'&&<Pencil size={21} strokeWidth={2.4}/>}
              {t.id==='dots'&&(
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <circle cx="4" cy="12" r="2.8"/>
                  <circle cx="12" cy="12" r="3.2"/>
                  <circle cx="20" cy="12" r="2.8"/>
                </svg>
              )}
              {t.id==='spray'&&<Sparkles size={21} strokeWidth={2.2}/>}
              {t.id==='stamp'&&(
                <svg viewBox="0 0 44 44" width="28" height="28" aria-hidden="true">
                  <CuteStamp kind={stampKind} cx={22} cy={22} r={17} color={palette[paletteIndex].color} ink={tool==='stamp'?'var(--canvas)':'currentColor'}/>
                </svg>
              )}
              {t.id==='boom'&&<span style={{fontSize:'24px',lineHeight:1}} aria-hidden="true">✹</span>}
              {t.id==='fill'&&<PaintBucket size={21} strokeWidth={2.2}/>}
              {t.id==='eraser'&&<Eraser size={21} strokeWidth={2.2}/>}
            </button>
          ))}
        </div>
      </div>

      {tool==='stamp'&&(
        <div className="stamp-tray" role="group" aria-label="Cute animal stamps">
          {world.stamps.map(s=>(
            <button
              key={s.id}
              className={stampKind===s.id?'active':''}
              onClick={()=>setStampKind(s.id)}
              aria-label={s.label}
              title={s.label}
            >
              <StampCardPreview kind={s.id} active={stampKind===s.id} color={palette[paletteIndex].color}/>
            </button>
          ))}
        </div>
      )}

      <div className="play-row">
        <button className={`giant-play ${state.isPlaying?'is-playing':''} ${state.isPreparing?'is-preparing':''} ${state.audioError?'has-audio-error':''}`} onPointerDown={()=>transport.unlockAudio(worldId,paletteIndex)} onClick={()=>marks.length?transport.togglePlay():undefined} disabled={!marks.length} aria-label={state.audioError?'SoundFont failed to load. Tap to retry':state.isPreparing?'Preparing sounds':state.isPlaying?'Pause drawing':'Play drawing'} title={state.audioError??undefined}>
          {state.isPlaying?<Pause size={27} fill="currentColor"/>:<Play size={29} fill="currentColor"/>}
        </button>
        <div className={`transport-scrub ${state.audioError?'has-error':''}`}>
          {state.audioError
            ? <button className="soundfont-retry" type="button" onPointerDown={()=>transport.unlockAudio(worldId,paletteIndex)} onClick={()=>transport.togglePlay()} title={state.audioError}>Sound unavailable · retry</button>
            : <input aria-label="Move through your drawing" type="range" min="0" max="1000" step="1" value={Math.round(progress*1000)} style={{'--seek-fill':`${progress*100}%`} as React.CSSProperties} onChange={e=>transport.seek((Number(e.target.value)/1000)*song.totalDuration)} disabled={!marks.length}/>}
        </div>
        <button className="world-pill" onClick={()=>setShowWorlds(true)} aria-label={`Change world. Current world ${world.label}`}><span className="world-dots">{palette.slice(0,3).map((c,i)=><i key={i} style={{background:c.color}}/>)}</span><b>{world.label}</b><small>swap</small></button>
      </div>
    </section>

    {showWorlds&&<WorldSheet current={worldId} onPick={chooseWorld} onClose={()=>setShowWorlds(false)}/>} 
  </div>;
}
