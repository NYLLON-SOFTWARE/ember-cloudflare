import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExportRecord } from "./export.ts";

const SCRIPT = fileURLToPath(new URL("./export.ts", import.meta.url));

// A small workspace, as the seed would make it: Fernwood's three people, two shared rooms and three
// DMs, Maya their administrator, and nine messages among them, some of a thread and one deleted. The
// fake Worker answers the way the real one does, two messages of a room at a time, so the script has
// to page, and the export it writes is checked below against what was seeded.

const MAYA = { id: "u1", name: "Maya Chen", emailAddress: "maya@fernwood.example", password: "fern-park-9", administrator: true };
const SAM = { id: "u2", name: "Sam Rivera", emailAddress: "sam@fernwood.example", password: "quiet-river-3", administrator: false };
const TOM = { id: "u3", name: "Tom Aldous", emailAddress: "tom@fernwood.example", password: "old-forest-7", administrator: false };
const PEOPLE = [MAYA, SAM, TOM];

const GENERAL = "r-general";
const LAUNCH = "r-launch";
const RANDOM = "r-random";
const WITH_SAM = "r-d1";
const SAM_AND_TOM = "r-d2";
const TO_HERSELF = "r-d3";

const ROOMS = [
  { id: GENERAL, kind: "open", name: "general", icon: null, createdAt: "2026-02-01T09:00:00.000Z" },
  { id: LAUNCH, kind: "closed", name: "Launch plan", icon: null, createdAt: "2026-02-01T09:05:00.000Z", memberIds: [SAM.id, TOM.id] },
  { id: RANDOM, kind: "open", name: "random", icon: null, createdAt: "2026-02-01T09:02:00.000Z" },
  { id: WITH_SAM, kind: "direct", name: null, icon: null, createdAt: "2026-02-02T10:00:00.000Z", memberIds: [MAYA.id, SAM.id] },
  { id: SAM_AND_TOM, kind: "direct", name: null, icon: null, createdAt: "2026-02-02T10:05:00.000Z", memberIds: [SAM.id, TOM.id] },
  { id: TO_HERSELF, kind: "direct", name: null, icon: null, createdAt: "2026-02-02T10:09:00.000Z", memberIds: [MAYA.id] },
];

const message = (n: number, roomId: string, creatorId: string, plainText: string, rest: object = {}) => ({
  id: `m${n}`,
  clientMessageId: `cm-${n}`,
  roomId,
  creator: { id: creatorId, name: PEOPLE.find((person) => person.id === creatorId)!.name },
  body: `<p>${plainText}</p>`,
  plainText,
  mentions: [],
  createdAt: `2026-02-03T09:${String(n).padStart(2, "0")}:00.000Z`,
  updatedAt: `2026-02-03T09:${String(n).padStart(2, "0")}:00.000Z`,
  editedAt: null,
  boosts: [],
  ...rest,
});

const MESSAGES = [
  message(1, GENERAL, MAYA.id, "Hello crew"),
  message(2, GENERAL, SAM.id, "Hello! The room hears me too", { parentId: "m1", alsoSent: true, parentText: "Hello crew" }),
  message(3, GENERAL, MAYA.id, "Ship it"),
  message(4, LAUNCH, SAM.id, "Blueprint attached"),
  message(5, LAUNCH, TOM.id, "Only the thread hears me", { parentId: "m4", parentText: "Blueprint attached" }),
  message(6, WITH_SAM, SAM.id, "Lunch?"),
  message(7, WITH_SAM, MAYA.id, "Yes at noon", { deleted: true }),
  message(8, SAM_AND_TOM, SAM.id, "Ping"),
  message(9, TO_HERSELF, MAYA.id, "Note to self"),
];

/** A page of room `roomId`'s messages, as the Worker answers them: the two oldest after `after`. */
function pageOf(roomId: string, after: string | null) {
  const next = MESSAGES.filter(({ id }) => after === null || id > after).filter((said) => said.roomId === roomId);
  return { messages: next.slice(0, 2), hasMore: next.length > 2 };
}

/** What the fake Worker answers, to an administrator alone: signing in, the listing, a room's messages. */
function answerOf(url: string, after: string | null, cookie: string | undefined, body: string): { status: number; answer: object; cookie?: string } {
  const administrator = cookie === "session=stays";
  if (url === "/api/session") {
    const asked = JSON.parse(body) as { emailAddress?: string; password?: string };
    const person = PEOPLE.find(({ emailAddress }) => asked.emailAddress === emailAddress);
    if (!person || asked.password !== person.password) return { status: 401, answer: { error: "Those details don't match anyone here" } };
    return { status: 201, answer: { user: { id: person.id, name: person.name, administrator: person.administrator } }, cookie: `session=${person.administrator ? "stays" : "visitor"}` };
  }
  if (url === "/api/export") {
    if (!cookie) return { status: 401, answer: { error: "Not signed in" } };
    if (!administrator) return { status: 403, answer: { error: "Only administrators can export the workspace" } };
    return {
      status: 200,
      answer: {
        users: PEOPLE.map(({ id, name, emailAddress, administrator: role }) => ({ id, name, emailAddress, bio: null, role: role ? "administrator" : "member", status: "active" })),
        rooms: ROOMS,
      },
    };
  }
  const room = /^\/api\/export\/rooms\/([^/]+)\/messages$/.exec(url);
  if (room) {
    if (!administrator) return { status: 403, answer: { error: "Only administrators can export the workspace" } };
    return { status: 200, answer: pageOf(decodeURIComponent(room[1]!), after) };
  }
  return { status: 404, answer: { error: "Not found" } };
}

let server: Server;
let address: string;
let output: string;
let asked: string[];

beforeEach(async () => {
  asked = [];
  server = createServer((request: IncomingMessage, response) => {
    const { url = "", headers: { cookie } } = request;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      asked.push(url);
      const { status, answer, cookie: fresh } = answerOf(url.split("?")[0]!, new URL(`http://x${url}`).searchParams.get("after"), cookie, Buffer.concat(chunks).toString());
      response.writeHead(status, { "Content-Type": "application/json", ...(fresh && { "Set-Cookie": `${fresh}; Path=/; HttpOnly` }) });
      response.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  output = path.join(mkdtempSync(path.join(tmpdir(), "export-")), "ember-export.ndjson");
});

afterEach(() => {
  server.close();
  rmSync(path.dirname(output), { recursive: true, force: true });
});

/** Runs the export of the workspace at `address` to `output`, with `emailAddress` and `password` signing in. */
function run(emailAddress: string | null, password: string | null): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.EMBER_EXPORT_EMAIL_ADDRESS;
  delete env.EMBER_EXPORT_PASSWORD;
  if (emailAddress !== null) env.EMBER_EXPORT_EMAIL_ADDRESS = emailAddress;
  if (password !== null) env.EMBER_EXPORT_PASSWORD = password;
  const child = spawn(process.execPath, [SCRIPT, address, output], { env });
  let [stdout, stderr] = ["", ""];
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr })));
}

/** The export the script wrote, one record to a line. */
const recordsOf = (): ExportRecord[] => readFileSync(output, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as ExportRecord);

describe("The export script", () => {
  it("writes everyone, then every room with its messages, once each and in order", async () => {
    const { status, stdout, stderr } = await run(MAYA.emailAddress, MAYA.password);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    expect(stdout).toContain(`Exporting ${address} as Maya Chen to ${output}.`);
    expect(stdout).toContain(`Wrote 3 people, 6 rooms and 9 messages to ${output}.`);

    const records = recordsOf();
    expect(records.filter(({ type }) => type === "user")).toEqual(
      PEOPLE.map(({ id, name, emailAddress, administrator }) => ({
        type: "user",
        user: { id, name, emailAddress, bio: null, role: administrator ? "administrator" : "member", status: "active" },
      })),
    );
    // The shared rooms by name, then the DMs in the order they were made.
    expect(records.flatMap((record) => (record.type === "room" ? [record.room.id] : []))).toEqual([GENERAL, LAUNCH, RANDOM, WITH_SAM, SAM_AND_TOM, TO_HERSELF]);

    // Each room's messages directly after it, oldest first, an empty room's none.
    const roomsAt = records.flatMap((record, at) => (record.type === "room" ? [[record.room.id, at] as const] : []));
    for (const [roomId, at] of roomsAt) {
      const said: Array<Extract<ExportRecord, { type: "message" }>["message"]> = [];
      for (const record of records.slice(at + 1)) {
        if (record.type !== "message") break;
        said.push(record.message);
      }
      expect(said.map(({ id }) => id), roomId).toEqual(MESSAGES.filter((written) => written.roomId === roomId).map(({ id }) => id));
      expect(said.map(({ id }) => id), roomId).toEqual([...said].map(({ id }) => id).sort());
    }

    // Nothing twice, and everything once: every room kind with its members, every message, threads
    // with their parents, a deleted one kept for its thread, and a self-DM among the DMs.
    const messages = records.flatMap((record) => (record.type === "message" ? [record.message] : []));
    expect(new Set(messages.map(({ id }) => id)).size).toBe(messages.length);
    expect(messages.map(({ id }) => id)).toEqual(MESSAGES.map(({ id }) => id));
    expect(messages.filter(({ roomId }) => roomId === RANDOM)).toEqual([]);
    const byId = new Map(messages.map((written) => [written.id, written]));
    expect(byId.get("m2")).toMatchObject({ parentId: "m1", alsoSent: true });
    expect(byId.get("m5")).toMatchObject({ parentId: "m4" });
    expect(byId.get("m7")).toMatchObject({ deleted: true });
    const rooms = records.flatMap((record) => (record.type === "room" ? [record.room] : []));
    expect(rooms.find(({ id }) => id === LAUNCH)).toEqual(ROOMS[1]);
    expect(rooms.find(({ id }) => id === TO_HERSELF)).toEqual(ROOMS[5]);

    // General's three messages took two pages, and the second was asked for by the first's last message.
    expect(asked.filter((url) => url.startsWith(`/api/export/rooms/${GENERAL}/`))).toHaveLength(2);
    expect(asked.some((url) => new URL(`http://x${url}`).searchParams.get("after") === "m2")).toBe(true);
  });

  it("refuses someone who isn't an administrator, before it asks the Worker for anything of the export", async () => {
    const { status, stdout, stderr } = await run(SAM.emailAddress, SAM.password);
    expect(status).toBe(2);
    expect(stderr).toContain("Sam Rivera isn't one of");
    expect(stderr).toContain("administrators");
    expect(stdout).toBe("");
    expect(existsSync(output)).toBe(false);
    expect(asked).toEqual(["/api/session"]);
  });

  it("passes the Worker's refusal of the details on", async () => {
    const { status, stderr } = await run(MAYA.emailAddress, "not the password");
    expect(status).toBe(1);
    expect(stderr).toContain("Those details don't match anyone here");
    expect(existsSync(output)).toBe(false);
  });

  it.each([
    ["no email address", null, MAYA.password],
    ["no password", MAYA.emailAddress, null],
  ])("says what it signs in with when the environment has %s", async (_, emailAddress, password) => {
    const { status, stderr } = await run(emailAddress, password);
    expect(status).toBe(2);
    expect(stderr).toContain("EMBER_EXPORT_EMAIL_ADDRESS");
    expect(stderr).toContain("EMBER_EXPORT_PASSWORD");
    expect(asked).toEqual([]);
  });
});
