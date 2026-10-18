import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseScriptHashManifest, scriptHashesFor } from "../../src/lib/csp-script-hashes";
import { buildScriptHashManifest, inlineScriptBodies, scriptHash } from "./csp-hash-build";

const LOCALES = ["de", "zh-Hans"] as const;
const page = (...scripts: string[]) =>
  `<!DOCTYPE html><html><head><script src="/a.js" async></script>${scripts.join("")}</head></html>`;

describe("inlineScriptBodies", () => {
  it("returns inline scripts only, byte for byte", () => {
    const html = page(
      "<script>self.__next_f.push([0])</script>",
      '<script id="_R_">\n  a("</b>")\n</script>',
      '<script src="/x.js"></script>',
      "<script nomodule src=/y.js></script>",
      "<SCRIPT>upper()</SCRIPT>",
    );
    expect(inlineScriptBodies(html)).toEqual([
      "self.__next_f.push([0])",
      '\n  a("</b>")\n',
      "upper()",
    ]);
  });
  it("finds nothing in a page without inline scripts", () => {
    expect(inlineScriptBodies('<script src="/a.js"></script><p>x</p>')).toEqual([]);
  });
});

describe("scriptHash", () => {
  it("is the CSP sha256 source of the UTF-8 text", () => {
    const body = "console.log('é中')";
    expect(scriptHash(body)).toBe(
      `sha256-${createHash("sha256").update(Buffer.from(body, "utf8")).digest("base64")}`,
    );
    expect(scriptHash("")).toBe("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });
});

describe("buildScriptHashManifest", () => {
  const files = [
    { path: "de.html", html: page("<script>de-home()</script>", "<script>shared()</script>") },
    { path: "de/driver/offline-shell.html", html: page("<script>de-shell()</script>") },
    { path: "zh-Hans/driver/offline-shell.html", html: page("<script>zh-shell()</script>") },
    { path: "_not-found.html", html: page("<script>shared()</script>", "<script>nf()</script>") },
    { path: "[locale]/login.html", html: page("<script>shell()</script>") },
  ];
  const manifest = buildScriptHashManifest(files, LOCALES);
  const h = scriptHash;

  it("puts locale-less documents into common and locale documents under their locale", () => {
    expect(manifest.common).toEqual([h("shared()"), h("nf()"), h("shell()")].sort());
    expect(manifest.locales.de).toEqual([h("de-home()"), h("de-shell()")].sort());
    expect(manifest.locales["zh-Hans"]).toEqual([h("zh-shell()")]);
  });
  it("does not repeat a hash that is already common", () => {
    expect(manifest.locales.de).not.toContain(h("shared()"));
  });
  it("a response gets the common hashes plus those of its locale", () => {
    expect(scriptHashesFor(manifest, "zh-Hans")).toEqual([...manifest.common, h("zh-shell()")]);
    expect(scriptHashesFor(manifest, null)).toEqual(manifest.common);
    expect(scriptHashesFor(manifest, "xx")).toEqual(manifest.common);
  });
  it("is deterministic (sorted, deduplicated)", () => {
    expect(buildScriptHashManifest([...files].reverse(), LOCALES)).toEqual(manifest);
  });
});

describe("parseScriptHashManifest", () => {
  it("round-trips and ignores unrelated keys", () => {
    const raw = JSON.stringify({
      buildId: "x",
      common: ["sha256-a="],
      locales: { de: ["sha256-b="] },
    });
    expect(parseScriptHashManifest(raw)).toEqual({
      common: ["sha256-a="],
      locales: { de: ["sha256-b="] },
    });
  });
  it("turns anything malformed into an empty manifest", () => {
    for (const raw of [undefined, "", "  ", "not json", "null", "[]", '{"common":5,"locales":7}']) {
      const parsed = parseScriptHashManifest(raw);
      expect(parsed.common, String(raw)).toEqual([]);
      expect(Object.values(parsed.locales).flat(), String(raw)).toEqual([]);
    }
  });
});
