import { feature } from "@ember/parity";
import { avatarSvg } from "@ember/protocol";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "@/hooks/use-account";
import { Rail, type Activity, type RailPage } from "./rail";

const ada = { id: "u1", name: "Ada Lovelace", administrator: false };
const activityOff: Activity = { on: false, unread: 0, onToggle: () => {} };

/** The rail for the page `current` names, as `me` sees it. */
const railAt = (current: RailPage, activity = activityOff, me = ada, onNewDirect = () => {}) => (
  <Rail me={me} workspaceName="Analytical Engines" current={current} activity={activity} onNewDirect={onNewDirect} />
);

afterEach(() => history.replaceState(null, "", "/"));

describe(feature("ui.rail"), () => {
  it("puts Home, DMs, Activity, Search, Workspace, appearance and your profile on the rail", () => {
    render(railAt("home"));
    const rail = screen.getByRole("navigation", { name: "Workspace" });
    expect([...rail.querySelectorAll("a, button")].map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual([
      "Ember home",
      "Home",
      "DMs",
      "Activity",
      "Search",
      "Workspace",
      "Appearance: System",
      "Your profile",
    ]);
    expect(within(rail).getByRole("link", { name: "Ember home" })).toHaveAttribute("href", "/");
    expect(within(rail).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(within(rail).getByRole("link", { name: "DMs" })).toHaveAttribute("href", "/rooms/directs/new");
    expect(within(rail).getByRole("link", { name: "Search" })).toHaveAttribute("href", "/searches");
    expect(within(rail).getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/account/edit");
    expect(within(rail).getByRole("link", { name: "Your profile" })).toHaveAttribute("href", "/users/me/profile");
  });

  it("links your avatar to your profile, titled with your name, as ember-rust's `.mb-rail__profile` is", async () => {
    render(railAt("home"));
    const profile = screen.getByRole("link", { name: "Your profile" });
    expect(profile).toHaveAttribute("title", "Ada Lovelace");
    await userEvent.click(profile);
    expect(location.pathname).toBe("/users/me/profile");
  });

  it("names the settings link Admin for administrators, and Workspace for everyone else", () => {
    const { rerender } = render(railAt("workspace", activityOff, { ...ada, administrator: true }));
    const settings = screen.getByRole("link", { name: "Admin" });
    expect(settings).toHaveAttribute("href", "/account/edit");
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Workspace" })).not.toBeInTheDocument();
    rerender(railAt("workspace"));
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("titles the logo with the workspace's name", () => {
    render(railAt("home"));
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
  });

  it("marks the logo and Home at home, Home for a room, Workspace for its settings, your avatar for your profile, and nothing for a room's forms", () => {
    const { rerender } = render(railAt("home"));
    const current = () => screen.queryAllByRole("link", { current: "page" }).map((link) => link.getAttribute("aria-label") ?? link.textContent);
    expect(current()).toEqual(["Ember home", "Home"]);
    rerender(railAt("room"));
    expect(current()).toEqual(["Home"]);
    rerender(railAt("workspace"));
    expect(current()).toEqual(["Workspace"]);
    rerender(railAt("profile"));
    expect(current()).toEqual(["Your profile"]);
    rerender(railAt(null));
    expect(current()).toEqual([]);
  });

  it("shows the page a link names in place", async () => {
    render(railAt("home"));
    const length = history.length;
    await userEvent.click(screen.getByRole("link", { name: "Workspace" }));
    expect(location.pathname).toBe("/account/edit");
    expect(history.length).toBe(length + 1);
  });

  it("marks no page while Activity is on", () => {
    render(railAt("home", { ...activityOff, on: true }));
    expect(screen.queryAllByRole("link", { current: "page" })).toEqual([]);
  });

  it("draws Iconoir's icons, which the project's owner chose over ember-rust's", () => {
    render(railAt("home"));
    const rail = screen.getByRole("navigation", { name: "Workspace" });
    const icons = Object.fromEntries(
      [...rail.querySelectorAll("a, button")].map((item) => [item.getAttribute("aria-label") ?? item.textContent, item.querySelector("svg")?.classList[0]]),
    );
    expect(icons).toEqual({
      "Ember home": undefined,
      Home: "iconoir-home",
      DMs: "iconoir-multi-bubble",
      Activity: "iconoir-bell",
      Search: "iconoir-search",
      Workspace: "iconoir-box",
      "Appearance: System": "iconoir-computer",
      "Your profile": undefined,
    });
  });
});

describe(feature("search.page"), () => {
  it("links Search to the search page, marked while it shows, whatever's searched for", async () => {
    const { rerender } = render(railAt("home"));
    const search = screen.getByRole("link", { name: "Search" });
    expect(search).toHaveAttribute("href", "/searches");
    expect(search).not.toHaveAttribute("aria-current");
    rerender(railAt("search"));
    expect(screen.queryAllByRole("link", { current: "page" })).toEqual([search]);
    await userEvent.click(search);
    expect(location.pathname).toBe("/searches");
  });
});

describe(feature("dms.picker"), () => {
  it("opens New direct message in place from DMs, which a click with a modifier key leaves to the browser", async () => {
    const onNewDirect = vi.fn();
    render(railAt("room", activityOff, ada, onNewDirect));
    const dms = screen.getByRole("link", { name: "DMs" });
    await userEvent.click(dms);
    expect(onNewDirect).toHaveBeenCalledExactlyOnceWith(dms);
    expect(location.pathname).toBe("/");

    onNewDirect.mockClear();
    const opened = fireEvent.click(dms, { ctrlKey: true });
    expect(opened).toBe(true);
    expect(onNewDirect).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/");
  });

  it("never marks DMs, whose address goes on to the last room visited", () => {
    render(railAt("room"));
    expect(screen.getByRole("link", { name: "DMs" })).not.toHaveAttribute("aria-current");
  });
});

describe(feature("sidebar.activity-filter"), () => {
  it("toggles Activity, titled as ember-rust titles it, and shows it pressed while it's on", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(railAt("home", { ...activityOff, onToggle }));
    const activity = screen.getByRole("button", { name: "Activity" });
    expect(activity).toHaveAttribute("title", "Show unread conversations");
    expect(activity).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(activity);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(railAt("home", { ...activityOff, on: true, onToggle }));
    expect(activity).toHaveAttribute("aria-pressed", "true");
    expect(activity).toHaveClass("aria-pressed:bg-hover", "aria-pressed:text-foreground");
  });

  it("counts unread conversations in a pill at its corner, hidden at none", () => {
    const { rerender } = render(railAt("room", { ...activityOff, unread: 3 }));
    const activity = screen.getByRole("button", { name: "Activity" });
    expect(activity).toHaveAccessibleDescription("3 unread");
    const pill = within(activity).getByText("3");
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveClass("absolute", "h-[17px]", "min-w-[17px]", "border-2", "border-surface", "bg-foreground", "text-[10px]", "text-background");

    rerender(railAt("room", { ...activityOff, unread: 0 }));
    expect(activity).not.toHaveAttribute("aria-description");
    expect(activity).toHaveTextContent(/^Activity$/);
  });
});

describe(feature("users.avatars"), () => {
  it("shows your avatar as your profile picture", () => {
    render(railAt("home"));
    const picture = screen.getByRole("link", { name: "Your profile" }).querySelector("img")!;
    expect(picture.src).toBe(`data:image/svg+xml;base64,${btoa(avatarSvg(ada.id, ada.name))}`);
  });
});

describe(feature("accounts.logo"), () => {
  it("shows Ember's flame, or the workspace's logo on the page's background, as ember-rust's `.mb-rail__brand`", () => {
    const account = { name: "Analytical Engines", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, memberfulSignIn: false };
    const { rerender } = render(<AccountContext value={account}>{railAt("home")}</AccountContext>);
    const brand = screen.getByRole("link", { name: "Ember home" });
    expect(brand.querySelector("img")).toHaveAttribute("src", "/ember-icon.png");
    expect(brand).not.toHaveClass("bg-background");

    rerender(<AccountContext value={{ ...account, logo: "/account/logo?v=20261017120000" }}>{railAt("home")}</AccountContext>);
    expect(brand.querySelector("img")).toHaveAttribute("src", "/account/logo?v=20261017120000");
    expect(brand.querySelector("img")).toHaveAttribute("alt", "");
    expect(brand).toHaveClass("bg-background");
  });
});
