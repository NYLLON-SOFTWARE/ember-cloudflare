import { feature } from "@ember/parity";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, AccountChanges, DirectoryUser, Me, RoleChange, WorkspaceSettings } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import cancel from "@/components/icons/campfire/cancel.svg";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { ApiError } from "@/lib/api";
import { CHANGES_SAVED, WorkspaceSettingsPage } from "./workspace-settings-page";

const JOIN_CODE = "aB3d-Ef5h-iJ7k";
const NEW_JOIN_CODE = "Zy9x-Wv8u-Ts7r";
const asAdministrator: WorkspaceSettings = {
  account: { name: "Analytical Engines", hideTranslationButtons: true, customStyles: "" },
  joinCode: JOIN_CODE,
  canAdminister: true,
};
const asMember: WorkspaceSettings = { ...asAdministrator, canAdminister: false };

/** Someone as the people directory lists them. */
const listed = (id: string, name: string, role: DirectoryUser["role"] = "member", status: DirectoryUser["status"] = "active"): DirectoryUser => ({
  id,
  name,
  bio: null,
  role,
  status,
  avatarUrl: `/users/${id}.token/avatar?v=20261014120000`,
});

const ada = listed("u1", "Ada Lovelace", "administrator");
const grace = listed("u2", "Grace Hopper", "administrator");
// Lowercase, which the list folds, as SQLite's LOWER does.
const linus = listed("u3", "linus Torvalds");
const mallory = listed("u4", "Mallory", "member", "banned");
/** The workspace's people, in no order, with a bot and someone removed, whom the list leaves out. */
const everyone = [mallory, listed("u5", "Build Bot", "bot"), linus, listed("u6", "Charles Babbage", "member", "deactivated"), grace, ada];
const asAda: Me = { id: ada.id, name: ada.name, administrator: true };
const asLinus: Me = { id: linus.id, name: linus.name, administrator: false };

interface Answers {
  /** What saving the name or the settings answers, rather than the workspace changed as asked. */
  saved?: () => Response | Promise<Response>;
  /** What regenerating the join link answers, rather than `NEW_JOIN_CODE`. */
  regenerated?: () => Response | Promise<Response>;
  /** What changing someone's role answers, rather than them with the role sent. */
  roleChanged?: () => Response | Promise<Response>;
}

/** Answers the page's requests as the server would for `settings`, or as `answers` says. */
function serve(settings: WorkspaceSettings, { saved, regenerated, roleChanged }: Answers = {}) {
  let { account } = settings;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    const person = request.match(/^PATCH \/api\/account\/users\/(.+)$/);
    if (person) {
      const { role } = JSON.parse(String(init?.body)) as RoleChange;
      return roleChanged ? roleChanged() : Response.json({ user: { ...everyone.find((user) => user.id === person[1]), role } });
    }
    switch (request) {
      case "GET /api/account":
        return Response.json({ ...settings, account });
      case "PATCH /api/account": {
        if (saved) return saved();
        const { name = account.name, settings: changed } = JSON.parse(String(init?.body)) as AccountChanges;
        account = { ...account, name, hideTranslationButtons: changed?.hideTranslationButtons ?? account.hideTranslationButtons };
        return Response.json({ account });
      }
      case "POST /api/account/join_code":
        return regenerated ? regenerated() : Response.json({ joinCode: NEW_JOIN_CODE });
      default:
        throw new Error(`Unexpected request for ${request}`);
    }
  });
}

const spies = () => ({
  onAccountChanged: vi.fn(),
  onJoinCodeChanged: vi.fn(),
  reloadPeople: vi.fn(async () => {}),
  onPersonChanged: vi.fn(),
  onFailed: vi.fn(),
});
type Callbacks = ReturnType<typeof spies>;

/** Changes someone in the people directory the page shows, as the workspace socket does. */
let socketSays: (person: DirectoryUser) => void;
/** Changes the workspace the page shows, as the workspace socket does. */
let workspaceSays: (account: Account) => void;

/**
 * The page, with the workspace and the people directory as the app keeps them: changed as the page or
 * the workspace socket says. The workspace starts as the app loaded it, before the page's settings came.
 */
function Page({ me, listed, callbacks }: { me: Me; listed: DirectoryUser[]; callbacks: Callbacks }) {
  const [people, setPeople] = useState(() => new Map(listed.map((person) => [person.id, person])));
  const [account, setAccount] = useState<Account>({ ...asAdministrator.account, name: "Ember" });
  socketSays = (person) => setPeople((people) => new Map(people).set(person.id, person));
  workspaceSays = setAccount;
  const personChanged = (person: DirectoryUser) => {
    callbacks.onPersonChanged(person);
    socketSays(person);
  };
  // As the app's, which the page's loading waits on, it stays the same.
  const [askForAccount] = useState(() => () => (account: Account) => {
    callbacks.onAccountChanged(account);
    setAccount(account);
  });
  const { onAccountChanged: _, ...handlers } = callbacks;
  return (
    <AccountContext value={account}>
      <PeopleContext value={people}>
        <FlashProvider workspace>
          <Sheet>
            <WorkspaceSettingsPage me={me} back="/rooms/general" version="0.1" {...handlers} askForAccount={askForAccount} onPersonChanged={personChanged} />
          </Sheet>
        </FlashProvider>
      </PeopleContext>
    </AccountContext>
  );
}

function showPage(me = asAda, people = everyone, callbacks = spies()) {
  history.replaceState(null, "", "/account/edit");
  const { rerender } = render(<Page me={me} listed={people} callbacks={callbacks} />);
  return { ...callbacks, rerender: (me: Me) => rerender(<Page me={me} listed={people} callbacks={callbacks} />), user: userEvent.setup() };
}

const nameField = () => screen.findByRole("textbox", { name: "Workspace name" });
const joinLink = () => screen.findByRole("textbox", { name: "Share to invite more people" });
/** What the page last asked to save, if anything. */
const saved = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);

beforeEach(() => {
  serve(asAdministrator);
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe(feature("accounts.settings-page"), () => {
  it("reads Workspace settings, titled Account settings, with Go Back to the last room visited", () => {
    showPage();
    expect(document.title).toBe("Account settings");
    expect(screen.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeInTheDocument();
    expect(screen.getByText("Manage your workspace, invitations, and people.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/rooms/general");
  });

  it("is busy until its settings load", async () => {
    showPage();
    const panel = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(panel).toHaveAttribute("aria-busy", "true");
    await nameField();
    expect(panel).toHaveAttribute("aria-busy", "false");
  });

  it("says why its settings didn't load", async () => {
    const error = new ApiError(500, "Something went wrong");
    vi.mocked(fetch).mockRejectedValue(error);
    const { onFailed } = showPage();
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(error));
  });
});

describe(feature("platform.version"), () => {
  it("ends with Ember's version", () => {
    showPage();
    expect(screen.getByText("0.1").closest("footer")).toHaveTextContent("Ember™ version 0.1");
  });
});

describe(feature("accounts.name"), () => {
  it("lets an administrator rename the workspace, saying Changes saved.", async () => {
    const { onAccountChanged, user } = showPage();
    const name = await nameField();
    expect(name).toHaveValue("Analytical Engines");
    expect(onAccountChanged).toHaveBeenCalledWith(asAdministrator.account);
    await user.clear(name);
    await user.type(name, "Difference Engines");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGES_SAVED);
    expect(saved()).toEqual([{ name: "Difference Engines" }]);
    expect(onAccountChanged).toHaveBeenLastCalledWith({ ...asAdministrator.account, name: "Difference Engines" });
    expect(name).toHaveValue("Difference Engines");
  });

  it("saves with Enter, and says Changes saved. when the name hasn't changed, as ember-rust does", async () => {
    const { user } = showPage();
    await user.type(await nameField(), "{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGES_SAVED);
    expect(saved()).toEqual([{ name: "Analytical Engines" }]);
  });

  it("leaves the field unfocused, and its text where you click, as ember-rust does", async () => {
    showPage();
    const name = await nameField();
    expect(name).not.toHaveFocus();
    expect(name).toHaveAttribute("data-ember-preserve-selection");
    expect(name).toHaveAttribute("placeholder", "Name this account");
    expect(name).toHaveAttribute("autocomplete", "off");
    expect(name).toHaveAttribute("maxlength", "100");
  });

  it("can't save again until the last save is answered", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { saved: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    await user.type(await nameField(), "{Enter}");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    answer(Response.json({ account: asAdministrator.account }));
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("says why a rename was refused, keeping the name typed", async () => {
    serve(asAdministrator, { saved: () => Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }) });
    const { onAccountChanged, onFailed, user } = showPage();
    const name = await nameField();
    await user.type(name, " Ltd{Enter}");
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(name).toHaveValue("Analytical Engines Ltd");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(onAccountChanged).toHaveBeenCalledTimes(1);
  });

  it("shows members the workspace's name, which they can't change", async () => {
    serve(asMember);
    showPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Workspace name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows members a new name as soon as the workspace socket says it, where ember-rust's shows it on the next load", async () => {
    serve(asMember);
    showPage();
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    act(() => workspaceSays({ ...asMember.account, name: "Difference Engines" }));
    expect(screen.getByRole("heading", { level: 2, name: "Difference Engines" })).toBeInTheDocument();
  });
});

describe(feature("accounts.translation-buttons"), () => {
  const hideSwitch = () => screen.findByRole("switch", { name: "Hide translation buttons" });

  it("lets an administrator show translation buttons, and hide them again, saved at once with no notice", async () => {
    const { onAccountChanged, user } = showPage();
    const hide = await hideSwitch();
    expect(hide).toBeChecked();
    expect(hide).toHaveAccessibleDescription("Hide language help throughout the app for everyone.");
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();

    await user.click(hide);
    expect(hide).not.toBeChecked();
    await waitFor(() => expect(onAccountChanged).toHaveBeenLastCalledWith({ ...asAdministrator.account, hideTranslationButtons: false }));
    // The workspace name's globe.
    expect(screen.getByText("Translate")).toBeInTheDocument();

    await user.click(hide);
    await waitFor(() => expect(onAccountChanged).toHaveBeenLastCalledWith(asAdministrator.account));
    expect(saved()).toEqual([{ settings: { hideTranslationButtons: false } }, { settings: { hideTranslationButtons: true } }]);
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("follows the workspace socket, for a switch moved in another tab", async () => {
    showPage();
    const hide = await hideSwitch();
    act(() => workspaceSays({ ...asAdministrator.account, hideTranslationButtons: false }));
    expect(hide).not.toBeChecked();
  });

  it("can't be moved again until the last move is answered, and moves back saying why it was refused", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { saved: () => new Promise((resolve) => (answer = resolve)) });
    const { onFailed, user } = showPage();
    const hide = await hideSwitch();
    await user.click(hide);
    await user.click(hide);
    expect(hide).not.toBeChecked();
    expect(saved()).toEqual([{ settings: { hideTranslationButtons: false } }]);

    answer(Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(hide).toBeChecked();
  });

  it("isn't shown to members", async () => {
    serve(asMember);
    showPage();
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe(feature("accounts.custom-css"), () => {
  it("links administrators to Custom styles from its top bar", async () => {
    showPage();
    expect(await screen.findByRole("link", { name: "Custom styles" })).toHaveAttribute("href", "/account/custom_styles/edit");
  });

  it("gives members no link", async () => {
    serve(asMember);
    showPage();
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    expect(screen.queryByRole("link", { name: "Custom styles" })).not.toBeInTheDocument();
  });
});

describe(feature("accounts.join-link"), () => {
  it("shows everyone the join link, and tells the welcome card its code", async () => {
    serve(asMember);
    const { onJoinCodeChanged } = showPage();
    expect(await joinLink()).toHaveValue(`http://localhost:3000/join/${JOIN_CODE}`);
    expect(onJoinCodeChanged).toHaveBeenCalledExactlyOnceWith(JOIN_CODE);
    expect(screen.getByRole("button", { name: "Copy join link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate join link" })).not.toBeInTheDocument();
  });
});

describe(feature("accounts.regenerate-join-link"), () => {
  it("lets an administrator regenerate the link at once, with no notice, as ember-rust does", async () => {
    const { onJoinCodeChanged, user } = showPage();
    await user.click(await screen.findByRole("button", { name: "Regenerate join link" }));
    await waitFor(async () => expect(await joinLink()).toHaveValue(`http://localhost:3000/join/${NEW_JOIN_CODE}`));
    expect(fetch).toHaveBeenCalledWith("/api/account/join_code", expect.objectContaining({ method: "POST" }));
    expect(onJoinCodeChanged).toHaveBeenLastCalledWith(NEW_JOIN_CODE);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("can't regenerate it again until the last is answered", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { regenerated: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    const regenerate = await screen.findByRole("button", { name: "Regenerate join link" });
    await user.click(regenerate);
    expect(regenerate).toBeDisabled();
    answer(Response.json({ joinCode: NEW_JOIN_CODE }));
    await waitFor(() => expect(regenerate).toBeEnabled());
  });

  it("says why it wasn't regenerated, keeping the link it had", async () => {
    serve(asAdministrator, { regenerated: () => Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }) });
    const { onFailed, onJoinCodeChanged, user } = showPage();
    await user.click(await screen.findByRole("button", { name: "Regenerate join link" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(await joinLink()).toHaveValue(`http://localhost:3000/join/${JOIN_CODE}`);
    expect(screen.getByRole("button", { name: "Regenerate join link" })).toBeEnabled();
    expect(onJoinCodeChanged).toHaveBeenCalledOnce();
  });
});

describe(feature("rooms.create-open"), () => {
  it("has New room in its Rooms section, which opens the form in place", async () => {
    const { user } = showPage();
    const rooms = screen.getByRole("region", { name: "Rooms" });
    const newRoom = within(rooms).getByRole("link", { name: "New room" });
    expect(newRoom).toHaveAttribute("href", "/rooms/opens/new");
    await user.click(newRoom);
    expect(location.pathname).toBe("/rooms/opens/new");
  });
});

const peopleList = () => screen.findByRole("list", { name: "People" });
/** The list as it reads: each row's name, and a dash for the rule between administrators and members. */
const readList = async () => [...(await peopleList()).children].map((item) => (item.tagName === "HR" ? "—" : item.querySelector("strong")!.textContent));
const rowOf = async (name: string) => within(await peopleList()).getByText(name).closest("li")!;
const crownOf = async (name: string) => within(await rowOf(name)).getByRole("checkbox");
/** The roles the page has asked for, by whom. */
const roleChanges = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) => init?.method === "PATCH" && String(input).startsWith("/api/account/users/"))
    .map(([input, init]) => [String(input).split("/").at(-1), (JSON.parse(String(init?.body)) as RoleChange).role]);

describe(feature("accounts.people"), () => {
  it("lists everyone but bots by name, administrators first, then a rule and the members", async () => {
    showPage();
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "—", "linus Torvalds", "Mallory"]);
    expect(screen.getByRole("heading", { level: 2, name: "People" })).toBeInTheDocument();
  });

  it("draws the rule only when there are both administrators and members", async () => {
    showPage(asAda, [grace, ada]);
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("shows members the people who are active, with no controls", async () => {
    serve(asMember);
    showPage(asLinus);
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "—", "linus Torvalds"]);
    expect(within(await peopleList()).queryAllByRole("checkbox")).toEqual([]);
  });

  it("shows administrators who's banned, dimmed under a cancel mark, with no crown", async () => {
    showPage();
    const row = await rowOf("Mallory");
    const [avatar, mark] = row.querySelectorAll("img");
    expect(avatar).toHaveClass("opacity-50");
    expect(mark).toHaveAttribute("src", cancel);
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect((await rowOf("linus Torvalds")).querySelector("img")).not.toHaveClass("opacity-50");
  });

  it("shows each person's avatar from the people directory, loaded as it's scrolled to", async () => {
    showPage();
    const avatar = (await rowOf("Grace Hopper")).querySelector("img");
    expect(avatar).toHaveAttribute("src", grace.avatarUrl);
    expect(avatar).toHaveAttribute("loading", "lazy");
  });

  it("loads the people directory again as it shows, as ember-rust lists everyone as its page loads", async () => {
    const { reloadPeople } = showPage();
    await peopleList();
    expect(reloadPeople).toHaveBeenCalledOnce();
  });

  it("says why the people didn't load", async () => {
    const callbacks = spies();
    const error = new TypeError("Failed to fetch");
    callbacks.reloadPeople.mockRejectedValueOnce(error);
    showPage(asAda, everyone, callbacks);
    await waitFor(() => expect(callbacks.onFailed).toHaveBeenCalledWith(error));
  });
});

describe(feature("accounts.roles"), () => {
  it("gives administrators a crown on each person's row, pressed for administrators, and their own can't be pressed", async () => {
    showPage();
    expect(await crownOf("Ada Lovelace")).toBeDisabled();
    expect(await crownOf("Ada Lovelace")).toBeChecked();
    expect(await crownOf("Grace Hopper")).toBeEnabled();
    expect(await crownOf("Grace Hopper")).toBeChecked();
    expect(await crownOf("Grace Hopper")).toHaveAccessibleName("Role: Administrator");
    expect(await crownOf("linus Torvalds")).not.toBeChecked();
    expect(await crownOf("linus Torvalds")).toHaveAccessibleName("Role: Member");
  });

  it("makes someone an administrator with their crown, at once, with no notice, as ember-rust does", async () => {
    const { onPersonChanged, user } = showPage();
    await user.click(await crownOf("linus Torvalds"));
    expect(await crownOf("linus Torvalds")).toBeChecked();
    await waitFor(() => expect(onPersonChanged).toHaveBeenCalledWith({ ...linus, role: "administrator" }));
    expect(roleChanges()).toEqual([["u3", "administrator"]]);
    // Their row joins the administrators.
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "linus Torvalds", "—", "Mallory"]);
    expect(await crownOf("linus Torvalds")).toHaveAccessibleName("Role: Administrator");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("makes an administrator a member again", async () => {
    const { onPersonChanged, user } = showPage();
    await user.click(await crownOf("Grace Hopper"));
    await waitFor(() => expect(onPersonChanged).toHaveBeenCalledWith({ ...grace, role: "member" }));
    expect(roleChanges()).toEqual([["u2", "member"]]);
    expect(await readList()).toEqual(["Ada Lovelace", "—", "Grace Hopper", "linus Torvalds", "Mallory"]);
  });

  it("can be pressed from the keyboard, where ember-rust's checkbox is hidden from it", async () => {
    const { onPersonChanged, user } = showPage();
    (await crownOf("Grace Hopper")).focus();
    await user.tab();
    expect(await crownOf("linus Torvalds")).toHaveFocus();
    await user.keyboard(" ");
    await waitFor(() => expect(onPersonChanged).toHaveBeenCalledWith({ ...linus, role: "administrator" }));
  });

  it("can't be pressed again until the change is answered", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { roleChanged: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    const crown = await crownOf("linus Torvalds");
    await user.click(crown);
    await user.click(crown);
    expect(crown).toBeChecked();
    expect(roleChanges()).toEqual([["u3", "administrator"]]);
    answer(Response.json({ user: { ...linus, role: "administrator" } }));
    await waitFor(async () => expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "linus Torvalds", "—", "Mallory"]));
  });

  it("leaves out an answer the workspace socket has overtaken, loading the people again to see who's right", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { roleChanged: () => new Promise((resolve) => (answer = resolve)) });
    const { onPersonChanged, reloadPeople, user } = showPage();
    await user.click(await crownOf("linus Torvalds"));
    // Ada's change comes by the socket before its answer does, and then Grace's, making Linus a member again.
    act(() => socketSays({ ...linus, role: "administrator" }));
    act(() => socketSays({ ...linus, role: "member" }));
    answer(Response.json({ user: { ...linus, role: "administrator" } }));
    await waitFor(async () => expect(await crownOf("linus Torvalds")).not.toBeChecked());
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "—", "linus Torvalds", "Mallory"]);
    expect(onPersonChanged).not.toHaveBeenCalled();
    expect(reloadPeople).toHaveBeenCalledTimes(2);
  });

  it("doesn't load the people again for an answer the workspace socket has already brought", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { roleChanged: () => new Promise((resolve) => (answer = resolve)) });
    const { onPersonChanged, reloadPeople, user } = showPage();
    await user.click(await crownOf("linus Torvalds"));
    act(() => socketSays({ ...linus, role: "administrator" }));
    answer(Response.json({ user: { ...linus, role: "administrator" } }));
    // Answered after Linus's, a change to Grace shows his answer has been heard.
    serve(asAdministrator);
    await user.click(await crownOf("Grace Hopper"));
    await waitFor(() => expect(onPersonChanged).toHaveBeenCalledWith({ ...grace, role: "member" }));
    expect(onPersonChanged).toHaveBeenCalledOnce();
    expect(reloadPeople).toHaveBeenCalledOnce();
    expect(await crownOf("linus Torvalds")).toBeChecked();
  });

  it("says why a change was refused, and puts the crown back", async () => {
    serve(asAdministrator, { roleChanged: () => Response.json({ error: "Only administrators can change people's roles" }, { status: 403 }) });
    const { onFailed, onPersonChanged, user } = showPage();
    await user.click(await crownOf("linus Torvalds"));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(await crownOf("linus Torvalds")).not.toBeChecked();
    expect(onPersonChanged).not.toHaveBeenCalled();
  });

  it("loads the settings again once the person looking is made an administrator, or a member again", async () => {
    serve(asMember);
    const { rerender } = showPage(asLinus);
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "—", "linus Torvalds"]);

    serve(asAdministrator);
    rerender({ ...asLinus, administrator: true });
    expect(await nameField()).toBeInTheDocument();
    expect(await crownOf("linus Torvalds")).toBeDisabled();
    expect(await readList()).toContain("Mallory");
  });
});
