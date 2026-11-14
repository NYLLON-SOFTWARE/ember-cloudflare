import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectoryUser, UserId, UserGroup } from "@ember/protocol";
import { DirectoryLoaded, DirectoryReloading, PeopleContext, type People } from "@/hooks/use-directory";
import { ApiError } from "@/lib/api";
import { CONFIRM_DELETE, GROUPS_EXPLAINED, UserGroups } from "./user-groups-settings";

const ada: DirectoryUser = { id: "u1", name: "Ada Lovelace", bio: null, role: "administrator", status: "active", avatarUrl: "/users/u1.abc/avatar?v=1" };
const grace: DirectoryUser = { id: "u2", name: "Grace Hopper", bio: null, role: "member", status: "active", avatarUrl: "/users/u2.def/avatar?v=1" };
const bender: DirectoryUser = { id: "u3", name: "Bender", bio: null, role: "bot", status: "active", avatarUrl: "/users/u3.ghi/avatar?v=1" };

const design: UserGroup = { id: "g1", name: "design", memberIds: [ada.id] };
const people: People = new Map(
  [ada, grace, bender].map((person) => [person.id, person]),
);

/** Answers the groups API as `route` says, failing any request it has no answer for. */
function serve(route: (method: string, path: string, body: unknown) => Response = () => Response.json({ groups: [design] })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => route(init?.method ?? "GET", String(input), init?.body ? JSON.parse(String(init.body)) : undefined));
}

/**
 * The card, with `directory` in the people directory, which has loaded when `loaded` and is loading
 * again when `reloading`, and `groups` as the server lists them. `rerender` shows the card with
 * another directory, loaded or loading as then said.
 */
function showCard({ directory = people, loaded = false, reloading = false }: { directory?: People; loaded?: boolean; reloading?: boolean } = {}) {
  const callbacks = { onSaved: vi.fn(), reloadDirectory: vi.fn(), onFailed: vi.fn() };
  const cardWith = (directory: People, loaded: boolean, reloading: boolean) => (
    <PeopleContext value={directory}>
      <DirectoryReloading value={reloading}>
        <DirectoryLoaded value={loaded}>
          <UserGroups {...callbacks} />
        </DirectoryLoaded>
      </DirectoryReloading>
    </PeopleContext>
  );
  const { rerender } = render(cardWith(directory, loaded, reloading));
  return { ...callbacks, user: userEvent.setup(), rerender: (directory: People, loaded: boolean, reloading: boolean) => rerender(cardWith(directory, loaded, reloading)) };
}

const card = () => screen.getByRole("region", { name: "User groups" });

afterEach(() => vi.restoreAllMocks());

describe("User groups", () => {
  it("says what groups are for, and lists them by name with how many each stands for", async () => {
    serve();
    const { user } = showCard();
    expect(GROUPS_EXPLAINED).toMatch(/^People mention a group by name, and everyone in it is notified\./);
    expect(within(card()).getByRole("heading", { name: "User groups" })).toBeVisible();
    await user.click(within(card()).getByRole("button", { name: "New group" }));
    expect(within(card()).getByLabelText("Name")).toBeVisible();
  });

  it("makes a group from the name and the members checked, of the active people alone", async () => {
    const created = { id: "g2", name: "on call", memberIds: [grace.id] };
    let sent: { body?: unknown; path?: string } = {};
    serve((method, path, body) => {
      if (method === "POST" && path === "/api/user_groups") {
        sent = { body, path };
        return Response.json({ group: created }, { status: 201 });
      }
      return Response.json({ groups: [design] });
    });
    const { user, onSaved, reloadDirectory } = showCard();
    await user.click(within(card()).getByRole("button", { name: "New group" }));
    await user.type(within(card()).getByLabelText("Name"), "On Call");
    // Bots aren't offered, and nobody's checked to start with.
    expect(within(card()).getByRole("checkbox", { name: "Ada Lovelace" })).not.toBeChecked();
    expect(within(card()).queryByRole("checkbox", { name: "Bender" })).toBeNull();
    await user.click(within(card()).getByRole("checkbox", { name: "Grace Hopper" }));
    await user.click(within(card()).getByRole("button", { name: "Create group" }));
    expect(sent).toEqual({ path: "/api/user_groups", body: { name: "On Call", memberIds: [grace.id] } });
    expect(within(card()).getByRole("list").lastChild).toHaveTextContent("on call");
    expect(onSaved).toHaveBeenCalledOnce();
    // The people directory loads again, which reads the groups a mention shows and names by.
    expect(reloadDirectory).toHaveBeenCalledOnce();
    expect(within(card()).queryByRole("button", { name: "Create group" })).toBeNull();
  });

  it("changes a group's name and members, sending what's checked", async () => {
    const changed = { ...design, name: "design & code", memberIds: [grace.id, ada.id] };
    let sent: { body?: unknown; path?: string } = {};
    serve((method, path, body) => {
      if (method === "PATCH" && path === `/api/user_groups/${design.id}`) {
        sent = { body, path };
        return Response.json({ group: changed });
      }
      return Response.json({ groups: [design] });
    });
    const { user } = showCard();
    await user.click(await within(card()).findByRole("button", { name: "Edit design" }));
    const name = within(card()).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("design");
    await user.clear(name);
    await user.type(name, "Design & Code");
    await user.click(within(card()).getByRole("checkbox", { name: "Grace Hopper" }));
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    expect(sent).toEqual({ path: `/api/user_groups/${design.id}`, body: { name: "Design & Code", memberIds: [ada.id, grace.id] } });
    expect(within(card()).getByRole("list")).toHaveTextContent("design & code");
  });

  it("says why the server refused a name, keeping what's typed", async () => {
    serve((method) => {
      if (method === "POST") return Response.json({ error: "A group is already named that." }, { status: 422 });
      return Response.json({ groups: [design] });
    });
    const { user } = showCard();
    await user.click(within(card()).getByRole("button", { name: "New group" }));
    await user.type(within(card()).getByLabelText("Name"), "Design");
    await user.click(within(card()).getByRole("button", { name: "Create group" }));
    expect(within(card()).getByRole("alert")).toHaveTextContent("A group is already named that.");
    expect(within(card()).getByLabelText("Name")).toHaveValue("Design");
    // The form stays open, so what's typed isn't lost.
    expect(within(card()).getByRole("button", { name: "Create group" })).toBeVisible();
  });

  it("deletes a group after asking, and keeps it when Cancel is pressed", async () => {
    const asking = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ groups: [design] }));
    const { user, reloadDirectory } = showCard();
    await user.click(await within(card()).findByRole("button", { name: "Delete design" }));
    expect(asking).toHaveBeenCalledWith(CONFIRM_DELETE);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reloadDirectory).not.toHaveBeenCalled();

    asking.mockReturnValue(true);
    fetcher.mockImplementation(async (input, init) => ((init?.method ?? "GET") === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ groups: [design] })));
    await user.click(within(card()).getByRole("button", { name: "Delete design" }));
    expect(within(card()).queryByRole("button", { name: "Delete design" })).toBeNull();
    expect(reloadDirectory).toHaveBeenCalledOnce();
  });

  it("opens Edit on another group with its name and members, not the form still open's", async () => {
    const onCall: UserGroup = { id: "g2", name: "on call", memberIds: [grace.id] };
    serve((method) => (method === "GET" ? Response.json({ groups: [design, onCall] }) : Response.json({ groups: [] })));
    const { user } = showCard();
    await user.click(await within(card()).findByRole("button", { name: "Edit design" }));
    await user.type(within(card()).getByLabelText("Name"), " for web");
    await user.click(within(card()).getByRole("button", { name: "Edit on call" }));
    expect(within(card()).getByLabelText("Name")).toHaveValue("on call");
    expect(within(card()).getByRole("checkbox", { name: "Grace Hopper" })).toBeChecked();
    expect(within(card()).getByRole("checkbox", { name: "Ada Lovelace" })).not.toBeChecked();
  });

  it("lets a member the directory lists gone go, whom no checkbox offers, so saving keeps who's checked alone", async () => {
    const former: DirectoryUser = { id: "u4", name: "Former Hand", bio: null, role: "member", status: "deactivated", avatarUrl: "" };
    const stale: UserGroup = { id: "g3", name: "launch", memberIds: [grace.id, former.id] };
    let sent: unknown;
    serve((method, _path, body) => {
      if (method === "PATCH") {
        sent = body;
        return Response.json({ group: { ...stale, memberIds: [grace.id] } });
      }
      return Response.json({ groups: [stale] });
    });
    const { user } = showCard({ directory: new Map<UserId, DirectoryUser>([...people, [former.id, former]]), loaded: true });
    await user.click(await within(card()).findByRole("button", { name: "Edit launch" }));
    expect(within(card()).queryByRole("checkbox", { name: "Former Hand" })).toBeNull();
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    expect(sent).toEqual({ name: "launch", memberIds: [grace.id] });
    expect(within(card()).getByRole("list")).toHaveTextContent("1 member");
  });

  it("waits for the directory's load under way to let a member go, which keeps the one it has since listed", async () => {
    const newcomer: DirectoryUser = { id: "u5", name: "New Hand", bio: null, role: "member", status: "active", avatarUrl: "" };
    const fresh: UserGroup = { id: "g4", name: "launch", memberIds: [ada.id, newcomer.id] };
    let sent: unknown;
    serve((method, _path, body) => {
      if (method === "PATCH") {
        sent = body;
        return Response.json({ group: fresh });
      }
      return Response.json({ groups: [fresh] });
    });
    // The directory has loaded, but is loading again: its answer may name a member this listing
    // doesn't, as one just added is, whom letting go would drop from the group.
    const { user, rerender } = showCard({
      directory: new Map<UserId, DirectoryUser>([...people, [newcomer.id, { ...newcomer, status: "deactivated" }]]),
      loaded: true,
      reloading: true,
    });
    await user.click(await within(card()).findByRole("button", { name: "Edit launch" }));
    // The load has settled, listing the newcomer active now, whom the form has kept and offers checked.
    rerender(new Map<UserId, DirectoryUser>([...people, [newcomer.id, newcomer]]), true, false);
    expect(await within(card()).findByRole("checkbox", { name: "New Hand" })).toBeChecked();
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    expect(sent).toEqual({ name: "launch", memberIds: [ada.id, newcomer.id] });
  });

  it("says why a delete couldn't be sent, keeping the group to be tried again", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    serve((method) => (method === "DELETE" ? Response.json({ error: "Something went wrong" }, { status: 500 }) : Response.json({ groups: [design] })));
    const { user, onFailed, reloadDirectory } = showCard();
    await user.click(await within(card()).findByRole("button", { name: "Delete design" }));
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onFailed.mock.calls[0]![0]).toBeInstanceOf(ApiError);
    expect(onFailed.mock.calls[0]![0].status).toBe(500);
    expect(within(card()).getByRole("button", { name: "Delete design" })).toBeVisible();
    expect(reloadDirectory).not.toHaveBeenCalled();
  });

  it("says a session that has ended to the page, which goes to sign in", async () => {
    serve((method) => (method === "GET" ? Response.json({ error: "Not signed in" }, { status: 401 }) : Response.json({ groups: [] })));
    const { onFailed } = showCard();
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.any(ApiError)));
    expect(onFailed.mock.calls[0]![0].status).toBe(401);
  });
});
