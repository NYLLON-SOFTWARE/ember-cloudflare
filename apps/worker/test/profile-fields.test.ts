import {
  MAX_PROFILE_FIELD_VALUE_LENGTH,
  MAX_PROFILE_FIELDS,
  PROFILE_FIELD_NAME_REFUSED,
  PROFILE_FIELD_ORDER_REFUSED,
  PROFILE_FIELD_UNKNOWN,
  PROFILE_FIELD_VALUE_NOT_A_CHOICE,
  PROFILE_FIELDS_FULL,
  type NewWorkspace,
  type PersonAnswer,
  type ProfileAnswer,
  type ProfileField,
} from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, cookieOf, freshDeploy, signIn, shown, workspaceSql, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

/** The fields as the settings list them, which every change answers. */
const fieldsOf = async (session: Session) => ((await (await api("/api/account/profile_fields", { headers: as(session) })).json()) as { fields: ProfileField[] }).fields;

const add = (session: Session | null, body: unknown) => api("/api/account/profile_fields", { method: "POST", headers: as(session), body: JSON.stringify(body) });

const change = (session: Session | null, id: string, body: unknown) => api(`/api/account/profile_fields/${id}`, { method: "PATCH", headers: as(session), body: JSON.stringify(body) });

const order = (session: Session | null, ids: string[]) => api("/api/account/profile_fields/order", { method: "PUT", headers: as(session), body: JSON.stringify({ ids }) });

const remove = (session: Session | null, id: string) => api(`/api/account/profile_fields/${id}`, { method: "DELETE", headers: as(session) });

/** Saves someone's profile, as its form does. */
const save = (session: Session, body: unknown) => api("/api/users/me/profile", { method: "PATCH", headers: as(session), body: JSON.stringify(body) });

const profileOf = async (session: Session) => ((await (await api("/api/users/me/profile", { headers: as(session) })).json()) as ProfileAnswer).profile;

/** Someone as their page shows them. */
const personOf = async (viewer: Session, userId: string) => (await (await api(`/api/users/${userId}`, { headers: as(viewer) })).json()) as PersonAnswer;

const values = () => workspaceSql("SELECT field_id, user_id, value FROM profile_field_values ORDER BY field_id, user_id");

/** A field of the workspace's, as the list answers it. */
const named = (fields: ProfileField[], name: string) => fields.find((field) => field.name === name)!;

beforeEach(freshDeploy);
afterEach(() => vi.restoreAllMocks());

describe("Profile fields", () => {
  it("lists the fields in the order they come in the profile, newest last", async () => {
    const administrator = await setUp();
    expect(await fieldsOf(administrator)).toEqual([]);

    expect((await add(administrator, { name: "Title" })).status).toBe(200);
    expect((await add(administrator, { name: "Pronouns", options: ["she/her", "he/him", "they/them"] })).status).toBe(200);
    expect(await fieldsOf(administrator)).toEqual([
      { id: expect.any(String), name: "Title", options: null },
      { id: expect.any(String), name: "Pronouns", options: ["she/her", "he/him", "they/them"] },
    ]);
  });

  it("renames a field and sets its choices, keeping the values saved for it", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await add(administrator, { name: "Title" });
    const [field] = await fieldsOf(administrator);
    expect((await save(grace, { fieldValues: { [field!.id]: "Countess" } })).status).toBe(200);

    expect((await change(administrator, field!.id, { name: "Job title", options: ["Countess", "Admiral"] })).status).toBe(200);
    expect(await fieldsOf(administrator)).toEqual([{ id: field!.id, name: "Job title", options: ["Countess", "Admiral"] }]);
    expect(await values()).toEqual([{ field_id: field!.id, user_id: grace.user.id, value: "Countess" }]);
  });

  it("renames nothing for an id nobody has", async () => {
    const administrator = await setUp();
    expect((await change(administrator, "nobody", { name: "Title" })).status).toBe(404);
  });

  it("puts the fields in the order given, which their ids must name, once each", async () => {
    const administrator = await setUp();
    await add(administrator, { name: "Title" });
    await add(administrator, { name: "Pronouns" });
    const [title, pronouns] = await fieldsOf(administrator);

    expect((await order(administrator, [pronouns!.id, title!.id])).status).toBe(200);
    expect((await fieldsOf(administrator)).map((field) => field.name)).toEqual(["Pronouns", "Title"]);
    expect((await order(administrator, [title!.id])).status).toBe(422);
    expect(await (await order(administrator, [title!.id, title!.id])).json()).toEqual({ error: PROFILE_FIELD_ORDER_REFUSED });
    expect((await fieldsOf(administrator)).map((field) => field.name)).toEqual(["Pronouns", "Title"]);
  });

  it("takes a field away with everything anyone saved for it", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await add(administrator, { name: "Title" });
    const [field] = await fieldsOf(administrator);
    expect((await save(grace, { fieldValues: { [field!.id]: "Countess" } })).status).toBe(200);

    expect((await remove(administrator, field!.id)).status).toBe(200);
    expect(await fieldsOf(administrator)).toEqual([]);
    expect(await values()).toEqual([]);
    // Taking one that isn't there changes nothing.
    expect((await remove(administrator, field!.id)).status).toBe(200);
  });

  it("keeps as many fields as a workspace can, refusing the next", async () => {
    const administrator = await setUp();
    for (let n = 0; n < MAX_PROFILE_FIELDS; n++) expect((await add(administrator, { name: `Field ${n}` })).status).toBe(200);
    expect(await (await add(administrator, { name: "One more" })).json()).toEqual({ error: PROFILE_FIELDS_FULL });
    expect(await fieldsOf(administrator)).toHaveLength(MAX_PROFILE_FIELDS);
    // Room is made again once one is gone.
    await remove(administrator, (await fieldsOf(administrator))[0]!.id);
    expect((await add(administrator, { name: "One more" })).status).toBe(200);
  });

  it("refuses a name without anything in it, or longer than it can keep, and choices that are blank, too long, too many, or not a list", async () => {
    const administrator = await setUp();
    expect(await (await add(administrator, { name: "  " })).json()).toEqual({ error: PROFILE_FIELD_NAME_REFUSED });
    expect((await add(administrator, { name: `${"x".repeat(101)} ` })).status).toBe(422);
    expect((await add(administrator, { name: "Choices", options: ["", "  "] })).status).toBe(422);
    expect((await add(administrator, { name: "Choices", options: ["ok", `${"x".repeat(MAX_PROFILE_FIELD_VALUE_LENGTH + 1)}`] })).status).toBe(422);
    expect((await add(administrator, { name: "Choices", options: Array.from({ length: 11 }, (_, n) => `Choice ${n}`) })).status).toBe(422);
    expect((await add(administrator, { name: "Choices", options: "Free text" })).status).toBe(422);
    expect((await change(administrator, "none", { name: "Choices", options: [42] })).status).toBe(404);
    expect(await fieldsOf(administrator)).toEqual([]);
  });

  it("saves choices without the spaces at their ends, as it saves the name", async () => {
    const administrator = await setUp();
    expect((await add(administrator, { name: " Pronouns ", options: ["  she/her  ", "they/them"] })).status).toBe(200);
    expect(await fieldsOf(administrator)).toEqual([{ id: expect.any(String), name: "Pronouns", options: ["she/her", "they/them"] }]);
  });

  it("answers 403 to anyone but an administrator, and 401 to anyone signed out, before anything they sent is checked", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    expect((await api("/api/account/profile_fields", { headers: as(grace) })).status).toBe(403);
    for (const asked of [add(grace, { name: "" }), change(grace, "u1", { name: "" }), order(grace, []), remove(grace, "u1")]) expect((await asked).status).toBe(403);
    for (const asked of [api("/api/account/profile_fields"), add(null, { name: "Title" }), change(null, "u1", { name: "Title" }), order(null, []), remove(null, "u1")]) {
      expect((await asked).status).toBe(401);
    }
    expect(await fieldsOf(administrator)).toEqual([]);
  });

  it("answers only reading and changing the fields", async () => {
    const administrator = await setUp();
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect((await api("/api/account/profile_fields", { method, headers: as(administrator), body: JSON.stringify({ name: "Title" }) })).status).toBe(404);
    }
    expect((await api("/api/account/profile_fields/order", { method: "POST", headers: as(administrator), body: JSON.stringify({ ids: [] }) })).status).toBe(404);
  });

  it("saves what someone gives a field with their profile, and answers it on their profile", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await add(administrator, { name: "Title" });
    await add(administrator, { name: "Pronouns", options: ["she/her", "they/them"] });
    const fields = await fieldsOf(administrator);

    const saved = await save(grace, { bio: "Rear admiral", fieldValues: { [fields[0]!.id]: "Countess", [fields[1]!.id]: "she/her" } });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as ProfileAnswer).profile.fields).toEqual([
      { ...fields[0], value: "Countess" },
      { ...fields[1], value: "she/her" },
    ]);
    expect((await profileOf(grace)).fields).toEqual([
      { ...fields[0], value: "Countess" },
      { ...fields[1], value: "she/her" },
    ]);
    expect(await values()).toEqual([
      { field_id: fields[0]!.id, user_id: grace.user.id, value: "Countess" },
      { field_id: fields[1]!.id, user_id: grace.user.id, value: "she/her" },
    ]);
    expect((await personOf(administrator, grace.user.id)).fields).toEqual([
      { ...fields[0], value: "Countess" },
      { ...fields[1], value: "she/her" },
    ]);
  });

  it("saves a field's value alone, when nothing else of the profile changed", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await add(administrator, { name: "Title" });
    const [field] = await fieldsOf(administrator);
    expect((await save(grace, { fieldValues: { [field!.id]: "Countess" } })).status).toBe(200);
    expect((await profileOf(grace)).fields).toEqual([{ ...field, value: "Countess" }]);
    // And clearing it saves none.
    expect((await save(grace, { fieldValues: { [field!.id]: "" } })).status).toBe(200);
    expect((await profileOf(grace)).fields).toEqual([{ ...field, value: "" }]);
    expect(await values()).toEqual([]);
  });

  it("refuses a value a field's choices aren't one of, or a field that's gone, saving nothing", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await add(administrator, { name: "Pronouns", options: ["she/her", "they/them"] });
    const [field] = await fieldsOf(administrator);

    expect(await (await save(grace, { fieldValues: { [field!.id]: "he/him" } })).json()).toEqual({ error: PROFILE_FIELD_VALUE_NOT_A_CHOICE });
    expect(await values()).toEqual([]);
    // A choice it has is saved, so it was the one the workspace hadn't.
    expect((await save(grace, { fieldValues: { [field!.id]: "they/them" } })).status).toBe(200);
    expect(await (await save(grace, { fieldValues: { gone: "Countess" } })).json()).toEqual({ error: PROFILE_FIELD_UNKNOWN });
    expect(await values()).toEqual([{ field_id: field!.id, user_id: grace.user.id, value: "they/them" }]);
  });

  it("keeps the fields it answers to the fields of now, so someone's page shows what the workspace asks", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await add(administrator, { name: "Title" });
    await save(grace, { fieldValues: { [(await fieldsOf(administrator))[0]!.id]: "Countess" } });
    await add(administrator, { name: "Phone" });

    const fields = (await personOf(administrator, grace.user.id)).fields;
    expect(fields.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "Title", value: "Countess" },
      { name: "Phone", value: "" },
    ]);
    // Their profile, which they save, is told the same.
    expect((await profileOf(grace)).fields).toEqual(fields);
  });

  it("answers a save of the profile that names no fields without touching any", async () => {
    const administrator = await setUp();
    await add(administrator, { name: "Title" });
    const [field] = await fieldsOf(administrator);
    expect((await save(administrator, { bio: "Countess", fieldValues: {} })).status).toBe(200);
    expect(await values()).toEqual([]);
    expect((await profileOf(administrator)).fields).toEqual([{ ...field, value: "" }]);
  });
});
