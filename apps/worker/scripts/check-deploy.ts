import type { ServerFrame } from "@ember/protocol";

// Checks a deployed Worker end to end: the app's page loads, sign-in issues a session (so
// SESSION_SECRET is set), and a room's Durable Object answers a WebSocket with its welcome.
// The Preview workflow runs it after each deploy; it works against `pnpm dev` too:
//
//   node apps/worker/scripts/check-deploy.ts http://localhost:8787

/** A room of the check's own, so it never shows up in anyone's #general. */
const ROOM = "deploy-check";
/** A Worker's new workers.dev hostname can take a little while to start answering. */
const STARTUP_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 5_000;
const WELCOME_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl: string): Promise<{ storage: string }> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(new URL("/api/health", baseUrl));
      if (response.ok) return (await response.json()) as { storage: string };
      throw new Error(`it answered ${response.status}`);
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`/api/health wasn't up after ${STARTUP_TIMEOUT_MS / 1000}s`, { cause: error });
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function checkPage(baseUrl: string): Promise<void> {
  const response = await fetch(baseUrl);
  const html = await response.text();
  if (!response.ok || !html.includes('<div id="root">')) throw new Error(`The app's page answered ${response.status} without the app`);
}

async function signIn(baseUrl: string): Promise<string> {
  const response = await fetch(new URL("/api/session", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Deploy check" }),
  });
  if (response.status !== 201) {
    // Signing the token throws without a secret, and the error page says nothing more.
    const hint = response.status === 500 ? ". Is SESSION_SECRET set?" : "";
    throw new Error(`Sign-in answered ${response.status}${hint}`);
  }
  return ((await response.json()) as { token: string }).token;
}

function waitForWelcome(baseUrl: string, token: string): Promise<void> {
  const url = new URL(`/api/rooms/${ROOM}/socket`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  const socket = new WebSocket(url);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`No welcome from #${ROOM} after ${WELCOME_TIMEOUT_MS}ms`)), WELCOME_TIMEOUT_MS);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      // Closing fires the close event, so stop listening first.
      socket.onerror = socket.onclose = socket.onmessage = null;
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    socket.onerror = () => finish(new Error(`The socket to #${ROOM} failed`));
    socket.onclose = (event) => finish(new Error(`The socket to #${ROOM} closed (${event.code}) before its welcome`));
    socket.onmessage = (event) => {
      if ((JSON.parse(event.data as string) as ServerFrame).type === "welcome") finish();
    };
  });
}

async function check(baseUrl: string): Promise<void> {
  const { storage } = await waitForHealth(baseUrl);
  console.log(`✓ /api/health answers, storing messages in ${storage}`);
  await checkPage(baseUrl);
  console.log("✓ The app's page loads");
  const token = await signIn(baseUrl);
  console.log("✓ Sign-in issues a session");
  await waitForWelcome(baseUrl, token);
  console.log(`✓ #${ROOM} welcomes a socket`);
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
