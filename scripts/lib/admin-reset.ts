import type { Readable } from "node:stream";

/**
 * Argument and password handling of `pnpm admin:reset-password` (NUD-094). Pure, so it is unit
 * tested; the script itself only wires it to the terminal and the database.
 */
export type ResetArgs = {
  email?: string;
  reactivate: boolean;
  yes: boolean;
  help: boolean;
  /** A forbidden flag that was used (the password must never be an argument). */
  forbidden?: string;
  unknown: string[];
};

export function parseResetArgs(argv: string[], env: Record<string, string | undefined>): ResetArgs {
  const out: ResetArgs = { reactivate: false, yes: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--email") out.email = argv[++i];
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length);
    else if (arg === "--reactivate") out.reactivate = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (/^--(password|pass|pw)(=|$)/.test(arg)) out.forbidden = arg.split("=")[0];
    else out.unknown.push(arg);
  }
  out.email ||= env.ADMIN_EMAIL?.trim() || undefined;
  return out;
}

/** First line of a stream (a password piped in), without the line break. */
export async function readFirstLine(stream: Readable, maxBytes = 1024): Promise<string> {
  let data = "";
  for await (const chunk of stream) {
    data += String(chunk);
    if (data.includes("\n") || data.length > maxBytes) break;
  }
  const line = data.split(/\r?\n/)[0] ?? "";
  return line.slice(0, maxBytes);
}

export const HELP = `Usage: pnpm admin:reset-password --email <admin email> [--reactivate] [--yes]

Sets a new password for an existing ADMIN account directly in the database.

Database:  DATABASE_URL_UNPOOLED, else DATABASE_URL (the direct Neon connection for production).
Password:  never an argument. One of
             - typed at the hidden prompt (asked twice),
             - piped in on stdin (first line):  printf '%s\\n' "$PW" | pnpm admin:reset-password --email a@b.c --yes
             - environment variable ADMIN_NEW_PASSWORD (visible to other processes of the same user).
           Minimum 10 characters. The password is never printed or logged.
Options:   --reactivate  also re-enables a deactivated admin account
           --yes         do not ask for confirmation (required when stdin is not a terminal)
`;
