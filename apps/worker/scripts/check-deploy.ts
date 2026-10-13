// Checks a deployed Worker without signing in: /api/health answers once SESSION_SECRET is set and
// the Workspace and a room's Durable Object both read their storage, the app's page loads, and the
// API asks for sign-in. The Preview workflow runs it after each deploy; it works against `pnpm dev`
// too:
//
//   node apps/worker/scripts/check-deploy.ts http://localhost:8787

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
