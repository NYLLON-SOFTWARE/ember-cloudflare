import { huddlePath, searchPath, type Account, type DirectoryUser, type DirectRoom, type Involvement, type Me, type Room, type RoomSettings, type SharedRoom, type SidebarRoom } from "@ember/protocol";
import { bodyFromPlainText, mentionContent } from "@ember/richtext/dom";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSearchContext } from "@/components/workspace/search-box";
import { CONFIRM_LEAVE } from "@/lib/api";
import type { SentAway } from "@/lib/outbox";
import type { RoomAnswer } from "@/lib/room-list";
import { commandIn, type WrittenCommand } from "@/lib/slash-commands";
import { AccountContext } from "./use-account";
import { PeopleContext } from "./use-directory";
import { navigate, NEW_DIRECT_PATH, roomPath, roomSettingsPath } from "./use-route";
import { useSlashCommands } from "./use-slash-commands";

const { flash, sendAway } = vi.hoisted(() => ({ flash: vi.fn(), sendAway: vi.fn(async (): Promise<SentAway> => "sent") }));
vi.mock("@/components/flash", () => ({ useFlash: () => flash }));
vi.mock("@/lib/outbox", () => ({ sendAway }));
vi.mock("./use-route", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-route")>()), navigate: vi.fn() }));

const person = (id: string, name: string): DirectoryUser => ({ id, name, bio: null, role: "member", status: "active", avatarUrl: `/users/${id}/avatar` });
const ada = person("ada0000000000001", "Ada Lovelace");
const grace = person("grace00000000001", "Grace Hopper");
const linus = person("linus00000000001", "Linus Torvalds");
const me: Me = { id: ada.id, name: ada.name, administrator: false };

const general: SharedRoom = { id: "general", kind: "open", name: "general", icon: null };
const design: SharedRoom = { id: "design", kind: "closed", name: "design", icon: "lock" };
const withGrace: DirectRoom = { id: "dm-grace", kind: "direct", members: [ada, grace], activeAt: "2026-11-17T12:00:00.000Z" };
const listed = (room: Room, involvement: Involvement): SidebarRoom => ({ ...room, unread: false, involvement });
const rooms = [listed(general, "mentions"), listed(design, "everything"), listed(withGrace, "everything")];

/** A workspace with huddles turned on. */
const account: Account = { name: "Ember", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {}, huddles: true, huddleCameras: true, huddleScreens: true };

/** A mention of `person`, as the @ list writes it. */
const mention = ({ id, name, avatarUrl }: DirectoryUser) =>
  `<action-text-attachment sgid="${id}" content="${mentionContent({ id, name, avatarUrl }).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" content-type="application/vnd.campfire.mention"></action-text-attachment>`;

/** A command, written as `markup`, or as plain text. */
const written = (text: string, markup = bodyFromPlainText(text)) => commandIn(markup) as WrittenCommand;

/** What was asked of the server, by method and address, with what was sent. */
const requests = () => vi.mocked(fetch).mock.calls.map(([url, init]) => [init?.method ?? "GET", url, init?.body && JSON.parse(init.body as string)]);

/** Answers each request by its method and address, as `answers` has it. */
function serve(answers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const answer = answers[`${init?.method ?? "GET"} ${url}`];
      if (answer instanceof Response) return answer;
      return answer === undefined ? Response.json({ error: "Not found" }, { status: 404 }) : Response.json(answer);
    }),
  );
}

function runIn(room: Room, { involvement = "mentions" as Involvement, huddles = true } = {}) {
  const answers: RoomAnswer[] = [];
  const callbacks = { onFailed: vi.fn(), onOpenDirects: vi.fn(), onOpenShortcuts: vi.fn(), onSend: vi.fn(() => true), openSearch: vi.fn() };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AccountContext value={{ ...account, huddles }}>
      <PeopleContext value={new Map([ada, grace, linus].map((p) => [p.id, p]))}>
        <OpenSearchContext value={callbacks.openSearch}>{children}</OpenSearchContext>
      </PeopleContext>
    </AccountContext>
  );
  const { result } = renderHook(
    () =>
      useSlashCommands({
        room,
        me,
        involvement,
        rooms,
        askForRoom: () => (answer) => answers.push(answer),
        onFailed: callbacks.onFailed,
        onOpenDirects: callbacks.onOpenDirects,
        onOpenShortcuts: callbacks.onOpenShortcuts,
        onSend: callbacks.onSend,
      }),
    { wrapper },
  );
  return { ...callbacks, answers, run: (command: WrittenCommand) => result.current.run(command), commands: () => result.current.commands.map(({ name }) => name) };
}

const settingsOf = (room: SharedRoom, members: DirectoryUser[], canAdminister = true): RoomSettings => ({
  room,
  canAdminister,
  people: [ada, grace, linus].map((p) => ({ id: p.id, name: p.name, member: members.includes(p) })),
});

beforeEach(() => serve({}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.documentElement.classList.remove("dark");
});

describe("/ commands", () => {
  it("lists /huddle where the room has huddles, and those about who's in a room in a private one", () => {
    expect(runIn(design).commands()).toEqual(["darkmode", "dm", "huddle", "invite", "leave", "msg", "mute", "remove", "rename", "search", "shortcuts", "shrug", "snippet"]);
    expect(runIn(general, { huddles: false }).commands()).toEqual(["darkmode", "dm", "msg", "mute", "rename", "search", "shortcuts", "shrug", "snippet"]);
  });

  it("turns dark mode on or off, opens the DMs and the keyboard shortcuts", async () => {
    const { run, onOpenDirects, onOpenShortcuts } = runIn(general);
    expect(await run(written("/darkmode"))).toBe(true);
    expect(document.documentElement).toHaveClass("dark");
    await run(written("/darkmode"));
    expect(document.documentElement).not.toHaveClass("dark");

    expect(await run(written("/dm"))).toBe(true);
    expect(onOpenDirects).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalledWith(NEW_DIRECT_PATH);
    expect(await run(written("/shortcuts"))).toBe(true);
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
  });

  it("offers the room's huddle as its link does, and searches for what follows /search, or opens the search box", async () => {
    const { run, openSearch } = runIn(general);
    await run(written("/huddle"));
    expect(navigate).toHaveBeenLastCalledWith(huddlePath(general.id));
    await run(written("/search launch plans"));
    expect(navigate).toHaveBeenLastCalledWith(searchPath({ q: "launch plans" }));
    await run(written("/search"));
    expect(openSearch).toHaveBeenCalledExactlyOnceWith({ opener: expect.anything(), roomId: general.id });
  });

  it("mutes the room, or unmutes it to where a room starts, or the room named", async () => {
    serve({ "PUT /api/rooms/general/involvement": { involvement: "nothing" }, "PUT /api/rooms/design/involvement": { involvement: "nothing" } });
    const { run, answers } = runIn(general);
    expect(await run(written("/mute"))).toBe(true);
    expect(await run(written("/mute #Design"))).toBe(true);
    expect(requests()).toEqual([
      ["PUT", "/api/rooms/general/involvement", { involvement: "nothing" }],
      ["PUT", "/api/rooms/design/involvement", { involvement: "nothing" }],
    ]);
    expect(answers).toEqual([
      { type: "involved", roomId: "general", involvement: "nothing" },
      { type: "involved", roomId: "design", involvement: "nothing" },
    ]);
    expect(flash.mock.calls).toEqual([
      ["notice", "Muted #general."],
      ["notice", "Muted #design."],
    ]);

    serve({ "PUT /api/rooms/general/involvement": { involvement: "mentions" } });
    await runIn(general, { involvement: "nothing" }).run(written("/mute"));
    expect(requests()).toEqual([["PUT", "/api/rooms/general/involvement", { involvement: "mentions" }]]);
    expect(flash).toHaveBeenLastCalledWith("notice", "Unmuted #general.");
  });

  it("says a room named that isn't yours can't be muted, keeping the command to put right", async () => {
    const { run } = runIn(general);
    expect(await run(written("/mute #nowhere"))).toBe(false);
    expect(flash).toHaveBeenCalledExactlyOnceWith("alert", "Name a room you're in after the #.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds whom /invite mentions or names to the room, or the room named, which only its administrators can", async () => {
    serve({ "GET /api/rooms/design/settings": settingsOf(design, [ada]), "PATCH /api/rooms/design/members": { room: design } });
    const { run, answers } = runIn(design);
    expect(await run(written("", `<p>/invite ${mention(grace)} @linus torvalds</p>`))).toBe(true);
    expect(requests()).toEqual([
      ["GET", "/api/rooms/design/settings", undefined],
      ["PATCH", "/api/rooms/design/members", { addedIds: [grace.id, linus.id], removedIds: [] }],
    ]);
    expect(answers).toEqual([{ type: "saved", room: design }]);
    expect(flash).toHaveBeenLastCalledWith("notice", "Added Grace Hopper and Linus Torvalds to #design.");

    serve({ "GET /api/rooms/design/settings": settingsOf(design, [ada], false) });
    expect(await runIn(general).run(written("/invite @Grace Hopper #design"))).toBe(false);
    expect(flash).toHaveBeenLastCalledWith("alert", "Only administrators and the room's creator can add people to #design.");
  });

  it("adds and removes each of two people /invite and /remove mention who share a name", async () => {
    const otherGrace = person("grace00000000002", "Grace Hopper");
    const settings = (members: DirectoryUser[]): RoomSettings => ({ room: design, canAdminister: true, people: [ada, grace, otherGrace].map((p) => ({ id: p.id, name: p.name, member: members.includes(p) })) });
    const both = `${mention(grace)} ${mention(otherGrace)}`;
    serve({ "GET /api/rooms/design/settings": settings([ada]), "PATCH /api/rooms/design/members": { room: design } });
    expect(await runIn(design).run(written("", `<p>/invite ${both}</p>`))).toBe(true);
    expect(requests().at(-1)).toEqual(["PATCH", "/api/rooms/design/members", { addedIds: [grace.id, otherGrace.id], removedIds: [] }]);

    serve({ "GET /api/rooms/design/settings": settings([ada, grace, otherGrace]), "PATCH /api/rooms/design/members": { room: design } });
    expect(await runIn(design).run(written("", `<p>/remove ${both} ${mention(grace)}</p>`))).toBe(true);
    expect(requests().at(-1)).toEqual(["PATCH", "/api/rooms/design/members", { addedIds: [], removedIds: [grace.id, otherGrace.id] }]);
  });

  it("opens the room's settings for /invite with nobody named, and says everyone's in an open room", async () => {
    await runIn(design).run(written("/invite"));
    expect(navigate).toHaveBeenLastCalledWith(roomSettingsPath("closed", design.id));
    expect(await runIn(general).run(written("/invite @Grace Hopper"))).toBe(true);
    expect(flash).toHaveBeenLastCalledWith("notice", "Everyone is in #general already.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes whom /remove names out of the room", async () => {
    serve({ "GET /api/rooms/design/settings": settingsOf(design, [ada, grace, linus]), "PATCH /api/rooms/design/members": { room: design } });
    const { run, answers } = runIn(design);
    expect(await run(written("/kick @Grace Hopper"))).toBe(true);
    expect(requests().at(-1)).toEqual(["PATCH", "/api/rooms/design/members", { addedIds: [], removedIds: [grace.id] }]);
    expect(answers).toEqual([{ type: "saved", room: design }]);
    expect(flash).toHaveBeenLastCalledWith("notice", "Removed Grace Hopper from #design.");
  });

  it("leaves a private room once it's confirmed, and hides an open one, going home", async () => {
    serve({ "DELETE /api/rooms/design/membership": new Response(null, { status: 204 }), "PUT /api/rooms/general/involvement": { involvement: "invisible" } });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const inDesign = runIn(design);
    expect(await inDesign.run(written("/leave"))).toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(CONFIRM_LEAVE);
    expect(inDesign.answers).toEqual([{ type: "gone", roomId: "design" }]);
    expect(navigate).toHaveBeenLastCalledWith("/");

    const inGeneral = runIn(general);
    expect(await inGeneral.run(written("/leave"))).toBe(true);
    expect(inGeneral.answers).toEqual([{ type: "involved", roomId: "general", involvement: "invisible" }]);
    expect(flash).toHaveBeenLastCalledWith("notice", "#general is hidden from your sidebar.");
  });

  it("says why a command the server refused didn't run, keeping it to put right", async () => {
    serve({ "DELETE /api/rooms/design/membership": Response.json({ error: "You can change this room, so take yourself out in its settings" }, { status: 403 }) });
    vi.stubGlobal("confirm", () => true);
    const { run, onFailed, answers } = runIn(design);
    expect(await run(written("/leave"))).toBe(false);
    expect(onFailed).toHaveBeenCalledOnce();
    expect(answers).toEqual([]);
  });

  it("renames the room, or opens its settings for a name", async () => {
    serve({ "PATCH /api/rooms/general": { room: { ...general, name: "town square" } } });
    const { run, answers } = runIn(general);
    expect(await run(written("/rename town square"))).toBe(true);
    expect(requests()).toEqual([["PATCH", "/api/rooms/general", { name: "town square" }]]);
    expect(answers).toEqual([{ type: "saved", room: { ...general, name: "town square" } }]);
    expect(flash).toHaveBeenLastCalledWith("notice", "Renamed the room #town square.");

    await run(written("/rename"));
    expect(navigate).toHaveBeenLastCalledWith(roomSettingsPath("open", general.id));
  });

  it("sends /msg's message to whom it mentions, in a DM with them, as a message written there while it was away", async () => {
    serve({ "POST /api/directs": { room: withGrace } });
    const { run, answers } = runIn(general);
    expect(await run(written("", `<p>/msg ${mention(grace)} lunch at <strong>noon</strong>?</p>`))).toBe(true);
    expect(requests()).toEqual([["POST", "/api/directs", { userIds: [grace.id] }]]);
    expect(answers).toEqual([{ type: "saved", room: withGrace }]);
    expect(sendAway).toHaveBeenCalledExactlyOnceWith(
      withGrace.id,
      expect.objectContaining({ roomId: withGrace.id, body: "<p>lunch at <strong>noon</strong>?</p>", plainText: "lunch at noon?", creator: me, queued: true }),
    );
    expect(flash).toHaveBeenLastCalledWith("notice", "Sent to Grace Hopper.");
  });

  it("says /msg's message wasn't sent where the room didn't take it, keeping it to send again", async () => {
    sendAway.mockResolvedValueOnce("not sent");
    expect(await runIn(general).run(written("/msg #design see the brief"))).toBe(false);
    expect(flash).toHaveBeenCalledExactlyOnceWith("alert", "Your message to #design wasn't sent.");
  });

  it("says /msg's message may not have gone where the room didn't say it has it, leaving it to the room rather than sending it again", async () => {
    sendAway.mockResolvedValueOnce("unconfirmed");
    expect(await runIn(general).run(written("/msg #design see the brief"))).toBe(true);
    expect(flash).toHaveBeenCalledExactlyOnceWith("alert", "Your message to #design may not have gone yet. If it doesn't, it shows there as not sent.");
  });

  it("sends /msg's message to a room it names, or to this one as written here, and opens the conversation with nothing to send", async () => {
    const { run, onSend } = runIn(general);
    await run(written("/msg #design see the brief"));
    expect(sendAway).toHaveBeenCalledExactlyOnceWith(design.id, expect.objectContaining({ body: "<p>see the brief</p>" }));
    expect(await run(written("/msg #general hello all"))).toBe(true);
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>hello all</p>");
    await run(written("/msg #design"));
    expect(navigate).toHaveBeenLastCalledWith(roomPath(design.id));
    expect(await run(written("/msg hello"))).toBe(false);
    expect(flash).toHaveBeenLastCalledWith("alert", "Write /msg, then @someone or #room, then your message.");
  });
});
