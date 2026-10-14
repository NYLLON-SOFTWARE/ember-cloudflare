import { feature } from "@ember/parity";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./preview-secrets.sh", import.meta.url));
const TOKEN = "0123456789abcdef".repeat(4);
const SECRET = /^[0-9a-f]{64}$/;

/** What `wrangler secret list` finds: the names of the Worker's secrets, no Worker yet, or a failure. */
type Listing = string[] | "no worker" | "error";

/** Stands in for `pnpm exec wrangler secret list --name <worker>`, answering as $LISTING says. */
const WRANGLER = `#!/usr/bin/env bash
[ "$1 $2 $3 $4" = "exec wrangler secret list" ] || { echo "unexpected: $*" >&2; exit 2; }
case "$LISTING" in
  "no worker") echo "✘ [ERROR] A request to the Cloudflare API failed." >&2; echo "Worker \\"$6\\" not found. [code: 10007]" >&2; exit 1 ;;
  error) echo "✘ [ERROR] Authentication error [code: 10000]" >&2; exit 1 ;;
  *) echo "$LISTING" ;;
esac
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "preview-secrets-"));
  writeFileSync(path.join(dir, "pnpm"), WRANGLER, { mode: 0o755 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the script for a Worker whose secrets are `listing`, with the repository's setup token if given. */
function deploy(listing: Listing, setupToken = "") {
  const file = path.join(dir, "secrets.json");
  const LISTING = Array.isArray(listing) ? JSON.stringify(listing.map((name) => ({ name, type: "secret_text" }))) : listing;
  const run = spawnSync("bash", [SCRIPT, "ember-preview", file], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LISTING, EMBER_SETUP_TOKEN: setupToken },
    encoding: "utf8",
  });
  const written = existsSync(file);
  return {
    status: run.status,
    logs: run.stdout + run.stderr,
    secrets: written ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : null,
    mode: written ? statSync(file).mode & 0o777 : null,
  };
}

/** The log lines that show `secret`, other than the one asking GitHub to mask it. */
const leaks = (logs: string, secret: string) => logs.split("\n").filter((line) => line.includes(secret) && line !== `::add-mask::${secret}`);

describe(feature("platform.deploy-secrets"), () => {
  it("makes both secrets for a Worker's first deploy, readable only by the deploy, and masks them in the logs", () => {
    const { status, secrets, mode, logs } = deploy("no worker");
    expect(status).toBe(0);
    expect(secrets).toEqual({ SESSION_SECRET: expect.stringMatching(SECRET), EMBER_SETUP_TOKEN: expect.stringMatching(SECRET) });
    expect(secrets!.SESSION_SECRET).not.toBe(secrets!.EMBER_SETUP_TOKEN);
    expect(mode).toBe(0o600);
    for (const secret of Object.values(secrets!)) {
      expect(logs).toContain(`::add-mask::${secret}`);
      expect(leaks(logs, secret)).toEqual([]);
    }
  });

  it("keeps the secrets the Worker has, so nobody is signed out", () => {
    const { status, secrets } = deploy(["SESSION_SECRET", "EMBER_SETUP_TOKEN"]);
    expect(status).toBe(0);
    expect(secrets).toEqual({});
  });

  it("gives the Worker the repository's setup token, without showing it", () => {
    const { status, secrets, logs } = deploy(["SESSION_SECRET", "EMBER_SETUP_TOKEN"], TOKEN);
    expect(status).toBe(0);
    expect(secrets).toEqual({ EMBER_SETUP_TOKEN: TOKEN });
    expect(leaks(logs, TOKEN)).toEqual([]);
  });

  it("makes a setup token nobody knows when the repository has none, so setup stays locked", () => {
    const { status, secrets } = deploy(["SESSION_SECRET"]);
    expect(status).toBe(0);
    expect(secrets).toEqual({ EMBER_SETUP_TOKEN: expect.stringMatching(SECRET) });
  });

  it("stops when it can't list the Worker's secrets, rather than replacing them", () => {
    const { status, secrets, logs } = deploy("error");
    expect(status).toBe(1);
    expect(secrets).toBeNull();
    expect(logs).toContain("Authentication error");
  });

  it.each(["short", TOKEN.toUpperCase(), `${TOKEN}0`, ` ${TOKEN}`])("refuses the repository's setup token %j without showing it", (token) => {
    const { status, secrets, logs } = deploy(["SESSION_SECRET"], token);
    expect(status).toBe(1);
    expect(secrets).toBeNull();
    expect(logs).toContain("::error::EMBER_SETUP_TOKEN must be 64 lowercase hex characters");
    expect(logs).not.toContain(token.trim());
  });
});
