import { feature } from "@ember/parity";
import { avatarSvg } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardLeaving } from "@/hooks/use-route";
import { Rail, type Activity, type RailPage } from "./rail";

const ada = { id: "u1", name: "Ada Lovelace", administrator: false };
const activityOff: Activity = { on: false, unread: 0, onToggle: () => {} };

/** The rail for the page `current` names, as `me` sees it. */
const railAt = (current: RailPage, onSignOut = vi.fn(), activity = activityOff, me = ada) => (
  <Rail me={me} workspaceName="Analytical Engines" current={current} activity={activity} onSignOut={onSignOut} />
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
    expect(within(rail).getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/account/edit");
  });

  it("names the settings link Admin for administrators, and Workspace for everyone else", () => {
    const { rerender } = render(railAt("workspace", vi.fn(), activityOff, { ...ada, administrator: true }));
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

  it("marks the logo and Home at home, Home for a room, Workspace for its settings, and nothing for a room's forms", () => {
    const { rerender } = render(railAt("home"));
    const current = () => screen.queryAllByRole("link", { current: "page" }).map((link) => link.getAttribute("aria-label") ?? link.textContent);
    expect(current()).toEqual(["Ember home", "Home"]);
    rerender(railAt("room"));
    expect(current()).toEqual(["Home"]);
    rerender(railAt("workspace"));
    expect(current()).toEqual(["Workspace"]);
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
    render(railAt("home", vi.fn(), { ...activityOff, on: true }));
    expect(screen.queryAllByRole("link", { current: "page" })).toEqual([]);
  });

  it("disables what isn't built yet, and says so", () => {
    render(railAt("home"));
    for (const label of ["DMs", "Search"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("title", `${label} isn't built yet`);
    }
  });
});

describe(feature("sidebar.activity-filter"), () => {
  it("toggles Activity, titled as ember-rust titles it, and shows it pressed while it's on", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(railAt("home", vi.fn(), { ...activityOff, onToggle }));
    const activity = screen.getByRole("button", { name: "Activity" });
    expect(activity).toHaveAttribute("title", "Show unread conversations");
    expect(activity).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(activity);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(railAt("home", vi.fn(), { ...activityOff, on: true, onToggle }));
    expect(activity).toHaveAttribute("aria-pressed", "true");
    expect(activity).toHaveClass("aria-pressed:bg-hover", "aria-pressed:text-foreground");
  });

  it("counts unread conversations in a pill at its corner, hidden at none", () => {
    const { rerender } = render(railAt("room", vi.fn(), { ...activityOff, unread: 3 }));
    const activity = screen.getByRole("button", { name: "Activity" });
    expect(activity).toHaveAccessibleDescription("3 unread");
    const pill = within(activity).getByText("3");
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveClass("absolute", "h-[17px]", "min-w-[17px]", "border-2", "border-surface", "bg-foreground", "text-[10px]", "text-background");

    rerender(railAt("room", vi.fn(), { ...activityOff, unread: 0 }));
    expect(activity).not.toHaveAttribute("aria-description");
    expect(activity).toHaveTextContent(/^Activity$/);
  });
});

describe(feature("auth.sign-out"), () => {
  it("signs out from the profile menu, which shows your name", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(railAt("home", onSignOut));
    await user.click(screen.getByRole("button", { name: "Your profile" }));
    expect(within(screen.getByRole("menu")).getByText("Ada Lovelace")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe(feature("rooms.unsaved-changes"), () => {
  it("asks a form with unsaved changes before signing out", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    let proceed = () => {};
    const stop = guardLeaving((path, go) => {
      expect(path).toBeNull();
      proceed = go;
      return true;
    });
    render(railAt("home", onSignOut));
    await user.click(screen.getByRole("button", { name: "Your profile" }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(onSignOut).not.toHaveBeenCalled();
    proceed();
    expect(onSignOut).toHaveBeenCalledOnce();
    stop();
  });
});

describe(feature("users.avatars"), () => {
  it("shows your avatar as your profile picture", () => {
    render(railAt("home"));
    const picture = screen.getByRole("button", { name: "Your profile" }).querySelector("img")!;
    expect(picture.src).toBe(`data:image/svg+xml;base64,${btoa(avatarSvg(ada.id, ada.name))}`);
  });
});
