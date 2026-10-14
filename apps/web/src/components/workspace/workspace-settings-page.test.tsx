import { feature } from "@ember/parity";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { WorkspaceSettingsPage } from "./workspace-settings-page";

function showPage() {
  history.replaceState(null, "", "/account/edit");
  render(
    <Sheet>
      <WorkspaceSettingsPage back="/rooms/general" />
    </Sheet>,
  );
}

afterEach(() => history.replaceState(null, "", "/"));

describe(feature("accounts.settings-page"), () => {
  it("reads Workspace settings, titled Account settings, with Go Back to the last room visited", () => {
    showPage();
    expect(document.title).toBe("Account settings");
    expect(screen.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeInTheDocument();
    expect(screen.getByText("Manage your workspace, invitations, and people.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/rooms/general");
  });
});

describe(feature("rooms.create-open"), () => {
  it("has New room in its Rooms section, which opens the form in place", async () => {
    showPage();
    const rooms = screen.getByRole("region", { name: "Rooms" });
    const newRoom = within(rooms).getByRole("link", { name: "New room" });
    expect(newRoom).toHaveAttribute("href", "/rooms/opens/new");
    await userEvent.click(newRoom);
    expect(location.pathname).toBe("/rooms/opens/new");
  });
});
