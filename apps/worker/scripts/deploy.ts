// Deploys the Worker with the secrets it doesn't have yet, so a new deployment works without anyone
// making them. Deploy to Cloudflare's build runs it as `pnpm run deploy`, and the Preview workflow
// runs it with its own options, which go on to `wrangler deploy`:
//
//   node apps/worker/scripts/deploy.ts [--name <worker>] [--config <file>] [--var NAME:value ...]
//
// Sessions are stored keyed with SESSION_SECRET, so changing it would sign everyone out: the first
// deploy makes one and later ones keep it. Browsers subscribe to push notifications with
// VAPID_PUBLIC_KEY, so the first deploy makes a VAPID key pair too, and later ones keep it. The first
// deploy also makes EMBER_SETUP_TOKEN, the one secret meant to be read: it prints the setup link that
// carries it, which is how whoever deployed, and nobody else, sets Ember up (apps/worker/src/setup.ts),
// and which is spent once they have. The secrets go up with the code in one `wrangler deploy
// --secrets-file`, from a file only this deploy can read, and nothing else here prints them:
// Cloudflare's build logs mask nothing, as GitHub's would. A CI log can be public, as a public
// repository's Actions logs are, so there the deploy makes no setup token, and says so, unless
// EMBER_SETUP_TOKEN in its environment brings one the deployer keeps as a secret of their own.
// Workers Builds' log is the account's own, so Deploy to Cloudflare gets its link there.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vapidKeys } from "./vapid-keys.ts";

/** The repository's root, where wrangler.jsonc is. */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Runs `pnpm exec wrangler` from the root, with its output captured or shown, and `env` besides this process's. */
function wrangler(args: string[], capture: boolean, env: Record<string, string> = {}) {
  return spawnSync("pnpm", ["exec", "wrangler", ...args], { cwd: ROOT, encoding: "utf8", stdio: capture ? "pipe" : "inherit", env: { ...process.env, ...env } });
}

/** The wrangler options that pick which Worker a command acts on, besides the ones wrangler.jsonc names. */
const TARGET_OPTIONS = ["--name", "--config", "-c"];

/** Whether `arg` is `option`, alone or with its value after `=`. */
const isOption = (arg: string, option: string) => arg === option || arg.startsWith(`${option}=`);

/**
 * The options among wrangler deploy's that pick its Worker, so `wrangler secret list` looks at the
 * same one. wrangler.jsonc has no environments, and an environment's Worker name depends on how it's
 * combined with `--name`, so `--env` is refused rather than guessed at.
 */
function targetOptions(args: string[]): string[] {
  if (args.some((arg) => isOption(arg, "--env") || isOption(arg, "-e"))) {
    throw new Error("wrangler.jsonc has no environments, so the deploy takes no --env.");
  }
  return args.flatMap((arg, at) => {
    if (TARGET_OPTIONS.includes(arg)) return args.slice(at, at + 2);
    return TARGET_OPTIONS.some((option) => isOption(arg, option)) ? [arg] : [];
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

/** The shape of EMBER_SETUP_TOKEN, as the Worker checks it (apps/worker/src/secrets.ts): `openssl rand -hex 32`. */
const SETUP_TOKEN = /^[0-9a-f]{64}$/;

/** Whether this deploy's output may be public: a CI log, except Workers Builds', which is the account's own. */
const inPublicLog = () => !!process.env.CI && !process.env.WORKERS_CI;

/** What became of the Worker's setup token: made here, given by the environment, withheld from a public log, or kept from before. */
type SetupToken = "made" | "given" | "withheld" | "kept";

/** New values for the secrets a Worker that has `names` is missing, and what became of its setup token. */
async function missingSecrets(names: string[]): Promise<{ secrets: Record<string, string>; setupToken: SetupToken }> {
  const secrets: Record<string, string> = {};
  if (!names.includes("SESSION_SECRET")) secrets.SESSION_SECRET = randomBytes(32).toString("hex");
  // A Worker with only one of the pair keeps it, and says in /api/health why push is off.
  if (!names.includes("VAPID_PUBLIC_KEY") && !names.includes("VAPID_PRIVATE_KEY")) {
    const { publicKey, privateKey } = await vapidKeys();
    Object.assign(secrets, { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey });
  }
  let setupToken: SetupToken = "kept";
  if (!names.includes("EMBER_SETUP_TOKEN")) {
    const given = process.env.EMBER_SETUP_TOKEN;
    if (given) {
      if (!SETUP_TOKEN.test(given)) throw new Error("EMBER_SETUP_TOKEN must be 64 lowercase hex characters, as `openssl rand -hex 32` makes.");
      [secrets.EMBER_SETUP_TOKEN, setupToken] = [given, "given"];
    } else if (inPublicLog()) {
      setupToken = "withheld";
    } else {
      [secrets.EMBER_SETUP_TOKEN, setupToken] = [randomBytes(32).toString("hex"), "made"];
    }
  }
  return { secrets, setupToken };
}

/** The Worker's address, from wrangler's record of the deploy in `outputFile`, or null where it recorded none. */
function deployedUrl(outputFile: string): string | null {
  if (!existsSync(outputFile)) return null;
  const targets = readFileSync(outputFile, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as { type?: string; targets?: string[] };
        return entry.type === "deploy" ? (entry.targets ?? []) : [];
      } catch {
        return [];
      }
    });
  return targets.find((target) => target.endsWith(".workers.dev")) ?? targets[0] ?? null;
}

/** Says how to set Ember up at `url`, as what became of the Worker's setup token allows. */
function tellSetupLink(setupToken: SetupToken, token: string | undefined, url: string | null): void {
  const page = `${(url ?? "https://<your Worker>").replace(/\/$/, "")}/first_run#token=`;
  const newToken = "openssl rand -hex 32 | pnpm exec wrangler secret put EMBER_SETUP_TOKEN";
  if (setupToken === "made") {
    console.log(`\nSet up Ember at ${page}${token}\nThat link carries this deployment's setup token, printed only now, and is spent once Ember is set up. For a new one: ${newToken}`);
  } else if (setupToken === "given") {
    console.log(`\nSet up Ember at ${page}<your EMBER_SETUP_TOKEN>`);
  } else if (setupToken === "withheld") {
    const notice = `Nobody can set Ember up until the Worker has an EMBER_SETUP_TOKEN secret, and this log may be public, so this deploy made none. Set EMBER_SETUP_TOKEN in the deploy's environment from a secret of your own (openssl rand -hex 32) and deploy again, or run ${newToken}; then open ${page}<the token>`;
    console.log(process.env.GITHUB_ACTIONS === "true" ? `::notice::${notice}` : `\n${notice}`);
  }
}

/** Deploys with `args` and the missing secrets, says how to set Ember up, and answers wrangler's exit status. */
async function deploy(args: string[]): Promise<number> {
  const { secrets, setupToken } = await missingSecrets(secretNames(targetOptions(args)));
  const dir = mkdtempSync(path.join(tmpdir(), "ember-deploy-"));
  try {
    const file = path.join(dir, "secrets.json");
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    const made = Object.keys(secrets);
    console.log(made.length ? `Deploying with new ${made.join(", ")}` : "Deploying with the Worker's secrets as they are");
    // wrangler records what it deployed, the Worker's address among it, in the file the environment names, else one of this deploy's own.
    const output = process.env.WRANGLER_OUTPUT_FILE_PATH || path.join(dir, "wrangler-output.json");
    const status = wrangler(["deploy", "--secrets-file", file, ...args], false, { WRANGLER_OUTPUT_FILE_PATH: output }).status ?? 1;
    if (status === 0) tellSetupLink(setupToken, secrets.EMBER_SETUP_TOKEN, deployedUrl(output));
    return status;
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
