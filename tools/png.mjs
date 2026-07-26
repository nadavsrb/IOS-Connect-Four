// Minimal PNG reader for the smoke test: enough to sample pixels out of a
// Playwright screenshot without pulling in a dependency. Handles the 8-bit
// RGB/RGBA non-interlaced images Chromium produces and nothing else.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colour = data[9];
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0 || !(colour === 2 || colour === 6)) {
        throw new Error(`unsupported PNG: depth=${depth} colour=${colour} interlace=${interlace}`);
      }
      channels = colour === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= channels ? up[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 255;
    }
  }

  const at = (x, y) => {
    const o = y * stride + x * channels;
    return [pixels[o], pixels[o + 1], pixels[o + 2]];
  };
  return { width, height, at };
}

// Largest single-row colour step down a column. A gradient never steps; a flat
// colour meeting a gradient does, and that step is the seam you see on screen.
export function largestVerticalStep(png, x) {
  let worst = 0;
  let worstY = 0;
  for (let y = 1; y < png.height; y++) {
    const a = png.at(x, y - 1);
    const b = png.at(x, y);
    const step = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    if (step > worst) {
      worst = step;
      worstY = y;
    }
  }
  return { step: worst, y: worstY };
}
