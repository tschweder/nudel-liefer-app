import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { parseResetArgs, readFirstLine } from "./admin-reset";

describe("parseResetArgs", () => {
  it("reads email, flags and the ADMIN_EMAIL fallback", () => {
    expect(parseResetArgs(["--email", "a@b.c", "--yes", "--reactivate"], {})).toMatchObject({
      email: "a@b.c",
      yes: true,
      reactivate: true,
      unknown: [],
    });
    expect(parseResetArgs(["--email=x@y.z"], {}).email).toBe("x@y.z");
    expect(parseResetArgs([], { ADMIN_EMAIL: " env@example.com " }).email).toBe("env@example.com");
    expect(
      parseResetArgs(["--email", "flag@example.com"], { ADMIN_EMAIL: "env@example.com" }).email,
    ).toBe("flag@example.com");
  });
  it("refuses a password on the command line, however it is spelled", () => {
    for (const flag of ["--password", "--password=hunter2", "--pass", "--pw=x"]) {
      expect(parseResetArgs([flag, "hunter2"], {}).forbidden, flag).toBeDefined();
    }
  });
  it("collects unknown arguments", () => {
    expect(parseResetArgs(["--nope", "x"], {}).unknown).toEqual(["--nope", "x"]);
  });
});

describe("readFirstLine", () => {
  it("returns the first line without the line break", async () => {
    expect(await readFirstLine(Readable.from(["secret-pass-1\n", "more"]))).toBe("secret-pass-1");
    expect(await readFirstLine(Readable.from(["a\r\nb"]))).toBe("a");
    expect(await readFirstLine(Readable.from(["no newline"]))).toBe("no newline");
    expect(await readFirstLine(Readable.from([]))).toBe("");
  });
  it("bounds what it reads", async () => {
    expect((await readFirstLine(Readable.from(["x".repeat(5000)]), 100)).length).toBe(100);
  });
});
