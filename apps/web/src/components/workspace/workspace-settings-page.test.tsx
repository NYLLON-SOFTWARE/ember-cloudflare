import { feature } from "@ember/parity";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_PATH, LOGO_TOO_LARGE, MAX_LOGO_SIZE, type Account, type AccountChanges, type DirectoryUser, type Me, type RoleChange, type RoomId, type SidebarRoom, type WorkspaceSettings } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import cancel from "@/components/icons/campfire/cancel.svg";
import crown from "@/components/icons/campfire/crown.svg";
import minus from "@/components/icons/campfire/minus.svg";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { ApiError } from "@/lib/api";
import { CONFIRM_REMOVE } from "./people-list";
import { CHANGES_SAVED, WorkspaceSettingsPage } from "./workspace-settings-page";

vi.mock("@/lib/previews", () => ({
  logoVariantsOf: vi.fn(async () => ({ large: new Blob(["large"], { type: "image/png" }), small: new Blob(["small"], { type: "image/png" }) })),
}));

const JOIN_CODE = "aB3d-Ef5h-iJ7k";
const NEW_JOIN_CODE = "Zy9x-Wv8u-Ts7r";
const asAdministrator: WorkspaceSettings = {
  account: { name: "Analytical Engines", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null },
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

/** A room shared by name, as the sidebar lists it. */
const shared = (id: string, name: string): SidebarRoom => ({ id, name, kind: id.startsWith("secret") ? "closed" : "open", icon: null, unread: false, involvement: "mentions" });
/** Ada's rooms, in the order she joined them, as her sidebar lists them, with a DM, which isn't put in order. */
const adasRooms: SidebarRoom[] = [
  shared("general", "general"),
  shared("random", "random"),
  shared("secret", "Design"),
  { id: "dm", kind: "direct", members: [asAda, { id: grace.id, name: grace.name }], activeAt: "2026-10-16T12:00:00.000Z", unread: false, involvement: "everything" },
];

interface Answers {
  /** What saving the name or the settings answers, rather than the workspace changed as asked. */
  saved?: () => Response | Promise<Response>;
  /** What regenerating the join link answers, rather than `NEW_JOIN_CODE`. */
  regenerated?: () => Response | Promise<Response>;
  /** What changing someone's role answers, rather than them with the role sent. */
  roleChanged?: () => Response | Promise<Response>;
  /** What removing someone answers, rather than them removed. */
  removed?: () => Response | Promise<Response>;
  /** What saving the shared order answers, rather than the rooms sent. */
  ordered?: () => Response | Promise<Response>;
  /** What saving a logo answers, rather than the workspace with `LOGO`. */
  logoSaved?: () => Response | Promise<Response>;
}

/** The workspace's logo once one is uploaded. */
const LOGO = "/account/logo?v=20261017120000";

/** Answers the page's requests as the server would for `settings`, or as `answers` says. */
function serve(settings: WorkspaceSettings, { saved, regenerated, roleChanged, removed, ordered, logoSaved }: Answers = {}) {
  let { account } = settings;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    const person = request.match(/^PATCH \/api\/account\/users\/(.+)$/);
    if (person) {
      const { role } = JSON.parse(String(init?.body)) as RoleChange;
      return roleChanged ? roleChanged() : Response.json({ user: { ...everyone.find((user) => user.id === person[1]), role } });
    }
    const removing = request.match(/^DELETE \/api\/account\/users\/(.+)$/);
    if (removing) return removed ? removed() : Response.json({ user: { ...everyone.find((user) => user.id === removing[1]), status: "deactivated" } });
    switch (request) {
      case "GET /api/account":
        return Response.json({ ...settings, account });
      case "PATCH /api/account": {
        if (saved) return saved();
        const { name = account.name, settings: changed, customDomain = account.customDomain } = JSON.parse(String(init?.body)) as AccountChanges;
        account = {
          ...account,
          name,
          hideTranslationButtons: changed?.hideTranslationButtons ?? account.hideTranslationButtons,
          restrictRoomCreation: changed?.restrictRoomCreation ?? account.restrictRoomCreation,
          customDomain,
        };
        return Response.json({ account });
      }
      case `PUT ${LOGO_PATH}`:
        if (logoSaved) return logoSaved();
        account = { ...account, logo: LOGO };
        return Response.json({ account });
      case `DELETE ${LOGO_PATH}`:
        account = { ...account, logo: null };
        return Response.json({ account });
      case "POST /api/account/join_code":
        return regenerated ? regenerated() : Response.json({ joinCode: NEW_JOIN_CODE });
      case "PUT /api/account/room_order":
        return ordered ? ordered() : Response.json({ sharedOrder: (JSON.parse(String(init?.body)) as { roomIds: RoomId[] }).roomIds });
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
  onSharedOrderSaved: vi.fn(),
  onSessionChanged: vi.fn(),
});
type Callbacks = ReturnType<typeof spies>;

/** Changes someone in the people directory the page shows, as the workspace socket does. */
let socketSays: (person: DirectoryUser) => void;
/** Changes the workspace the page shows, as the workspace socket does. */
let workspaceSays: (account: Account) => void;
/** Changes the rooms the page shows, and the shared order, as the sidebar's list does. */
let sidebarSays: (rooms: SidebarRoom[] | null, sharedOrder?: RoomId[]) => void;

/**
 * The page, with the workspace, the people directory and the sidebar's rooms as the app keeps them:
 * changed as the page, the workspace socket or the sidebar says. The workspace starts as the app loaded
 * it, before the page's settings came, and the rooms as the sidebar listed them.
 */
function Page({ me, listed, rooms: listedRooms, callbacks }: { me: Me; listed: DirectoryUser[]; rooms: SidebarRoom[] | null; callbacks: Callbacks }) {
  const [people, setPeople] = useState(() => new Map(listed.map((person) => [person.id, person])));
  const [account, setAccount] = useState<Account>({ ...asAdministrator.account, name: "Ember" });
  const [sidebar, setSidebar] = useState<{ rooms: SidebarRoom[] | null; sharedOrder: RoomId[] }>({ rooms: listedRooms, sharedOrder: [] });
  socketSays = (person) => setPeople((people) => new Map(people).set(person.id, person));
  workspaceSays = setAccount;
  sidebarSays = (rooms, sharedOrder = []) => setSidebar({ rooms, sharedOrder });
  const personChanged = (person: DirectoryUser) => {
    callbacks.onPersonChanged(person);
    socketSays(person);
  };
  const sharedOrderSaved = (sharedOrder: RoomId[]) => {
    callbacks.onSharedOrderSaved(sharedOrder);
    setSidebar((sidebar) => ({ ...sidebar, sharedOrder }));
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
            <WorkspaceSettingsPage
              me={me}
              back="/rooms/general"
              version="0.1"
              {...handlers}
              askForAccount={askForAccount}
              onPersonChanged={personChanged}
              rooms={sidebar.rooms}
              sharedOrder={sidebar.sharedOrder}
              onSharedOrderSaved={sharedOrderSaved}
            />
          </Sheet>
        </FlashProvider>
      </PeopleContext>
    </AccountContext>
  );
}

function showPage(me = asAda, people = everyone, callbacks = spies(), rooms: SidebarRoom[] | null = adasRooms) {
  history.replaceState(null, "", "/account/edit");
  const { rerender } = render(<Page me={me} listed={people} rooms={rooms} callbacks={callbacks} />);
  return { ...callbacks, rerender: (me: Me) => rerender(<Page me={me} listed={people} rooms={rooms} callbacks={callbacks} />), user: userEvent.setup() };
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

describe(feature("accounts.logo"), () => {
  const logo = () => screen.getByRole("img", { name: "Workspace logo" });
  const picker = () => screen.getByLabelText("Upload logo", { exact: false });
  const removeButton = () => screen.queryByRole("button", { name: "Remove logo" });
  /** What each logo saved sent, in order. */
  const uploads = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "PUT")
      .map(([, init]) => init?.body as FormData);
  const blackHole = () => new File(["black hole"], "black_hole.png", { type: "image/png" });
  const withLogo: WorkspaceSettings = { ...asAdministrator, account: { ...asAdministrator.account, logo: LOGO } };

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:black-hole");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("shows administrators Ember's stock icon above the workspace's name, to change with a logo, as ember-rust does", async () => {
    showPage();
    await nameField();
    expect(logo()).toHaveAttribute("src", "/logos/app-icon.png");
    expect(picker()).toBeEnabled();
    expect(picker()).toHaveAttribute("type", "file");
    expect(picker()).toHaveAttribute("accept", "image/*");
    expect(picker()).toHaveAccessibleDescription("Choose a workspace logo");
    expect(picker().compareDocumentPosition(await nameField())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Nothing to remove while there's no logo.
    expect(removeButton()).toBeNull();
  });

  it("saves a logo as soon as it's picked, showing it meanwhile, with its variants, saying Changes saved.", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { logoSaved: () => new Promise((resolve) => (answer = resolve)) });
    const { onAccountChanged, onFailed, user } = showPage();
    await nameField();
    await user.upload(picker(), blackHole());

    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect(logo()).toHaveAttribute("src", "blob:black-hole");
    expect(picker()).toBeDisabled();
    const [sent] = uploads();
    expect(sent!.get("logo")).toMatchObject({ name: "black_hole.png", type: "image/png" });
    expect(sent!.get("large")).toMatchObject({ type: "image/png" });
    expect(sent!.get("small")).toMatchObject({ type: "image/png" });

    const account = { ...asAdministrator.account, logo: LOGO };
    await act(async () => answer(Response.json({ account })));
    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGES_SAVED);
    expect(onAccountChanged).toHaveBeenLastCalledWith(account);
    expect(logo()).toHaveAttribute("src", LOGO);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:black-hole");
    expect(picker()).toBeEnabled();
    expect(removeButton()).toBeInTheDocument();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("removes the logo with Remove logo, saying nothing, as ember-rust's page comes back", async () => {
    serve(withLogo);
    const { onAccountChanged, user } = showPage();
    await nameField();
    expect(logo()).toHaveAttribute("src", LOGO);
    await user.click(removeButton()!);

    await waitFor(() => expect(removeButton()).toBeNull());
    expect(logo()).toHaveAttribute("src", "/logos/app-icon.png");
    expect(fetch).toHaveBeenCalledWith(LOGO_PATH, expect.objectContaining({ method: "DELETE" }));
    expect(onAccountChanged).toHaveBeenLastCalledWith(asAdministrator.account);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a logo over 16 MB is too large without sending it", async () => {
    const { user } = showPage();
    await nameField();
    const huge = blackHole();
    Object.defineProperty(huge, "size", { value: MAX_LOGO_SIZE + 1 });
    await user.upload(picker(), huge);

    expect(await screen.findByRole("alert")).toHaveTextContent(LOGO_TOO_LARGE);
    expect(uploads()).toEqual([]);
    expect(logo()).toHaveAttribute("src", "/logos/app-icon.png");
  });

  it("says why a logo couldn't be saved, showing the logo as it was", async () => {
    serve(withLogo, { logoSaved: () => Response.json({ error: "Ember isn't set up to store files" }, { status: 503 }) });
    const { onFailed, user } = showPage();
    await nameField();
    await user.upload(picker(), blackHole());

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 503, message: "Ember isn't set up to store files" })));
    expect(logo()).toHaveAttribute("src", LOGO);
    expect(picker()).toBeEnabled();
  });

  it("shows a logo saved in another tab as soon as the workspace socket says it", async () => {
    showPage();
    await nameField();
    act(() => workspaceSays({ ...asAdministrator.account, logo: LOGO }));
    expect(logo()).toHaveAttribute("src", LOGO);
    expect(removeButton()).toBeInTheDocument();
  });

  it("shows members the workspace's logo over its name, or Ember's stock icon, with no picker", async () => {
    serve({ ...withLogo, canAdminister: false });
    showPage(asLinus);
    const name = await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    const shown = screen.getByRole("img", { name: "Account logo" });
    expect(shown).toHaveAttribute("src", LOGO);
    expect(shown.compareDocumentPosition(name)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByLabelText("Upload logo", { exact: false })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();

    act(() => workspaceSays(asMember.account));
    expect(screen.getByRole("img", { name: "Account logo" })).toHaveAttribute("src", "/logos/app-icon.png");
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

describe(feature("accounts.custom-domain"), () => {
  const moved: WorkspaceSettings = { ...asAdministrator, account: { ...asAdministrator.account, customDomain: "chat.example.com" } };

  it("gives administrators a Custom domain section, after Hide translation buttons, saying Changes saved.", async () => {
    serve(moved);
    const { onAccountChanged, user } = showPage();
    const section = await screen.findByRole("region", { name: "Custom domain" });
    const following = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(following(screen.getByRole("switch", { name: "Hide translation buttons" }), section)).toBe(true);
    expect(following(section, screen.getByRole("heading", { level: 2, name: "Rooms" }))).toBe(true);
    expect(section).toHaveTextContent("Ember's address is chat.example.com.");

    await user.click(within(section).getByRole("button", { name: "Stop using it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGES_SAVED);
    expect(saved()).toEqual([{ customDomain: null }]);
    expect(onAccountChanged).toHaveBeenLastCalledWith(asAdministrator.account);
    expect(section).toHaveTextContent(`People open Ember at ${location.host}.`);
  });

  it("isn't shown to members", async () => {
    serve({ ...moved, canAdminister: false });
    showPage(asLinus);
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    expect(screen.queryByRole("region", { name: "Custom domain" })).not.toBeInTheDocument();
    expect(screen.queryByText(/chat\.example\.com/)).not.toBeInTheDocument();
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

describe(feature("bots.list"), () => {
  it("links administrators to Chat bots from its top bar, before Custom styles", async () => {
    showPage();
    const bots = await screen.findByRole("link", { name: "Chat bots" });
    expect(bots).toHaveAttribute("href", "/account/bots");
    expect(bots.nextElementSibling).toBe(screen.getByRole("link", { name: "Custom styles" }));
  });

  it("gives members no link", async () => {
    serve(asMember);
    showPage();
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    expect(screen.queryByRole("link", { name: "Chat bots" })).not.toBeInTheDocument();
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

describe(feature("rooms.creation-permission"), () => {
  const restrictSwitch = () => screen.findByRole("switch", { name: "Must be admin to create new rooms" });
  const roomsSection = () => screen.queryByRole("region", { name: "Rooms" });

  it("gives administrators a crowned switch under New room that limits creating rooms to them, saved at once with no notice", async () => {
    const { onAccountChanged, user } = showPage();
    const restrict = await restrictSwitch();
    expect(roomsSection()).toContainElement(restrict);
    expect(restrict.parentElement).toHaveTextContent("Must be admin to create new rooms");
    expect(restrict.parentElement!.querySelector("img")).toHaveAttribute("src", crown);
    expect(restrict).not.toBeChecked();

    await user.click(restrict);
    expect(restrict).toBeChecked();
    await waitFor(() => expect(onAccountChanged).toHaveBeenLastCalledWith({ ...asAdministrator.account, restrictRoomCreation: true }));
    // Administrators can still create rooms.
    expect(within(roomsSection()!).getByRole("link", { name: "New room" })).toBeInTheDocument();

    await user.click(restrict);
    await waitFor(() => expect(onAccountChanged).toHaveBeenLastCalledWith(asAdministrator.account));
    expect(saved()).toEqual([{ settings: { restrictRoomCreation: true } }, { settings: { restrictRoomCreation: false } }]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("follows the workspace socket, for a switch moved in another tab", async () => {
    showPage();
    const restrict = await restrictSwitch();
    act(() => workspaceSays({ ...asAdministrator.account, restrictRoomCreation: true }));
    expect(restrict).toBeChecked();
  });

  it("can't be moved again until the last move is answered, and moves back saying why it was refused", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { saved: () => new Promise((resolve) => (answer = resolve)) });
    const { onFailed, user } = showPage();
    const restrict = await restrictSwitch();
    await user.click(restrict);
    await user.click(restrict);
    expect(restrict).toBeChecked();
    expect(saved()).toEqual([{ settings: { restrictRoomCreation: true } }]);

    answer(Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(restrict).not.toBeChecked();
  });

  it("takes the Rooms section away from members while it's on, and gives it back once it's off", async () => {
    serve({ ...asMember, account: { ...asMember.account, restrictRoomCreation: true } });
    showPage(asLinus);
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    expect(roomsSection()).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New room" })).not.toBeInTheDocument();

    act(() => workspaceSays({ ...asMember.account, restrictRoomCreation: false }));
    expect(within(roomsSection()!).getByRole("link", { name: "New room" })).toBeInTheDocument();
  });

  it("gives members New room alone in the Rooms section while anyone can create rooms", async () => {
    serve(asMember);
    showPage(asLinus);
    await screen.findByRole("heading", { level: 2, name: "Analytical Engines" });
    const rooms = roomsSection()!;
    expect(within(rooms).getByRole("link", { name: "New room" })).toBeInTheDocument();
    expect(within(rooms).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(rooms).queryByRole("list", { name: "Room order" })).not.toBeInTheDocument();
  });
});

describe(feature("sidebar.shared-order"), () => {
  const HELP = "Drag rooms into order, then save to update everyone’s sidebar. Starred rooms keep their personal order.";
  const orderList = () => screen.getByRole("list", { name: "Room order" });
  const orderRows = () => within(orderList()).getAllByRole("listitem");
  /** The rooms the list shows, top to bottom. */
  const ordered = () => orderRows().map((row) => row.textContent);
  const orderRow = (name: string) => orderRows().find((row) => row.textContent === `#${name}`)!;
  const status = () => within(screen.getByRole("region", { name: "Rooms" })).getByRole("status");
  const button = (name: string) => screen.getByRole("button", { name });
  /** The orders the page has saved, as sent. */
  const sentOrders = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input) === "/api/account/room_order")
      .map(([, init]) => [init?.method, JSON.parse(String(init?.body))]);
  /** Moves `name`'s row with Alt and an arrow. */
  const altArrow = (name: string, key: "ArrowUp" | "ArrowDown") => fireEvent.keyDown(orderRow(name), { key, altKey: true });

  it("lists an administrator's rooms but their DMs, the ones the shared order ranks first, in its order, then the rest by name", async () => {
    showPage();
    await screen.findByRole("list", { name: "Room order" });
    expect(ordered()).toEqual(["#Design", "#general", "#random"]);
    act(() => sidebarSays(adasRooms, ["random", "general"]));
    expect(ordered()).toEqual(["#random", "#general", "#Design"]);

    expect(screen.getByText(HELP)).toBeInTheDocument();
    for (const row of orderRows()) {
      expect(row).toHaveAccessibleDescription(HELP);
      expect(row).toHaveAttribute("tabindex", "0");
      expect(row).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    }
    const grip = within(orderRow("random")).getByRole("button", { name: "Move random" });
    expect(grip).toHaveAttribute("title", "Drag to reorder, or press Alt + Up / Down");
    expect(grip).toHaveClass("cursor-grab", "touch-none");
    expect(button("Cancel")).toBeDisabled();
    expect(button("Save order")).toBeDisabled();
    expect(status()).toBeEmptyDOMElement();
    expect(status()).toHaveClass("sr-only");
  });

  it("moves a row past the one above or below it with Alt and an arrow, keeping it focused, and saves only with Save order", async () => {
    const { onSharedOrderSaved, user } = showPage();
    await screen.findByRole("list", { name: "Room order" });
    orderRow("random").focus();
    altArrow("random", "ArrowUp");
    expect(ordered()).toEqual(["#Design", "#random", "#general"]);
    expect(orderRow("random")).toHaveFocus();
    expect(status()).toHaveTextContent("Unsaved room order. Save to apply it to everyone.");
    expect(status()).not.toHaveClass("sr-only");
    expect(status()).toHaveClass("text-muted-foreground");
    // Not past either end, nor with the arrow alone.
    altArrow("Design", "ArrowUp");
    fireEvent.keyDown(orderRow("general"), { key: "ArrowUp" });
    altArrow("general", "ArrowDown");
    expect(ordered()).toEqual(["#Design", "#random", "#general"]);
    expect(sentOrders()).toEqual([]);

    await user.click(button("Save order"));
    await waitFor(() => expect(status()).toHaveTextContent("Room order saved for everyone."));
    expect(sentOrders()).toEqual([["PUT", { roomIds: ["secret", "random", "general"] }]]);
    expect(onSharedOrderSaved).toHaveBeenCalledExactlyOnceWith(["secret", "random", "general"]);
    expect(ordered()).toEqual(["#Design", "#random", "#general"]);
    expect(button("Save order")).toBeDisabled();
    expect(button("Cancel")).toBeDisabled();
  });

  it("puts the rows back as saved with Cancel, saying nothing", async () => {
    const { user } = showPage();
    await screen.findByRole("list", { name: "Room order" });
    altArrow("general", "ArrowUp");
    await user.click(button("Cancel"));
    expect(ordered()).toEqual(["#Design", "#general", "#random"]);
    expect(status()).toBeEmptyDOMElement();
    expect(button("Save order")).toBeDisabled();
    expect(sentOrders()).toEqual([]);
  });

  it("keeps still until a save is answered, then saves nothing more until something moves", async () => {
    let answer = (_: Response) => {};
    serve(asAdministrator, { ordered: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    await screen.findByRole("list", { name: "Room order" });
    altArrow("general", "ArrowUp");
    await user.click(button("Save order"));
    expect(status()).toHaveTextContent("Saving room order…");
    expect(button("Save order")).toBeDisabled();
    expect(button("Cancel")).toBeDisabled();
    altArrow("random", "ArrowUp");
    expect(ordered()).toEqual(["#general", "#Design", "#random"]);

    await act(async () => answer(Response.json({ sharedOrder: ["general", "secret", "random"] })));
    expect(status()).toHaveTextContent("Room order saved for everyone.");
    expect(sentOrders()).toHaveLength(1);
  });

  it("says on screen why an order wasn't saved, keeping it to try again", async () => {
    serve(asAdministrator, { ordered: () => Response.json({ error: "Only administrators can put rooms in order for everyone" }, { status: 403 }) });
    const { onSharedOrderSaved, onFailed, user } = showPage();
    await screen.findByRole("list", { name: "Room order" });
    altArrow("general", "ArrowUp");
    await user.click(button("Save order"));
    await waitFor(() => expect(status()).toHaveTextContent("Couldn’t save room order. Please try again."));
    expect(status()).toHaveClass("text-negative");
    expect(ordered()).toEqual(["#general", "#Design", "#random"]);
    expect(button("Save order")).toBeEnabled();
    expect(onSharedOrderSaved).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("goes to sign in when the session has expired", async () => {
    serve(asAdministrator, { ordered: () => Response.json({ error: "Sign in to continue" }, { status: 401 }) });
    const { onSessionChanged, user } = showPage();
    await screen.findByRole("list", { name: "Room order" });
    altArrow("general", "ArrowUp");
    await user.click(button("Save order"));
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledExactlyOnceWith(null));
  });

  it("keeps what's moved as rooms come and go, a new one last, and follows an order saved elsewhere otherwise", async () => {
    showPage();
    await screen.findByRole("list", { name: "Room order" });
    altArrow("random", "ArrowUp");
    expect(ordered()).toEqual(["#Design", "#random", "#general"]);
    act(() => sidebarSays([...adasRooms.filter((room) => room.id !== "secret"), shared("ops", "Ops")], ["general"]));
    expect(ordered()).toEqual(["#random", "#general", "#Ops"]);
    expect(button("Save order")).toBeEnabled();

    fireEvent.click(button("Cancel"));
    expect(ordered()).toEqual(["#general", "#Ops", "#random"]);
    act(() => sidebarSays(adasRooms, ["random", "secret"]));
    expect(ordered()).toEqual(["#random", "#Design", "#general"]);
  });

  it("waits for the sidebar's rooms, and says when there are none to arrange", async () => {
    showPage(asAda, everyone, spies(), null);
    await screen.findByRole("switch", { name: "Must be admin to create new rooms" });
    expect(screen.queryByRole("list", { name: "Room order" })).not.toBeInTheDocument();
    act(() => sidebarSays(adasRooms.filter((room) => room.kind === "direct")));
    expect(orderList()).toBeEmptyDOMElement();
    expect(screen.getByText("No rooms to arrange yet.")).toBeInTheDocument();
    act(() => sidebarSays(adasRooms));
    expect(ordered()).toEqual(["#Design", "#general", "#random"]);
    expect(screen.queryByText("No rooms to arrange yet.")).not.toBeInTheDocument();
  });

  describe("dragged", () => {
    // jsdom lays nothing out, so each row is 52px tall, in the order the list draws them, and the list
    // is too tall for a drag to scroll it.
    function layOutRows() {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (!this.dataset.roomId) return DOMRect.fromRect({ x: 0, y: -1000, width: 600, height: 3000 });
        return DOMRect.fromRect({ x: 0, y: Array.prototype.indexOf.call(this.parentElement!.children, this) * 52, width: 600, height: 52 });
      });
    }

    /** Shows the page with its rooms in order, and the clock and layout as the drags need them. */
    async function showList() {
      const shown = showPage();
      await screen.findByRole("list", { name: "Room order" });
      vi.useFakeTimers();
      layOutRows();
      return shown;
    }

    afterEach(() => vi.useRealTimers());

    const grip = (name: string) => within(orderRow(name)).getByRole("button", { name: `Move ${name}` });
    const pressGrip = (name: string) =>
      fireEvent.pointerDown(grip(name), { pointerType: "mouse", button: 0, clientX: 20, clientY: orderRows().indexOf(orderRow(name)) * 52 + 26 });
    const dragTo = (clientY: number) => fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 20, clientY });

    it("picks a row up by its grip at once, moves it past the rows whose middle it passes, and places it where it's let go", async () => {
      await showList();
      pressGrip("random");
      expect(status()).toHaveTextContent("Moving random. Release to place, or press Escape to cancel.");
      expect(orderRow("random")).toHaveClass("bg-hover", "shadow-[inset_3px_0_var(--color-foreground)]");
      expect(orderList()).toHaveClass("select-none");

      dragTo(10);
      expect(ordered()).toEqual(["#random", "#Design", "#general"]);
      fireEvent.pointerUp(window);
      expect(orderRow("random")).not.toHaveClass("bg-hover");
      expect(orderRow("random")).toHaveFocus();
      expect(status()).toHaveTextContent("Unsaved room order. Save to apply it to everyone.");
      expect(button("Save order")).toBeEnabled();
      expect(sentOrders()).toEqual([]);
    });

    it("picks a row up only by its grip", async () => {
      await showList();
      fireEvent.pointerDown(orderRow("random").lastElementChild!, { pointerType: "mouse", button: 0, clientX: 200, clientY: 2 * 52 + 26 });
      dragTo(10);
      fireEvent.pointerUp(window);
      expect(ordered()).toEqual(["#Design", "#general", "#random"]);
      expect(status()).toBeEmptyDOMElement();
    });

    it("puts a dragged row back on Escape, leaving nothing to save", async () => {
      await showList();
      pressGrip("random");
      dragTo(10);
      expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);
      expect(ordered()).toEqual(["#Design", "#general", "#random"]);
      expect(status()).toHaveTextContent("Room move canceled.");
      fireEvent.pointerUp(window);
      expect(button("Save order")).toBeDisabled();
    });

    it("puts a row being dragged back when Cancel or Save order is pressed, so what's put back, or saved, is what shows", async () => {
      await showList();
      altArrow("random", "ArrowUp");
      pressGrip("Design");
      dragTo(2 * 52 + 40);
      expect(ordered()).toEqual(["#random", "#general", "#Design"]);
      fireEvent.click(button("Cancel"));
      fireEvent.pointerUp(window);
      expect(ordered()).toEqual(["#Design", "#general", "#random"]);
      expect(button("Save order")).toBeDisabled();

      altArrow("random", "ArrowUp");
      pressGrip("Design");
      dragTo(2 * 52 + 40);
      fireEvent.click(button("Save order"));
      fireEvent.pointerUp(window);
      expect(ordered()).toEqual(["#Design", "#random", "#general"]);
      expect(sentOrders()).toEqual([["PUT", { roomIds: ["secret", "random", "general"] }]]);
      await act(() => vi.runAllTimersAsync());
      expect(status()).toHaveTextContent("Room order saved for everyone.");
    });

    it("drags with a finger on its grip at once, the page not scrolling", async () => {
      await showList();
      fireEvent.touchStart(grip("Design"), { touches: [{ clientX: 20, clientY: 26 }] });
      expect(status()).toHaveTextContent("Moving Design.");
      expect(fireEvent.touchMove(window, { touches: [{ clientX: 20, clientY: 2 * 52 + 40 }] })).toBe(false);
      expect(ordered()).toEqual(["#general", "#random", "#Design"]);
      fireEvent.touchEnd(window);
      expect(status()).toHaveTextContent("Unsaved room order.");
    });
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
    expect(avatar!.closest("a")).toHaveClass("[&>img]:opacity-50");
    expect(mark).toHaveAttribute("src", cancel);
    expect(mark).toHaveClass("pointer-events-none");
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect((await rowOf("linus Torvalds")).querySelector("a")).not.toHaveClass("[&>img]:opacity-50");
  });

  it("gives your own row My settings, which opens your profile, and nobody else's", async () => {
    const { user } = showPage(asLinus);
    const mine = within(await rowOf("linus Torvalds")).getByRole("link", { name: "My settings" });
    expect(within(await rowOf("Grace Hopper")).queryByRole("link", { name: "My settings" })).not.toBeInTheDocument();
    await user.click(mine);
    expect(location.pathname).toBe("/users/me/profile");
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
    // Past Grace's Delete, and linus's avatar, which links to his page.
    await user.tab();
    expect(screen.getByRole("button", { name: "Delete Grace Hopper" })).toHaveFocus();
    await user.tab();
    expect(within(await rowOf("linus Torvalds")).getByRole("link")).toHaveFocus();
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

const deleteOf = async (name: string) => within(await rowOf(name)).queryByRole("button", { name: `Delete ${name}` });
/** Whom the page has asked to remove. */
const removals = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "DELETE")
    .map(([input]) => String(input).split("/").at(-1));
const confirmed = (answer: boolean) => vi.spyOn(window, "confirm").mockReturnValue(answer);

describe(feature("accounts.remove-person"), () => {
  it("gives administrators Delete on each active person's row but their own, white on red, named for them", async () => {
    showPage();
    const remove = await deleteOf("Grace Hopper");
    expect(remove).toBeEnabled();
    const [icon] = remove!.querySelectorAll("img");
    expect(icon).toHaveAttribute("src", minus);
    expect(icon).toHaveClass("invert");
    expect(remove).toHaveClass("bg-negative-button");
    expect(await deleteOf("linus Torvalds")).toBeInTheDocument();
    expect(await deleteOf("Ada Lovelace")).toBeNull();
    expect(await deleteOf("Mallory")).toBeNull();
    // After the crown, as in ember-rust's row.
    expect((await crownOf("linus Torvalds")).closest("label")!.nextElementSibling).toBe(await deleteOf("linus Torvalds"));
  });

  it("gives members none", async () => {
    serve(asMember);
    showPage(asLinus);
    await peopleList();
    expect(within(await peopleList()).queryAllByRole("button")).toEqual([]);
  });

  it("removes someone once you confirm, with no notice, as ember-rust does, and they leave the list", async () => {
    const confirm = confirmed(true);
    const { onPersonChanged, user } = showPage();
    await user.click((await deleteOf("linus Torvalds"))!);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(CONFIRM_REMOVE);
    await waitFor(() => expect(onPersonChanged).toHaveBeenCalledWith({ ...linus, status: "deactivated" }));
    expect(removals()).toEqual(["u3"]);
    expect(await readList()).toEqual(["Ada Lovelace", "Grace Hopper", "—", "Mallory"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes nobody unless you confirm", async () => {
    confirmed(false);
    const { user } = showPage();
    await user.click((await deleteOf("linus Torvalds"))!);
    expect(removals()).toEqual([]);
    expect(await readList()).toContain("linus Torvalds");
  });

  it("can't be pressed again until the removal is answered", async () => {
    confirmed(true);
    let answer = (_: Response) => {};
    serve(asAdministrator, { removed: () => new Promise((resolve) => (answer = resolve)) });
    const { user } = showPage();
    const remove = (await deleteOf("linus Torvalds"))!;
    await user.click(remove);
    expect(remove).toBeDisabled();
    await user.click(remove);
    expect(removals()).toEqual(["u3"]);
    answer(Response.json({ user: { ...linus, status: "deactivated" } }));
    await waitFor(async () => expect(await readList()).not.toContain("linus Torvalds"));
  });

  it("needs no answer the workspace socket has already brought", async () => {
    confirmed(true);
    let answer = (_: Response) => {};
    serve(asAdministrator, { removed: () => new Promise((resolve) => (answer = resolve)) });
    const { onPersonChanged, reloadPeople, user } = showPage();
    await user.click((await deleteOf("linus Torvalds"))!);
    act(() => socketSays({ ...linus, status: "deactivated" }));
    expect(await readList()).not.toContain("linus Torvalds");
    answer(Response.json({ user: { ...linus, status: "deactivated" } }));
    // Answered after Linus's, Grace's removal shows his answer has been heard.
    serve(asAdministrator);
    await user.click((await deleteOf("Grace Hopper"))!);
    await waitFor(() => expect(onPersonChanged).toHaveBeenCalledWith({ ...grace, status: "deactivated" }));
    expect(onPersonChanged).toHaveBeenCalledOnce();
    expect(reloadPeople).toHaveBeenCalledOnce();
  });

  it("says why a removal was refused, keeping them listed, to be tried again", async () => {
    confirmed(true);
    serve(asAdministrator, { removed: () => Response.json({ error: "Only administrators can remove people" }, { status: 403 }) });
    const { onFailed, onPersonChanged, user } = showPage();
    await user.click((await deleteOf("linus Torvalds"))!);
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(await deleteOf("linus Torvalds")).toBeEnabled();
    expect(await readList()).toContain("linus Torvalds");
    expect(onPersonChanged).not.toHaveBeenCalled();
  });
});

describe(feature("users.avatar-links"), () => {
  it("links each person's avatar to their page, titled with their name and bio, a banned person's too, and goes there in place", async () => {
    const { user } = showPage(asAda, [ada, { ...grace, bio: "Wrote the first compiler" }, mallory]);
    const link = within(await rowOf("Grace Hopper")).getByRole("link");
    expect(link).toHaveAttribute("href", "/users/u2");
    expect(link).toHaveAttribute("title", "Grace Hopper – Wrote the first compiler");
    expect(within(await rowOf("Mallory")).getByRole("link", { name: "Mallory" })).toHaveAttribute("href", "/users/u4");
    await user.click(link);
    expect(location.pathname).toBe("/users/u2");
  });
});
