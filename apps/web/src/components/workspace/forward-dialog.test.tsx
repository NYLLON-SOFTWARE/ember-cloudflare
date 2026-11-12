import type { Message, Room } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlashProvider } from "@/components/flash";
import { ApiError, checkShare, forwardMessage } from "@/lib/api";
import { ForwardDialog, matching, threadOfLink, type Destination } from "./forward-dialog";
import { ConversationsContext } from "./quote-cite";

vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), checkShare: vi.fn(), forwardMessage: vi.fn() }));

const portside: Room = { id: "portside", kind: "open", name: "Portside", icon: null };
const general: Room = { id: "general", kind: "open", name: "general", icon: null };
const rooms = [portside, general];

describe("Forward message's destinations", () => {
  const destinations: Destination[] = [portside, general].map((room) => ({ room, name: room.name }));

  it("finds conversations by any part of their name, ignoring case and a leading #", () => {
    expect(matching(destinations, "PORT").map(({ room }) => room.id)).toEqual(["portside"]);
    expect(matching(destinations, "#gen").map(({ room }) => room.id)).toEqual(["general"]);
    expect(matching(destinations, "  ")).toEqual(destinations);
  });

  it("takes a pasted link to a message, or a reply, in a conversation you're in as its thread", () => {
    expect(threadOfLink(`${location.origin}/rooms/portside/@m1`, rooms)).toEqual({ room: portside, parentId: "m1" });
    expect(threadOfLink(`${location.origin}/rooms/portside/threads/p1/@r1`, rooms)).toEqual({ room: portside, parentId: "p1" });
    expect(threadOfLink(`${location.origin}/rooms/secret/@m1`, rooms)).toBeNull();
    expect(threadOfLink(`${location.origin}/rooms/portside`, rooms)).toBeNull();
    expect(threadOfLink("portside", rooms)).toBeNull();
    expect(threadOfLink("https://elsewhere.example/rooms/portside/@m1", rooms)).toBeNull();
  });
});

/** A message in room `roomId`, by Zan. */
const messageIn = (roomId: string): Message => ({
  id: "m1",
  clientMessageId: "c1",
  roomId,
  creator: { id: "zan", name: "Zan" },
  body: "<p>Between us</p>",
  plainText: "Between us",
  mentions: [],
  createdAt: "2026-11-11T19:30:00Z",
  updatedAt: "2026-11-11T19:30:00Z",
  editedAt: null,
  boosts: [],
});

describe("Forward outside who can see the original", () => {
  const me = { id: "ada", name: "Ada" };
  const zan = { id: "zan", name: "Zan" };
  const secret: Room = { id: "secret", kind: "closed", name: "secret", icon: null };
  const direct: Room = { id: "dm1", kind: "direct", members: [me, zan], activeAt: "2026-11-11T00:00:00Z" };
  const original = (roomId: string): Message => ({
    id: "m1",
    clientMessageId: "c1",
    roomId,
    creator: zan,
    body: "<p>Between us</p>",
    plainText: "Between us",
    mentions: [],
    createdAt: "2026-11-11T19:30:00Z",
    updatedAt: "2026-11-11T19:30:00Z",
    editedAt: null,
    boosts: [],
  });

  function show(roomId: string) {
    render(
      <FlashProvider>
        <ConversationsContext value={{ rooms: [secret, direct, general], meId: me.id }}>
          <ForwardDialog message={original(roomId)} opener={null} onClose={() => {}} />
        </ConversationsContext>
      </FlashProvider>,
    );
    return userEvent.setup();
  }

  async function forwardTo(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("option", { name }));
    await user.click(screen.getByRole("button", { name: "Forward" }));
  }

  afterEach(() => vi.mocked(forwardMessage).mockReset());

  it("asks first where the conversation picked has people who can't see the original, and forwards once you say so", async () => {
    vi.mocked(checkShare).mockResolvedValue({ widens: true, newViewers: 3, names: [] });
    const user = show("secret");
    await forwardTo(user, "general");
    const warning = await screen.findByRole("alertdialog", { name: /^Forward outside .*secret$/ });
    expect(checkShare).toHaveBeenCalledWith("secret", "general");
    expect(warning).toHaveTextContent(/3 people in #general aren['’]t in .*secret and will be able to see this message\./);
    expect(within(warning).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Forward"]);
    expect(forwardMessage).not.toHaveBeenCalled();

    await user.click(within(warning).getByRole("button", { name: "Forward" }));
    expect(forwardMessage).toHaveBeenCalledWith("secret", "m1", expect.objectContaining({ to: "general" }));
  });

  it("forwards nothing on Cancel, leaving Forward message open", async () => {
    vi.mocked(checkShare).mockResolvedValue({ widens: true, newViewers: 1, names: ["Ana"] });
    const user = show("dm1");
    await forwardTo(user, "general");
    const warning = await screen.findByRole("alertdialog", { name: "Forward outside your DM with Zan" });
    expect(warning).toHaveTextContent("Ana will be able to see this message in #general.");
    await user.click(within(warning).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Forward message" })).toBeInTheDocument();
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("asks again on Forward where who'd see it has changed since the warning opened", async () => {
    vi.mocked(checkShare).mockResolvedValueOnce({ widens: true, newViewers: 1, names: ["Ana"] }).mockResolvedValue({ widens: true, newViewers: 2, names: ["Ana", "Bo"] });
    const user = show("secret");
    await forwardTo(user, "general");
    const first = await screen.findByRole("alertdialog");
    expect(first).toHaveTextContent("Ana will be able to see this message in #general.");
    await user.click(within(first).getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent("Ana and Bo will be able to see this message in #general."));
    expect(forwardMessage).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(forwardMessage).toHaveBeenCalledOnce());
  });

  it("hands focus back to Forward as the warning closes", async () => {
    vi.mocked(checkShare).mockResolvedValue({ widens: true, newViewers: 1, names: ["Ana"] });
    const user = show("secret");
    await forwardTo(user, "general");
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Forward" })).toHaveFocus());
  });

  it("says so where either conversation, or the message, is no longer there for them", async () => {
    vi.mocked(checkShare).mockResolvedValue({ widens: false, newViewers: 0, names: [] });
    vi.mocked(forwardMessage).mockRejectedValue(new ApiError(404, "Room not found"));
    const user = show("secret");
    await forwardTo(user, "general");
    expect(await screen.findByText("That conversation or message isn’t there for you any more.")).toBeInTheDocument();
  });

  it("marks a private room with a lock, and a room with its icon, without a #", () => {
    show("general");
    expect(screen.getByRole("option", { name: "secret" }).textContent).not.toContain("#");
    expect(screen.getByRole("option", { name: "secret" }).querySelector("svg")).not.toBeNull();
  });

  it("forwards without asking where everyone there can see the original", async () => {
    vi.mocked(checkShare).mockResolvedValue({ widens: false, newViewers: 0, names: [] });
    const user = show("secret");
    await forwardTo(user, "general");
    await waitFor(() => expect(forwardMessage).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("Forward message's list of conversations", () => {
  const me = { id: "ada", name: "Ada" };
  const engineering: Room = { id: "engineering", kind: "open", name: "Engineering", icon: null };
  const backend: Room = { id: "backend", kind: "open", name: "Backend", icon: null, parent: { id: "engineering", name: "Engineering" } };

  it("names a sub-room after its parent, finds it by either, and marks each room once, with its icon", async () => {
    render(
      <FlashProvider>
        <ConversationsContext value={{ rooms: [engineering, backend], meId: me.id }}>
          <ForwardDialog message={{ ...messageIn("engineering") }} opener={null} onClose={() => {}} />
        </ConversationsContext>
      </FlashProvider>,
    );
    const option = screen.getByRole("option", { name: "Engineering – Backend" });
    expect(option.textContent!.match(/#/g)).toHaveLength(1);
    await userEvent.setup().type(screen.getByRole("combobox"), "backend");
    expect(screen.getAllByRole("option").map((row) => row.getAttribute("aria-label") ?? row.textContent!.replace("#", ""))).toEqual(["Engineering – Backend"]);
  });
});

