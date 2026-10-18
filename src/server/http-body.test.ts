// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readTextLimited } from "./http-body";

const req = (body: string | undefined, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers });

describe("readTextLimited", () => {
  it("returns the text of a small body (also multi-byte)", async () => {
    expect(await readTextLimited(req('{"a":"ä漢"}'), 100)).toBe('{"a":"ä漢"}');
    expect(await readTextLimited(req(undefined), 100)).toBe("");
  });
  it("refuses a body over the limit, counted in bytes", async () => {
    expect(await readTextLimited(req("x".repeat(101)), 100)).toBeNull();
    expect(await readTextLimited(req("漢".repeat(40)), 100)).toBeNull(); // 120 bytes
    expect(await readTextLimited(req("x".repeat(100)), 100)).toBe("x".repeat(100));
  });
  it("trusts a declared length only to reject early, never to accept", async () => {
    expect(await readTextLimited(req("{}", { "content-length": "5000" }), 100)).toBeNull();
    // a request that claims to be small but streams more is cut off while reading
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(60)));
        controller.enqueue(new TextEncoder().encode("x".repeat(60)));
        controller.close();
      },
    });
    const lying = new Request("http://localhost/x", {
      method: "POST",
      body: stream,
      headers: { "content-length": "10" },
      // @ts-expect-error duplex is required for stream bodies in Node
      duplex: "half",
    });
    expect(await readTextLimited(lying, 100)).toBeNull();
  });
});
