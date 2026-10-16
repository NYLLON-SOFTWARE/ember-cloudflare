import { feature } from "@ember/parity";
import { MAX_PUSH_ENDPOINT_LENGTH, MAX_PUSH_KEY_LENGTH, type NewWorkspace, type PushSubscriptionKeys, type PushSubscriptions, type UserId } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, cookieOf, freshDeploy, shown, signIn, workspaceSql, type Session } from "./support";

const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";

/** A browser's subscription, with RFC 8291's example keys, at Chrome's push service unless given another endpoint. */
const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bHq") => ({
  endpoint,
  p256dhKey: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authKey: "BTBZMqHH6r4Tts7J_aSIgg",
});

/** What `POST /api/push-subscriptions` answers `session` for `body`, sent as JSON unless it's a string, from Firefox. */
const save = (session: Session | null, body: unknown) =>
  api("/api/push-subscriptions", {
    method: "POST",
    headers: { "User-Agent": FIREFOX, ...(session ? { Cookie: session.cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Saves `keys` for `session`, as turning notifications on does. */
async function saved(session: Session, keys: PushSubscriptionKeys = subscription()): Promise<void> {
  const response = await save(session, keys);
  expect(response.status, await response.clone().text()).toBe(204);
}

/** What `GET /api/push-subscriptions` answers `session`. */
const list = (session: Session | null) => api("/api/push-subscriptions", { headers: session ? { Cookie: session.cookie } : {} });

/** The endpoints of `session`'s subscriptions, as they're listed. */
async function endpointsOf(session: Session): Promise<string[]> {
  const response = await list(session);
  expect(response.status).toBe(200);
  return ((await response.json()) as PushSubscriptions).subscriptions.map(({ endpoint }) => endpoint);
}

/** What `DELETE /api/push-subscriptions/:id` answers `session`. */
const destroy = (session: Session | null, id: number | string) =>
  api(`/api/push-subscriptions/${id}`, { method: "DELETE", headers: session ? { Cookie: session.cookie } : {} });

const stored = (userId: UserId) => workspaceSql("SELECT endpoint, p256dh_key, auth_key, user_agent FROM push_subscriptions WHERE user_id = ? ORDER BY id", userId);

/** The ids of `userId`'s stored subscriptions. */
const idsOf = async (userId: UserId) => ((await workspaceSql("SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id", userId)) as Array<{ id: number }>).map(({ id }) => id);

/** Signs `session` out, as Log out does, naming the endpoint of the subscription this browser ended, if given. */
const signOut = (session: Session, pushSubscriptionEndpoint?: string) =>
  api("/api/session", { method: "DELETE", headers: { Cookie: session.cookie }, body: JSON.stringify({ pushSubscriptionEndpoint }) });

beforeEach(freshDeploy);

describe(feature("notifications.subscriptions"), () => {
  it("saves a browser's subscription for you, with its user agent, and lists only yours", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    await saved(ada);

    expect(await stored(ada.user.id)).toEqual([{ endpoint: subscription().endpoint, p256dh_key: subscription().p256dhKey, auth_key: subscription().authKey, user_agent: FIREFOX }]);
    const response = await list(ada);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [id] = await idsOf(ada.user.id);
    expect(await response.json()).toEqual({ subscriptions: [{ id, endpoint: subscription().endpoint, userAgent: FIREFOX }] });
    expect(await endpointsOf(grace)).toEqual([]);
  });

  it("saving the same subscription again keeps one, saved again, while a changed key adds another", async () => {
    const ada = await signIn("Ada");
    await saved(ada);
    await workspaceSql("UPDATE push_subscriptions SET updated_at = '2026-01-01T00:00:00.000Z'");

    await saved(ada);
    const [row] = (await workspaceSql("SELECT created_at, updated_at FROM push_subscriptions")) as Array<{ created_at: string; updated_at: string }>;
    expect(row!.updated_at > "2026-01-01T00:00:00.000Z").toBe(true);
    expect(await idsOf(ada.user.id)).toHaveLength(1);

    await saved(ada, { ...subscription(), authKey: "AAAAAAAAAAAAAAAAAAAAAA" });
    expect(await endpointsOf(ada)).toEqual([subscription().endpoint, subscription().endpoint]);
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://jmt17.google.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGuQyavXutnMZHyWVcLaK",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "HTTPS://FCM.GOOGLEAPIS.COM/fcm/send/abc",
    "https://fcm.googleapis.com:443/fcm/send/abc",
    "https://someone@fcm.googleapis.com/fcm/send/abc",
  ])("takes an endpoint at a push service: %s", async (endpoint) => {
    const ada = await signIn("Ada");
    await saved(ada, subscription(endpoint));
    expect(await endpointsOf(ada)).toEqual([endpoint]);
  });

  it.each([
    ["", "Endpoint can't be blank and is not a valid URL"],
    [" \t", "Endpoint can't be blank and is not a valid URL"],
    ["fcm.googleapis.com/fcm/send/abc", "Endpoint is not a valid URL"],
    ["https://fcm.googleapis.com/fcm/send/a b", "Endpoint is not a valid URL"],
    ["https://fcm.googleapis.com /fcm/send/abc", "Endpoint is not a valid URL"],
    ["https://fcm.googleapis.com:99999/fcm/send/abc", "Endpoint is not a valid URL"],
    ["http://fcm.googleapis.com/fcm/send/abc", "Endpoint must use HTTPS"],
    ["wss://fcm.googleapis.com/fcm/send/abc", "Endpoint must use HTTPS"],
    ["https://fcm.googleapis.com:8443/fcm/send/abc", "Endpoint must use the default HTTPS port"],
    ["https://push.example.com/fcm/send/abc", "Endpoint is not a permitted push service"],
    ["https://evilfcm.googleapis.com/fcm/send/abc", "Endpoint is not a permitted push service"],
    ["https://fcm.googleapis.com.example.com/fcm/send/abc", "Endpoint is not a permitted push service"],
    ["https://127.0.0.1/fcm/send/abc", "Endpoint is not a permitted push service"],
  ])("refuses the endpoint %j as ember-rust does, saving nothing", async (endpoint, error) => {
    const ada = await signIn("Ada");
    const response = await save(ada, subscription(endpoint));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error });
    expect(await endpointsOf(ada)).toEqual([]);
  });

  it.each([
    [null, "A push subscription needs its endpoint and keys"],
    ["not JSON", "A push subscription needs its endpoint and keys"],
    [{ endpoint: subscription().endpoint, p256dhKey: subscription().p256dhKey }, "A push subscription needs its endpoint and keys"],
    [{ ...subscription(), authKey: 7 }, "A push subscription needs its endpoint and keys"],
    [subscription(`https://fcm.googleapis.com/${"a".repeat(MAX_PUSH_ENDPOINT_LENGTH)}`), "Endpoint can't be longer than 2048 characters"],
    [{ ...subscription(), p256dhKey: "a".repeat(MAX_PUSH_KEY_LENGTH + 1) }, "Keys can't be longer than 256 characters"],
  ])("refuses %j, which no browser sends", async (body, error) => {
    const ada = await signIn("Ada");
    const response = await save(ada, body);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error });
  });

  it("answers 401 without a session, before checking what was sent", async () => {
    const ada = await signIn("Ada");
    const expired = { ...ada, cookie: `${ada.cookie}x` };
    for (const session of [null, expired]) {
      for (const response of [await save(session, subscription()), await save(session, subscription("http://nowhere")), await list(session), await destroy(session, 1)]) {
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Not signed in" });
      }
    }
    expect(await workspaceSql("SELECT id FROM push_subscriptions")).toEqual([]);
  });

  it("deletes only your own subscriptions, and does nothing for anyone else's", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    await saved(ada);
    await saved(grace);
    const [adas] = await idsOf(ada.user.id);
    const [graces] = await idsOf(grace.user.id);

    for (const id of [graces!, 999, "nonsense", "1.5"]) expect((await destroy(ada, id)).status).toBe(204);
    expect(await idsOf(grace.user.id)).toEqual([graces]);
    expect(await idsOf(ada.user.id)).toEqual([adas]);

    expect((await destroy(ada, adas!)).status).toBe(204);
    expect(await idsOf(ada.user.id)).toEqual([]);
  });

  it("forgets your subscriptions with the endpoint this browser ended as it signs out, and no others", async () => {
    const ada = await signIn("Ada");
    const grace = await signIn("Grace");
    const laptop = subscription("https://fcm.googleapis.com/fcm/send/laptop");
    const phone = subscription("https://web.push.apple.com/phone");
    await saved(ada, laptop);
    await saved(ada, { ...laptop, authKey: "AAAAAAAAAAAAAAAAAAAAAA" });
    await saved(ada, phone);
    await saved(grace, laptop);

    expect((await signOut(ada, laptop.endpoint)).status).toBe(204);
    expect(await stored(ada.user.id)).toEqual([expect.objectContaining({ endpoint: phone.endpoint })]);
    expect(await endpointsOf(grace)).toEqual([laptop.endpoint]);
  });

  it.each([
    ["nothing", undefined],
    ["something that isn't JSON", "endpoint"],
    ["no endpoint", JSON.stringify({})],
    ["a blank endpoint", JSON.stringify({ pushSubscriptionEndpoint: "" })],
    ["an endpoint that isn't text", JSON.stringify({ pushSubscriptionEndpoint: 7 })],
  ])("keeps your subscriptions when signing out sends %s", async (_, body) => {
    const ada = await signIn("Ada");
    await saved(ada);
    const response = await api("/api/session", { method: "DELETE", headers: { Cookie: ada.cookie }, ...(body === undefined ? {} : { body }) });
    expect(response.status).toBe(204);
    expect(await idsOf(ada.user.id)).toHaveLength(1);
  });

  describe("removing and banning", () => {
    const administrator = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

    /** Sets Ember up with Ada as its administrator, and signs Grace in, each with a subscription. */
    async function setUp(): Promise<{ ada: Session; grace: Session }> {
      const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(administrator) });
      expect(response.status).toBe(201);
      const ada = { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
      const grace = await signIn("Grace");
      await saved(ada);
      await saved(grace, subscription("https://updates.push.services.mozilla.com/wpush/v2/grace"));
      await saved(grace, subscription("https://web.push.apple.com/grace"));
      return { ada, grace };
    }

    it("forgets all of someone's subscriptions when they're removed", async () => {
      const { ada, grace } = await setUp();
      expect((await api(`/api/account/users/${grace.user.id}`, { method: "DELETE", headers: { Cookie: ada.cookie } })).status).toBe(200);
      expect(await idsOf(grace.user.id)).toEqual([]);
      expect(await idsOf(ada.user.id)).toHaveLength(1);
    });

    it("keeps someone's subscriptions when they're banned, as ember-rust does for when the ban is lifted", async () => {
      const { ada, grace } = await setUp();
      expect((await api(`/api/users/${grace.user.id}/ban`, { method: "POST", headers: { Cookie: ada.cookie } })).status).toBe(200);
      expect(await idsOf(grace.user.id)).toHaveLength(2);
    });
  });
});
