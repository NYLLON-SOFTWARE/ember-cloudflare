import { feature } from "@ember/parity";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./deploy.ts", import.meta.url));
const SECRET = /^[0-9a-f]{64}$/;
/** The secrets a Worker deployed before has. */
const EVERY_SECRET = ["SESSION_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];

/** What `wrangler secret list` finds: the names of the Worker's secrets, no Worker yet, or a failure. */
type Listing = string[] | "no worker" | "error";

/**
 * Stands in for `pnpm exec wrangler`: `secret list` answers as $LISTING says, and `deploy` keeps
 * what it was given in $OUT (its options, its secrets file's path, mode and contents) and exits
 * with $DEPLOY_STATUS.
 */
const PNPM = `#!/usr/bin/env bash
[ "$1 $2" = "exec wrangler" ] || { echo "unexpected: $*" >&2; exit 2; }
shift 2
if [ "$1 $2" = "secret list" ]; then
  echo "$*" > "$OUT/list-args"
  case "$LISTING" in
    "no worker") echo "✘ [ERROR] A request to the Cloudflare API failed." >&2; echo 'Worker "ember" not found. [code: 10007]' >&2; exit 1 ;;
    error) echo "✘ [ERROR] Authentication error [code: 10000]" >&2; exit 1 ;;
    *) echo "$LISTING" ;;
  esac
elif [ "$1 $2" = "deploy --secrets-file" ]; then
  echo "$3" > "$OUT/secrets-path"
  stat -c %a "$3" > "$OUT/secrets-mode"
  cp "$3" "$OUT/secrets.json"
  shift 3
  echo "$*" > "$OUT/deploy-args"
  echo "Deployed ember"
  exit "\${DEPLOY_STATUS:-0}"
else
  echo "unexpected: $*" >&2; exit 2
fi
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "deploy-"));
  writeFileSync(path.join(dir, "pnpm"), PNPM, { mode: 0o755 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const output = (name: string) => (existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8").trim() : null);

/** Runs the script with `args` for a Worker whose secrets are `listing`. */
function deploy(listing: Listing, args: string[] = [], deployStatus = 0) {
  const LISTING = Array.isArray(listing) ? JSON.stringify(listing.map((name) => ({ name, type: "secret_text" }))) : listing;
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LISTING, OUT: dir, DEPLOY_STATUS: String(deployStatus) },
    encoding: "utf8",
  });
  const secrets = output("secrets.json");
  return {
    status: run.status,
    logs: run.stdout + run.stderr,
    deployed: output("deploy-args") !== null,
    secrets: secrets === null ? null : (JSON.parse(secrets) as Record<string, string>),
  };
}

describe(feature("platform.deploy-secrets"), () => {
  it("makes the secrets for a Worker's first deploy, readable only by the deploy, and never prints them", () => {
    const { status, secrets, logs } = deploy("no worker");
    expect(status).toBe(0);
    expect(secrets).toEqual({
      SESSION_SECRET: expect.stringMatching(SECRET),
      VAPID_PUBLIC_KEY: expect.stringMatching(/^B[\w-]{86}$/),
      VAPID_PRIVATE_KEY: expect.stringMatching(/^[\w-]{43}$/),
    });
    expect(output("secrets-mode")).toBe("600");
    // Cloudflare's build logs mask nothing, so no secret may appear in them, not even masked.
    for (const secret of [secrets!.SESSION_SECRET!, secrets!.VAPID_PRIVATE_KEY!]) expect(logs).not.toContain(secret);
    expect(logs).toContain("Deploying with new SESSION_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY");
  });

  it("removes the secrets file once wrangler has deployed", () => {
    deploy("no worker");
    expect(existsSync(output("secrets-path")!)).toBe(false);
  });

  it("keeps the secrets the Worker has, so nobody is signed out or loses their push subscriptions", () => {
    const { status, secrets } = deploy(EVERY_SECRET);
    expect(status).toBe(0);
    expect(secrets).toEqual({});
  });

  it("stops when it can't list the Worker's secrets, rather than replacing them", () => {
    const { status, deployed, logs } = deploy("error");
    expect(status).toBe(1);
    expect(deployed).toBe(false);
    expect(logs).toContain("Authentication error");
  });

  it("passes its options to wrangler deploy, and the Worker's name to the secrets it lists", () => {
    deploy(EVERY_SECRET, ["--name", "ember-production", "--var", "GIT_REVISION:abc1234"]);
    expect(output("list-args")).toBe("secret list --name ember-production");
    expect(output("deploy-args")).toBe("--name ember-production --var GIT_REVISION:abc1234");
  });

  it.each([
    [["--config", "wrangler.production.jsonc", "--env", "staging"], "secret list --config wrangler.production.jsonc --env staging"],
    [["-c=wrangler.production.jsonc", "-e", "staging", "--var", "A:b"], "secret list -c=wrangler.production.jsonc -e staging"],
  ])("lists the secrets of the Worker another config or environment picks, as it deploys that one (%j)", (args, listed) => {
    deploy(EVERY_SECRET, args);
    expect(output("list-args")).toBe(listed);
    expect(output("deploy-args")).toBe(args.join(" "));
  });

  it("lists the secrets of the Worker wrangler.jsonc names when it's given no name, as Deploy to Cloudflare runs it", () => {
    deploy(EVERY_SECRET);
    expect(output("list-args")).toBe("secret list");
  });

  it("fails when wrangler deploy does", () => {
    const { status } = deploy(EVERY_SECRET, [], 1);
    expect(status).toBe(1);
  });
});

describe(feature("notifications.web-push-keys"), () => {
  it("makes a VAPID key pair for a Worker that has neither key, and keeps the private key out of the logs", () => {
    const { status, secrets, logs } = deploy(["SESSION_SECRET"]);
    expect(status).toBe(0);
    expect(secrets).toEqual({ VAPID_PUBLIC_KEY: expect.stringMatching(/^B[\w-]{86}$/), VAPID_PRIVATE_KEY: expect.stringMatching(/^[\w-]{43}$/) });
    expect(logs).not.toContain(secrets!.VAPID_PRIVATE_KEY!);
  });

  it.each(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"])("leaves a Worker with only %s as it is, rather than replacing it", (key) => {
    const { status, secrets } = deploy(["SESSION_SECRET", key]);
    expect(status).toBe(0);
    expect(secrets).toEqual({});
  });
});
