import { feature } from "@ember/parity";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rail } from "./rail";

const ada = { id: "u1", name: "Ada Lovelace" };

afterEach(() => history.replaceState(null, "", "/"));

describe(feature("ui.rail"), () => {
  it("puts Home, DMs, Activity, Search, Workspace, appearance and your profile on the rail", () => {
    render(<Rail me={ada} current="home" onSignOut={vi.fn()} />);
    const rail = screen.getByRole("navigation", { name: "Workspace" });
    expect([...rail.querySelectorAll("a, button")].map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual([
      "Ember home",
      "Home",
      "DMs",
      "Activity",
      "Search",
      "Workspace",
      "Appearance",
      "Your profile",
    ]);
    expect(within(rail).getByRole("link", { name: "Ember home" })).toHaveAttribute("href", "/");
    expect(within(rail).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(within(rail).getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/account/edit");
  });

  it("marks Home for a room, Workspace for its settings, and neither for a room's forms", () => {
    const { rerender } = render(<Rail me={ada} current="home" onSignOut={vi.fn()} />);
    const current = () => screen.queryAllByRole("link", { current: "page" }).map((link) => link.textContent);
    expect(current()).toEqual(["Home"]);
    rerender(<Rail me={ada} current="workspace" onSignOut={vi.fn()} />);
    expect(current()).toEqual(["Workspace"]);
    rerender(<Rail me={ada} current={null} onSignOut={vi.fn()} />);
    expect(current()).toEqual([]);
  });

  it("shows the page a link names in place", async () => {
    render(<Rail me={ada} current="home" onSignOut={vi.fn()} />);
    const length = history.length;
    await userEvent.click(screen.getByRole("link", { name: "Workspace" }));
    expect(location.pathname).toBe("/account/edit");
    expect(history.length).toBe(length + 1);
  });

  it("disables what isn't built yet, and says so", () => {
    render(<Rail me={ada} current="home" onSignOut={vi.fn()} />);
    for (const label of ["DMs", "Activity", "Search"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("title", `${label} isn't built yet`);
    }
  });
});

describe(feature("auth.sign-out"), () => {
  it("signs out from the profile menu, which shows your name", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(<Rail me={ada} current="home" onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: "Your profile" }));
    expect(within(screen.getByRole("menu")).getByText("Ada Lovelace")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe(feature("users.avatars"), () => {
  it("shows your initials as your profile picture", () => {
    render(<Rail me={ada} current="home" onSignOut={vi.fn()} />);
    expect(within(screen.getByRole("button", { name: "Your profile" })).getByText("AL")).toBeInTheDocument();
  });
});
