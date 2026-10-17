import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { renderPlaceholderPng, textWidth } from "./placeholder-image";

function decode(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(2);
  const idatLength = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  const stride = 1 + width * 3;
  expect(raw.length).toBe(stride * height);
  const pixel = (x: number, y: number) => [
    ...raw.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3),
  ];
  return { width, height, pixel, tail: png.subarray(41 + idatLength + 4) };
}

describe("renderPlaceholderPng", () => {
  const options = {
    width: 200,
    height: 100,
    background: [10, 20, 30],
    foreground: [250, 240, 230],
    lines: [{ text: "E", scale: 4 }],
  } as const;

  it("creates a valid PNG with the background colour and drawn text pixels", () => {
    const png = renderPlaceholderPng({ ...options, lines: [...options.lines] });
    const image = decode(png);
    expect([image.width, image.height]).toEqual([200, 100]);
    expect(image.pixel(0, 0)).toEqual([10, 20, 30]);
    // "E" (5x7 at scale 4, 20x28 px) is centred: top-left corner pixel of the glyph is set.
    const left = Math.floor((200 - textWidth("E", 4)) / 2);
    const top = Math.floor((100 - 28) / 2);
    expect(image.pixel(left, top)).toEqual([250, 240, 230]);
    expect(image.pixel(left + 19, top + 27)).toEqual([250, 240, 230]);
    // IEND chunk closes the file.
    expect(image.tail.subarray(4, 8).toString("ascii")).toBe("IEND");
  });

  it("is deterministic and stays small", () => {
    const a = renderPlaceholderPng({
      ...options,
      lines: [...options.lines],
      width: 800,
      height: 600,
    });
    const b = renderPlaceholderPng({
      ...options,
      lines: [...options.lines],
      width: 800,
      height: 600,
    });
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBeLessThan(20_000);
  });

  it("measures text width", () => {
    expect(textWidth("", 3)).toBe(0);
    expect(textWidth("EI", 2)).toBe((2 * 6 - 1) * 2);
  });
});
