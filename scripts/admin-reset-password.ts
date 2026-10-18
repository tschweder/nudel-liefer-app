/**
 * `pnpm admin:reset-password` (NUD-094): sets a new password for an admin account when nobody can
 * log in. Runs against the database named by DATABASE_URL_UNPOOLED / DATABASE_URL. The password
 * comes from a hidden prompt, stdin or ADMIN_NEW_PASSWORD - never from the command line - and is
 * never printed. See docs/runbook.md "Reset the admin password".
 */
import "dotenv/config";

import { createInterface } from "node:readline";

import { resetAdminPassword } from "../src/server/admin-password";
import { createPrismaClient } from "../src/server/db";
import { HELP, parseResetArgs, readFirstLine } from "./lib/admin-reset";
import { databaseIdentity } from "./lib/backup";

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

/** Reads one line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

async function main() {
  const args = parseResetArgs(process.argv.slice(2), process.env);
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.forbidden) {
    fail(
      `${args.forbidden} is not supported: a password on the command line ends up in the shell history. Use the hidden prompt, stdin or ADMIN_NEW_PASSWORD.\n\n${HELP}`,
    );
  }
  if (args.unknown.length > 0) fail(`unknown argument: ${args.unknown.join(" ")}\n\n${HELP}`);
  if (!args.email) fail(`--email is required\n\n${HELP}`);
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) fail("DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set");

  const interactive = Boolean(process.stdin.isTTY);
  if (!interactive && !args.yes) {
    fail("stdin is not a terminal: pass --yes to confirm that this is the right database");
  }

  let password = process.env.ADMIN_NEW_PASSWORD;
  if (password === undefined || password === "") {
    if (interactive) {
      password = await promptHidden("New password (hidden): ");
      const again = await promptHidden("Repeat the password: ");
      if (password !== again) fail("The two entries differ. Nothing was changed.");
    } else {
      password = await readFirstLine(process.stdin);
    }
  }

  console.error(`Database: ${databaseIdentity(url)}`);
  console.error(`Admin:    ${args.email}`);
  if (interactive && !args.yes) {
    const answer = (await askLine("Type the e-mail address again to confirm: "))
      .trim()
      .toLowerCase();
    if (answer !== args.email.toLowerCase()) fail("Not confirmed. Nothing was changed.");
  }

  const db = createPrismaClient(url);
  try {
    const result = await resetAdminPassword(db, {
      email: args.email,
      password,
      reactivate: args.reactivate,
    });
    if (!result.ok) {
      const reasons = {
        invalid_input: "That is not a valid e-mail address.",
        weak_password: "The password must have 10 to 200 characters. Nothing was changed.",
        not_found:
          "No admin account with that e-mail address exists (drivers are not handled here).",
        ambiguous:
          "More than one admin matches that address (differing only in letter case). Fix the data first.",
        inactive: "That admin account is deactivated. Repeat with --reactivate to enable it again.",
      } as const;
      fail(reasons[result.error]);
    }
    console.log(
      `Password updated for ${args.email}${result.reactivated ? " (account re-enabled)" : ""}. Sessions that are already open stay valid until they expire; rotate AUTH_SECRET to sign everyone out.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Never print the error object: driver / adapter errors may contain the connection string.
  fail(
    `Failed: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://[redacted]") : "unknown error"}`,
  );
});
