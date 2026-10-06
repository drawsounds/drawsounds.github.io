import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bomb, PaintBucket, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';
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
  eraseMarkAt,
  freezeMark,
  interpretCanvas,
  interpretMark,
  randomWorld,
} from './music/canvasMusic';

function initialTransport(): TransportState { return {isPlaying:false,currentTime:0,totalDuration:0,currentSectionIndex:0,activePhraseIds:[]}; }

const TOOLS: {id:CanvasTool; glyph:string; label:string}[] = [
  {id:'crayon',glyph:'〰',label:'crayon'},
  {id:'dots',glyph:'•••',label:'dots'},
  {id:'spray',glyph:'⁙',label:'spray'},
  {id:'stamp',glyph:'✦',label:'stamp'},
  {id:'boom',glyph:'✹',label:'boom'},
  {id:'fill',glyph:'',label:'fill'},
  {id:'eraser',glyph:'⌫',label:'erase'},
];
type CanvasFx = {id:string;x:number;y:number;color:string;ink:string;kind:'scribble'|'stamp'|'boom';seed:number;stampKind?:StampKind};
function seeded(seed:number){let s=seed||1;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function markBounds(mark:CanvasMark){
  const pts=mark.points.length?mark.points:[{x:.5,y:.5}];let minX=1,maxX=0,minY=1,maxY=0;
  pts.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
  const pad=(mark.tool==='boom'||mark.tool==='stamp'?.05:.014)*mark.size;
  return {minX:Math.max(0,minX-pad),maxX:Math.min(1,maxX+pad),minY:Math.max(0,minY-pad),maxY:Math.min(1,maxY+pad)};
}
function pathFrom(points:CanvasPoint[],dx=0,dy=0){if(!points.length)return'';if(points.length===1)return`M ${points[0].x*1000+dx} ${points[0].y*700+dy} l .01 .01`;return points.map((p,i)=>`${i?'L':'M'} ${p.x*1000+dx} ${p.y*700+dy}`).join(' ');}
function starPoints(cx:number,cy:number,r:number,n=5){const pts:string[]=[];for(let i=0;i<n*2;i++){const a=-Math.PI/2+i*Math.PI/n,rr=i%2===0?r:r*.43;pts.push(`${cx+Math.cos(a)*rr},${cy+Math.sin(a)*rr}`);}return pts.join(' ');}

function CuteStamp({kind,cx,cy,r,color,ink}:{kind:StampKind;cx:number;cy:number;r:number;color:string;ink:string}){
  const generic=['star','cat','rocket','frog','flower','lightning'];
  if(!generic.includes(kind)){ const choice=WORLDS.flatMap(w=>w.stamps).find(s=>s.id===kind); return <g><path d={`M ${cx-r*.72} ${cy-r*.08} Q ${cx-r*.4} ${cy-r*.78} ${cx+r*.06} ${cy-r*.6} Q ${cx+r*.78} ${cy-r*.28} ${cx+r*.6} ${cy+r*.45} Q ${cx} ${cy+r*.82} ${cx-r*.62} ${cy+r*.38} Z`} fill={color}/><circle cx={cx} cy={cy} r={r*.72} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.05)} opacity=".16" strokeDasharray="5 8"/><text x={cx} y={cy+r*.12} textAnchor="middle" fontSize={r*.72} fontWeight="900" fill={ink}>{choice?.glyph||'✦'}</text></g>; }
  if(kind==='star') return <g><polygon points={starPoints(cx,cy,r,5)} fill={color}/><circle cx={cx-r*.22} cy={cy-r*.05} r={r*.07} fill={ink}/><circle cx={cx+r*.22} cy={cy-r*.05} r={r*.07} fill={ink}/><path d={`M ${cx-r*.2} ${cy+r*.18} Q ${cx} ${cy+r*.35} ${cx+r*.2} ${cy+r*.18}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.06)} strokeLinecap="round"/></g>;
  if(kind==='cat') return <g><path d={`M ${cx-r*.64} ${cy-r*.34} L ${cx-r*.58} ${cy-r*.98} L ${cx-r*.16} ${cy-r*.62} Q ${cx} ${cy-r*.74} ${cx+r*.16} ${cy-r*.62} L ${cx+r*.58} ${cy-r*.98} L ${cx+r*.64} ${cy-r*.34} Q ${cx+r*.72} ${cy+r*.65} ${cx} ${cy+r*.72} Q ${cx-r*.72} ${cy+r*.65} ${cx-r*.64} ${cy-r*.34}`} fill={color}/><circle cx={cx-r*.24} cy={cy-r*.08} r={r*.08} fill={ink}/><circle cx={cx+r*.24} cy={cy-r*.08} r={r*.08} fill={ink}/><path d={`M ${cx-r*.08} ${cy+r*.12} L ${cx} ${cy+r*.2} L ${cx+r*.08} ${cy+r*.12}`} fill={ink}/><path d={`M ${cx-r*.12} ${cy+r*.28} Q ${cx} ${cy+r*.38} ${cx+r*.12} ${cy+r*.28}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.05)} strokeLinecap="round"/>{[-1,1].map(side=><g key={side}><path d={`M ${cx+side*r*.18} ${cy+r*.21} L ${cx+side*r*.72} ${cy+r*.12}`} stroke={ink} strokeWidth={Math.max(1.5,r*.035)}/><path d={`M ${cx+side*r*.18} ${cy+r*.29} L ${cx+side*r*.72} ${cy+r*.38}`} stroke={ink} strokeWidth={Math.max(1.5,r*.035)}/></g>)}</g>;
  if(kind==='rocket') return <g transform={`translate(${cx} ${cy}) rotate(12)`}><path d={`M 0 ${-r} Q ${r*.58} ${-r*.18} ${r*.35} ${r*.62} L 0 ${r*.42} L ${-r*.35} ${r*.62} Q ${-r*.58} ${-r*.18} 0 ${-r}`} fill={color}/><circle cy={-r*.2} r={r*.2} fill={ink} opacity=".18"/><path d={`M ${-r*.2} ${r*.48} L 0 ${r*1.06} L ${r*.2} ${r*.48}`} fill={ink} opacity=".45"/></g>;
  if(kind==='frog') return <g><ellipse cx={cx} cy={cy+r*.15} rx={r*.74} ry={r*.55} fill={color}/><circle cx={cx-r*.38} cy={cy-r*.3} r={r*.3} fill={color}/><circle cx={cx+r*.38} cy={cy-r*.3} r={r*.3} fill={color}/><circle cx={cx-r*.38} cy={cy-r*.3} r={r*.11} fill={ink}/><circle cx={cx+r*.38} cy={cy-r*.3} r={r*.11} fill={ink}/><path d={`M ${cx-r*.35} ${cy+r*.12} Q ${cx} ${cy+r*.48} ${cx+r*.35} ${cy+r*.12}`} fill="none" stroke={ink} strokeWidth={Math.max(2,r*.06)} strokeLinecap="round"/></g>;
  if(kind==='flower') return <g>{Array.from({length:7},(_,i)=>{const a=i*Math.PI*2/7;return <ellipse key={i} cx={cx+Math.cos(a)*r*.45} cy={cy+Math.sin(a)*r*.45} rx={r*.28} ry={r*.42} transform={`rotate(${a*180/Math.PI+90} ${cx+Math.cos(a)*r*.45} ${cy+Math.sin(a)*r*.45})`} fill={color}/>})}<circle cx={cx} cy={cy} r={r*.3} fill={ink} opacity=".25"/><circle cx={cx} cy={cy} r={r*.14} fill={color}/></g>;
  return <g transform={`translate(${cx} ${cy}) rotate(8)`}><path d={`M ${r*.12} ${-r} L ${-r*.56} ${r*.03} L ${-r*.08} ${r*.03} L ${-r*.32} ${r} L ${r*.62} ${-r*.18} L ${r*.1} ${-r*.18} Z`} fill={color}/><path d={`M ${r*.05} ${-r*.75} L ${-r*.28} ${-r*.06}`} stroke={ink} strokeWidth={Math.max(2,r*.06)} opacity=".28"/></g>;
}

function MarkArt({mark,color,ink,active}:{mark:CanvasMark;color:string;ink:string;active:boolean}){
  const p=mark.points[0]||{x:.5,y:.5},path=pathFrom(mark.points),sw=Math.max(14,22*mark.size),rnd=seeded(mark.seed),cls=`mark mark-${mark.tool} ${active?'is-sounding':''}`;
  if(mark.tool==='fill'){
    const gradId=`fill_${mark.id.replace(/[^a-zA-Z0-9_]/g,'_')}`;
    return <g className={cls}>
      <defs><linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28"/><stop offset=".5" stopColor={color} stopOpacity=".18"/><stop offset="1" stopColor={ink} stopOpacity=".09"/></linearGradient></defs>
      <rect width="1000" height="700" fill={`url(#${gradId})`}/>
      {Array.from({length:18},(_,i)=>{const cx=rnd()*1000,cy=rnd()*700,rx=60+rnd()*180,ry=35+rnd()*125;return <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={color} opacity={.025+rnd()*.055} transform={`rotate(${(rnd()-.5)*25} ${cx} ${cy})`}/>})}
      {Array.from({length:8},(_,i)=>{const y=60+rnd()*580;return <path key={`s${i}`} d={`M ${-60+rnd()*100} ${y} C ${220+rnd()*100} ${y-30+rnd()*60}, ${650+rnd()*120} ${y+30-rnd()*60}, 1060 ${y+(rnd()-.5)*40}`} fill="none" stroke={color} strokeWidth={10+rnd()*22} strokeLinecap="round" opacity={.025+rnd()*.04}/>})}
    </g>;
  }
  if(mark.tool==='crayon'){
    const artifacts=mark.points.filter((_,i)=>i%Math.max(2,Math.floor(mark.points.length/9))===0).slice(0,12);
    const first=mark.points[0]||{x:.2,y:.5},last=mark.points[mark.points.length-1]||{x:.8,y:.5},gradId=`paint_${mark.id.replace(/[^a-zA-Z0-9_]/g,'_')}`;
    return <g className={cls}>
      <defs><linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={first.x*1000} y1={first.y*700} x2={last.x*1000} y2={last.y*700}><stop offset="0" stopColor={color}/><stop offset=".55" stopColor={color} stopOpacity=".82"/><stop offset="1" stopColor={ink} stopOpacity=".62"/></linearGradient></defs>
      <path d={pathFrom(mark.points,4,-2)} fill="none" stroke={color} strokeWidth={sw*.78} strokeLinecap="round" strokeLinejoin="round" opacity=".16"/>
      <path d={path} fill="none" stroke={`url(#${gradId})`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity=".96"/>
      <path d={pathFrom(mark.points,-3,1)} fill="none" stroke={color} strokeWidth={Math.max(2,sw*.17)} strokeLinecap="round" strokeLinejoin="round" opacity=".28" strokeDasharray={`${10+rnd()*18} ${4+rnd()*12}`}/>
      <path d={pathFrom(mark.points,2,3)} fill="none" stroke={ink} strokeWidth={Math.max(1.3,sw*.055)} strokeLinecap="round" strokeLinejoin="round" opacity=".12" strokeDasharray={`${2+rnd()*5} ${7+rnd()*10}`}/>
      <path d={pathFrom(mark.points,-2,2)} fill="none" stroke={ink} strokeWidth={Math.max(1.7,sw*.075)} strokeLinecap="round" strokeLinejoin="round" opacity=".14" strokeDasharray={`${4+rnd()*5} ${7+rnd()*9}`}/>
      {artifacts.map((pt,i)=><g key={i} opacity={.36+rnd()*.28}><circle cx={pt.x*1000+(rnd()-.5)*28} cy={pt.y*700+(rnd()-.5)*24} r={2+rnd()*7} fill={color}/>{i%3===0&&<path d={`M ${pt.x*1000-8-rnd()*10} ${pt.y*700+5} l ${16+rnd()*16} ${-10+rnd()*5}`} stroke={color} strokeWidth={2+rnd()*3} strokeLinecap="round"/>}</g>)}
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
  const stampPool=WORLDS.flatMap(w=>w.stamps), cx=p.x*1000,cy=p.y*700,r=33+mark.size*23,kind=mark.stampKind||stampPool[mark.seed%stampPool.length]?.id||'star';
  return <g className={cls}>
    <g opacity=".16" transform={`translate(${(rnd()-.5)*8} ${(rnd()-.5)*8}) rotate(${(rnd()-.5)*7} ${cx} ${cy})`}><CuteStamp kind={kind} cx={cx} cy={cy} r={r*1.04} color={color} ink={ink}/></g>
    <CuteStamp kind={kind} cx={cx} cy={cy} r={r} color={color} ink={ink}/>
    <circle cx={cx} cy={cy} r={r*1.18} fill="none" stroke={color} strokeWidth={3} opacity=".16" strokeDasharray="4 10"/>
    {Array.from({length:7},(_,i)=>{const a=rnd()*Math.PI*2,d=r*(.78+rnd()*.72);return <circle key={i} cx={cx+Math.cos(a)*d} cy={cy+Math.sin(a)*d} r={1.5+rnd()*5} fill={color} opacity={.18+rnd()*.32}/>})}
  </g>;
}

function FxArt({fx}:{fx:CanvasFx}){
  const rnd=seeded(fx.seed),cx=fx.x*1000,cy=fx.y*700;
  if(fx.kind==='boom')return <g className="canvas-fx fx-boom">{Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2,len=45+rnd()*60;return <path key={i} d={`M ${cx+Math.cos(a)*12} ${cy+Math.sin(a)*12} L ${cx+Math.cos(a)*len} ${cy+Math.sin(a)*len}`} stroke={fx.color} strokeWidth={3+rnd()*5} strokeLinecap="round"/>})}<circle cx={cx} cy={cy} r="22" fill="none" stroke={fx.color} strokeWidth="6"/></g>;
  if(fx.kind==='stamp'){
    const kind=fx.stampKind||'star';
    if(kind==='rocket')return <g className="canvas-fx fx-stamp fx-rocket">{Array.from({length:6},(_,i)=><path key={i} d={`M ${cx+(i-2.5)*7} ${cy+18+i*3} l ${-(i-2.5)*4} ${42+rnd()*25}`} stroke={fx.color} strokeWidth={3+rnd()*4} strokeLinecap="round" opacity={.35+rnd()*.4}/>)}<circle cx={cx} cy={cy} r="42" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
    if(kind==='frog')return <g className="canvas-fx fx-stamp fx-frog">{[28,48,70].map((r,i)=><ellipse key={r} cx={cx} cy={cy+i*3} rx={r} ry={r*.55} fill="none" stroke={fx.color} strokeWidth={4-i} opacity={.65-i*.14}/>)}</g>;
    if(kind==='flower')return <g className="canvas-fx fx-stamp fx-flower">{Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <circle key={i} cx={cx+Math.cos(a)*42} cy={cy+Math.sin(a)*42} r={9+rnd()*7} fill={fx.color} opacity=".42"/>})}<circle cx={cx} cy={cy} r="26" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
    if(kind==='lightning')return <g className="canvas-fx fx-stamp fx-lightning">{Array.from({length:5},(_,i)=><path key={i} d={`M ${cx-18+rnd()*36} ${cy-48-rnd()*20} l ${-8+rnd()*16} ${28+rnd()*15} l ${12-rnd()*24} ${26+rnd()*20}`} fill="none" stroke={fx.color} strokeWidth={3+rnd()*4} strokeLinecap="round" strokeLinejoin="round"/> )}</g>;
    if(kind==='cat')return <g className="canvas-fx fx-stamp fx-cat"><circle cx={cx-35} cy={cy+28} r="8" fill={fx.color}/><circle cx={cx-8} cy={cy+40} r="6" fill={fx.color}/><path d={`M ${cx-76} ${cy-8} Q ${cx} ${cy-34} ${cx+76} ${cy-8}`} fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="9 10"/><path d={`M ${cx-68} ${cy+8} Q ${cx} ${cy+32} ${cx+68} ${cy+8}`} fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="9 10"/></g>;
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
  const [stampKind,setStampKind]=useState<StampKind>('star');
  const [paletteIndex,setPaletteIndex]=useState(0);
  const [state,setState]=useState<TransportState>(()=>initialTransport());
  const [showWorlds,setShowWorlds]=useState(false);
  const [hoverPoint,setHoverPoint]=useState<CanvasPoint|null>(null);
  const [effects,setEffects]=useState<CanvasFx[]>([]);
  const [bombState,setBombState]=useState<'idle'|'arming'|'boom'>('idle');
  const lastLiveAudition=useRef(0);
  const bombTimer=useRef<number|null>(null);
  const song=useMemo(()=>interpretCanvas(marks,worldId),[marks,worldId]);
  useEffect(()=>{ if(!world.stamps.some(s=>s.id===stampKind)) setStampKind(world.stamps[0]?.id||'star'); },[worldId]);

  useEffect(()=>{transport.setSong(song,true,true);},[song]);
  useEffect(()=>transport.subscribe(setState),[]);
  useEffect(()=>()=>transport.stop(),[]);

  const pointFromEvent=(e:React.PointerEvent<SVGSVGElement>):CanvasPoint=>{const r=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  const addEffect=useCallback((mark:CanvasMark,kind:CanvasFx['kind'])=>{const p=mark.points[mark.points.length-1]||mark.points[0]||{x:.5,y:.5};const sound=WORLD_MAP[worldId].palette[mark.paletteIndex%WORLD_MAP[worldId].palette.length];const fx={id:`fx_${Date.now()}_${Math.random()}`,x:p.x,y:p.y,color:sound.color,ink:sound.ink,kind,seed:mark.seed,stampKind:mark.stampKind};setEffects(prev=>[...prev.slice(-10),fx]);window.setTimeout(()=>setEffects(prev=>prev.filter(x=>x.id!==fx.id)),650);},[worldId]);
  const audition=useCallback((mark:CanvasMark,live=false)=>{transport.auditionPhrase(interpretMark(mark,worldId),live);},[worldId]);
  const commit=useCallback((mark:CanvasMark,kind:CanvasFx['kind'])=>{const frozen=freezeMark(mark,worldId);setMarks(prev=>[...prev,frozen]);audition(frozen,false);addEffect(frozen,kind);},[addEffect,audition,worldId]);
  const eraseAt=useCallback((p:CanvasPoint)=>{setMarks(prev=>prev.map(mark=>eraseMarkAt(mark,p,worldId,.050)).filter((mark):mark is CanvasMark=>Boolean(mark)));},[worldId]);

  const cancelBomb=useCallback(()=>{if(bombTimer.current!==null){window.clearTimeout(bombTimer.current);bombTimer.current=null;}setBombState(state=>state==='boom'?state:'idle');},[]);
  const startBomb=useCallback(()=>{
    if(!marks.length||bombState!=='idle')return;
    setBombState('arming');
    bombTimer.current=window.setTimeout(()=>{
      bombTimer.current=null;setBombState('boom');transport.stop();
      window.setTimeout(()=>{setMarks([]);setDraft(null);setEffects([]);},160);
      window.setTimeout(()=>setBombState('idle'),650);
    },1000);
  },[marks.length,bombState]);
  useEffect(()=>()=>{if(bombTimer.current!==null)window.clearTimeout(bombTimer.current);},[]);

  const pointerDown=(e:React.PointerEvent<SVGSVGElement>)=>{
    const p=pointFromEvent(e);
    if(bombState==='arming'){cancelBomb();return;}
    e.currentTarget.setPointerCapture(e.pointerId);setHoverPoint(p);
    if(tool==='eraser'){eraseAt(p);return;}
    const next:CanvasMark={id:`m_${Date.now()}_${Math.floor(Math.random()*1e5)}`,paletteIndex,tool,points:[tool==='fill'?{x:.5,y:.5}:p],size:.86+Math.random()*.26,seed:Math.floor(Math.random()*1e9),stampKind:tool==='stamp'?stampKind:undefined};
    if(tool==='fill'){commit(next,'scribble');setDraft(null);return;}
    if(tool==='stamp'||tool==='boom'){commit(next,tool==='boom'?'boom':'stamp');setDraft(null);return;}
    setDraft(next);lastLiveAudition.current=performance.now()-1000;
  };
  const pointerMove=(e:React.PointerEvent<SVGSVGElement>)=>{
    const p=pointFromEvent(e);setHoverPoint(p);
    if(tool==='eraser'&&(e.buttons&1)){eraseAt(p);return;}
    if(!draft||!(e.buttons&1))return;
    const last=draft.points[draft.points.length-1],min=draft.tool==='dots'?.034:draft.tool==='spray'?.019:.012;if(Math.hypot(last.x-p.x,last.y-p.y)<min)return;
    const next={...draft,points:[...draft.points,p]};setDraft(next);
    const now=performance.now();
    const behavior=world.palette[next.paletteIndex%world.palette.length]?.behavior;
    const heavyLine=next.tool==='crayon'&&(behavior==='bass'||behavior==='harmony');
    const interval=heavyLine?145:next.tool==='crayon'?90:next.tool==='dots'?100:112;
    if(now-lastLiveAudition.current>interval){
      const tiny={...next,id:`live_${next.id}`,points:next.points.slice(heavyLine?-2:-5)};
      audition(tiny,true);lastLiveAudition.current=now;
    }
  };
  const pointerUp=(e:React.PointerEvent<SVGSVGElement>)=>{try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{/* noop */}if(draft){commit(draft,'scribble');setDraft(null);}};

  const chooseWorld=(id:WorldId)=>{transport.stop();setWorldId(id);setShowWorlds(false);setPaletteIndex(0);setStampKind(WORLD_MAP[id].stamps[0]?.id||'star');};
  const undo=()=>{setMarks(prev=>prev.slice(0,-1));};
  const progress=song.totalDuration?Math.max(0,Math.min(1,state.currentTime/song.totalDuration)):0;
  const rawDisplayMarks=draft?[...marks,draft]:marks,displayMarks=[...rawDisplayMarks].sort((a,b)=>(a.tool==='fill'?0:1)-(b.tool==='fill'?0:1)),palette=world.palette;
  const activeIds=useMemo(()=>{if(!state.isPlaying)return new Set<string>();const set=new Set<string>();displayMarks.forEach(m=>{const b=markBounds(m);if(progress>=b.minX-.008&&progress<=b.maxX+.012)set.add(m.id);});return set;},[displayMarks,progress,state.isPlaying]);

  return <div className={`paint-app world-${worldId}`} style={{'--canvas':world.canvas,'--ink':world.canvasInk,'--accent':world.accent} as React.CSSProperties} onPointerDownCapture={e=>{if(bombState==='arming' && !(e.target as HTMLElement).closest('.bomb-reset')) cancelBomb();}}>
    <header className="tiny-topbar">
      <div className="little-brand"><span>a</span><b>aura</b></div>
      <div className="tiny-actions">
        <button onClick={undo} disabled={!marks.length||bombState!=='idle'} aria-label="Undo last mark"><RotateCcw size={18}/></button>
        <button className={`bomb-reset ${bombState!=='idle'?`is-${bombState}`:''}`} disabled={!marks.length&&bombState==='idle'} aria-label={bombState==='arming'?'Bomb lit. Touch anywhere to cancel':'Clear the whole drawing'} onClick={e=>{e.stopPropagation();bombState==='arming'?cancelBomb():startBomb();}}><Bomb size={19}/><i/></button>
      </div>
    </header>

    <main className="canvas-stage">
      <div className={`music-paper ${marks.length?'has-marks':''} ${state.isPlaying?'playing':''}`}>
        {bombState==='boom'&&<div className="reset-boom" aria-hidden="true"><b>✹</b><i/><i/><i/><i/><i/><i/></div>}
        {!marks.length&&!draft&&<div className="empty-whisper" aria-hidden="true"><i/><span>draw something noisy</span><i/></div>}
        <svg className="music-canvas" viewBox="0 0 1000 700" preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={()=>setHoverPoint(null)}>
          <rect width="1000" height="700" fill="transparent"/>
          {displayMarks.map(mark=>{const sound=palette[mark.paletteIndex%palette.length],maskId=`erase_${mark.id.replace(/[^a-zA-Z0-9_]/g,'_')}`;return <g key={mark.id}>{mark.erasures?.length?<defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="700"><rect width="1000" height="700" fill="white"/>{mark.erasures.map((hole,i)=><ellipse key={i} cx={hole.x*1000} cy={hole.y*700} rx={(hole.radius??.05)*820} ry={(hole.radius??.05)*700} fill="black"/>)}</mask></defs>:null}<g mask={mark.erasures?.length?`url(#${maskId})`:undefined}><MarkArt mark={mark} color={sound.color} ink={sound.ink} active={activeIds.has(mark.id)}/></g></g>;})}
          {effects.map(fx=><FxArt key={fx.id} fx={fx}/>)}
          {hoverPoint&&tool!=='eraser'&&<circle className="brush-cursor" cx={hoverPoint.x*1000} cy={hoverPoint.y*700} r={tool==='boom'?35:tool==='stamp'?29:tool==='fill'?24:12} fill={palette[paletteIndex].color}/>} 
          {hoverPoint&&tool==='eraser'&&<g className="eraser-cursor"><circle cx={hoverPoint.x*1000} cy={hoverPoint.y*700} r="36"/><path d={`M ${hoverPoint.x*1000-15} ${hoverPoint.y*700+8} l 30 -16`}/></g>}
        </svg>
        <div className="playhead" style={{left:`${progress*100}%`,opacity:state.isPlaying?1:.16}}><i/></div>
      </div>
    </main>

    <section className="playground-dock" aria-label="Musical drawing toys">
      <div className="toy-shelf">
        <div className="shelf-colors" role="group" aria-label="Sound colors">
          {palette.map((c,i)=><button key={`${worldId}_${i}`} className={`paint-pot ${paletteIndex===i?'active':''}`} onClick={()=>{setPaletteIndex(i);if(tool==='eraser')setTool('crayon');}} aria-label={c.name} title={c.name}><span style={{background:c.color}}/><small>{paletteIndex===i?c.name:''}</small></button>)}
        </div>
        <div className="shelf-tools" role="group" aria-label="Drawing toys">
          {TOOLS.map(t=><button key={t.id} className={`toy-tool ${tool===t.id?'active':''}`} onClick={()=>setTool(t.id)} aria-label={t.label}><b>{t.id==='fill'?<PaintBucket size={19}/>:t.glyph}</b><span>{t.label}</span></button>)}
        </div>
      </div>

      {tool==='stamp'&&<div className="stamp-tray" role="group" aria-label="Stamp shapes">{world.stamps.map(s=><button key={s.id} className={stampKind===s.id?'active':''} onClick={()=>setStampKind(s.id)} aria-label={s.label} title={s.label}><b>{s.glyph}</b><small>{(world.id==='flamenco'||world.id==='tango')?s.label:''}</small></button>)}</div>}

      <div className="play-row">
        <button className={`giant-play ${state.isPlaying?'is-playing':''}`} onClick={()=>marks.length?transport.togglePlay():undefined} disabled={!marks.length} aria-label={state.isPlaying?'Pause drawing':'Play drawing'}>
          {state.isPlaying?<Pause size={27} fill="currentColor"/>:<Play size={29} fill="currentColor"/>}
        </button>
        <div className="transport-scrub">
          <input aria-label="Move through your drawing" type="range" min="0" max="1000" step="1" value={Math.round(progress*1000)} style={{'--seek-fill':`${progress*100}%`} as React.CSSProperties} onChange={e=>transport.seek((Number(e.target.value)/1000)*song.totalDuration)} disabled={!marks.length}/>
        </div>
        <button className="world-pill" onClick={()=>setShowWorlds(true)} aria-label={`Change world. Current world ${world.label}`}><span className="world-dots">{palette.slice(0,3).map((c,i)=><i key={i} style={{background:c.color}}/>)}</span><b>{world.label}</b><small>swap</small></button>
      </div>
    </section>

    {showWorlds&&<WorldSheet current={worldId} onPick={chooseWorld} onClose={()=>setShowWorlds(false)}/>} 
  </div>;
}
