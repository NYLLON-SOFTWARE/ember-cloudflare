import {
  CUSTOM_EMOJI_API_PATH,
  CUSTOM_EMOJI_NAME_IS_STANDARD,
  CUSTOM_EMOJI_NAME_TAKEN,
  CUSTOM_EMOJI_TOO_LARGE,
  CUSTOM_EMOJI_WRONG_TYPE,
  customEmojiApiPath,
  customEmojiImagePath,
  MAX_CUSTOM_EMOJI,
  MAX_CUSTOM_EMOJI_SIZE,
  TOO_MANY_CUSTOM_EMOJI,
  type CustomEmoji,
  type CustomEmojiList,
  type NewWorkspace,
} from "@ember/protocol";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { api, apiWith, connect, cookieOf, freshDeploy, freshRoom, openWorkspaceSocket, origin, post, recordedImage, shown, signIn, workspaceSql, type Session } from "./support";

// Custom emoji, as Slack has them: anyone adds one, and its code shows as its picture in everyone's app.

const files = (env as unknown as Env).FILES!;

/** Sets the workspace up, answering its administrator's session. */
async function setUp(): Promise<Session> {
  const body = JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" });
  const response = await api("/api/first_run", { method: "POST", body });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** A picture within an emoji's 128×128, as the app's scaled one is. */
const picture = (name = "blob", type = "image/png") => new File([recordedImage("black_hole-logo-small.png")], name, { type });

/** A form with an emoji's `name` and `image`, as the Custom emoji page sends one. */
function emojiForm(name: string | null, image: File | string | null = picture()): FormData {
  const form = new FormData();
  if (name !== null) form.append("name", name);
  if (image !== null) form.append("image", image);
  return form;
}

/** Adds the emoji `form` brings as `session`. */
async function add(session: Session | null, form: FormData, bindings: Partial<Env> = {}): Promise<Response> {
  const request = new Request(origin, { method: "POST", body: form });
  const body = await request.arrayBuffer();
  const headers = { "Content-Type": request.headers.get("Content-Type")!, "Content-Length": String(body.byteLength) };
  return apiWith(bindings, CUSTOM_EMOJI_API_PATH, { method: "POST", headers: { ...as(session), ...headers }, body });
}

/** Adds an emoji named `name` as `session`, answering it. */
async function added(session: Session, name: string): Promise<CustomEmoji> {
  const response = await add(session, emojiForm(name));
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as CustomEmoji;
}

const remove = (session: Session | null, name: string) => api(customEmojiApiPath(name), { method: "DELETE", headers: as(session) });

const listed = async (session: Session) => ((await (await api(CUSTOM_EMOJI_API_PATH, { headers: as(session) })).json()) as CustomEmojiList).emoji;

const image = (session: Session | null, key: string, init: RequestInit = {}) => api(customEmojiImagePath(key), { ...init, headers: { ...as(session), ...init.headers } });

/** Everything R2 keeps of custom emoji. */
const stored = async () => (await files.list({ prefix: "emoji/" })).objects.map(({ key }) => key);

const pendingDeletions = () => workspaceSql("SELECT object_key FROM pending_picture_deletions ORDER BY object_key");

/** Waits for the Workspace to have R2 delete the pictures it has queued, and to forget them. */
const deleted = () => vi.waitFor(async () => expect(await pendingDeletions()).toEqual([]), { timeout: 5_000 });

const refusal = async (response: Response) => [response.status, await response.json()];

beforeEach(freshDeploy);

describe("Custom emoji", () => {
  it("adds the emoji anyone uploads, listed for everyone by name with who added it", async () => {
    await setUp();
    const grace = await signIn("Grace");
    const linus = await signIn("Linus");
    expect(await listed(grace)).toEqual([]);

    const shipit = await added(grace, "shipit");
    expect(shipit).toEqual({ name: "shipit", key: expect.stringMatching(/^[0-9a-z]{28}$/), creatorId: grace.user.id, createdAt: expect.any(String) });
    const parrot = await added(linus, "party_parrot");

    expect(await listed(linus)).toEqual([parrot, shipit]);
    expect(await stored()).toEqual([`emoji/${parrot.key}`, `emoji/${shipit.key}`].sort());
    // Nothing waits to be deleted: the emoji took their pictures' reservations.
    expect(await pendingDeletions()).toEqual([]);
  });

  it("serves an emoji's picture to people signed in, as its bytes said what it is, for a browser to keep", async () => {
    const ada = await setUp();
    // Whatever the form called it.
    const response = await add(ada, emojiForm("shipit", picture("shipit.gif", "image/gif")));
    const { key } = (await response.json()) as CustomEmoji;

    const shown = await image(ada, key);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Type")).toBe("image/png");
    expect(shown.headers.get("Cache-Control")).toBe("max-age=31536000, private, immutable");
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(recordedImage("black_hole-logo-small.png"));

    const etag = shown.headers.get("ETag")!;
    const unchanged = await image(ada, key, { headers: { "If-None-Match": etag } });
    expect([unchanged.status, await unchanged.text()]).toEqual([304, ""]);
    const head = await image(ada, key, { method: "HEAD" });
    expect([head.status, head.headers.get("Content-Type"), await head.text()]).toEqual([200, "image/png", ""]);

    // Signed out, the browser is sent to sign in, and a key with no picture is an empty 404.
    expect((await image(null, key, { redirect: "manual" })).status).toBe(302);
    expect((await image(ada, "0".repeat(28))).status).toBe(404);
    expect((await image(ada, key, { method: "POST" })).status).toBe(404);
  });

  it("tells every tab of everyone's as an emoji is added and removed", async () => {
    const ada = await setUp();
    const grace = await signIn("Grace");
    const tab = await openWorkspaceSocket(grace);
    const other = await openWorkspaceSocket(ada);

    const shipit = await added(ada, "shipit");
    expect(await tab.next()).toEqual({ type: "emoji.added", emoji: shipit });
    expect(await other.next()).toEqual({ type: "emoji.added", emoji: shipit });

    expect((await remove(ada, "shipit")).status).toBe(204);
    expect(await tab.next()).toEqual({ type: "emoji.removed", name: "shipit" });
    expect(await other.next()).toEqual({ type: "emoji.removed", name: "shipit" });
  });

  it("refuses a name another custom emoji has, one of the emoji's own, and one no code could be", async () => {
    const ada = await setUp();
    await added(ada, "shipit");

    expect(await refusal(await add(ada, emojiForm("shipit")))).toEqual([409, { error: CUSTOM_EMOJI_NAME_TAKEN, field: "name" }]);
    for (const standard of ["tada", "+1", "skin-tone-3"]) {
      expect(await refusal(await add(ada, emojiForm(standard)))).toEqual([422, { error: CUSTOM_EMOJI_NAME_IS_STANDARD, field: "name" }]);
    }
    for (const name of ["x", "Shipit", "ship it", "_shipit", "ship:it", "x".repeat(33)]) {
      const response = await add(ada, emojiForm(name));
      expect([response.status, ((await response.json()) as { field: string }).field], name).toEqual([422, "name"]);
    }
    expect(await refusal(await add(ada, emojiForm(null)))).toEqual([422, { error: "Give the emoji a name", field: "name" }]);

    expect((await listed(ada)).map(({ name }) => name)).toEqual(["shipit"]);
    expect(await stored()).toHaveLength(1);
  });

  it("refuses a picture that isn't a PNG, JPEG, GIF or WebP by its bytes, one over 256 KB, and none", async () => {
    const ada = await setUp();
    const svg = new File([`<svg xmlns="http://www.w3.org/2000/svg"/>`], "shipit.png", { type: "image/png" });
    expect(await refusal(await add(ada, emojiForm("shipit", svg)))).toEqual([415, { error: CUSTOM_EMOJI_WRONG_TYPE }]);
    const large = new File([recordedImage("black_hole-logo-small.png"), new Uint8Array(MAX_CUSTOM_EMOJI_SIZE)], "blob");
    expect(await refusal(await add(ada, emojiForm("shipit", large)))).toEqual([413, { error: CUSTOM_EMOJI_TOO_LARGE }]);
    expect(await refusal(await add(ada, emojiForm("shipit", null)))).toEqual([400, { error: "Choose an image" }]);
    expect(await refusal(await add(ada, emojiForm("shipit", "a picture")))).toEqual([400, { error: "Choose an image" }]);

    expect(await listed(ada)).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it("takes a JPEG and a WebP too", async () => {
    const ada = await setUp();
    const jpeg = (await (await add(ada, emojiForm("black_hole", new File([recordedImage("black_hole-thumb.jpg")], "blob")))).json()) as CustomEmoji;
    const webp = (await (await add(ada, emojiForm("earth", new File([recordedImage("earth-avatar.webp")], "blob")))).json()) as CustomEmoji;
    expect((await image(ada, jpeg.key)).headers.get("Content-Type")).toBe("image/jpeg");
    expect((await image(ada, webp.key)).headers.get("Content-Type")).toBe("image/webp");
  });

  it("lets whoever added an emoji remove it, and administrators, but nobody else, and has R2 delete its picture", async () => {
    const ada = await setUp();
    const grace = await signIn("Grace");
    const linus = await signIn("Linus");
    const shipit = await added(grace, "shipit");
    const parrot = await added(grace, "party_parrot");

    expect(await refusal(await remove(linus, "shipit"))).toEqual([403, { error: "Only administrators can remove an emoji someone else added" }]);
    expect(await refusal(await remove(grace, "nothing"))).toEqual([404, { error: "No custom emoji has that name" }]);
    expect((await listed(ada)).map(({ name }) => name)).toEqual(["party_parrot", "shipit"]);

    expect((await remove(grace, "shipit")).status).toBe(204);
    expect((await remove(ada, "party_parrot")).status).toBe(204);
    expect(await listed(ada)).toEqual([]);
    await deleted();
    expect(await stored()).toEqual([]);
    expect((await image(ada, shipit.key)).status).toBe(404);
    expect((await image(ada, parrot.key)).status).toBe(404);

    // The name is free again.
    expect((await added(linus, "shipit")).key).not.toBe(shipit.key);
  });

  it("needs someone signed in, and somewhere to keep pictures", async () => {
    const ada = await setUp();
    expect((await api(CUSTOM_EMOJI_API_PATH)).status).toBe(401);
    expect((await add(null, emojiForm("shipit"))).status).toBe(401);
    expect((await remove(null, "shipit")).status).toBe(401);
    expect((await add(ada, emojiForm("shipit"), { FILES: undefined })).status).toBe(503);
    expect(await stored()).toEqual([]);
  });

  it(`keeps a workspace to ${MAX_CUSTOM_EMOJI} custom emoji`, async () => {
    const ada = await setUp();
    await workspaceSql(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO custom_emoji (name, object_key, content_type, creator_id, created_at) SELECT 'emoji' || i, 'emoji/' || i, 'image/png', ?, '2026-01-01T00:00:00.000Z' FROM n`,
      MAX_CUSTOM_EMOJI,
      ada.user.id,
    );
    expect(await refusal(await add(ada, emojiForm("shipit")))).toEqual([422, { error: TOO_MANY_CUSTOM_EMOJI }]);
    expect(await stored()).toEqual([]);
  });

  it("keeps an emoji's code as a message's text and as a reaction, however long its name", async () => {
    const ada = await setUp();
    const name = "x".repeat(32);
    await added(ada, name);
    const room = await freshRoom("emoji");
    const client = await connect(room, ada);

    const message = await post(client, `<p>Ready :${name}:</p>`);
    expect(message.body).toBe(`<p>Ready :${name}:</p>`);
    client.send({ type: "boost.create", messageId: message.id, content: `:${name}:` });
    expect((await client.next("boost.created")).boost.content).toBe(`:${name}:`);
  });
});
