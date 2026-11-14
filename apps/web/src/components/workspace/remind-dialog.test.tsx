import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, Reminder } from "@ember/protocol";
import { DismissReminder } from "@/hooks/use-reminders";
import { RemindDialog } from "./remind-dialog";

vi.mock("@/lib/api", () => ({
  fetchReminders: vi.fn(),
  setReminder: vi.fn(),
  dismissReminder: vi.fn(),
}));

import { fetchReminders, setReminder } from "@/lib/api";

const message = { id: "m1", roomId: "room" } as Message;

const waiting = (id: string, messageId: string, remindAt: string): Reminder => ({ id, roomId: "room", messageId, creator: { id: "ada", name: "Ada" }, excerpt: "", remindAt });

const fetchMock = vi.mocked(fetchReminders);
const setMock = vi.mocked(setReminder);

afterEach(() => vi.clearAllMocks());

describe("RemindDialog", () => {
  it("sets a reminder for the preset that's picked, then closes", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue([]);
    setMock.mockResolvedValue(waiting("r9", "m1", new Date().toISOString()));
    const onClose = vi.fn();
    render(<RemindDialog message={message} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "In 20 minutes" }));
    await user.click(screen.getByRole("button", { name: "Set reminder" }));
    await vi.waitFor(() => expect(setMock).toHaveBeenCalledOnce());
    const [roomId, messageId, remindAt] = setMock.mock.calls[0]!;
    expect(roomId).toBe("room");
    expect(messageId).toBe("m1");
    expect(Math.abs(new Date(remindAt).getTime() - (Date.now() + 20 * 60 * 1000))).toBeLessThan(5_000);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("picks a time of its own for a custom reminder", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue([]);
    setMock.mockResolvedValue(waiting("r9", "m1", new Date().toISOString()));
    render(<RemindDialog message={message} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Pick a time…" }));
    const field = screen.getByLabelText("Time to be reminded at");
    // Read as the local time it names, whatever zone the test runs in.
    const custom = "2030-01-01T09:30";
    fireEvent.change(field, { target: { value: custom } });
    await user.click(screen.getByRole("button", { name: "Set reminder" }));
    await vi.waitFor(() => expect(setMock).toHaveBeenCalledOnce());
    expect(new Date(setMock.mock.calls[0]![2]).getTime()).toBe(new Date(custom).getTime());
  });

  it("reads a preset from when the reminder is asked for, so a dialog left open doesn't set a stale time", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue([]);
    setMock.mockResolvedValue(waiting("r9", "m1", new Date().toISOString()));
    const start = Date.now();
    const now = vi.spyOn(Date, "now");
    try {
      render(<RemindDialog message={message} onClose={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "In 20 minutes" }));
      // The dialog stays open ten minutes past when the preset was picked.
      now.mockReturnValue(start + 10 * 60_000);
      await user.click(screen.getByRole("button", { name: "Set reminder" }));
      await vi.waitFor(() => expect(setMock).toHaveBeenCalledOnce());
      // So it's set for twenty minutes from then, some thirty minutes out, rather than the ten that
      // picking it would have kept.
      const sent = new Date(setMock.mock.calls[0]![2]).getTime();
      expect(sent - start).toBeGreaterThan(25 * 60_000);
      expect(sent - start).toBeLessThan(35 * 60_000);
    } finally {
      now.mockRestore();
    }
  });

  it("lists what's waiting on this message alone, and takes one back", async () => {
    const user = userEvent.setup();
    const later = new Date(Date.now() + 60_000).toISOString();
    fetchMock.mockResolvedValue([waiting("r1", "m1", later), waiting("r2", "other", later)]);
    const takeBack = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <DismissReminder value={takeBack}>
        <RemindDialog message={message} onClose={vi.fn()} />
      </DismissReminder>,
    );

    expect(await screen.findByText("in a minute")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Take this reminder back" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Take this reminder back" }));
    expect(takeBack).toHaveBeenCalledWith("r1");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Take this reminder back" })).not.toBeInTheDocument());
  });

  it("keeps what's waiting and says so when taking one back fails", async () => {
    const user = userEvent.setup();
    const later = new Date(Date.now() + 60_000).toISOString();
    fetchMock.mockResolvedValue([waiting("r1", "m1", later)]);
    const takeBack = vi.fn<(id: string) => Promise<void>>().mockRejectedValue(new Error("Ember couldn't be reached"));
    render(
      <DismissReminder value={takeBack}>
        <RemindDialog message={message} onClose={vi.fn()} />
      </DismissReminder>,
    );

    expect(await screen.findByText("in a minute")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take this reminder back" }));
    expect(await screen.findByText("Ember couldn't take that back. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take this reminder back" })).toBeInTheDocument();
  });

  it("says what the Worker refused, and stays", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue([]);
    setMock.mockRejectedValue(new Error("Choose a time a little later from now"));
    const onClose = vi.fn();
    render(<RemindDialog message={message} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Pick a time…" }));
    fireEvent.change(screen.getByLabelText("Time to be reminded at"), { target: { value: "2020-01-01T09:30" } });
    await user.click(screen.getByRole("button", { name: "Set reminder" }));
    expect(await screen.findByText("Choose a time a little later from now")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
