import type { Me } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { chooseAppearance } from "@/lib/appearance";
import { NewReleaseContext, YouButton } from "./you-sheet";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: true };
const grace: Me = { id: "u2", name: "Grace Hopper", administrator: false };

afterEach(() => {
  history.replaceState(null, "", "/");
  chooseAppearance("system");
});

const sheet = () => within(screen.getByRole("dialog", { name: "Ada Lovelace" }));

describe("The You sheet on a phone", () => {
  it("opens from your avatar with your name, Your profile, Admin for an administrator with what's new, and the appearance", async () => {
    render(
      <NewReleaseContext value="1.4.0">
        <YouButton me={ada} />
      </NewReleaseContext>,
    );
    expect(screen.getByRole("button", { name: "You" })).toHaveAccessibleDescription("Ember 1.4.0 is available");
    await userEvent.click(screen.getByRole("button", { name: "You" }));
    expect(sheet().getByRole("link", { name: "Your profile" })).toHaveAttribute("href", "/users/me/profile");
    const admin = sheet().getByRole("link", { name: "Admin" });
    expect(admin).toHaveAttribute("href", "/account/edit");
    expect(admin).toHaveAccessibleDescription("Ember 1.4.0 is available");
    expect(admin).toHaveTextContent("Ember 1.4.0 is available");
    const appearance = sheet().getByRole("group", { name: "Appearance" });
    expect(within(appearance).getAllByRole("radio").map((choice) => choice.closest("label")!.textContent)).toEqual(["Light", "Dark", "System"]);
    expect(within(appearance).getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("says Workspace for anyone else, with nothing new to say", async () => {
    render(<YouButton me={grace} />);
    await userEvent.click(screen.getByRole("button", { name: "You" }));
    const workspace = within(screen.getByRole("dialog", { name: "Grace Hopper" })).getByRole("link", { name: "Workspace" });
    expect(workspace).not.toHaveAccessibleDescription();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("goes to your profile in place and closes", async () => {
    render(<YouButton me={ada} />);
    await userEvent.click(screen.getByRole("button", { name: "You" }));
    await userEvent.click(sheet().getByRole("link", { name: "Your profile" }));
    expect(location.pathname).toBe("/users/me/profile");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies an appearance at once and stays open for another", async () => {
    render(<YouButton me={ada} />);
    await userEvent.click(screen.getByRole("button", { name: "You" }));
    await userEvent.click(sheet().getByText("Dark"));
    expect(document.documentElement).toHaveClass("dark");
    expect(sheet().getByRole("radio", { name: "Dark" })).toBeChecked();
  });
});
