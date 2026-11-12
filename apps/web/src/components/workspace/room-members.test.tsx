import type { DirectoryUser, Me, Room, RoomSettings, SharedRoom } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { MembersButton } from "./room-members";

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
    expect(within(dialog).getByText("Members 2")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add people" })).not.toBeInTheDocument();
  });

  it("finds people by name", async () => {
    serve(settings(false));
    renderButton(plans);
    await userEvent.click(await screen.findByRole("button", { name: /View members, 2/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find people" }), "grace");
    expect(within(screen.getByRole("list", { name: "Members" })).getAllByRole("link").map((row) => row.textContent)).toEqual(["Grace Hopper, here nowCompilers"]);
  });

  it("adds people to a private room for whoever can change it, as its settings save its members", async () => {
    serve(settings(true));
    renderButton(plans);
    await userEvent.click(await screen.findByRole("button", { name: /View members, 2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Linus Torvalds" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/rooms/plans", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ kind: "closed", memberIds: ["ada", "grace", "linus"] }) }));
    await waitFor(() => expect(screen.getByText("Members 3")).toBeInTheDocument());
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
});
