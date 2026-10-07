import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Bomb, Eraser, PaintBucket, Pause, Pencil, Play, RotateCcw, X } from 'lucide-react';
import { transport } from './audio/engine';
import type { TransportState } from './audio/types';
import { WORLD_MAP, WORLDS, createGestureStats, eraseMarkAt, extendGestureStats, freezeMark, interpretCanvas, interpretMark, performFloodFill, randomWorld, } from './music/canvasMusic';
import type { CanvasMark, CanvasPoint, CanvasTool, Performer, StampKind, WorldId } from './music/canvasTypes';
import { atOrThrow, cyclicAt, firstOrThrow, lastOrThrow } from './utils/arrays';
function withoutGeneratedState(mark: CanvasMark, points: CanvasPoint[], id = mark.id): CanvasMark {
    const copy: CanvasMark = { ...mark, id, points };
    delete copy.gesture;
    delete copy.performance;
    return copy;
}
function initialTransport(): TransportState { return { isPlaying: false, isPreparing: false, currentTime: 0, totalDuration: 0, isReady: transport.isReady() }; }
const TOOLS: {
    id: CanvasTool;
    label: string;
    description: string;
}[] = [
    { id: 'crayon', label: 'Crayon', description: 'Crayon: draw musical lines' },
    { id: 'dots', label: 'Dots', description: 'Dots: staccato rhythmic beats' },
    { id: 'spray', label: 'Spray can', description: 'Spray can: aerosol splatter mist' },
    { id: 'stamp', label: 'Stamp', description: 'Stamp: rhythmic animal and shape stamps' },
    { id: 'boom', label: 'Boom', description: 'Boom: explosive crash burst' },
    { id: 'fill', label: 'Fill', description: 'Fill: wash background harmony' },
    { id: 'eraser', label: 'Eraser', description: 'Eraser: clear marks' },
];
function DotsIcon({ size = 21 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="3" />
            <circle cx="12" cy="12" r="3.6" />
            <circle cx="19" cy="12" r="3" />
        </svg>
    );
}
function SprayCanIcon({ size = 21, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="9.5" width="10" height="12.5" rx="2" />
            <path d="M 5 9.5 C 5 7.8 7 6.8 9 6.8 C 11 6.8 13 7.8 13 9.5" />
            <rect x="7.5" y="4.2" width="3" height="2.6" rx="0.6" fill="currentColor" />
            <path d="M 14.5 4.8 L 19.5 2.8" strokeWidth={Math.max(1.5, strokeWidth * 0.8)} />
            <path d="M 15 7.2 L 20.5 7.2" strokeWidth={Math.max(1.5, strokeWidth * 0.8)} />
            <path d="M 14.5 9.6 L 19.5 11.6" strokeWidth={Math.max(1.5, strokeWidth * 0.8)} />
            <circle cx="18" cy="4.8" r="0.8" fill="currentColor" stroke="none" />
            <circle cx="17.5" cy="9.4" r="0.8" fill="currentColor" stroke="none" />
        </svg>
    );
}
function RubberStampIcon({ size = 21, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="4.8" r="2.6" />
            <path d="M 12 7.4 L 12 11.2" />
            <path d="M 6.8 15.2 L 9.2 11.2 L 14.8 11.2 L 17.2 15.2 Z" fill="currentColor" fillOpacity="0.14" />
            <rect x="4.5" y="15.2" width="15" height="3.8" rx="1.2" />
            <path d="M 6 21.5 L 18 21.5" strokeDasharray="3.2 2" strokeWidth={Math.max(1.6, strokeWidth * 0.8)} />
        </svg>
    );
}
function BoomIcon({ size = 21, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon
                points="12,2 14.8,7.8 21.2,5.8 17.5,11.8 22,15.8 15.8,16.5 16.2,22 11.5,18 7,21.5 8.2,15.5 2,14.5 7,10.2 3.5,4.8 9.8,6.8"
                fill="currentColor"
                fillOpacity="0.18"
            />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        </svg>
    );
}
type CanvasFx = {
    id: string;
    x: number;
    y: number;
    color: string;
    kind: 'scribble' | 'stamp' | 'boom' | 'fill';
    seed: number;
    stampKind?: StampKind;
};
function seeded(seed: number) { let s = seed || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function pathFrom(points: CanvasPoint[], dx = 0, dy = 0) {
    if (!points.length)
        return '';
    if (points.length === 1) {
        const point = firstOrThrow(points, 'path points');
        return `M ${point.x * 1000 + dx} ${point.y * 700 + dy} l .01 .01`;
    }
    let path = '';
    for (let index = 0; index < points.length; index++) {
        const point = atOrThrow(points, index, 'path points');
        path += `${index ? 'L' : 'M'} ${point.x * 1000 + dx} ${point.y * 700 + dy} `;
    }
    return path;
}
function starPoints(cx: number, cy: number, r: number, n = 5) { const pts: string[] = []; for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 === 0 ? r : r * .43;
    pts.push(`${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`);
} return pts.join(' '); }
function CuteStamp({ kind, cx, cy, r, color, ink, monochrome = false, withSeal = false }: {
    kind: StampKind;
    cx: number;
    cy: number;
    r: number;
    color: string;
    ink: string;
    monochrome?: boolean;
    withSeal?: boolean;
}) {
    const c = monochrome ? 'currentColor' : color;
    const i = monochrome ? 'currentColor' : ink;
    const fillBase = monochrome ? 'none' : color;
    const strokeWidth = monochrome ? Math.max(1.8, r * 0.08) : Math.max(1.8, r * 0.05);
    const seal = withSeal ? (
      <g className="stamp-seal" opacity={monochrome ? ".55" : ".38"}>
        <circle cx={cx} cy={cy} r={r * 1.08} fill="none" stroke={i} strokeWidth={Math.max(1.6, r * .042)} strokeDasharray={`${r * .24} ${r * .08}`}/>
        <circle cx={cx} cy={cy} r={r * 1.02} fill="none" stroke={i} strokeWidth={Math.max(1, r * .024)} opacity=".6"/>
      </g>
    ) : null;
    if (kind === 'cat') {
        return <g>
      {seal}
      <path d={`M ${cx - r * .62} ${cy - r * .26} L ${cx - r * .58} ${cy - r * .94} L ${cx - r * .16} ${cy - r * .58} Q ${cx} ${cy - r * .68} ${cx + r * .16} ${cy - r * .58} L ${cx + r * .58} ${cy - r * .94} L ${cx + r * .62} ${cy - r * .26} Q ${cx + r * .74} ${cy + r * .66} ${cx} ${cy + r * .72} Q ${cx - r * .74} ${cy + r * .66} ${cx - r * .62} ${cy - r * .26} Z`} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/>
      <polygon points={`${cx - r * .46},${cy - r * .36} ${cx - r * .46},${cy - r * .76} ${cx - r * .22},${cy - r * .52}`} fill={i} opacity=".25"/>
      <polygon points={`${cx + r * .46},${cy - r * .36} ${cx + r * .46},${cy - r * .76} ${cx + r * .22},${cy - r * .52}`} fill={i} opacity=".25"/>
      <circle cx={cx - r * .38} cy={cy + r * .22} r={r * .13} fill={i} opacity=".15"/>
      <circle cx={cx + r * .38} cy={cy + r * .22} r={r * .13} fill={i} opacity=".15"/>
      <circle cx={cx - r * .24} cy={cy - r * .06} r={r * .085} fill={i}/>
      <circle cx={cx - r * .21} cy={cy - r * .09} r={r * .03} fill={monochrome ? 'var(--canvas,#fff)' : c}/>
      <circle cx={cx + r * .24} cy={cy - r * .06} r={r * .085} fill={i}/>
      <circle cx={cx + r * .27} cy={cy - r * .09} r={r * .03} fill={monochrome ? 'var(--canvas,#fff)' : c}/>
      <polygon points={`${cx - r * .07},${cy + r * .10} ${cx + r * .07},${cy + r * .10} ${cx},${cy + r * .18}`} fill={i}/>
      <path d={`M ${cx - r * .14} ${cy + r * .25} Q ${cx - r * .07} ${cy + r * .34} ${cx} ${cy + r * .24} Q ${cx + r * .07} ${cy + r * .34} ${cx + r * .14} ${cy + r * .25}`} fill="none" stroke={i} strokeWidth={strokeWidth} strokeLinecap="round"/>
      {[-1, 1].map(side => <g key={side}>
        <path d={`M ${cx + side * r * .20} ${cy + r * .15} L ${cx + side * r * .72} ${cy + r * .08}`} stroke={i} strokeWidth={Math.max(1.5, r * .035)} strokeLinecap="round"/>
        <path d={`M ${cx + side * r * .20} ${cy + r * .24} L ${cx + side * r * .74} ${cy + r * .26}`} stroke={i} strokeWidth={Math.max(1.5, r * .035)} strokeLinecap="round"/>
      </g>)}
    </g>;
    }
    if (kind === 'frog') {
        return <g>
      {seal}
      <circle cx={cx - r * .40} cy={cy - r * .28} r={r * .30} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/>
      <circle cx={cx + r * .40} cy={cy - r * .28} r={r * .30} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/>
      <ellipse cx={cx} cy={cy + r * .18} rx={r * .75} ry={r * .54} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/>
      <circle cx={cx - r * .40} cy={cy - r * .28} r={r * .14} fill={i}/>
      <circle cx={cx - r * .36} cy={cy - r * .32} r={r * .05} fill={monochrome ? 'var(--canvas,#fff)' : c}/>
      <circle cx={cx + r * .40} cy={cy - r * .28} r={r * .14} fill={i}/>
      <circle cx={cx + r * .44} cy={cy - r * .32} r={r * .05} fill={monochrome ? 'var(--canvas,#fff)' : c}/>
      <circle cx={cx - r * .07} cy={cy + r * .08} r={r * .025} fill={i} opacity=".6"/>
      <circle cx={cx + r * .07} cy={cy + r * .08} r={r * .025} fill={i} opacity=".6"/>
      <path d={`M ${cx - r * .44} ${cy + r * .18} Q ${cx} ${cy + r * .55} ${cx + r * .44} ${cy + r * .18}`} fill="none" stroke={i} strokeWidth={Math.max(2.2, r * .065)} strokeLinecap="round"/>
      <ellipse cx={cx - r * .46} cy={cy + r * .28} rx={r * .12} ry={r * .08} fill={i} opacity=".22"/>
      <ellipse cx={cx + r * .46} cy={cy + r * .28} rx={r * .12} ry={r * .08} fill={i} opacity=".22"/>
    </g>;
    }
    if (kind === 'panda') {
        const earR = r * .36;
        const earInnerR = r * .18;
        const earX = r * .54;
        const earY = r * .62;
        const earStroke = monochrome ? i : (fillBase !== 'none' ? fillBase : 'var(--canvas,#fff)');
        return <g>
      {seal}
      <circle cx={cx - earX} cy={cy - earY} r={earR} fill={i} stroke={earStroke} strokeWidth={Math.max(2.4, r * 0.08)}/>
      <circle cx={cx + earX} cy={cy - earY} r={earR} fill={i} stroke={earStroke} strokeWidth={Math.max(2.4, r * 0.08)}/>
      <circle cx={cx - earX} cy={cy - earY} r={earInnerR} fill={monochrome ? 'var(--canvas,#fff)' : c} opacity={monochrome ? .4 : .88}/>
      <circle cx={cx + earX} cy={cy - earY} r={earInnerR} fill={monochrome ? 'var(--canvas,#fff)' : c} opacity={monochrome ? .4 : .88}/>
      <ellipse cx={cx} cy={cy} rx={r * .72} ry={r * .70} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/>
      <ellipse cx={cx - r * .28} cy={cy - r * .12} rx={r * .20} ry={r * .27} transform={`rotate(24 ${cx - r * .28} ${cy - r * .12})`} fill={i} opacity=".85"/>
      <ellipse cx={cx + r * .28} cy={cy - r * .12} rx={r * .20} ry={r * .27} transform={`rotate(-24 ${cx + r * .28} ${cy - r * .12})`} fill={i} opacity=".85"/>
      <circle cx={cx - r * .25} cy={cy - r * .12} r={r * .06} fill={monochrome ? 'var(--canvas,#fff)' : c}/>
      <circle cx={cx + r * .25} cy={cy - r * .12} r={r * .06} fill={monochrome ? 'var(--canvas,#fff)' : c}/>
      <ellipse cx={cx} cy={cy + r * .14} rx={r * .13} ry={r * .095} fill={i}/>
      <path d={`M ${cx - r * .13} ${cy + r * .27} Q ${cx} ${cy + r * .38} ${cx + r * .13} ${cy + r * .27}`} fill="none" stroke={i} strokeWidth={Math.max(2.2, r * .06)} strokeLinecap="round"/>
      <circle cx={cx - r * .43} cy={cy + r * .26} r={r * .10} fill={i} opacity=".18"/>
      <circle cx={cx + r * .43} cy={cy + r * .26} r={r * .10} fill={i} opacity=".18"/>
    </g>;
    }
    if (kind === 'star')
        return <g>{seal}<polygon points={starPoints(cx, cy, r, 5)} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/><circle cx={cx - r * .22} cy={cy - r * .05} r={r * .07} fill={i}/><circle cx={cx + r * .22} cy={cy - r * .05} r={r * .07} fill={i}/><path d={`M ${cx - r * .2} ${cy + r * .18} Q ${cx} ${cy + r * .35} ${cx + r * .2} ${cy + r * .18}`} fill="none" stroke={i} strokeWidth={Math.max(2, r * .06)} strokeLinecap="round"/></g>;
    if (kind === 'rocket')
        return <g transform={`translate(${cx} ${cy}) rotate(12)`}>{seal}<path d={`M 0 ${-r} Q ${r * .58} ${-r * .18} ${r * .35} ${r * .62} L 0 ${r * .42} L ${-r * .35} ${r * .62} Q ${-r * .58} ${-r * .18} 0 ${-r}`} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/><circle cy={-r * .2} r={r * .2} fill={monochrome ? 'none' : i} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth} opacity={monochrome ? 1 : .18}/><path d={`M ${-r * .2} ${r * .48} L 0 ${r * 1.06} L ${r * .2} ${r * .48}`} stroke={i} strokeWidth={monochrome ? strokeWidth : 1} fill={i} opacity={monochrome ? 1 : .45}/></g>;
    if (kind === 'flower')
        return <g>{seal}{Array.from({ length: 7 }, (_, idx) => { const a = idx * Math.PI * 2 / 7; return <ellipse key={idx} cx={cx + Math.cos(a) * r * .45} cy={cy + Math.sin(a) * r * .45} rx={r * .28} ry={r * .42} transform={`rotate(${a * 180 / Math.PI + 90} ${cx + Math.cos(a) * r * .45} ${cy + Math.sin(a) * r * .45})`} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/>; })}<circle cx={cx} cy={cy} r={r * .3} fill={i} opacity=".25"/><circle cx={cx} cy={cy} r={r * .14} fill={monochrome ? 'var(--canvas,#fff)' : c}/></g>;
    if (kind === 'lightning')
        return <g transform={`translate(${cx} ${cy}) rotate(8)`}>{seal}<path d={`M ${r * .12} ${-r} L ${-r * .56} ${r * .03} L ${-r * .08} ${r * .03} L ${-r * .32} ${r} L ${r * .62} ${-r * .18} L ${r * .1} ${-r * .18} Z`} fill={fillBase} stroke={monochrome ? i : 'none'} strokeWidth={strokeWidth}/><path d={`M ${r * .05} ${-r * .75} L ${-r * .28} ${-r * .06}`} stroke={i} strokeWidth={Math.max(2, r * .06)} opacity=".28"/></g>;
    return null;
}
function StampToolbarIcon({ kind, size = 21 }: {
    kind: StampKind;
    size?: number;
}) {
    if (kind === 'cat') {
        return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5c-4 0-7 2.5-7 6 0 4.5 3 7 7 7s7-2.5 7-7c0-3.5-3-6-7-6Z"/>
      <path d="m5.5 8-2.5-4 4.5 1.5"/>
      <path d="m18.5 8 2.5-4-4.5 1.5"/>
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
      <path d="M10 15c.6.5 1.4.8 2 .8s1.4-.3 2-.8"/>
    </svg>;
    }
    if (kind === 'frog') {
        return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="8" r="3"/>
      <circle cx="17" cy="8" r="3"/>
      <circle cx="7" cy="8" r="1" fill="currentColor" stroke="none"/>
      <circle cx="17" cy="8" r="1" fill="currentColor" stroke="none"/>
      <path d="M4 14c0 4 3.6 7 8 7s8-3 8-7-3.6-5-8-5-8 1-8 5Z"/>
      <path d="M8 16c1.2 1.2 2.6 1.8 4 1.8s2.8-.6 4-1.8"/>
    </svg>;
    }
    if (kind === 'panda') {
        return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4.5" cy="5.5" r="3.5" fill="currentColor"/>
      <circle cx="19.5" cy="5.5" r="3.5" fill="currentColor"/>
      <circle cx="12" cy="13.5" r="7.5"/>
      <ellipse cx="8.5" cy="12.5" rx="1.8" ry="2.2"/>
      <ellipse cx="15.5" cy="12.5" rx="1.8" ry="2.2"/>
      <circle cx="8.5" cy="12.5" r=".8" fill="currentColor" stroke="none"/>
      <circle cx="15.5" cy="12.5" r=".8" fill="currentColor" stroke="none"/>
      <path d="M11 16.5h2"/>
    </svg>;
    }
    if (kind === 'star') {
        return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>;
    }
    if (kind === 'rocket') {
        return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <circle cx="15" cy="9" r="1.5"/>
    </svg>;
    }
    if (kind === 'flower') {
        return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 16.5A3.5 3.5 0 0 0 8.5 20a3.5 3.5 0 0 0 7 0 3.5 3.5 0 0 0-3.5-3.5Z"/>
      <path d="M12 7.5A3.5 3.5 0 0 0 15.5 4a3.5 3.5 0 0 0-7 0 3.5 3.5 0 0 0 3.5 3.5Z"/>
      <path d="M7.5 12A3.5 3.5 0 0 0 4 15.5a3.5 3.5 0 0 0 0-7A3.5 3.5 0 0 0 7.5 12Z"/>
      <path d="M16.5 12A3.5 3.5 0 0 0 20 8.5a3.5 3.5 0 0 0 0 7 3.5 3.5 0 0 0-3.5-3.5Z"/>
    </svg>;
    }
    return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>;
}
const MarkArt = memo(function MarkArt({ mark, color, ink }: {
    mark: CanvasMark;
    color: string;
    ink: string;
}) {
    const p = mark.points[0] || { x: .5, y: .5 }, path = pathFrom(mark.points), sw = Math.max(14, 22 * mark.size), rnd = seeded(mark.seed), cls = `mark mark-${mark.tool}`;
    if (mark.tool === 'fill') {
        // Fill masks stay color-independent so world changes can retint them.
        if (mark.fillMaskDataUrl) {
            const fillMaskId = `fill_${mark.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            const b = mark.bounds ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 }, x = b.minX * 1000, y = b.minY * 700, w = (b.maxX - b.minX) * 1000, h = (b.maxY - b.minY) * 700;
            return <g className={cls}>
        <defs><mask id={fillMaskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style={{ maskType: 'alpha' }} x="0" y="0" width="1000" height="700">
          <image href={mark.fillMaskDataUrl} x={x} y={y} width={w} height={h} preserveAspectRatio="none" pointerEvents="none" style={{ imageRendering: 'pixelated' }}/>
        </mask></defs>
        <rect width="1000" height="700" fill={color} mask={`url(#${fillMaskId})`}/>
      </g>;
        }
        return <g className={cls}><rect width="1000" height="700" fill={color}/></g>;
    }
    if (mark.tool === 'crayon') {
        return <g className={cls}>
      <path d={path} fill="none" stroke={color} strokeWidth={sw * 1.06} strokeLinecap="round" strokeLinejoin="round"/>
      <path d={path} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>
      <path d={path} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={Math.max(1.8, sw * 0.24)} strokeLinecap="round" strokeLinejoin="round"/>
    </g>;
    }
    if (mark.tool === 'dots')
        return <g className={cls}>{mark.points.map((pt, i) => { const r = 7 + mark.size * 7 + (i % 3); return <g key={i}><circle cx={pt.x * 1000} cy={pt.y * 700} r={r} fill={color}/>{i % 3 === 0 && <circle cx={pt.x * 1000} cy={pt.y * 700} r={r * 1.7} fill="none" stroke={color} strokeWidth={2.3} opacity=".26"/>}{i % 5 === 0 && <circle cx={pt.x * 1000 + r * 1.4} cy={pt.y * 700 - r * .8} r={r * .25} fill={color} opacity=".55"/>}</g>; })}</g>;
    if (mark.tool === 'spray') {
        const dots: Array<{
            x: number;
            y: number;
            r: number;
            op: number;
            dash?: boolean;
        }> = [];
        mark.points.forEach((pt, pi) => { const burst = 2 + Math.floor(rnd() * 10) + (pi % 5 === 0 ? 4 : 0), lean = (rnd() - .5) * 1.3; for (let i = 0; i < burst; i++) {
            const a = rnd() * Math.PI * 2 + lean, d = Math.pow(rnd(), 1.65) * (18 + rnd() * 58) * mark.size;
            dots.push({ x: pt.x * 1000 + Math.cos(a) * d + (rnd() - .5) * 10, y: pt.y * 700 + Math.sin(a) * d + (rnd() - .5) * 7, r: .8 + Math.pow(rnd(), 2) * 8.5, op: .18 + rnd() * .7, dash: i === 0 && pi % 3 === 0 });
        } if (rnd() > .58)
            dots.push({ x: pt.x * 1000 + (rnd() - .5) * 14, y: pt.y * 700 + (rnd() - .5) * 12, r: 3 + rnd() * 9, op: .48 + rnd() * .4 }); });
        // Hundreds of individual SVG circles per spray mark eventually dominate
        // paint/reconciliation cost. Quantize opacity very slightly and batch all
        // particles in each band into a single compound path.
        const opacity = [.22, .38, .54, .70, .86], buckets = opacity.map(() => [] as string[]), dashes: Array<{
            d: string;
            op: number;
            width: number;
        }> = [];
        const n = (v: number) => Math.round(v * 10) / 10;
        for (const d of dots) {
            if (d.dash) {
                dashes.push({ d: `M ${n(d.x - 8)} ${n(d.y + 4)} l ${n(16 + rnd() * 9)} ${n(-8 - rnd() * 6)}`, op: d.op, width: 2 + rnd() * 3 });
                continue;
            }
            const b = Math.max(0, Math.min(opacity.length - 1, Math.round((d.op - .18) / .7 * (opacity.length - 1)))), x = n(d.x), y = n(d.y), r = n(d.r);
            atOrThrow(buckets, b, 'spray opacity buckets').push(`M ${n(x - r)} ${y} a ${r} ${r} 0 1 0 ${n(r * 2)} 0 a ${r} ${r} 0 1 0 ${n(-r * 2)} 0`);
        }
        return <g className={cls}>{buckets.map((parts, i) => parts.length ? <path key={`p${i}`} d={parts.join(' ')} fill={color} opacity={opacity[i]}/> : null)}{dashes.map((d, i) => <path key={`d${i}`} d={d.d} stroke={color} strokeWidth={d.width} strokeLinecap="round" opacity={d.op}/>)}</g>;
    }
    if (mark.tool === 'boom') {
        const cx = p.x * 1000, cy = p.y * 700, r = 36 + mark.size * 29;
        return <g className={cls} transform={`translate(${cx} ${cy}) rotate(${(mark.seed % 17) - 8})`}><circle r={r * .42} fill={color} opacity=".92"/><circle r={r * .76} fill="none" stroke={color} strokeWidth={5} opacity=".3"/>{Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2, a2 = a + (rnd() - .5) * .18, len = r * (.85 + rnd() * .55); return <path key={i} d={`M ${Math.cos(a) * r * .45} ${Math.sin(a) * r * .45} L ${Math.cos(a2) * len} ${Math.sin(a2) * len}`} stroke={color} strokeWidth={4 + rnd() * 7} strokeLinecap="round"/>; })}{Array.from({ length: 10 }, (_, i) => { const a = rnd() * Math.PI * 2, d = r * (.7 + rnd() * .8); return <circle key={`d${i}`} cx={Math.cos(a) * d} cy={Math.sin(a) * d} r={2 + rnd() * 7} fill={color} opacity={.35 + rnd() * .5}/>; })}<circle r={r * .14} fill={ink} opacity=".18"/></g>;
    }
    const cx = p.x * 1000, cy = p.y * 700, r = 36 + mark.size * 25, kind = mark.stampKind ?? 'cat';
    return <g className={cls} shapeRendering="geometricPrecision">
    <CuteStamp kind={kind} cx={cx} cy={cy} r={r} color={color} ink={ink} withSeal={true}/>
  </g>;
});
const RenderedMark = memo(function RenderedMark({ mark, sound }: {
    mark: CanvasMark;
    sound: Performer;
}) {
    const maskId = `erase_${mark.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    return <g>
    {mark.erasures?.length ? <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="700"><rect width="1000" height="700" fill="white"/>{mark.erasures.map((hole, i) => <ellipse key={i} cx={hole.x * 1000} cy={hole.y * 700} rx={(hole.radius ?? .05) * 820} ry={(hole.radius ?? .05) * 700} fill="black"/>)}</mask></defs> : null}
    <g mask={mark.erasures?.length ? `url(#${maskId})` : undefined}><MarkArt mark={mark} color={sound.color} ink={sound.ink}/></g>
  </g>;
});
// Keep committed marks isolated from the live draft render path.
const MarksLayer = memo(function MarksLayer({ marks, palette }: {
    marks: CanvasMark[];
    palette: Performer[];
}) {
    const ordered = useMemo(() => [...marks].sort((a, b) => (a.tool === 'fill' ? 0 : 1) - (b.tool === 'fill' ? 0 : 1)), [marks]);
    return <>{ordered.map(mark => <RenderedMark key={mark.id} mark={mark} sound={cyclicAt(palette, mark.paletteIndex, 'mark palette')}/>)}</>;
});
function FxArt({ fx }: {
    fx: CanvasFx;
}) {
    const rnd = seeded(fx.seed), cx = fx.x * 1000, cy = fx.y * 700;
    if (fx.kind === 'fill')
        return <g className="canvas-fx fx-fill"><circle cx={cx} cy={cy} r="60" fill={fx.color} opacity=".85"/><circle cx={cx} cy={cy} r="120" fill="none" stroke={fx.color} strokeWidth="36" opacity=".5"/></g>;
    if (fx.kind === 'boom')
        return <g className="canvas-fx fx-boom">{Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2, len = 45 + rnd() * 60; return <path key={i} d={`M ${cx + Math.cos(a) * 12} ${cy + Math.sin(a) * 12} L ${cx + Math.cos(a) * len} ${cy + Math.sin(a) * len}`} stroke={fx.color} strokeWidth={3 + rnd() * 5} strokeLinecap="round"/>; })}<circle cx={cx} cy={cy} r="22" fill="none" stroke={fx.color} strokeWidth="6"/></g>;
    if (fx.kind === 'stamp') {
        const kind = fx.stampKind || 'cat';
        if (kind === 'cat')
            return <g className="canvas-fx fx-stamp fx-cat"><circle cx={cx - 35} cy={cy + 28} r="8" fill={fx.color}/><circle cx={cx - 8} cy={cy + 40} r="6" fill={fx.color}/><path d={`M ${cx - 76} ${cy - 8} Q ${cx} ${cy - 34} ${cx + 76} ${cy - 8}`} fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="9 10"/><path d={`M ${cx - 68} ${cy + 8} Q ${cx} ${cy + 32} ${cx + 68} ${cy + 8}`} fill="none" stroke={fx.color} strokeWidth="3" strokeDasharray="9 10"/></g>;
        if (kind === 'frog')
            return <g className="canvas-fx fx-stamp fx-frog">{[28, 48, 70].map((r, i) => <ellipse key={r} cx={cx} cy={cy + i * 3} rx={r} ry={r * .55} fill="none" stroke={fx.color} strokeWidth={4 - i} opacity={.65 - i * .14}/>)}</g>;
        if (kind === 'panda')
            return <g className="canvas-fx fx-stamp fx-panda">{[-1, 1].map(side => <g key={side}><circle cx={cx + side * 36} cy={cy - 26} r={15} fill={fx.color}/><circle cx={cx + side * 36} cy={cy - 26} r={8} fill="none" stroke="white" strokeWidth="2.5" opacity=".7"/><circle cx={cx + side * 25} cy={cy - 6} r={4} fill={fx.color}/><circle cx={cx + side * 37} cy={cy - 10} r={4} fill={fx.color}/><circle cx={cx + side * 47} cy={cy - 3} r={4} fill={fx.color}/></g>)}</g>;
        if (kind === 'rocket')
            return <g className="canvas-fx fx-stamp fx-rocket">{Array.from({ length: 6 }, (_, i) => <path key={i} d={`M ${cx + (i - 2.5) * 7} ${cy + 18 + i * 3} l ${-(i - 2.5) * 4} ${42 + rnd() * 25}`} stroke={fx.color} strokeWidth={3 + rnd() * 4} strokeLinecap="round" opacity={.35 + rnd() * .4}/>)}<circle cx={cx} cy={cy} r="42" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
        if (kind === 'flower')
            return <g className="canvas-fx fx-stamp fx-flower">{Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return <circle key={i} cx={cx + Math.cos(a) * 42} cy={cy + Math.sin(a) * 42} r={9 + rnd() * 7} fill={fx.color} opacity=".42"/>; })}<circle cx={cx} cy={cy} r="26" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
        if (kind === 'lightning')
            return <g className="canvas-fx fx-stamp fx-lightning">{Array.from({ length: 5 }, (_, i) => <path key={i} d={`M ${cx - 18 + rnd() * 36} ${cy - 48 - rnd() * 20} l ${-8 + rnd() * 16} ${28 + rnd() * 15} l ${12 - rnd() * 24} ${26 + rnd() * 20}`} fill="none" stroke={fx.color} strokeWidth={3 + rnd() * 4} strokeLinecap="round" strokeLinejoin="round"/>)}</g>;
        return <g className="canvas-fx fx-stamp fx-star">{Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5, r = 48 + rnd() * 35; return <path key={i} d={`M ${cx + Math.cos(a) * 18} ${cy + Math.sin(a) * 18} L ${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`} stroke={fx.color} strokeWidth={2.5 + rnd() * 3.5} strokeLinecap="round"/>; })}<circle cx={cx} cy={cy} r="25" fill="none" stroke={fx.color} strokeWidth="4"/></g>;
    }
    return <g className="canvas-fx fx-scribble">{Array.from({ length: 8 }, (_, i) => { const a = rnd() * Math.PI * 2, d = 18 + rnd() * 42; return <circle key={i} cx={cx + Math.cos(a) * d} cy={cy + Math.sin(a) * d} r={2 + rnd() * 5} fill={fx.color}/>; })}</g>;
}
function WorldSheet({ current, onPick, onClose }: {
    current: WorldId;
    onPick: (id: WorldId) => void;
    onClose: () => void;
}) {
    return <div className="world-sheet-backdrop" onPointerDown={onClose}>
    <section className="world-sheet" onPointerDown={(e: ReactPointerEvent<HTMLElement>) => e.stopPropagation()}>
      <div className="world-sheet-head"><strong>pick a world</strong><button onClick={onClose} aria-label="Close worlds"><X size={20}/></button></div>
      <div className="world-grid">
        {WORLDS.map(w => <button key={w.id} className={`world-card ${current === w.id ? 'active' : ''}`} onClick={() => onPick(w.id)}>
          <b>{w.label}</b>
        </button>)}
      </div>
    </section>
  </div>;
}
export default function App() {
    const [worldId, setWorldId] = useState<WorldId>(() => randomWorld());
    const world = WORLD_MAP[worldId];
    const [marks, setMarks] = useState<CanvasMark[]>([]);
    const [draft, setDraft] = useState<CanvasMark | null>(null);
    const [tool, setTool] = useState<CanvasTool>('crayon');
    const [stampKind, setStampKind] = useState<StampKind>('cat');
    const [paletteIndex, setPaletteIndex] = useState(0);
    const [state, setState] = useState<TransportState>(() => initialTransport());
    const [showWorlds, setShowWorlds] = useState(false);
    const [hoverPoint, setHoverPoint] = useState<CanvasPoint | null>(null);
    const [effects, setEffects] = useState<CanvasFx[]>([]);
    const [bombState, setBombState] = useState<'idle' | 'arming' | 'boom'>('idle');
    const lastLiveAudition = useRef(0);
    const livePerformanceStartedAt = useRef(0);
    const lastCapturedPointIndex = useRef(-1);
    const bombTimer = useRef<number | null>(null);
    const activePointerId = useRef<number | null>(null);
    const draftRef = useRef<CanvasMark | null>(null);
    const draftFrame = useRef<number | null>(null);
    const eraseQueue = useRef<CanvasPoint[]>([]);
    const eraseFrame = useRef<number | null>(null);
    const hoverRef = useRef<CanvasPoint | null>(null);
    const hoverFrame = useRef<number | null>(null);
    const canvasRect = useRef<{
        left: number;
        top: number;
        width: number;
        height: number;
    } | null>(null);
    const playheadRef = useRef<HTMLDivElement | null>(null);
    const scrubRef = useRef<HTMLInputElement | null>(null);
    const song = useMemo(() => interpretCanvas(marks, worldId), [marks, worldId]);
    useEffect(() => { transport.setSong(song); }, [song]);
    useEffect(() => transport.subscribe(next => {
        // Keep the 20Hz transport clock out of React's root render. Moving the
        // playhead and native range value imperatively is enough for time-only
        // ticks; React only receives meaningful/discrete transport changes.
        const progress = next.totalDuration ? Math.max(0, Math.min(1, next.currentTime / next.totalDuration)) : 0;
        if (playheadRef.current) {
            playheadRef.current.style.left = `${progress * 100}%`;
            playheadRef.current.style.opacity = next.isPlaying ? '1' : '.16';
        }
        if (scrubRef.current) {
            scrubRef.current.value = String(Math.round(progress * 1000));
            scrubRef.current.style.setProperty('--seek-fill', `${progress * 100}%`);
        }
        setState(prev => {
            if (prev.isPlaying && !next.isPlaying) {
                setEffects([]);
            }
            const sameDiscrete = prev.isPlaying === next.isPlaying && prev.isPreparing === next.isPreparing && prev.totalDuration === next.totalDuration && prev.isReady === next.isReady;
            const samePausedTime = next.isPlaying || Math.abs(prev.currentTime - next.currentTime) < .001;
            return sameDiscrete && samePausedTime ? prev : next;
        });
    }), []);
    useEffect(() => {
        const root = document.documentElement;
        let frame = 0;
        const syncViewport = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const height = window.visualViewport?.height ?? window.innerHeight;
                root.style.setProperty('--app-height', `${Math.max(1, Math.round(height))}px`);
                canvasRect.current = null;
            });
        };
        syncViewport();
        window.addEventListener('resize', syncViewport, { passive: true });
        window.addEventListener('orientationchange', syncViewport);
        window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', syncViewport);
            window.removeEventListener('orientationchange', syncViewport);
            window.visualViewport?.removeEventListener('resize', syncViewport);
            root.style.removeProperty('--app-height');
        };
    }, []);
    useEffect(() => {
        const unlock = () => {
            transport.unlockAudio();
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('pointerdown', unlock, { passive: true });
        window.addEventListener('keydown', unlock, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, []);
    const pointFromEvent = (e: ReactPointerEvent<SVGSVGElement>): CanvasPoint => { const r = canvasRect.current ?? e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    const addEffect = useCallback((mark: CanvasMark, kind: CanvasFx['kind']) => {
        const point = mark.points.length ? lastOrThrow(mark.points, 'effect mark points') : { x: .5, y: .5 };
        const sound = cyclicAt(WORLD_MAP[worldId].palette, mark.paletteIndex, `${worldId} palette`);
        const fx: CanvasFx = {
            id: `fx_${Date.now()}_${Math.random()}`,
            x: point.x,
            y: point.y,
            color: sound.color,
            kind,
            seed: mark.seed,
            ...(mark.stampKind !== undefined ? { stampKind: mark.stampKind } : {}),
        };
        setEffects(prev => [...prev.slice(-10), fx]);
        window.setTimeout(() => setEffects(prev => prev.filter(x => x.id !== fx.id)), 650);
    }, [worldId]);
    const audition = useCallback((mark: CanvasMark, live = false, onset = false) => transport.auditionPhrase(interpretMark(mark, worldId), live, onset), [worldId]);
    const captureLiveAudition = useCallback((mark: CanvasMark, played: ReturnType<typeof transport.auditionPhrase>, now: number) => {
        if (!played.length)
            return;
        let capture = mark.performance;
        if (!capture || capture.worldId !== worldId) {
            capture = { worldId, events: [] };
            mark.performance = capture;
        }
        const pointIndex = Math.max(0, mark.points.length - 1), gestureTime = Math.max(0, (now - livePerformanceStartedAt.current) / 1000);
        for (const note of played)
            capture.events.push({ ...note, pointIndex, gestureTime });
        lastCapturedPointIndex.current = pointIndex;
        // A normal stroke never approaches this. The bound only protects against a
        // pointer being held for minutes; when reached, thin the oldest interior
        // samples instead of dropping the newest musical motion.
        if (capture.events.length > 192) {
            const last = lastOrThrow(capture.events, 'captured performance events');
            capture.events = capture.events.filter((_, i) => i === 0 || i % 2 === 0);
            if (capture.events[capture.events.length - 1] !== last)
                capture.events.push(last);
            mark.performance = capture;
        }
    }, [worldId]);
    const commit = useCallback((mark: CanvasMark, kind: CanvasFx['kind'], preview = true) => { const frozen = freezeMark(mark); setMarks(prev => [...prev, frozen]); if (preview)
        audition(frozen, false); addEffect(frozen, kind); }, [addEffect, audition, worldId]);
    const auditionStamp = useCallback((kind: StampKind) => {
        const mark: CanvasMark = {
            id: `preview_stamp_${Date.now()}`,
            paletteIndex,
            tool: 'stamp',
            points: [{ x: .5, y: .5 }],
            size: 1,
            seed: Math.floor(Math.random() * 1e9),
            stampKind: kind,
            gesture: createGestureStats({ x: .5, y: .5 }),
        };
        audition(mark, false);
    }, [audition, paletteIndex]);
    const auditionColor = useCallback((index: number) => {
        void transport.unlockAudio();
        const mark: CanvasMark = {
            id: `preview_stamp_color_${Date.now()}`,
            paletteIndex: index,
            tool: 'stamp',
            points: [{ x: .5, y: .5 }],
            size: 1,
            seed: Math.floor(Math.random() * 1e9),
            stampKind,
            gesture: createGestureStats({ x: .5, y: .5 }),
        };
        audition(mark, false);
    }, [audition, stampKind]);
    const publishDraft = useCallback((mark: CanvasMark | null, immediate = false) => {
        draftRef.current = mark;
        if (immediate) {
            if (draftFrame.current !== null) {
                cancelAnimationFrame(draftFrame.current);
                draftFrame.current = null;
            }
            setDraft(mark ? { ...mark, points: [...mark.points], ...(mark.gesture ? { gesture: { ...mark.gesture } } : {}) } : null);
            return;
        }
        if (draftFrame.current !== null)
            return;
        draftFrame.current = requestAnimationFrame(() => { draftFrame.current = null; const value = draftRef.current; setDraft(value ? { ...value, points: [...value.points] } : null); });
    }, []);
    const publishHover = useCallback((point: CanvasPoint | null, immediate = false) => {
        hoverRef.current = point;
        if (immediate) {
            if (hoverFrame.current !== null) {
                cancelAnimationFrame(hoverFrame.current);
                hoverFrame.current = null;
            }
            setHoverPoint(point);
            return;
        }
        if (hoverFrame.current !== null)
            return;
        hoverFrame.current = requestAnimationFrame(() => { hoverFrame.current = null; setHoverPoint(hoverRef.current); });
    }, []);
    const flushErase = useCallback(() => {
        if (eraseFrame.current !== null) {
            cancelAnimationFrame(eraseFrame.current);
            eraseFrame.current = null;
        }
        const points = eraseQueue.current.splice(0);
        if (!points.length)
            return;
        setMarks(prev => {
            let next = prev;
            for (const p of points)
                next = next.map(mark => eraseMarkAt(mark, p, .050)).filter((mark): mark is CanvasMark => Boolean(mark));
            return next;
        });
    }, [worldId]);
    const eraseAt = useCallback((p: CanvasPoint) => {
        eraseQueue.current.push(p);
        if (eraseFrame.current !== null)
            return;
        eraseFrame.current = requestAnimationFrame(() => { eraseFrame.current = null; flushErase(); });
    }, [flushErase]);
    const cancelBomb = useCallback(() => {
        if (bombTimer.current !== null) {
            window.clearTimeout(bombTimer.current);
            bombTimer.current = null;
        }
        setEffects([]);
        transport.interruptPlayback();
        setBombState(state => state === 'boom' ? state : 'idle');
    }, []);
    const startBomb = useCallback(() => {
        if (!marks.length || bombState !== 'idle')
            return;
        setEffects([]);
        transport.interruptPlayback();
        setBombState('arming');
        bombTimer.current = window.setTimeout(() => {
            bombTimer.current = null;
            setBombState('boom');
            transport.stop();
            setEffects([]);
            window.setTimeout(() => { setMarks([]); publishDraft(null, true); }, 160);
            window.setTimeout(() => setBombState('idle'), 650);
        }, 1000);
    }, [marks.length, bombState, publishDraft]);
    useEffect(() => () => {
        if (bombTimer.current !== null)
            window.clearTimeout(bombTimer.current);
        if (draftFrame.current !== null)
            cancelAnimationFrame(draftFrame.current);
        if (eraseFrame.current !== null)
            cancelAnimationFrame(eraseFrame.current);
        if (hoverFrame.current !== null)
            cancelAnimationFrame(hoverFrame.current);
    }, []);
    const beginCanvasGesture = useCallback((p: CanvasPoint, pointerType: string) => {
        if (bombState === 'arming') {
            cancelBomb();
            return;
        }
        if (pointerType !== 'touch')
            publishHover(p, true);
        if (tool === 'eraser') {
            eraseAt(p);
            return;
        }
        if (tool === 'fill') {
            const result = performFloodFill(marks, p, world);
            const next: CanvasMark = {
                id: `m_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
                paletteIndex, tool: 'fill', points: [p], size: 1, seed: Math.floor(Math.random() * 1e9),
                fillMaskDataUrl: result.fillMaskDataUrl, bounds: result.bounds, gesture: createGestureStats(p),
            };
            const frozen = freezeMark(next);
            setMarks(prev => [...prev, frozen]);
            audition(frozen, false);
            addEffect(next, 'fill');
            publishDraft(null, true);
            return;
        }
        const next: CanvasMark = {
            id: `m_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
            paletteIndex,
            tool,
            points: [p],
            size: .86 + Math.random() * .26,
            seed: Math.floor(Math.random() * 1e9),
            ...(tool === 'stamp' ? { stampKind } : {}),
            gesture: createGestureStats(p),
        };
        if (tool === 'stamp' || tool === 'boom') {
            commit(next, tool === 'boom' ? 'boom' : 'stamp');
            publishDraft(null, true);
            return;
        }
        const now = performance.now();
        livePerformanceStartedAt.current = now;
        lastCapturedPointIndex.current = -1;
        next.performance = { worldId, events: [] };
        publishDraft(next, true);
        captureLiveAudition(next, audition(withoutGeneratedState(next, [p]), true, true), now);
        lastLiveAudition.current = now;
    }, [addEffect, audition, bombState, cancelBomb, captureLiveAudition, commit, eraseAt, marks, paletteIndex, publishDraft, publishHover, stampKind, tool, world, worldId]);
    const pointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
        if (bombState === 'arming') {
            cancelBomb();
            return;
        }
        if (activePointerId.current !== null && activePointerId.current !== e.pointerId)
            return;
        void transport.unlockAudio();
        if (!state.isReady)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        canvasRect.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        const p = pointFromEvent(e);
        activePointerId.current = e.pointerId;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        catch { /* implicit touch capture is enough */ }
        transport.interruptPlayback();
        beginCanvasGesture(p, e.pointerType);
    };
    const pointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
        const p = pointFromEvent(e);
        if (e.pointerType !== 'touch')
            publishHover(p);
        const isDrawing = activePointerId.current === e.pointerId;
        if (tool === 'eraser' && isDrawing) {
            eraseAt(p);
            return;
        }
        const current = draftRef.current;
        if (!current || !isDrawing)
            return;
        const last = lastOrThrow(current.points, 'active gesture points'), min = current.tool === 'dots' ? .034 : current.tool === 'spray' ? .019 : .012, dx = last.x - p.x, dy = last.y - p.y;
        if (dx * dx + dy * dy < min * min)
            return;
        // Keep full gesture data in refs and publish visual updates once per frame.
        current.points.push(p);
        current.gesture = extendGestureStats(current.gesture ?? createGestureStats(firstOrThrow(current.points, 'active gesture points')), p);
        const next = current;
        publishDraft(next);
        const now = performance.now();
        const role = world.palette[next.paletteIndex % world.palette.length]?.role;
        const heavyLine = next.tool === 'crayon' && (role === 'bass' || role === 'harmony');
        const interval = heavyLine ? 145 : next.tool === 'crayon' ? 90 : next.tool === 'dots' ? 100 : 112;
        if (now - lastLiveAudition.current > interval) {
            // Audition only the newest local gesture slice.
            const tiny = withoutGeneratedState(next, next.points.slice(heavyLine ? -2 : -5), `live_${next.id}`);
            captureLiveAudition(next, audition(tiny, true), now);
            lastLiveAudition.current = now;
        }
    };
    const pointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
        if (activePointerId.current !== e.pointerId)
            return;
        if (tool === 'eraser')
            flushErase();
        if (e.pointerType === 'touch')
            publishHover(null, true);
        activePointerId.current = null;
        canvasRect.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        catch { /* noop */ }
        const finalDraft = draftRef.current;
        if (finalDraft) {
            // Capture any final motion skipped by the audition throttle.
            const finalIndex = finalDraft.points.length - 1;
            if (finalIndex > lastCapturedPointIndex.current) {
                const role = world.palette[finalDraft.paletteIndex % world.palette.length]?.role, heavyLine = finalDraft.tool === 'crayon' && (role === 'bass' || role === 'harmony');
                const tiny = withoutGeneratedState(finalDraft, finalDraft.points.slice(heavyLine ? -2 : -5), `live_end_${finalDraft.id}`);
                const now = performance.now();
                captureLiveAudition(finalDraft, audition(tiny, true), now);
                lastLiveAudition.current = now;
            }
            // The captured live performance is the playback source.
            commit(finalDraft, 'scribble', false);
            publishDraft(null, true);
        }
    };
    const chooseWorld = (id: WorldId) => {
        if (id === worldId) {
            setShowWorlds(false);
            return;
        }
        transport.interruptPlayback();
        setEffects([]);
        activePointerId.current = null;
        eraseQueue.current = [];
        publishDraft(null, true);
        publishHover(null, true);
        setWorldId(id);
        setShowWorlds(false);
        setPaletteIndex(0);
        setStampKind(WORLD_MAP[id].stamps[0]?.id || 'cat');
    };
    const undo = () => {
        setEffects([]);
        setMarks(prev => prev.slice(0, -1));
    };
    const palette = world.palette;
    return <div className={`paint-app world-${worldId}`} style={{ '--canvas': world.canvas, '--ink': world.canvasInk, '--accent': world.accent } as CSSProperties} onPointerDownCapture={(e: ReactPointerEvent<HTMLDivElement>) => {
            if (bombState === 'arming' && !(e.target as HTMLElement).closest('.bomb-reset')) {
                setEffects([]);
                cancelBomb();
            }
        }}>
    <header className="tiny-topbar">
      <div className="little-brand">
        <span>d</span>
        <b>draw sounds</b>
        {!state.isReady && <span className="tuning-badge" aria-live="polite">tuning sounds...</span>}
      </div>
      <div className="tiny-actions">
        <button onClick={undo} disabled={!marks.length || bombState !== 'idle'} aria-label="Undo last mark"><RotateCcw size={18}/></button>
        <button className={`bomb-reset ${bombState !== 'idle' ? `is-${bombState}` : ''}`} disabled={!marks.length && bombState === 'idle'} aria-label={bombState === 'arming' ? 'Bomb lit. Touch anywhere to cancel' : 'Clear the whole drawing'} onClick={(e: {
        stopPropagation(): void;
    }) => { e.stopPropagation(); setEffects([]); transport.interruptPlayback(); bombState === 'arming' ? cancelBomb() : startBomb(); }}><Bomb size={19}/><i /></button>
      </div>
    </header>

    <main className="canvas-stage">
      <div className={`music-paper ${marks.length ? 'has-marks' : ''} ${state.isPlaying ? 'playing' : ''} ${!state.isReady ? 'is-tuning' : ''}`}>
        {bombState === 'boom' && <div className="reset-boom" aria-hidden="true"><b>✹</b><i /><i /><i /><i /><i /><i /></div>}
        {!marks.length && !draft && <div className={`empty-whisper ${!state.isReady ? 'is-tuning' : ''}`} aria-hidden="true"><i /><span>{state.isReady ? 'draw something noisy' : 'tuning instruments...'}</span><i /></div>}
        {Boolean(marks.length) && !draft && !state.isReady && <div className="empty-whisper is-tuning" aria-hidden="true"><i /><span>tuning instruments...</span><i /></div>}
        <svg className={`music-canvas ${!state.isReady ? 'is-busy' : ''}`} viewBox="0 0 1000 700" preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp} onPointerLeave={(e: ReactPointerEvent<SVGSVGElement>) => { if (activePointerId.current !== e.pointerId)
        publishHover(null, true); }}>
          <rect width="1000" height="700" fill="transparent"/>
          <MarksLayer marks={marks} palette={palette}/>
          {draft && <RenderedMark mark={draft} sound={cyclicAt(palette, draft.paletteIndex, 'draft palette')}/>}
          {effects.map(fx => <FxArt key={fx.id} fx={fx}/>)}
          {hoverPoint && tool === 'spray' && (() => {
            const hx = hoverPoint.x * 1000, hy = hoverPoint.y * 700;
            const col = cyclicAt(palette, paletteIndex, 'hover palette').color;
            return (
              <g className="brush-cursor spray-cursor">
                <circle cx={hx} cy={hy} r={32} fill="none" stroke={col} strokeWidth={1.6} strokeDasharray="3 4" opacity={0.65}/>
                <circle cx={hx} cy={hy} r={18} fill={col} opacity={0.12}/>
                <circle cx={hx} cy={hy} r={3.5} fill={col} opacity={0.9}/>
                <circle cx={hx - 10} cy={hy - 8} r={1.6} fill={col} opacity={0.5}/>
                <circle cx={hx + 12} cy={hy - 6} r={1.4} fill={col} opacity={0.45}/>
                <circle cx={hx - 7} cy={hy + 11} r={1.8} fill={col} opacity={0.48}/>
                <circle cx={hx + 9} cy={hy + 10} r={1.5} fill={col} opacity={0.4}/>
                <circle cx={hx + 18} cy={hy + 3} r={1.2} fill={col} opacity={0.35}/>
                <circle cx={hx - 16} cy={hy + 2} r={1.2} fill={col} opacity={0.35}/>
              </g>
            );
          })()}
          {hoverPoint && tool === 'stamp' && (() => {
            const hx = hoverPoint.x * 1000, hy = hoverPoint.y * 700;
            const sound = cyclicAt(palette, paletteIndex, 'hover palette');
            return (
              <g className="brush-cursor stamp-cursor">
                <circle cx={hx} cy={hy} r={34} fill="none" stroke={sound.color} strokeWidth={2.2} strokeDasharray="5 3.5" opacity={0.75}/>
                <circle cx={hx} cy={hy} r={30} fill={sound.color} opacity={0.12}/>
                <CuteStamp kind={stampKind} cx={hx} cy={hy} r={23} color={sound.color} ink={sound.ink} monochrome={false}/>
              </g>
            );
          })()}
          {hoverPoint && tool !== 'eraser' && tool !== 'spray' && tool !== 'stamp' && <circle className="brush-cursor" cx={hoverPoint.x * 1000} cy={hoverPoint.y * 700} r={tool === 'boom' ? 35 : tool === 'fill' ? 24 : 12} fill={cyclicAt(palette, paletteIndex, 'hover palette').color}/>}
          {hoverPoint && tool === 'eraser' && <g className="eraser-cursor"><circle cx={hoverPoint.x * 1000} cy={hoverPoint.y * 700} r="36"/><path d={`M ${hoverPoint.x * 1000 - 15} ${hoverPoint.y * 700 + 8} l 30 -16`}/></g>}
        </svg>
        <div ref={playheadRef} className="playhead" style={{ left: '0%', opacity: state.isPlaying ? 1 : .16 }}><i /></div>
      </div>
    </main>

    <section className="playground-dock" aria-label="Musical drawing toys">
      <div className="toy-shelf">
        <div className="shelf-colors" role="group" aria-label="Sound colors">
          {palette.map((c, i) => (<button key={`${worldId}_${i}`} className={`paint-pot ${paletteIndex === i ? 'active' : ''}`} onPointerDown={() => transport.unlockAudio()} onClick={() => {
                setPaletteIndex(i);
                auditionColor(i);
                if (tool === 'eraser')
                    setTool('crayon');
            }} aria-label={c.name} title={c.name}>
              <span style={{ background: c.color }}/>
            </button>))}
        </div>
        <div className={`shelf-tools ${tool === 'stamp' ? 'is-stamps' : ''}`} role="group" aria-label={tool === 'stamp' ? 'Stamps' : 'Drawing toys'}>
          {tool !== 'stamp' ? (TOOLS.map(t => (<button key={t.id} className={`toy-tool ${tool === t.id ? 'active' : ''}`} onPointerDown={() => transport.unlockAudio()} onClick={() => {
                setTool(t.id);
                if (t.id === 'stamp')
                    auditionStamp(stampKind);
            }} aria-label={t.description} title={t.description}>
                {t.id === 'crayon' && <Pencil size={21} strokeWidth={2.4}/>}
                {t.id === 'dots' && <DotsIcon size={21}/>}
                {t.id === 'spray' && <SprayCanIcon size={21} strokeWidth={2.2}/>}
                {t.id === 'stamp' && <RubberStampIcon size={21} strokeWidth={2.2}/>}
                {t.id === 'boom' && <BoomIcon size={21} strokeWidth={2.2}/>}
                {t.id === 'fill' && <PaintBucket size={21} strokeWidth={2.2}/>}
                {t.id === 'eraser' && <Eraser size={21} strokeWidth={2.2}/>}
              </button>))) : (<>
              <button className="toy-tool tool-mode-switch" onPointerDown={() => transport.unlockAudio()} onClick={() => setTool('crayon')} aria-label="Back to drawing tools" title="Back to drawing tools">
                <Pencil size={21} strokeWidth={2.4}/>
              </button>
              {world.stamps.map(s => (<button key={s.id} className={`toy-tool ${stampKind === s.id ? 'active' : ''}`} onPointerDown={() => transport.unlockAudio()} onClick={() => {
                    setStampKind(s.id);
                    auditionStamp(s.id);
                }} aria-label={s.label} title={s.label}>
                  <StampToolbarIcon kind={s.id} size={21}/>
                </button>))}
            </>)}
        </div>
      </div>

      <div className="play-row">
        <button className={`giant-play ${state.isPlaying ? 'is-playing' : ''} ${state.isPreparing ? 'is-preparing' : ''}`} onPointerDown={() => transport.unlockAudio()} onClick={() => { if (!marks.length)
        return; setEffects([]); transport.togglePlay(); }} disabled={!marks.length} aria-label={state.isPreparing ? 'Preparing sounds' : state.isPlaying ? 'Pause drawing' : 'Play drawing'}>
          {state.isPlaying ? <Pause size={27} fill="currentColor"/> : <Play size={29} fill="currentColor"/>}
        </button>
        <div className="transport-scrub">
          <input ref={scrubRef} aria-label="Move through your drawing" type="range" min="0" max="1000" step="1" defaultValue="0" style={{ '--seek-fill': '0%' } as CSSProperties} onChange={(e: ChangeEvent<HTMLInputElement>) => { setEffects([]); transport.seek((Number(e.target.value) / 1000) * song.totalDuration); }} disabled={!marks.length}/>
        </div>
        <button className="world-pill" onClick={() => setShowWorlds(true)} aria-label={`Change world. Current world ${world.label}`}><span className="world-dots">{palette.slice(0, 3).map((c, i) => <i key={i} style={{ background: c.color }}/>)}</span><b>{world.label}</b></button>
      </div>
    </section>

    {showWorlds && <WorldSheet current={worldId} onPick={chooseWorld} onClose={() => setShowWorlds(false)}/>}
  </div>;
}
