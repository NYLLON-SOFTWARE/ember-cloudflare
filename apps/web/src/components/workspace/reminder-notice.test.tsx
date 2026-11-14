import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Reminder } from "@ember/protocol";
import { ReminderNotice } from "./reminder-notice";

const reminder: Reminder = { id: "r1", roomId: "room", messageId: "m1", creator: { id: "ada", name: "Ada Lovelace" }, excerpt: "The deploy is at noon", remindAt: new Date().toISOString() };

describe("ReminderNotice", () => {
  it("says whose message it was and where it lives, with Open and Done", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDone = vi.fn();
    render(<ReminderNotice reminder={reminder} roomName="Launch" onOpen={onOpen} onDone={onDone} />);

    expect(screen.getByText("Ada Lovelace in Launch")).toBeInTheDocument();
    expect(screen.getByText("The deploy is at noon")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("says nothing of the room when there isn't one to name, as in a DM or a room that's gone", () => {
    render(<ReminderNotice reminder={reminder} roomName={null} onOpen={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText(/in /)).not.toBeInTheDocument();
  });
});
