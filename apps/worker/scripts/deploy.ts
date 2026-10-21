// Deploys the Worker with the secrets it doesn't have yet, so a new deployment works without anyone
// making them. Deploy to Cloudflare's build runs it as `pnpm run deploy`, and the Preview workflow
// runs it with its own options, which go on to `wrangler deploy`:
//
//   node apps/worker/scripts/deploy.ts [--name <worker>] [--config <file>] [--var NAME:value ...]
//
// Sessions are stored keyed with SESSION_SECRET, so changing it would sign everyone out: the first
// deploy makes one and later ones keep it. Browsers subscribe to push notifications with
// VAPID_PUBLIC_KEY, so the first deploy makes a VAPID key pair too, and later ones keep it. The
// secrets go up with the code in one `wrangler deploy --secrets-file`, from a file only this deploy
// can read, and nothing here prints them: Cloudflare's build logs mask nothing, as GitHub's would.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vapidKeys } from "./vapid-keys.ts";

/** The repository's root, where wrangler.jsonc is. */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Runs `pnpm exec wrangler` from the root, with its output captured or shown. */
function wrangler(args: string[], capture: boolean) {
  return spawnSync("pnpm", ["exec", "wrangler", ...args], { cwd: ROOT, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
}

/** The wrangler options that pick which Worker a command acts on, besides the ones wrangler.jsonc names. */
const TARGET_OPTIONS = ["--name", "--config", "-c", "--env", "-e"];

/** The options among wrangler deploy's that pick its Worker, so `wrangler secret list` looks at the same one. */
function targetOptions(args: string[]): string[] {
  return args.flatMap((arg, at) => {
    if (TARGET_OPTIONS.includes(arg)) return args.slice(at, at + 2);
    return TARGET_OPTIONS.some((option) => arg.startsWith(`${option}=`)) ? [arg] : [];
  });
}

/**
 * The names of the Worker's secrets, or none when there's no Worker yet. Failing to list them for
 * any other reason throws, rather than replacing ones that may be there.
 */
function secretNames(target: string[]): string[] {
  const listed = wrangler(["secret", "list", ...target], true);
  if (listed.status === 0) return (JSON.parse(listed.stdout) as { name: string }[]).map(({ name }) => name);
  if (/Worker "[^"]+" not found/.test(listed.stdout + listed.stderr)) return [];
  throw new Error(`Couldn't list the Worker's secrets:\n${listed.stdout}${listed.stderr}`);
}

/** New values for the secrets a Worker that has `names` is missing. */
async function missingSecrets(names: string[]): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};
  if (!names.includes("SESSION_SECRET")) secrets.SESSION_SECRET = randomBytes(32).toString("hex");
  // A Worker with only one of the pair keeps it, and says in /api/health why push is off.
  if (!names.includes("VAPID_PUBLIC_KEY") && !names.includes("VAPID_PRIVATE_KEY")) {
    const { publicKey, privateKey } = await vapidKeys();
    Object.assign(secrets, { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey });
  }
  return secrets;
}

/** Deploys with `args` and the missing secrets, and answers wrangler's exit status. */
async function deploy(args: string[]): Promise<number> {
  const secrets = await missingSecrets(secretNames(targetOptions(args)));
  const dir = mkdtempSync(path.join(tmpdir(), "ember-deploy-"));
  try {
    const file = path.join(dir, "secrets.json");
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    const made = Object.keys(secrets);
    console.log(made.length ? `Deploying with new ${made.join(", ")}` : "Deploying with the Worker's secrets as they are");
    return wrangler(["deploy", "--secrets-file", file, ...args], false).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await deploy(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
