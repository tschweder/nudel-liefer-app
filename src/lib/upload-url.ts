/**
 * Dependency-free guard shared by the server, the office upload client and the driver's offline
 * outbox (the outbox also runs in the service worker, so this module must stay import-free).
 *
 * `FakeStorage` answers with `fake://upload/<key>`, which the server happily treats as a grant but
 * no browser can ever PUT to - that is how an upload "succeeds" while nothing is stored (NUD-122).
 */
export function isUsableUploadUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
