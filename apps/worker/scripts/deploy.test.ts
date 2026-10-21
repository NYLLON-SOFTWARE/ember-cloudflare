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
const EVERY_SECRET = ["SESSION_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "EMBER_SETUP_TOKEN"];
/** The address wrangler's record of the deploy names, as the fake wrangler below writes it. */
const WORKER_URL = "https://ember.example.workers.dev";
/** The setup link the deploy prints, ending in the token `token`, at the Worker's address or where one is unknown. */
const setupLink = (token: string, url = WORKER_URL) => `Set up Ember at ${url}/first_run#token=${token}`;

/** What `wrangler secret list` finds: the names of the Worker's secrets, no Worker yet, or a failure. */
type Listing = string[] | "no worker" | "error";

/**
 * Stands in for `pnpm exec wrangler`: `secret list` answers as $LISTING says, and `deploy` keeps
 * what it was given in $OUT (its options, its secrets file's path, mode and contents), records the
 * Worker's address as wrangler does, in $WRANGLER_OUTPUT_FILE_PATH, unless $NO_URL says it has none,
 * and exits with $DEPLOY_STATUS.
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
  if [ -n "$WRANGLER_OUTPUT_FILE_PATH" ] && [ -z "$NO_URL" ]; then
    echo '{"version":1,"type":"deploy","targets":["https://ember.example.workers.dev"]}' >> "$WRANGLER_OUTPUT_FILE_PATH"
  fi
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

/**
 * Runs the script with `args` for a Worker whose secrets are `listing`, in a shell like a terminal's
 * unless `env` says it's CI's, Workers Builds' or GitHub Actions', or brings a setup token.
 */
function deploy(listing: Listing, args: string[] = [], { deployStatus = 0, env = {} }: { deployStatus?: number; env?: Record<string, string> } = {}) {
  const LISTING = Array.isArray(listing) ? JSON.stringify(listing.map((name) => ({ name, type: "secret_text" }))) : listing;
  // The suite itself runs under CI, which the script must hear only from the test.
  const { CI: _ci, GITHUB_ACTIONS: _actions, WORKERS_CI: _workers, EMBER_SETUP_TOKEN: _token, WRANGLER_OUTPUT_FILE_PATH: _output, ...shell } = process.env;
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...shell, PATH: `${dir}:${process.env.PATH}`, LISTING, OUT: dir, DEPLOY_STATUS: String(deployStatus), ...env },
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
      EMBER_SETUP_TOKEN: expect.stringMatching(SECRET),
    });
    expect(output("secrets-mode")).toBe("600");
    // Cloudflare's build logs mask nothing, so no secret may appear in them, not even masked; the
    // setup token is the one meant to be read, and goes in its link.
    for (const secret of [secrets!.SESSION_SECRET!, secrets!.VAPID_PRIVATE_KEY!]) expect(logs).not.toContain(secret);
    expect(logs).toContain("Deploying with new SESSION_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, EMBER_SETUP_TOKEN");
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
    [["--config", "wrangler.production.jsonc"], "secret list --config wrangler.production.jsonc"],
    [["-c=wrangler.production.jsonc", "--name", "ember-production", "--var", "A:b"], "secret list -c=wrangler.production.jsonc --name ember-production"],
  ])("lists the secrets of the Worker another config picks, as it deploys that one (%j)", (args, listed) => {
    deploy(EVERY_SECRET, args);
    expect(output("list-args")).toBe(listed);
    expect(output("deploy-args")).toBe(args.join(" "));
  });

  it.each([["--env", "staging"], ["-e=staging"]])("refuses an environment, which wrangler.jsonc doesn't have, before deploying (%j)", (...args) => {
    const { status, deployed, logs } = deploy(EVERY_SECRET, args);
    expect(status).toBe(1);
    expect(deployed).toBe(false);
    expect(output("list-args")).toBeNull();
    expect(logs).toContain("no environments");
  });

  it("lists the secrets of the Worker wrangler.jsonc names when it's given no name, as Deploy to Cloudflare runs it", () => {
    deploy(EVERY_SECRET);
    expect(output("list-args")).toBe("secret list");
  });

  it("fails when wrangler deploy does", () => {
    const { status } = deploy(EVERY_SECRET, [], { deployStatus: 1 });
    expect(status).toBe(1);
  });
});

describe(feature("auth.protected-setup"), () => {
  const withoutSetupToken = EVERY_SECRET.filter((name) => name !== "EMBER_SETUP_TOKEN");

  it("makes a setup token for a Worker that has none, and prints the setup link that carries it, once wrangler has deployed", () => {
    const { status, secrets, logs } = deploy(withoutSetupToken);
    expect(status).toBe(0);
    expect(secrets).toEqual({ EMBER_SETUP_TOKEN: expect.stringMatching(SECRET) });
    expect(logs).toContain(setupLink(secrets!.EMBER_SETUP_TOKEN!));
    expect(logs).toContain("printed only now");
    // A new token is made where the person sees it, then given to `wrangler secret put`, which asks for it: a pipe would hide it.
    expect(logs).toContain("make one with openssl rand -hex 32, give it to the Worker with pnpm exec wrangler secret put EMBER_SETUP_TOKEN, which asks for it");
    expect(logs).not.toContain("openssl rand -hex 32 |");
  });

  it("names the Worker deployed in how to make a new token, so it doesn't go to wrangler.jsonc's", () => {
    const { logs } = deploy(withoutSetupToken, ["--name", "ember-production", "--config=../wrangler.jsonc", "--var", "GIT_REVISION:abc1234"]);
    expect(logs).toContain("pnpm exec wrangler secret put EMBER_SETUP_TOKEN --name ember-production --config=../wrangler.jsonc, which asks for it");
  });

  it("reads this deploy's address from an output file that wrangler appended earlier deploys' records to", () => {
    const outputFile = path.join(dir, "kept-output.json");
    writeFileSync(outputFile, `${JSON.stringify({ version: 1, type: "deploy", targets: ["https://earlier.example.workers.dev"] })}\n`);
    const { secrets, logs } = deploy(withoutSetupToken, [], { env: { WRANGLER_OUTPUT_FILE_PATH: outputFile } });
    expect(logs).toContain(setupLink(secrets!.EMBER_SETUP_TOKEN!));
    expect(logs).not.toContain("earlier.example");
    // And left the file for the environment that keeps it, with this deploy's record after the earlier one.
    expect(readFileSync(outputFile, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("keeps the setup token a Worker has, and says nothing of a link it can't know", () => {
    const { status, secrets, logs } = deploy(EVERY_SECRET);
    expect(status).toBe(0);
    expect(secrets).toEqual({});
    expect(logs).not.toContain("Set up Ember");
  });

  it("prints no link when wrangler fails to deploy", () => {
    const { status, logs } = deploy("no worker", [], { deployStatus: 1 });
    expect(status).toBe(1);
    expect(logs).not.toContain("Set up Ember");
  });

  it("names the Worker where wrangler recorded no address, rather than guessing one", () => {
    const { secrets, logs } = deploy(withoutSetupToken, [], { env: { NO_URL: "1" } });
    expect(logs).toContain(setupLink(secrets!.EMBER_SETUP_TOKEN!, "https://<your Worker>"));
  });

  it("takes the setup token the environment brings, and prints the link's shape without it, since its holder knows it", () => {
    const token = "ab".repeat(32);
    const { status, secrets, logs } = deploy(withoutSetupToken, [], { env: { EMBER_SETUP_TOKEN: token } });
    expect(status).toBe(0);
    expect(secrets).toEqual({ EMBER_SETUP_TOKEN: token });
    expect(logs).toContain(`Set up Ember at ${WORKER_URL}/first_run#token=<your EMBER_SETUP_TOKEN>`);
    expect(logs).not.toContain(token);
  });

  it.each(["hunter2", "AB".repeat(32), `${"ab".repeat(32)}\n`])("refuses a setup token from the environment that can't be one (%j), before deploying", (token) => {
    const { status, deployed, logs } = deploy(withoutSetupToken, [], { env: { EMBER_SETUP_TOKEN: token } });
    expect(status).toBe(1);
    expect(deployed).toBe(false);
    expect(logs).toContain("EMBER_SETUP_TOKEN must be 64 lowercase hex characters");
  });

  it("ignores a setup token from the environment, whatever its shape, for a Worker that has one", () => {
    const { status, secrets } = deploy(EVERY_SECRET, [], { env: { EMBER_SETUP_TOKEN: "hunter2" } });
    expect(status).toBe(0);
    expect(secrets).toEqual({});
  });

  it("makes no setup token where the log may be public, as a CI's is, and says what to do instead", () => {
    const { status, secrets, logs } = deploy("no worker", [], { env: { CI: "true" } });
    expect(status).toBe(0);
    expect(secrets).toEqual({ SESSION_SECRET: expect.any(String), VAPID_PUBLIC_KEY: expect.any(String), VAPID_PRIVATE_KEY: expect.any(String) });
    expect(logs).not.toContain("Set up Ember at");
    expect(logs).toContain("this log may be public, so this deploy made none");
    expect(logs).toContain(`${WORKER_URL}/first_run#token=<your EMBER_SETUP_TOKEN>`);
    expect(logs).toContain(`pnpm exec wrangler secret put EMBER_SETUP_TOKEN, which asks for it, and open ${WORKER_URL}/first_run#token=<the token>`);
    expect(logs).not.toContain("::notice::");
  });

  it("says so as a notice under GitHub Actions, where it shows on the run", () => {
    const { logs } = deploy("no worker", [], { env: { CI: "true", GITHUB_ACTIONS: "true" } });
    expect(logs).toMatch(/^::notice::Nobody can set Ember up until the Worker has an EMBER_SETUP_TOKEN secret/m);
  });

  it("takes the token a CI's environment brings, and keeps it out of the log", () => {
    const token = "cd".repeat(32);
    const { secrets, logs } = deploy("no worker", [], { env: { CI: "true", GITHUB_ACTIONS: "true", EMBER_SETUP_TOKEN: token } });
    expect(secrets!.EMBER_SETUP_TOKEN).toBe(token);
    expect(logs).toContain(`Set up Ember at ${WORKER_URL}/first_run#token=<your EMBER_SETUP_TOKEN>`);
    expect(logs).not.toContain(token);
  });

  it("prints the link under Workers Builds, whose log is the account's own, as Deploy to Cloudflare runs it", () => {
    const { secrets, logs } = deploy("no worker", [], { env: { CI: "true", WORKERS_CI: "1" } });
    expect(secrets!.EMBER_SETUP_TOKEN).toMatch(SECRET);
    expect(logs).toContain(setupLink(secrets!.EMBER_SETUP_TOKEN!));
  });
});

describe(feature("notifications.web-push-keys"), () => {
  it("makes a VAPID key pair for a Worker that has neither key, and keeps the private key out of the logs", () => {
    const { status, secrets, logs } = deploy(["SESSION_SECRET", "EMBER_SETUP_TOKEN"]);
    expect(status).toBe(0);
    expect(secrets).toEqual({ VAPID_PUBLIC_KEY: expect.stringMatching(/^B[\w-]{86}$/), VAPID_PRIVATE_KEY: expect.stringMatching(/^[\w-]{43}$/) });
    expect(logs).not.toContain(secrets!.VAPID_PRIVATE_KEY!);
  });

  it.each(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"])("leaves a Worker with only %s as it is, rather than replacing it", (key) => {
    const { status, secrets } = deploy(["SESSION_SECRET", "EMBER_SETUP_TOKEN", key]);
    expect(status).toBe(0);
    expect(secrets).toEqual({});
  });
});
