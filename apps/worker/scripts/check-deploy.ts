// Checks a deployed Worker without signing in: /api/health answers once SESSION_SECRET is set and
// the Workspace and a room's Durable Object both read their storage, the app's page loads, the API
// asks for sign-in, and, until Ember is set up, setup takes the private link. The Preview workflow
// runs it after each deploy; it works against `pnpm dev` too:
//
//   node apps/worker/scripts/check-deploy.ts http://localhost:8787

import type { Bootstrap } from "@ember/protocol";

/**
 * A new Worker's workers.dev hostname, and a secret set just after its deploy, can take a little
 * while to reach every location, so each check is retried until then.
 */
const STARTUP_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 5_000;
/** How long one request may take, so one that stalls fails and is retried like any other. */
const REQUEST_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function health(baseUrl: string): Promise<{ storage: string }> {
  const response = await fetch(new URL("/api/health", baseUrl), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    // It says what's missing, such as SESSION_SECRET.
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(`/api/health answered ${response.status}${error ? `: ${error}` : ""}`);
  }
  return (await response.json()) as { storage: string };
}

async function checkPage(baseUrl: string): Promise<void> {
  const response = await fetch(baseUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const html = await response.text();
  if (!response.ok || !html.includes('<div id="root">')) throw new Error(`The app's page answered ${response.status} without the app`);
}

async function checkSignInRequired(baseUrl: string): Promise<void> {
  const response = await fetch(new URL("/api/me", baseUrl), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status !== 401) throw new Error(`/api/me answered ${response.status} without a session, not 401`);
}

/**
 * Until Ember is set up, whoever opens it first becomes its administrator, so anywhere but this
 * machine setup has to take the private link (EMBER_SETUP_TOKEN). Answers what it found.
 */
async function checkSetup(baseUrl: string): Promise<string> {
  const response = await fetch(new URL("/api/bootstrap", baseUrl), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`/api/bootstrap answered ${response.status}`);
  const { setup, setupProtected } = (await response.json()) as Bootstrap;
  if (setup === "complete") return "Ember is set up";
  if (setupProtected) return "Setup waits for the private link: /first_run/access#token=<EMBER_SETUP_TOKEN>";
  if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname)) return "Setup is open to the first visitor, which is fine on this machine";
  throw new Error("Setup is open to whoever visits first: set the EMBER_SETUP_TOKEN secret");
}

async function check(baseUrl: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  const eventually = async <T>(attempt: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await attempt();
      } catch (error) {
        if (Date.now() >= deadline) throw new Error(`Still failing after ${STARTUP_TIMEOUT_MS / 1000}s`, { cause: error });
        await sleep(RETRY_DELAY_MS);
      }
    }
  };

  const { storage } = await eventually(() => health(baseUrl));
  console.log(`✓ /api/health answers: the Workspace and a room read their storage in ${storage}`);
  await eventually(() => checkPage(baseUrl));
  console.log("✓ The app's page loads");
  await eventually(() => checkSignInRequired(baseUrl));
  console.log("✓ The API asks for sign-in");
  console.log(`✓ ${await eventually(() => checkSetup(baseUrl))}`);
}

/** An error and its causes, such as fetch's "fetch failed" and the refused connection behind it. */
function explain(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause ? `${error.message}: ${explain(error.cause)}` : error.message;
}

const [baseUrl] = process.argv.slice(2);
if (!baseUrl) {
  console.error("Usage: node apps/worker/scripts/check-deploy.ts <url>");
  process.exit(2);
}
try {
  await check(baseUrl);
} catch (error) {
  console.error(`✗ ${explain(error)}`);
  process.exitCode = 1;
}
