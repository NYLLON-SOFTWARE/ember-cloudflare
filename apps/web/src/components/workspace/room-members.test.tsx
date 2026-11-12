import type { DirectoryUser, Me, Room, RoomSettings, SharedRoom } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { MembersButton, MembersPage } from "./room-members";
import { loadRarePages } from "./rare-pages";

// What opens here loads with the pages few visits need, which take a while to import in a test.
beforeAll(() => loadRarePages(), 120_000);

const ada: Me = { id: "ada", name: "Ada Lovelace", administrator: false };
const grace = { id: "grace", name: "Grace Hopper" };
const linus = { id: "linus", name: "Linus Torvalds" };
const listed = (person: { id: string; name: string }, bio: string | null = null): DirectoryUser => ({ ...person, bio, role: "member", status: "active", avatarUrl: `/users/${person.id}/avatar` });
const people: People = new Map([
  [ada.id, listed(ada, "Analytical engines")],
  [grace.id, listed(grace, "Compilers")],
  [linus.id, listed(linus)],
]);

const plans: SharedRoom = { id: "plans", name: "plans", kind: "closed", icon: null };

/** What the room's settings answer: who's in it, and whether the reader can change it. */
const settings = (canAdminister: boolean, room: SharedRoom = plans): RoomSettings => ({
  room,
  canAdminister,
  parents: [],
  subRooms: 0,
  people: [
    { ...ada, member: true },
    { ...grace, member: true },
    { ...linus, member: room.kind === "open" },
  ],
});

/** Answers the room's settings, and saves a change to who's in it. */
function serve(answer: RoomSettings) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "PATCH") return Response.json({ room: answer.room });
    return String(url).endsWith("/settings") ? Response.json(answer) : Response.json({}, { status: 404 });
  });
}

const renderButton = (room: Room, present = [grace]) =>
  render(
    <PeopleContext value={people}>
      <MembersButton room={room} me={ada} present={present} onFailed={vi.fn()} />
    </PeopleContext>,
  );

afterEach(() => vi.restoreAllMocks());

describe("Members", () => {
  it("counts the room's members, and lists them, you first, with who's here and their bios, each going to their page", async () => {
    serve(settings(false));
    renderButton(plans);
    const button = await screen.findByRole("button", { name: "View members, 2 members" });
    await userEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "plans" });
    const rows = within(within(dialog).getByRole("list", { name: "Members" })).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual(["Ada Lovelace (you)Analytical engines", "Grace Hopper, here nowCompilers"]);
    expect(rows[1]).toHaveAttribute("href", "/users/grace");
    expect(dialog).toHaveAccessibleDescription("2 members");
    expect(within(dialog).queryByRole("button", { name: "Add people" })).not.toBeInTheDocument();
  });

  it("closes once a person is picked, as their profile opens, giving focus back to the button", async () => {
    serve(settings(false));
    renderButton(plans);
    const button = await screen.findByRole("button", { name: /View members, 2/ });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("link", { name: /Grace Hopper/ }));
    expect(location.pathname).toBe("/users/grace");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
    history.replaceState(null, "", "/");
  });

  it("gives focus back to the button as Escape or × closes it", async () => {
    serve(settings(false));
    renderButton(plans);
    const button = await screen.findByRole("button", { name: /View members, 2/ });
    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(button).toHaveFocus());
    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("finds people by each of the words typed, in any order", async () => {
    serve(settings(false));
    renderButton(plans);
    await userEvent.click(await screen.findByRole("button", { name: /View members, 2/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find people" }), "hopper grace");
    expect(within(screen.getByRole("list", { name: "Members" })).getAllByRole("link").map((row) => row.textContent)).toEqual(["Grace Hopper, here nowCompilers"]);
    await userEvent.type(screen.getByRole("searchbox", { name: "Find people" }), " x");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("goes along the people with the arrow keys, and opens the only one found with Enter", async () => {
    serve(settings(false));
    renderButton(plans);
    await userEvent.click(await screen.findByRole("button", { name: /View members, 2/ }));
    const search = screen.getByRole("searchbox", { name: "Find people" });
    const [you, grace] = within(screen.getByRole("list", { name: "Members" })).getAllByRole("link");
    search.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(you).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(grace).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(search).toHaveFocus();
    await userEvent.type(search, "grace{Enter}");
    expect(location.pathname).toBe("/users/grace");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    history.replaceState(null, "", "/");
  });

  it("marks bots, after the people", async () => {
    const bot = { id: "deploy", name: "Deploy Bot" };
    const withBot = new Map(people).set(bot.id, { ...listed(bot), role: "bot" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ ...settings(false), people: [{ ...ada, member: true }, { ...bot, member: true }, { ...grace, member: true }] }),
    );
    render(
      <PeopleContext value={withBot}>
        <MembersButton room={plans} me={ada} present={[]} onFailed={vi.fn()} />
      </PeopleContext>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /View members, 3/ }));
    const rows = within(screen.getByRole("list", { name: "Members" })).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual(["Ada Lovelace (you)Analytical engines", "Grace HopperCompilers", "Deploy Bot Bot"]);
  });

  it("adds people to a private room for whoever can change it, as its settings save its members", async () => {
    serve(settings(true));
    renderButton(plans);
    await userEvent.click(await screen.findByRole("button", { name: /View members, 2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Linus Torvalds" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/rooms/plans", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ kind: "closed", memberIds: ["ada", "grace", "linus"] }) }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAccessibleDescription("3 members"));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "View members, 3 members" })).toBeInTheDocument();
  });

  it("offers no Add people in an open room, which everyone is in", async () => {
    const open: SharedRoom = { ...plans, kind: "open" };
    serve(settings(true, open));
    renderButton(open);
    await userEvent.click(await screen.findByRole("button", { name: "View members, 3 members" }));
    expect(screen.queryByRole("button", { name: "Add people" })).not.toBeInTheDocument();
  });

  it("lists a DM's people from the DM, asking for nothing", async () => {
    vi.spyOn(globalThis, "fetch");
    const direct: Room = { id: "dm", kind: "direct", members: [ada, grace], activeAt: "2026-11-01T00:00:00.000Z" };
    renderButton(direct);
    await userEvent.click(screen.getByRole("button", { name: "View members, 2 members" }));
    expect(screen.getByRole("dialog", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Members" })).getAllByRole("link")).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks a private room without an icon with a lock, not #", async () => {
    serve(settings(false));
    renderButton(plans);
    await userEvent.click(await screen.findByRole("button", { name: "View members, 2 members" }));
    const dialog = screen.getByRole("dialog", { name: "plans" });
    expect(within(dialog).queryByText("#")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "plans" }).previousElementSibling?.tagName).toBe("svg");
  });

  it("lists the members as a page of its own, with Back, for a phone to push", async () => {
    serve(settings(true));
    const back = vi.fn();
    render(
      <PeopleContext value={people}>
        <MembersPage room={plans} me={ada} present={[grace]} onBack={back} onFailed={vi.fn()} />
      </PeopleContext>,
    );
    expect(await screen.findByText("2 members")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Members" })).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add people" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
  });
});
