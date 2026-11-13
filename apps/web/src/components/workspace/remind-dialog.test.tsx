import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, Reminder } from "@ember/protocol";
import { RemindDialog } from "./remind-dialog";

vi.mock("@/lib/api", () => ({
  fetchReminders: vi.fn(),
  setReminder: vi.fn(),
  dismissReminder: vi.fn(),
}));

import { dismissReminder, fetchReminders, setReminder } from "@/lib/api";

const message = { id: "m1", roomId: "room" } as Message;

const waiting = (id: string, messageId: string, remindAt: string): Reminder => ({ id, roomId: "room", messageId, creator: { id: "ada", name: "Ada" }, excerpt: "", remindAt });

const fetchMock = vi.mocked(fetchReminders);
const setMock = vi.mocked(setReminder);
const dismissMock = vi.mocked(dismissReminder);

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
    fireEvent.change(field, { target: { value: "2030-01-01T09:30" } });
    await user.click(screen.getByRole("button", { name: "Set reminder" }));
    await vi.waitFor(() => expect(setMock).toHaveBeenCalledOnce());
    expect(new Date(setMock.mock.calls[0]![2]).toISOString()).toBe("2030-01-01T09:30:00.000Z");
  });

  it("lists what's waiting on this message alone, and takes one back", async () => {
    const user = userEvent.setup();
    const later = new Date(Date.now() + 60_000).toISOString();
    fetchMock.mockResolvedValue([waiting("r1", "m1", later), waiting("r2", "other", later)]);
    render(<RemindDialog message={message} onClose={vi.fn()} />);

    expect(await screen.findByText("in a minute")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Take this reminder back" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Take this reminder back" }));
    expect(dismissMock).toHaveBeenCalledWith("r1");
    expect(screen.queryByRole("button", { name: "Take this reminder back" })).not.toBeInTheDocument();
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
