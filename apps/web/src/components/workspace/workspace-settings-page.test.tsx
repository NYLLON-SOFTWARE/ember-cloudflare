import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSettings } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { Sheet } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api";
import { CHANGES_SAVED, WorkspaceSettingsPage } from "./workspace-settings-page";

const asAdministrator: WorkspaceSettings = { account: { name: "Analytical Engines" }, canAdminister: true };
const asMember: WorkspaceSettings = { ...asAdministrator, canAdminister: false };

/**
 * Answers the page's requests as the server would for `settings`, saving any name it's sent, or with
 * `saved` when it's given.
 */
function serve(settings: WorkspaceSettings, saved?: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== "/api/account") throw new Error(`Unexpected request for ${String(input)}`);
    if (init?.method !== "PATCH") return Response.json(settings);
    return saved ? saved() : Response.json({ account: JSON.parse(String(init.body)) });
  });
}

function showPage() {
  const [onAccountChanged, onFailed] = [vi.fn(), vi.fn()];
  history.replaceState(null, "", "/account/edit");
  render(
    <FlashProvider workspace>
      <Sheet>
        <WorkspaceSettingsPage back="/rooms/general" version="0.1" onAccountChanged={onAccountChanged} onFailed={onFailed} />
      </Sheet>
    </FlashProvider>,
  );
  return { onAccountChanged, onFailed, user: userEvent.setup() };
}

const nameField = () => screen.findByRole("textbox", { name: "Workspace name" });
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
    expect(onAccountChanged).toHaveBeenCalledWith({ name: "Analytical Engines" });
    await user.clear(name);
    await user.type(name, "Difference Engines");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(CHANGES_SAVED);
    expect(saved()).toEqual([{ name: "Difference Engines" }]);
    expect(onAccountChanged).toHaveBeenLastCalledWith({ name: "Difference Engines" });
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
    serve(asAdministrator, () => new Promise((resolve) => (answer = resolve)));
    const { user } = showPage();
    await user.type(await nameField(), "{Enter}");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    answer(Response.json({ account: asAdministrator.account }));
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("says why a rename was refused, keeping the name typed", async () => {
    serve(asAdministrator, () => Response.json({ error: "Only administrators can change the workspace" }, { status: 403 }));
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
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
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
