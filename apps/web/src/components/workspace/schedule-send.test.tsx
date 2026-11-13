import type { ScheduledMessage } from "@ember/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { localInputFromDate, ScheduleSend, utcIsoFromLocalInput } from "./schedule-send";

const ada = { id: "u1", name: "Ada" };
const waiting = (overrides: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  id: "s1",
  clientMessageId: "c1",
  roomId: "general",
  creator: ada,
  body: "<p>After lunch</p>",
  plainText: "After lunch",
  mentions: [],
  sendAt: "2026-11-13T15:04:00.000Z",
  createdAt: "2026-11-13T14:00:00.000Z",
  ...overrides,
});

describe("Schedule send", () => {
  it("converts a local field to UTC and back without a zone attached", () => {
    const date = new Date(2026, 10, 13, 15, 4);
    const local = localInputFromDate(date);
    expect(local).toBe("2026-11-13T15:04");
    expect(utcIsoFromLocalInput(local)).toBe(date.toISOString());
    expect(utcIsoFromLocalInput("nope")).toBeNull();
  });

  it("schedules what's written for the chosen time", async () => {
    const onSchedule = vi.fn((_sendAt: string) => true);
    const user = userEvent.setup();
    render(<ScheduleSend disabled={false} scheduled={[]} canSchedule onSchedule={onSchedule} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Schedule send" }));
    const later = localInputFromDate(new Date(Date.now() + 2 * 60 * 60 * 1000));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: later } });
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onSchedule).toHaveBeenCalledOnce();
    const sendAt = onSchedule.mock.calls[0]![0];
    expect(sendAt.endsWith("Z")).toBe(true);
    expect(Date.parse(sendAt)).toBeGreaterThan(Date.now());
  });

  it("refuses a send time that has already passed", async () => {
    const onSchedule = vi.fn(() => true);
    const user = userEvent.setup();
    render(<ScheduleSend disabled={false} scheduled={[]} canSchedule onSchedule={onSchedule} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Schedule send" }));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: localInputFromDate(new Date(Date.now() - 60_000)) } });
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a time in the future.");
  });

  it("cancels a waiting message from the list", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ScheduleSend disabled={false} scheduled={[waiting()]} canSchedule={false} onSchedule={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Schedule send" }));
    expect(screen.getByText("After lunch")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel scheduled message" }));
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("s1");
  });
});
