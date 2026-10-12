import { feature } from "@ember/parity";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Rail } from "./rail";

const ada = { id: "u1", name: "Ada Lovelace" };

describe(feature("ui.rail"), () => {
  it("puts Home, DMs, Activity, Search, Workspace, appearance and your profile on the rail", () => {
    render(<Rail me={ada} onSignOut={vi.fn()} />);
    const rail = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(rail).getByRole("link", { name: "Ember home" })).toHaveAttribute("href", "/");
    expect(within(rail).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Home",
      "DMs",
      "Activity",
      "Search",
      "Workspace",
      "Appearance",
      "Your profile",
    ]);
    expect(within(rail).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("disables what isn't built yet, and says so", () => {
    render(<Rail me={ada} onSignOut={vi.fn()} />);
    for (const label of ["DMs", "Activity", "Search", "Workspace"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("title", `${label} isn't built yet`);
    }
  });
});

describe(feature("auth.sign-out"), () => {
  it("signs out from the profile menu, which shows your name", async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(<Rail me={ada} onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: "Your profile" }));
    expect(within(screen.getByRole("menu")).getByText("Ada Lovelace")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe(feature("users.avatars"), () => {
  it("shows your initials as your profile picture", () => {
    render(<Rail me={ada} onSignOut={vi.fn()} />);
    expect(within(screen.getByRole("button", { name: "Your profile" })).getByText("AL")).toBeInTheDocument();
  });
});
