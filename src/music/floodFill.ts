import type { CanvasMark, CanvasPoint, WorldConfig } from './canvasTypes';

export interface FloodFillResult {
  fillMaskDataUrl: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  filledPixelCount: number;
}

const W = 1000;
const H = 700;
const GAP_RAD = 3;
const PIXEL_COUNT=W*H;
let boundaryCache:{signature:string;closedMask:Uint8Array}|null=null;
let fillScratch:{filled:Uint8Array;wallDepth:Uint8Array;stack:Int32Array}|null=null;

function scratch(){
  if(!fillScratch)fillScratch={filled:new Uint8Array(PIXEL_COUNT),wallDepth:new Uint8Array(PIXEL_COUNT),stack:new Int32Array(PIXEL_COUNT)};
  fillScratch.filled.fill(0);fillScratch.wallDepth.fill(0);
  return fillScratch;
}

function boundarySignature(marks:CanvasMark[]){
  let out='';
  for(const mark of marks){
    if(mark.tool!=='crayon')continue;
    out+=`${mark.id}:${mark.points.length}:${mark.erasures?.length??0}|`;
  }
  return out;
}

function closedBoundaryMask(marks:CanvasMark[]){
  const signature=boundarySignature(marks);
  if(boundaryCache?.signature===signature)return boundaryCache.closedMask;

  const strokeCanvas=document.createElement('canvas');strokeCanvas.width=W;strokeCanvas.height=H;
  const sCtx=strokeCanvas.getContext('2d',{willReadFrequently:true});
  if(!sCtx)return null;

  for(const mark of marks){
    if(mark.tool!=='crayon')continue;
    const sw=Math.max(14,22*mark.size);
    sCtx.beginPath();sCtx.lineWidth=sw;sCtx.lineCap='round';sCtx.lineJoin='round';sCtx.strokeStyle='#000';
    mark.points.forEach((pt,i)=>{const px=pt.x*W,py=pt.y*H;if(i===0)sCtx.moveTo(px,py);else sCtx.lineTo(px,py);});
    sCtx.stroke();
    if(mark.erasures?.length){
      sCtx.save();sCtx.globalCompositeOperation='destination-out';
      for(const hole of mark.erasures){
        const rx=(hole.radius??.05)*820,ry=(hole.radius??.05)*700;
        sCtx.beginPath();sCtx.ellipse(hole.x*W,hole.y*H,rx,ry,0,0,Math.PI*2);sCtx.fill();
      }
      sCtx.restore();
    }
  }

  const strokeData=sCtx.getImageData(0,0,W,H).data,strokeMask=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++)if(strokeData[i*4+3]>40)strokeMask[i]=1;
  const closedMask=new Uint8Array(strokeMask);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(strokeMask[y*W+x]){
    for(let dy=-GAP_RAD;dy<=GAP_RAD;dy++){
      const ny=y+dy;if(ny<0||ny>=H)continue;
      for(let dx=-GAP_RAD;dx<=GAP_RAD;dx++){
        const nx=x+dx;if(nx<0||nx>=W||dx*dx+dy*dy>GAP_RAD*GAP_RAD)continue;
        closedMask[ny*W+nx]=1;
      }
    }
  }
  boundaryCache={signature,closedMask};
  return closedMask;
}

/**
 * Performs a digital paint flood fill:
 * - Treats only continuous crayon strokes as boundary walls.
 * - Bridges small gaps (gap-closing) so hand-drawn loops don't accidentally leak.
 * - Fills the enclosed shape with solid color.
 * - Leaves everything outside the boundary in its original state.
 */
export function performFloodFill(
  marks: CanvasMark[],
  clickPoint: CanvasPoint,
  _world: WorldConfig
): FloodFillResult {
  let startX = Math.max(0, Math.min(W - 1, Math.round(clickPoint.x * W)));
  let startY = Math.max(0, Math.min(H - 1, Math.round(clickPoint.y * H)));

  const closedMask=closedBoundaryMask(marks);
  if (!closedMask) {
    return {
      fillMaskDataUrl: '',
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      filledPixelCount: W * H,
    };
  }

  // Nudge boundary taps into the nearest open interior.
  if (closedMask[startY * W + startX]) {
    let found = false;
    for (let r = 1; r <= 14 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const nx = startX + dx, ny = startY + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
              if (!closedMask[ny * W + nx]) {
                startX = nx;
                startY = ny;
                found = true;
              }
            }
          }
        }
      }
    }
  }

  // Flood the open region using flattened pixel indices.
  const {filled:filledMask,wallDepth,stack}=scratch();
  let stackPtr = 0;
  const startIndex=startY*W+startX;
  stack[stackPtr++] = startIndex;
  filledMask[startIndex] = 1;

  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  let filledCount = 0;

  while (stackPtr > 0) {
    const idx=stack[--stackPtr];
    const y=(idx/W)|0;
    const x=idx-y*W;
    filledCount++;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    let n:number;
    if(x+1<W){n=idx+1;if(!filledMask[n]&&!closedMask[n]){filledMask[n]=1;stack[stackPtr++]=n;}}
    if(x>0){n=idx-1;if(!filledMask[n]&&!closedMask[n]){filledMask[n]=1;stack[stackPtr++]=n;}}
    if(y+1<H){n=idx+W;if(!filledMask[n]&&!closedMask[n]){filledMask[n]=1;stack[stackPtr++]=n;}}
    if(y>0){n=idx-W;if(!filledMask[n]&&!closedMask[n]){filledMask[n]=1;stack[stackPtr++]=n;}}
  }

  // Underlap the fill into the inside edge of the closed crayon wall.
  const underlapReach = GAP_RAD + 4;
  // Walk inward through boundary pixels without crossing the wall.
  let read=0,write=0;
  const seedMinX=Math.max(0,minX-1),seedMaxX=Math.min(W-1,maxX+1),seedMinY=Math.max(0,minY-1),seedMaxY=Math.min(H-1,maxY+1);
  for(let y=seedMinY;y<=seedMaxY;y++)for(let x=seedMinX;x<=seedMaxX;x++){
    const idx=y*W+x;if(!closedMask[idx])continue;
    const touches=(x>0&&filledMask[idx-1])||(x+1<W&&filledMask[idx+1])||(y>0&&filledMask[idx-W])||(y+1<H&&filledMask[idx+W]);
    if(!touches)continue;
    wallDepth[idx]=1;stack[write++]=idx;
  }
  while(read<write){
    const idx=stack[read++],depth=wallDepth[idx];if(depth>=underlapReach)continue;
    const y=(idx/W)|0,x=idx-y*W,nextDepth=depth+1;
    let n:number;
    if(x+1<W){n=idx+1;if(closedMask[n]&&!wallDepth[n]){wallDepth[n]=nextDepth;stack[write++]=n;}}
    if(x>0){n=idx-1;if(closedMask[n]&&!wallDepth[n]){wallDepth[n]=nextDepth;stack[write++]=n;}}
    if(y+1<H){n=idx+W;if(closedMask[n]&&!wallDepth[n]){wallDepth[n]=nextDepth;stack[write++]=n;}}
    if(y>0){n=idx-W;if(closedMask[n]&&!wallDepth[n]){wallDepth[n]=nextDepth;stack[write++]=n;}}
  }

  // Crop the alpha mask to the filled region.
  const outMinX=Math.max(0,minX-underlapReach),outMaxX=Math.min(W-1,maxX+underlapReach);
  const outMinY=Math.max(0,minY-underlapReach),outMaxY=Math.min(H-1,maxY+underlapReach);
  const outW=outMaxX-outMinX+1,outH=outMaxY-outMinY+1;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = outW;
  maskCanvas.height = outH;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) {
    return {
      fillMaskDataUrl: '',
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      filledPixelCount: filledCount,
    };
  }
  const maskImgData = maskCtx.createImageData(outW, outH);
  const maskU32 = new Uint32Array(maskImgData.data.buffer);
  for(let y=outMinY;y<=outMaxY;y++){
    const srcRow=y*W,dstRow=(y-outMinY)*outW;
    for(let x=outMinX;x<=outMaxX;x++){const i=srcRow+x;if(filledMask[i]||wallDepth[i])maskU32[dstRow+x-outMinX]=0xffffffff;}
  }
  maskCtx.putImageData(maskImgData, 0, 0);
  const fillMaskDataUrl = maskCanvas.toDataURL('image/png');

  const bounds = {
    minX: outMinX / W,
    maxX: (outMaxX + 1) / W,
    minY: outMinY / H,
    maxY: (outMaxY + 1) / H,
  };

  return {
    fillMaskDataUrl,
    bounds,
    filledPixelCount: filledCount,
  };
}
