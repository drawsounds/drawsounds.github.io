import type { CanvasMark, CanvasPoint, WorldConfig } from './canvasTypes';

export interface FloodFillResult {
  fillDataUrl: string;
  fillMaskDataUrl?: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  filledPixelCount: number;
}

const W = 1000;
const H = 700;

// In-memory cache for masks so subsequent fills and recoloring are fast
const fillMaskCache = new Map<string, Uint8Array>();

/**
 * Parses any CSS color (hex, rgb, named) into a 32-bit unsigned integer (ABGR in little endian).
 */
function parseColorToU32(cssColor: string): number {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0xff000000;
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  // Little-endian Uint32 layout: Alpha (top), Blue, Green, Red (lowest byte)
  return ((data[3] << 24) | (data[2] << 16) | (data[1] << 8) | data[0]) >>> 0;
}

/**
 * Checks color distance between two 32-bit colors.
 */
function colorDiff(c1: number, c2: number): number {
  const r1 = c1 & 0xff, g1 = (c1 >> 8) & 0xff, b1 = (c1 >> 16) & 0xff;
  const r2 = c2 & 0xff, g2 = (c2 >> 8) & 0xff, b2 = (c2 >> 16) & 0xff;
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

function seeded(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Performs a digital paint flood fill:
 * - Treats drawn strokes (crayon lines, dots, spray, stamps) as boundary walls.
 * - Bridges small gaps (gap-closing) so hand-drawn loops don't accidentally leak.
 * - Fills the enclosed shape with solid color.
 * - Leaves everything outside the boundary in its original state.
 */
export function performFloodFill(
  marks: CanvasMark[],
  clickPoint: CanvasPoint,
  fillColor: string,
  world: WorldConfig
): FloodFillResult {
  let startX = Math.max(0, Math.min(W - 1, Math.round(clickPoint.x * W)));
  let startY = Math.max(0, Math.min(H - 1, Math.round(clickPoint.y * H)));

  // Offscreen canvas for rasterizing current strokes and existing fills
  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.width = W;
  strokeCanvas.height = H;
  const sCtx = strokeCanvas.getContext('2d', { willReadFrequently: true });

  const compCanvas = document.createElement('canvas');
  compCanvas.width = W;
  compCanvas.height = H;
  const cCtx = compCanvas.getContext('2d', { willReadFrequently: true });

  if (!sCtx || !cCtx) {
    return {
      fillDataUrl: '',
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      filledPixelCount: W * H,
    };
  }

  // 1. Draw world canvas background onto composite canvas
  cCtx.fillStyle = world.canvas;
  cCtx.fillRect(0, 0, W, H);

  // 2. Draw existing fills onto composite canvas
  for (const mark of marks) {
    if (mark.tool === 'fill') {
      const sound = world.palette[mark.paletteIndex % world.palette.length];
      const mask = fillMaskCache.get(mark.id);
      if (mask) {
        const fillImgData = cCtx.createImageData(W, H);
        const fillU32 = new Uint32Array(fillImgData.data.buffer);
        const colorVal = parseColorToU32(sound.color);
        for (let i = 0; i < W * H; i++) {
          if (mask[i]) fillU32[i] = colorVal;
        }
        // Draw using offscreen canvas to avoid clobbering transparent pixels
        const tmp = document.createElement('canvas');
        tmp.width = W;
        tmp.height = H;
        const tCtx = tmp.getContext('2d');
        if (tCtx) {
          tCtx.putImageData(fillImgData, 0, 0);
          cCtx.drawImage(tmp, 0, 0);
        }
      }
    }
  }

  // 3. Draw strokes onto BOTH strokeCanvas (black boundary) and composite canvas (actual colors)
  for (const mark of marks) {
    if (mark.tool === 'fill') continue;
    const sound = world.palette[mark.paletteIndex % world.palette.length];
    const sw = Math.max(14, 22 * mark.size);

    if (mark.tool === 'crayon') {
      [sCtx, cCtx].forEach((ctx, idx) => {
        ctx.beginPath();
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = idx === 0 ? '#000000' : sound.color;
        mark.points.forEach((pt, i) => {
          const px = pt.x * W, py = pt.y * H;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      });
    } else if (mark.tool === 'dots') {
      [sCtx, cCtx].forEach((ctx, idx) => {
        ctx.fillStyle = idx === 0 ? '#000000' : sound.color;
        mark.points.forEach((pt, i) => {
          const r = 7 + mark.size * 7 + (i % 3);
          ctx.beginPath();
          ctx.arc(pt.x * W, pt.y * H, r, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    } else if (mark.tool === 'spray') {
      const rnd = seeded(mark.seed);
      [sCtx, cCtx].forEach((ctx, idx) => {
        ctx.fillStyle = idx === 0 ? '#000000' : sound.color;
        mark.points.forEach((pt, pi) => {
          const burst = 2 + Math.floor(rnd() * 10) + (pi % 5 === 0 ? 4 : 0);
          const lean = (rnd() - 0.5) * 1.3;
          for (let i = 0; i < burst; i++) {
            const a = rnd() * Math.PI * 2 + lean;
            const d = Math.pow(rnd(), 1.65) * (18 + rnd() * 58) * mark.size;
            const x = pt.x * W + Math.cos(a) * d + (rnd() - 0.5) * 10;
            const y = pt.y * H + Math.sin(a) * d + (rnd() - 0.5) * 7;
            const r = Math.max(1.5, 0.8 + Math.pow(rnd(), 2) * 8.5);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      });
    } else if (mark.tool === 'boom') {
      const p = mark.points[0] || { x: 0.5, y: 0.5 };
      const r = 36 + mark.size * 29;
      [sCtx, cCtx].forEach((ctx, idx) => {
        ctx.fillStyle = idx === 0 ? '#000000' : sound.color;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, r * 0.76, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (mark.tool === 'stamp') {
      const p = mark.points[0] || { x: 0.5, y: 0.5 };
      const r = (36 + mark.size * 25) * 0.78;
      [sCtx, cCtx].forEach((ctx, idx) => {
        ctx.fillStyle = idx === 0 ? '#000000' : sound.color;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 4. Build stroke mask from sCtx (black strokes on transparent background)
  const strokeImgData = sCtx.getImageData(0, 0, W, H);
  const strokeData = strokeImgData.data;
  const strokeMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    // alpha > 40 means a stroke touches this pixel
    if (strokeData[i * 4 + 3] > 40) strokeMask[i] = 1;
  }

  // 5. Gap closing on stroke mask (dilate by 3px to close hand-drawn gaps <= 6px)
  const closedMask = new Uint8Array(strokeMask);
  const gapRad = 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (strokeMask[y * W + x]) {
        for (let dy = -gapRad; dy <= gapRad; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -gapRad; dx <= gapRad; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            if (dx * dx + dy * dy <= gapRad * gapRad) {
              closedMask[ny * W + nx] = 1;
            }
          }
        }
      }
    }
  }

  // If start point is right on a stroke boundary, search around up to radius 12 for open interior
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

  // 6. Get composite pixel data to identify starting target color
  const compImgData = cCtx.getImageData(0, 0, W, H);
  const compU32 = new Uint32Array(compImgData.data.buffer);
  const startColor = compU32[startY * W + startX];

  // 7. Flood Fill algorithm (Iterative with Int32Array stack)
  const visited = new Uint8Array(W * H);
  const filledMask = new Uint8Array(W * H);
  const stack = new Int32Array(W * H * 2);
  let stackPtr = 0;

  stack[stackPtr++] = startX;
  stack[stackPtr++] = startY;
  visited[startY * W + startX] = 1;
  filledMask[startY * W + startX] = 1;

  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  let filledCount = 0;

  // Color tolerance for soft boundaries
  const tolerance = 48;

  while (stackPtr > 0) {
    const y = stack[--stackPtr];
    const x = stack[--stackPtr];
    filledCount++;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // 4-neighborhood
    const neighbors = [x + 1, y, x - 1, y, x, y + 1, x, y - 1];
    for (let i = 0; i < 8; i += 2) {
      const nx = neighbors[i];
      const ny = neighbors[i + 1];

      if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
        const idx = ny * W + nx;
        if (!visited[idx]) {
          visited[idx] = 1;
          // Must not hit gap-closed stroke boundary
          if (!closedMask[idx]) {
            // Must match target region color (or close to startColor)
            if (colorDiff(compU32[idx], startColor) <= tolerance) {
              filledMask[idx] = 1;
              stack[stackPtr++] = nx;
              stack[stackPtr++] = ny;
            }
          }
        }
      }
    }
  }

  // 8. Dilation (+2px) into the original stroke boundary:
  // Ensures fill seats neatly UNDER the thick crayon stroke, preventing hairline white gaps.
  const finalMask = new Uint8Array(filledMask);
  const dilateRad = 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (filledMask[y * W + x]) {
        for (let dy = -dilateRad; dy <= dilateRad; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -dilateRad; dx <= dilateRad; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            // Only dilate if it is part of the original stroke or free space
            finalMask[ny * W + nx] = 1;
          }
        }
      }
    }
  }

  // 9. Render the final mask onto the output canvas
  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    return {
      fillDataUrl: '',
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      filledPixelCount: filledCount,
    };
  }

  const outImgData = outCtx.createImageData(W, H);
  const outU32 = new Uint32Array(outImgData.data.buffer);
  const fillColorU32 = parseColorToU32(fillColor);
  const whiteMaskU32 = 0xffffffff; // solid white for mask

  // Also build mask canvas if needed
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskCtx = maskCanvas.getContext('2d');
  const maskImgData = maskCtx?.createImageData(W, H);
  const maskU32 = maskImgData ? new Uint32Array(maskImgData.data.buffer) : null;

  for (let i = 0; i < W * H; i++) {
    if (finalMask[i]) {
      outU32[i] = fillColorU32;
      if (maskU32) maskU32[i] = whiteMaskU32;
    }
  }

  outCtx.putImageData(outImgData, 0, 0);
  const fillDataUrl = outCanvas.toDataURL('image/png');

  let fillMaskDataUrl: string | undefined;
  if (maskCtx && maskImgData) {
    maskCtx.putImageData(maskImgData, 0, 0);
    fillMaskDataUrl = maskCanvas.toDataURL('image/png');
  }

  const bounds = {
    minX: Math.max(0, (minX - dilateRad) / W),
    maxX: Math.min(1, (maxX + dilateRad) / W),
    minY: Math.max(0, (minY - dilateRad) / H),
    maxY: Math.min(1, (maxY + dilateRad) / H),
  };

  return {
    fillDataUrl,
    fillMaskDataUrl,
    bounds,
    filledPixelCount: filledCount,
  };
}

/**
 * Stores the mask array into in-memory cache for a mark.
 */
export function cacheFillMask(id: string, mask: Uint8Array) {
  fillMaskCache.set(id, mask);
}

/**
 * Re-colors an existing fill mark with a new color (e.g. when changing worlds).
 */
export function recolorFillDataUrl(maskDataUrl: string, newColor: string): string {
  // If we have an offscreen canvas, render the mask tinted with newColor
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return maskDataUrl;

  const img = new Image();
  img.src = maskDataUrl;
  if (img.complete) {
    ctx.fillStyle = newColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return maskDataUrl;
}
