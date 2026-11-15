import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectoryUser, UserId, UserGroup } from "@ember/protocol";
import { DirectoryLoaded, DirectoryReloading, DirectoryStale, PeopleContext, type People } from "@/hooks/use-directory";
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
function serve(route: (method: string, path: string, body: unknown) => Response | Promise<Response> = () => Response.json({ groups: [design] })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => route(init?.method ?? "GET", String(input), init?.body ? JSON.parse(String(init.body)) : undefined));
}

/**
 * The card, with `directory` in the people directory, which has loaded when `loaded`, is loading again
 * when `reloading`, and last failed to when `stale`, and `groups` as the server lists them. `rerender`
 * shows the card with another directory, loaded or loading as then said.
 */
function showCard({ directory = people, loaded = false, reloading = false, stale = false }: { directory?: People; loaded?: boolean; reloading?: boolean; stale?: boolean } = {}) {
  const callbacks = { onSaved: vi.fn(), reloadDirectory: vi.fn(), onFailed: vi.fn() };
  const cardWith = (directory: People, loaded: boolean, reloading: boolean, stale: boolean) => (
    <PeopleContext value={directory}>
      <DirectoryReloading value={reloading}>
        <DirectoryLoaded value={loaded}>
          <DirectoryStale value={stale}>
            <UserGroups {...callbacks} />
          </DirectoryStale>
        </DirectoryLoaded>
      </DirectoryReloading>
    </PeopleContext>
  );
  const { rerender } = render(cardWith(directory, loaded, reloading, stale));
  return { ...callbacks, user: userEvent.setup(), rerender: (directory: People, loaded: boolean, reloading: boolean, stale = false) => rerender(cardWith(directory, loaded, reloading, stale)) };
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

  it("closes only the form whose save completed, one opened while it was under way keeping what's typed in it", async () => {
    const onCall: UserGroup = { id: "g2", name: "on call", memberIds: [grace.id] };
    const changed = { ...design, name: "design & code", memberIds: [ada.id] };
    let answer: (() => void) | undefined;
    serve((method, path) => {
      if (method === "PATCH" && path === `/api/user_groups/${design.id}`) {
        return new Promise<Response>((resolve) => (answer = () => resolve(Response.json({ group: changed }))));
      }
      return Response.json({ groups: [design, onCall] });
    });
    const { user, onSaved } = showCard();
    await user.click(await within(card()).findByRole("button", { name: "Edit design" }));
    await user.type(within(card()).getByLabelText("Name"), " for web");
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    // The save is under way, and Edit on another group has opened its form: what's typed there is that one's to lose.
    await user.click(within(card()).getByRole("button", { name: "Edit on call" }));
    await user.type(within(card()).getByLabelText("Name"), " urgent");
    // The first save answers, and shows its group without closing the form open now.
    answer?.();
    await vi.waitFor(() => expect(within(card()).getByRole("list")).toHaveTextContent("design & code"));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(within(card()).getByLabelText("Name")).toHaveValue("on call urgent");
  });

  it("closes the form whose save answered first, and closes nothing for the one still under way when it lands", async () => {
    const onCall: UserGroup = { id: "g2", name: "on call", memberIds: [grace.id] };
    const changedDesign = { ...design, name: "design & code", memberIds: [ada.id] };
    const changedOnCall = { ...onCall, name: "on call urgent", memberIds: [grace.id] };
    const answers: Record<string, () => void> = {};
    serve((method, path) => {
      if (method === "PATCH") {
        const id = path === `/api/user_groups/${design.id}` ? design.id : onCall.id;
        return new Promise<Response>((resolve) => (answers[id] = () => resolve(Response.json({ group: id === design.id ? changedDesign : changedOnCall }))));
      }
      return Response.json({ groups: [design, onCall] });
    });
    const { user, onSaved, reloadDirectory } = showCard();
    await user.click(await within(card()).findByRole("button", { name: "Edit design" }));
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    await user.click(within(card()).getByRole("button", { name: "Edit on call" }));
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    // The form open now answers first, and it alone closes.
    answers[onCall.id]?.();
    await vi.waitFor(() => expect(within(card()).queryByLabelText("Name")).toBeNull());
    expect(within(card()).getByRole("list")).toHaveTextContent("on call urgent");
    // The save still under way answers then, and shows its group without a form opening or closing.
    answers[design.id]?.();
    await vi.waitFor(() => expect(within(card()).getByRole("list")).toHaveTextContent("design & code"));
    expect(within(card()).queryByLabelText("Name")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(reloadDirectory).toHaveBeenCalledTimes(2);
  });

  it("closes nothing for a made group's save that lands after its form is gone, the group showing all the same", async () => {
    const created = { id: "g2", name: "on call", memberIds: [grace.id] };
    let answer: (() => void) | undefined;
    serve((method, path) => {
      if (method === "POST" && path === "/api/user_groups") {
        return new Promise<Response>((resolve) => (answer = () => resolve(Response.json({ group: created }, { status: 201 }))));
      }
      return Response.json({ groups: [design] });
    });
    const { user } = showCard();
    await user.click(within(card()).getByRole("button", { name: "New group" }));
    await user.type(within(card()).getByLabelText("Name"), "On Call");
    await user.click(within(card()).getByRole("checkbox", { name: "Grace Hopper" }));
    await user.click(within(card()).getByRole("button", { name: "Create group" }));
    // The making is under way, and Edit has opened another form, whose draft a late answer must keep.
    await user.click(await within(card()).findByRole("button", { name: "Edit design" }));
    await user.type(within(card()).getByLabelText("Name"), " for web");
    answer?.();
    await vi.waitFor(() => expect(within(card()).getByRole("list")).toHaveTextContent("on call"));
    expect(within(card()).getByLabelText("Name")).toHaveValue("design for web");
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

  it("waits for the directory's load under way before a save goes, which keeps the member it has yet to list", async () => {
    const newcomer: DirectoryUser = { id: "u5", name: "New Hand", bio: null, role: "member", status: "active", avatarUrl: "" };
    const fresh: UserGroup = { id: "g6", name: "launch", memberIds: [ada.id, newcomer.id] };
    let sent: unknown;
    serve((method, _path, body) => {
      if (method === "PATCH") {
        sent = body;
        return Response.json({ group: fresh });
      }
      return Response.json({ groups: [fresh] });
    });
    // The directory has loaded, but is loading again: its answer may list the newcomer back whom
    // this listing has gone, whom saving against the listing as it was would drop from the group.
    const { user, rerender, reloadDirectory } = showCard({
      directory: new Map<UserId, DirectoryUser>([...people, [newcomer.id, { ...newcomer, status: "deactivated" }]]),
      loaded: true,
      reloading: true,
    });
    await user.click(await within(card()).findByRole("button", { name: "Edit launch" }));
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    // The save waits for the load under way, which the card asks for no other alongside.
    expect(sent).toBeUndefined();
    expect(reloadDirectory).not.toHaveBeenCalled();
    // The load has come, listing the newcomer active now, and the save has gone with them kept.
    rerender(new Map<UserId, DirectoryUser>([...people, [newcomer.id, newcomer]]), true, false);
    await vi.waitFor(() => expect(sent).toEqual({ name: "launch", memberIds: [ada.id, newcomer.id] }));
  });

  it("waits for the directory to come, its last load having failed, and keeps the member it couldn't verify", async () => {
    const newcomer: DirectoryUser = { id: "u5", name: "New Hand", bio: null, role: "member", status: "active", avatarUrl: "" };
    const fresh: UserGroup = { id: "g5", name: "launch", memberIds: [ada.id, newcomer.id] };
    let sent: unknown;
    serve((method, _path, body) => {
      if (method === "PATCH") {
        sent = body;
        return Response.json({ group: fresh });
      }
      return Response.json({ groups: [fresh] });
    });
    // The directory's last load has failed, which leaves it as it was before it, listing the newcomer
    // gone whom the group has: letting them go for that listing alone would drop them from it.
    const { user, rerender, reloadDirectory } = showCard({
      directory: new Map<UserId, DirectoryUser>([...people, [newcomer.id, { ...newcomer, status: "deactivated" }]]),
      loaded: true,
      stale: true,
    });
    await user.click(await within(card()).findByRole("button", { name: "Edit launch" }));
    expect(within(card()).queryByRole("checkbox", { name: "New Hand" })).toBeNull();
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    // The card has asked for the directory again, and the save waits for a load that comes.
    expect(reloadDirectory).toHaveBeenCalledOnce();
    expect(sent).toBeUndefined();
    // One has come, listing the newcomer active now, and the save has gone with them kept.
    rerender(new Map<UserId, DirectoryUser>([...people, [newcomer.id, newcomer]]), true, false);
    await vi.waitFor(() => expect(sent).toEqual({ name: "launch", memberIds: [ada.id, newcomer.id] }));
    expect(within(card()).getByRole("list")).toHaveTextContent("2 members");
  });

  it("lets a held save go to be tried once its load has failed again, which it never sends against the listing as it was", async () => {
    const newcomer: DirectoryUser = { id: "u5", name: "New Hand", bio: null, role: "member", status: "active", avatarUrl: "" };
    const fresh: UserGroup = { id: "g7", name: "launch", memberIds: [ada.id, newcomer.id] };
    let sent: unknown;
    serve((method, _path, body) => {
      if (method === "PATCH") {
        sent = body;
        return Response.json({ group: fresh });
      }
      return Response.json({ groups: [fresh] });
    });
    // The directory's last load has failed, which leaves it listing the newcomer gone whom the group
    // has, and the save it held waits for a load that comes. One that fails again lets the save go
    // to be tried, rather than hold it for good or send it against the listing as it was.
    const { user, rerender, reloadDirectory } = showCard({
      directory: new Map<UserId, DirectoryUser>([...people, [newcomer.id, { ...newcomer, status: "deactivated" }]]),
      loaded: true,
      stale: true,
    });
    await user.click(await within(card()).findByRole("button", { name: "Edit launch" }));
    await user.click(within(card()).getByRole("button", { name: "Save changes" }));
    expect(reloadDirectory).toHaveBeenCalledOnce();
    expect(sent).toBeUndefined();
    // The load the save waits for has failed again, and the save is let go, still unsent.
    rerender(new Map<UserId, DirectoryUser>([...people, [newcomer.id, { ...newcomer, status: "deactivated" }]]), true, true, true);
    rerender(new Map<UserId, DirectoryUser>([...people, [newcomer.id, { ...newcomer, status: "deactivated" }]]), true, false, true);
    const saveButton = within(card()).getByRole("button", { name: "Save changes" });
    expect(saveButton).not.toBeDisabled();
    expect(sent).toBeUndefined();
    // Tried again, the save asks for the directory once more, and waits for it.
    await user.click(saveButton);
    expect(reloadDirectory).toHaveBeenCalledTimes(2);
    expect(sent).toBeUndefined();
    // One has come, listing the newcomer active now, and the save has gone with them kept.
    rerender(new Map<UserId, DirectoryUser>([...people, [newcomer.id, newcomer]]), true, false);
    await vi.waitFor(() => expect(sent).toEqual({ name: "launch", memberIds: [ada.id, newcomer.id] }));
    expect(within(card()).getByRole("list")).toHaveTextContent("2 members");
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
