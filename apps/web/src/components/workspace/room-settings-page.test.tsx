import { feature } from "@ember/parity";
import type { Room, RoomSettings } from "@ember/protocol";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import checkMark from "@/components/icons/campfire/check.svg";
import { Sheet } from "@/components/ui/sheet";
import { useRoute } from "@/hooks/use-route";
import { ApiError } from "@/lib/api";
import { RoomSettingsPage } from "./room-settings-page";

const ada = { id: "u1", name: "Ada Lovelace" };
const grace = { id: "u2", name: "Grace Hopper" };
const linus = { id: "u3", name: "Linus Torvalds" };
const design: Room = { id: "design", name: "Design", kind: "open" };
const leads: Room = { id: "leads", name: "Leads", kind: "closed" };

const openSettings = (canAdminister = true): RoomSettings => ({
  room: design,
  canAdminister,
  people: [ada, grace, linus].map((person) => ({ ...person, member: true })),
});
const closedSettings: RoomSettings = {
  room: leads,
  canAdminister: true,
  people: [
    { ...ada, member: true },
    { ...grace, member: false },
    { ...linus, member: true },
  ],
};

/** Answers `settings` for the page, then `saved` (or `refusal`) for a change. */
function serve(settings: RoomSettings | { status: number; error: string }, { saved, refusal }: { saved?: Room; refusal?: { status: number; error: string } } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (init?.method === "PATCH") return refusal ? Response.json({ error: refusal.error }, { status: refusal.status }) : Response.json({ room: saved });
    expect(input).toMatch(/^\/api\/rooms\/[^/]+\/settings$/);
    return "status" in settings ? Response.json({ error: settings.error }, { status: settings.status }) : Response.json(settings);
  });
}

/** Answers `settings` for the page, and holds a change until the returned function answers it. */
function holdChange(settings: RoomSettings) {
  let answer = (_: Response) => {};
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
    init?.method === "PATCH" ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(Response.json(settings)),
  );
  return (response: Response) => act(async () => answer(response));
}

type Callbacks = Pick<Parameters<typeof RoomSettingsPage>[0], "onSaved" | "onLeft" | "onMissing" | "onFailed">;

/** The page, as Ada, at the form its address names, as the workspace shows it. */
function SettingsRoute(callbacks: Callbacks) {
  const route = useRoute();
  return route.page === "room-settings" ? <RoomSettingsPage key={route.roomId} roomId={route.roomId} access={route.access} me={ada} {...callbacks} /> : null;
}

function showPage(room: Room, path = `/rooms/${room.kind}s/${room.id}/edit`) {
  const [onSaved, onLeft, onMissing, onFailed] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  const { unmount } = render(
    <Sheet>
      <SettingsRoute onSaved={onSaved} onLeft={onLeft} onMissing={onMissing} onFailed={onFailed} />
    </Sheet>,
  );
  return { onSaved, onLeft, onMissing, onFailed, unmount, user: userEvent.setup() };
}

const rowOf = (name: string) => screen.getByText(name).closest("li")!;
const hasCheckMark = (name: string) => [...rowOf(name).querySelectorAll("img")].some((img) => img.getAttribute("src") === checkMark);
/** The names listed, in order, not counting the avatars' initials. */
const names = () => screen.getAllByRole("listitem").map((row) => row.querySelector("strong")!.textContent);
const roomName = () => screen.findByRole("textbox", { name: "Room name" });
const accessSwitch = (person: { name: string }) => screen.getByRole("switch", { name: `Give ${person.name} access to this room` });
/** What the page asked the server to change. */
const sent = () => JSON.parse(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH")![1]!.body as string) as unknown;

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe(feature("rooms.settings-page"), () => {
  it("reads Room settings, titled for the room, with Go Back to it", async () => {
    serve(openSettings());
    showPage(design);
    expect(await roomName()).toHaveValue("Design");
    expect(document.title).toBe("Edit settings for Design");
    expect(screen.getByRole("heading", { level: 1, name: "Room settings" })).toBeInTheDocument();
    expect(screen.getByText("Manage the room name, access, and members.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/rooms/design");
  });

  it("lists everyone in an open room under Everyone, which is on, each with a check mark", async () => {
    serve(openSettings());
    showPage(design);
    await roomName();
    expect(names()).toEqual(["Everyone", "Ada Lovelace", "Grace Hopper", "Linus Torvalds"]);
    expect(screen.getByRole("switch", { name: "Give only some access to this room" })).toBeChecked();
    for (const person of [ada, grace, linus]) {
      expect(hasCheckMark(person.name)).toBe(true);
      expect(within(rowOf(person.name)).queryByRole("switch")).not.toBeInTheDocument();
    }
  });

  it("lists a private room's members with their switches on, then everyone else with theirs off", async () => {
    serve(closedSettings);
    showPage(leads);
    await roomName();
    expect(names()).toEqual(["Everyone", "Ada Lovelace", "Linus Torvalds", "Grace Hopper"]);
    expect(screen.getByRole("switch", { name: "Give everyone access to this room" })).not.toBeChecked();
    // One line under Everyone, and one between the members and everyone else.
    expect(screen.getByRole("list").querySelectorAll(":scope > hr")).toHaveLength(2);
    expect([ada, grace, linus].map((person) => accessSwitch(person).getAttribute("aria-checked"))).toEqual(["true", "false", "true"]);
  });

  it("renames the room", async () => {
    const saved = { ...design, name: "Product design" };
    serve(openSettings(), { saved });
    const { onSaved, user } = showPage(design);
    await user.clear(await roomName());
    await user.type(await roomName(), "Product design{Enter}");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const [path, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(path).toBe("/api/rooms/design");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Product design", kind: "open" });
    expect(location.pathname).toBe("/rooms/design");
  });

  it("lists a rename whose answer comes after the page was left, without taking over the page shown then", async () => {
    const saved = { ...design, name: "Product design" };
    const answer = holdChange(openSettings());
    const { onSaved, user, unmount } = showPage(design);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    unmount();
    history.replaceState(null, "", "/rooms/random");
    await answer(Response.json({ room: saved }));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(location.pathname).toBe("/rooms/random");
  });

  it("drops a failure that answers after the page was left, even for a room that's gone", async () => {
    const answer = holdChange(openSettings());
    const { onMissing, onFailed, user, unmount } = showPage(design);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    unmount();
    await answer(Response.json({ error: "Room not found or inaccessible" }, { status: 404 }));
    expect(onMissing).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("still reports a session that's ended, though the page was left before the answer", async () => {
    const answer = holdChange(openSettings());
    const { onFailed, user, unmount } = showPage(design);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    unmount();
    await answer(Response.json({ error: "Sign in to continue" }, { status: 401 }));
    expect(onFailed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 401 }));
  });

  it("says why a change wasn't saved, and lets you try again", async () => {
    serve(openSettings(), { refusal: { status: 422, error: "Name must be 1 to 100 characters" } });
    const { onSaved, onFailed, user } = showPage(design);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 422, message: "Name must be 1 to 100 characters" })));
    expect(onFailed.mock.calls[0]![0]).toBeInstanceOf(ApiError);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

});

describe(feature("rooms.convert-access"), () => {
  it("makes an open room private in place, keeping the name, with everyone in it switched on", async () => {
    serve(openSettings(), { saved: { ...design, name: "Leads", kind: "closed" } });
    const { onSaved, user } = showPage(design);
    await user.clear(await roomName());
    await user.type(await roomName(), "Leads");
    const length = history.length;
    await user.click(screen.getByRole("switch", { name: "Give only some access to this room" }));
    expect(location.pathname).toBe("/rooms/closeds/design/edit");
    expect(history.length).toBe(length);
    expect(await roomName()).toHaveValue("Leads");
    for (const person of [ada, grace, linus]) expect(accessSwitch(person)).toBeChecked();

    await user.click(accessSwitch(grace));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...design, name: "Leads", kind: "closed" }));
    expect(sent()).toEqual({ name: "Leads", kind: "closed", memberIds: [ada.id, linus.id] });
    expect(location.pathname).toBe("/rooms/design");
  });

  it("opens a private room to everyone", async () => {
    serve(closedSettings, { saved: { ...leads, kind: "open" } });
    const { onSaved, user } = showPage(leads);
    await user.click(await screen.findByRole("switch", { name: "Give everyone access to this room" }));
    expect(location.pathname).toBe("/rooms/opens/leads/edit");
    for (const person of [ada, grace, linus]) expect(hasCheckMark(person.name)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...leads, kind: "open" }));
    expect(sent()).toEqual({ name: "Leads", kind: "open" });
  });

  it("keeps who's chosen when Everyone goes on and off again", async () => {
    serve(closedSettings);
    const { user } = showPage(leads);
    await user.click(await screen.findByRole("switch", { name: `Give ${grace.name} access to this room` }));
    await user.click(screen.getByRole("switch", { name: "Give everyone access to this room" }));
    await user.click(screen.getByRole("switch", { name: "Give only some access to this room" }));
    expect(accessSwitch(grace)).toBeChecked();
  });

  it("moves people who can't change the room to the address for its kind, in place", async () => {
    serve(openSettings(false));
    history.replaceState(null, "", "/");
    const length = history.length;
    showPage(design, "/rooms/closeds/design/edit");
    await waitFor(() => expect(location.pathname).toBe("/rooms/opens/design/edit"));
    expect(history.length).toBe(length);
  });

  it("shows whoever can change the room the form its address names", async () => {
    serve(openSettings());
    showPage(design, "/rooms/closeds/design/edit");
    await roomName();
    expect(screen.getByRole("switch", { name: "Give everyone access to this room" })).not.toBeChecked();
    expect(location.pathname).toBe("/rooms/closeds/design/edit");
  });
});

describe(feature("rooms.members"), () => {
  it("saves a private room with the people whose switches are on", async () => {
    serve(closedSettings, { saved: leads });
    const { onSaved, user } = showPage(leads);
    await user.click(await screen.findByRole("switch", { name: `Give ${grace.name} access to this room` }));
    await user.click(accessSwitch(linus));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(leads));
    expect(sent()).toEqual({ name: "Leads", kind: "closed", memberIds: [ada.id, grace.id] });
  });

  it("goes home when you save the room without yourself, taking it out of the sidebar", async () => {
    serve(closedSettings, { saved: leads });
    const { onSaved, onLeft, onMissing, user } = showPage(leads);
    await user.click(await screen.findByRole("switch", { name: `Give ${ada.name} access to this room` }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith(leads.id));
    expect(sent()).toEqual({ name: "Leads", kind: "closed", memberIds: [linus.id] });
    expect(onMissing).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("holds the switches as they were sent until the change is saved", async () => {
    const answer = holdChange(closedSettings);
    const { onSaved, user } = showPage(leads);
    await user.click(await screen.findByRole("switch", { name: `Give ${grace.name} access to this room` }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(accessSwitch(linus));
    await user.click(screen.getByRole("switch", { name: "Give everyone access to this room" }));
    expect(accessSwitch(linus)).toBeChecked();
    expect(location.pathname).toBe("/rooms/closeds/leads/edit");

    await answer(Response.json({ room: leads }));
    expect(sent()).toEqual({ name: "Leads", kind: "closed", memberIds: [ada.id, linus.id, grace.id] });
    expect(onSaved).toHaveBeenCalledWith(leads);
  });

  it("takes a room left out of the sidebar when the answer comes after the page was left, staying where you are", async () => {
    const answer = holdChange(closedSettings);
    const { onLeft, onMissing, user, unmount } = showPage(leads);
    await user.click(await screen.findByRole("switch", { name: `Give ${ada.name} access to this room` }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    unmount();
    await answer(Response.json({ room: leads }));
    expect(onLeft).toHaveBeenCalledWith(leads.id);
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe(feature("rooms.edit-permissions"), () => {
  it("shows people who can't change the room its name and people, and nothing to change them with", async () => {
    serve(openSettings(false));
    showPage(design);
    expect(await screen.findByRole("heading", { level: 2, name: "Design" })).toBeInTheDocument();
    expect(names()).toEqual(["Everyone", "Ada Lovelace", "Grace Hopper", "Linus Torvalds"]);
    expect([ada, grace, linus].map((person) => hasCheckMark(person.name))).toEqual([false, false, false]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows them a private room's members, then everyone else, with no Everyone row or switches", async () => {
    serve({ ...closedSettings, canAdminister: false });
    showPage(leads);
    expect(await screen.findByRole("heading", { level: 2, name: "Leads" })).toBeInTheDocument();
    expect(names()).toEqual(["Ada Lovelace", "Linus Torvalds", "Grace Hopper"]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("goes home for a room that isn't there, or that the person isn't in", async () => {
    serve({ status: 404, error: "Room not found or inaccessible" });
    const { onMissing, onFailed } = showPage(design);
    await waitFor(() => expect(onMissing).toHaveBeenCalledOnce());
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("goes home when a room has gone by the time it's saved", async () => {
    serve(openSettings(), { refusal: { status: 404, error: "Room not found or inaccessible" } });
    const { onMissing, onFailed, user } = showPage(design);
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onMissing).toHaveBeenCalledOnce());
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("says why it couldn't load the settings", async () => {
    serve({ status: 503, error: "Service unavailable" });
    const { onMissing, onFailed } = showPage(design);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 503 })));
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("reports only a session that's ended when the settings answer after the page was left", async () => {
    const answers: ((response: Response) => void)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const first = showPage(design);
    first.unmount();
    const second = showPage(design);
    second.unmount();
    await act(async () => answers[0]!(Response.json({ error: "Room not found or inaccessible" }, { status: 404 })));
    expect(first.onMissing).not.toHaveBeenCalled();
    expect(first.onFailed).not.toHaveBeenCalled();
    await act(async () => answers[1]!(Response.json({ error: "Sign in to continue" }, { status: 401 })));
    expect(second.onFailed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 401 }));
    expect(second.onMissing).not.toHaveBeenCalled();
  });
});
