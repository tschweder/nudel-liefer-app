import { deflateSync } from "node:zlib";

/**
 * Tiny dependency-free PNG generator for the demo photos: a solid-colour image with a line of
 * text in a 5x7 bitmap font (capital letters, digits and "-" only). Used by `seedDemo` so the
 * demo has real image files without an image library.
 */

const GLYPHS: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

export type Rgb = readonly [number, number, number];
export type TextLine = { text: string; scale: number };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Characters without a glyph are rendered as blanks. */
function glyphFor(char: string): readonly string[] | undefined {
  return GLYPHS[char.toUpperCase()];
}

/** Width in pixels of a text line (glyphs separated by one blank column, scaled). */
export function textWidth(text: string, scale: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : (n * (GLYPH_W + 1) - 1) * scale;
}

/**
 * Renders a PNG (8-bit RGB). Each line is centred horizontally; the block of lines is centred
 * vertically (one glyph-height gap between lines).
 */
export function renderPlaceholderPng(options: {
  width: number;
  height: number;
  background: Rgb;
  foreground: Rgb;
  lines: readonly TextLine[];
}): Buffer {
  const { width, height, background, foreground, lines } = options;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter type "none"
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = background[0];
      raw[row + 2 + x * 3] = background[1];
      raw[row + 3 + x * 3] = background[2];
    }
  }
  const gap = 3 * Math.min(...lines.map((l) => l.scale), 3);
  const blockHeight =
    lines.reduce((sum, l) => sum + GLYPH_H * l.scale, 0) + gap * (lines.length - 1);
  let top = Math.max(0, Math.floor((height - blockHeight) / 2));
  for (const line of lines) {
    let left = Math.max(0, Math.floor((width - textWidth(line.text, line.scale)) / 2));
    for (const char of line.text) {
      const glyph = glyphFor(char);
      if (glyph) {
        for (let gy = 0; gy < GLYPH_H; gy += 1) {
          for (let gx = 0; gx < GLYPH_W; gx += 1) {
            if (glyph[gy]![gx] !== "1") continue;
            for (let dy = 0; dy < line.scale; dy += 1) {
              for (let dx = 0; dx < line.scale; dx += 1) {
                const px = left + gx * line.scale + dx;
                const py = top + gy * line.scale + dy;
                if (px >= width || py >= height) continue;
                const at = py * stride + 1 + px * 3;
                raw[at] = foreground[0];
                raw[at + 1] = foreground[1];
                raw[at + 2] = foreground[2];
              }
            }
          }
        }
      }
      left += (GLYPH_W + 1) * line.scale;
    }
    top += GLYPH_H * line.scale + gap;
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
