import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DndAnswer } from "@ember/protocol";
import { DoNotDisturb } from "./do-not-disturb";

// The Do not disturb section of your profile: the switch hushes your push notifications as soon as it
// turns on, for what the picker picks, and lifts the hush as soon as it turns off. It hushes push
// notifications alone, which the section says. The hush is the workspace's to keep, as the profile
// page's is, so the harness here keeps it as the workspace does.

const HUSHED = "2026-11-14T09:00:00.000Z";

/** The section, hushed until `hushedUntil` at first, as the workspace has it, with what it says and sends. */
function showSection(hushedUntil: string | null = null) {
  const [onChanged, onFailed] = [vi.fn(), vi.fn()];
  /** The hush as the workspace keeps it: how many changes have been heard counts as each is applied. */
  const workspace = { heard: 0, change: (_: string | null) => {} };
  function Section() {
    const [dndUntil, setDndUntil] = useState<string | null>(hushedUntil);
    const changed = (until: string | null) => {
      workspace.heard++;
      onChanged(until);
      setDndUntil(until);
    };
    workspace.change = changed;
    const askForDnd = () => {
      const heard = workspace.heard;
      return (until: string | null) => {
        if (workspace.heard === heard) changed(until);
      };
    };
    return <DoNotDisturb dndUntil={dndUntil} askForDnd={askForDnd} onChanged={changed} onFailed={onFailed} />;
  }
  const { unmount } = render(<Section />);
  const user = userEvent.setup();
  return {
    onChanged,
    onFailed,
    unmount,
    user,
    /** The socket says a tab of yours has changed the hush, as the workspace hears of it. */
    socketSays: (until: string | null) => act(() => workspace.change(until)),
  };
}

const dnd = () => screen.getByRole("region", { name: "Do not disturb" });
const hush = () => within(dnd()).getByRole("switch", { name: "Hush my push notifications" });
const untils = () => within(dnd()).getByRole("combobox", { name: "Until" });
/** What each hush sent, in order. */
const hushes = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PUT")
    .map(([, init]) => (JSON.parse(String(init?.body)) as { until: string }).until);
const lifts = () => vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input) === "/api/users/me/dnd" && init?.method === "DELETE").length;

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (request === "PUT /api/users/me/dnd") {
      const { until } = JSON.parse(String(init?.body)) as { until: string };
      return Response.json({ dndUntil: until } satisfies DndAnswer);
    }
    if (request === "DELETE /api/users/me/dnd") return Response.json({ dndUntil: null } satisfies DndAnswer);
    throw new Error(`Unexpected request for ${request}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Do not disturb", () => {
  it("says what it hushes and what carries on, with the picker at an hour and the switch off", () => {
    showSection();
    expect(dnd()).toHaveTextContent("Hushes your push notifications until a time you pick. Your rooms, unread marks, the app badge and banners in the app carry on.");
    expect(hush()).not.toBeChecked();
    expect(untils()).toHaveValue("1 hour");
    expect(within(dnd()).queryByText(/hushed until/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hushes for the picked span, an hour to begin with, as soon as the switch turns on, and says until when", async () => {
    const { user, onChanged } = showSection();
    await user.click(hush());
    await waitFor(() => expect(hush()).toBeChecked());
    expect(hushes()).toHaveLength(1);
    // An hour ahead, as the picker's pick has it.
    const until = new Date(hushes()[0]!);
    expect(until.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(61 * 60_000);
    // The hush is the workspace's to keep, shown as the server answered it.
    expect(onChanged).toHaveBeenLastCalledWith(hushes()[0]);
    expect(within(dnd()).getByText(/Push notifications are hushed until/)).toBeInTheDocument();
  });

  it("hushes until the span picked, whether the switch is on yet or not, tomorrow morning being nine", async () => {
    const { user } = showSection();
    await user.selectOptions(untils(), "Tomorrow morning");
    await waitFor(() => expect(hush()).toBeChecked());
    const until = new Date(hushes()[0]!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(until.getHours()).toBe(9);
    expect(until.getMinutes()).toBe(0);
    expect([until.getDate(), until.getMonth()]).toEqual([tomorrow.getDate(), tomorrow.getMonth()]);
  });

  it("offers no span that has passed, this evening being gone past five", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T18:30:00"));
    showSection();
    const evening = within(untils()).getByRole("option", { name: "This evening" }) as HTMLOptionElement;
    expect(evening).toBeDisabled();
    expect(within(untils()).getByRole("option", { name: "Tomorrow morning" })).toBeEnabled();
  });

  it("hushes until a custom time, which the picker's own field picks once it holds one", async () => {
    const { user, onChanged } = showSection();
    await user.selectOptions(untils(), "Custom…");
    expect(hushes()).toHaveLength(0);
    const field = within(dnd()).getByLabelText("Until a time of your own") as HTMLInputElement;
    expect(field).toHaveValue("");
    fireEvent.change(field, { target: { value: "2026-11-14T09:30" } });
    await waitFor(() => expect(hush()).toBeChecked());
    expect(hushes()).toHaveLength(1);
    // The field's time, in this device's time, is what the hush keeps.
    expect(new Date(hushes()[0]!).toTimeString().slice(0, 5)).toBe(new Date(2026, 10, 14, 9, 30).toTimeString().slice(0, 5));
    expect(onChanged).toHaveBeenLastCalledWith(hushes()[0]);
  });

  it("lets your push notifications through again as soon as the switch turns off", async () => {
    const { user, onChanged } = showSection(HUSHED);
    expect(hush()).toBeChecked();
    await user.click(hush());
    await waitFor(() => expect(hush()).not.toBeChecked());
    expect(lifts()).toBe(1);
    expect(onChanged).toHaveBeenLastCalledWith(null);
    expect(within(dnd()).queryByText(/hushed until/)).not.toBeInTheDocument();
  });

  it("says why a hush wasn't saved, showing it as it was", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      `${init?.method} ${String(input)}` === "PUT /api/users/me/dnd" ? Response.json({ error: "Pick a time that hasn't passed yet" }, { status: 422 }) : (Response.error() as Response),
    );
    const { user, onChanged, onFailed } = showSection(null);
    await user.click(hush());
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(hush()).not.toBeChecked();
    // The hush the workspace had, which the section showed again.
    expect(onChanged).toHaveBeenLastCalledWith(null);
    expect(within(dnd()).queryByText(/hushed until/)).not.toBeInTheDocument();
  });

  it("shows it as it was again when a hush isn't saved, even once the section is gone", async () => {
    let answer = (_: Response) => {};
    vi.mocked(fetch).mockImplementation(
      async (input, init) =>
        new Promise((resolve) => {
          if (`${init?.method} ${String(input)}` === "PUT /api/users/me/dnd") answer = resolve;
        }) as Promise<Response>,
    );
    const { user, onChanged, onFailed, unmount } = showSection(null);
    await user.click(hush());
    expect(hush()).toBeChecked();
    unmount();
    // The failure lands once the section is gone, which the workspace's hush hears of all the same.
    await act(async () => answer(Response.json({ error: "Pick a time that hasn't passed yet" }, { status: 422 })));
    await waitFor(() => expect(onChanged).toHaveBeenLastCalledWith(null));
    expect(onFailed).toHaveBeenCalledOnce();
  });

  it("can't change again until the last change is answered", async () => {
    let answer = (_: Response) => {};
    vi.mocked(fetch).mockImplementation(
      async (input, init) =>
        new Promise((resolve) => {
          if (`${init?.method} ${String(input)}` === "PUT /api/users/me/dnd") answer = resolve;
        }) as Promise<Response>,
    );
    const { user } = showSection(null);
    await user.click(hush());
    expect(hush()).toBeDisabled();
    expect(untils()).toBeDisabled();
    await user.click(hush());
    expect(hushes()).toHaveLength(1);

    await act(async () => answer(Response.json({ dndUntil: HUSHED } satisfies DndAnswer)));
    await waitFor(() => expect(hush()).toBeEnabled());
    expect(hush()).toBeChecked();
  });

  it("keeps a hush the socket brought while a save was on its way over what the save's answer says", async () => {
    const LATER = new Date(Date.parse(HUSHED) + 60 * 60_000).toISOString();
    let answer = (_: Response) => {};
    vi.mocked(fetch).mockImplementation(
      async (input, init) =>
        new Promise((resolve) => {
          if (`${init?.method} ${String(input)}` === "PUT /api/users/me/dnd") answer = resolve;
        }) as Promise<Response>,
    );
    const { user, onChanged, onFailed, socketSays } = showSection(null);
    await user.click(hush());
    expect(hush()).toBeChecked();
    // Another tab hushes for longer while this save is on its way, which the socket brings first.
    socketSays(LATER);
    expect(onChanged).toHaveBeenLastCalledWith(LATER);
    // The answer read before that, and doesn't take the shorter hush back on.
    await act(async () => answer(Response.json({ dndUntil: HUSHED } satisfies DndAnswer)));
    await waitFor(() => expect(hush()).toBeEnabled());
    expect(onChanged).toHaveBeenLastCalledWith(LATER);
    expect(hush()).toBeChecked();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("keeps a hush the socket brought while a save was failing over what it was before the save", async () => {
    const LATER = new Date(Date.parse(HUSHED) + 60 * 60_000).toISOString();
    let answer = (_: Response) => {};
    vi.mocked(fetch).mockImplementation(
      async (input, init) =>
        new Promise((resolve) => {
          if (`${init?.method} ${String(input)}` === "PUT /api/users/me/dnd") answer = resolve;
        }) as Promise<Response>,
    );
    const { user, onChanged, onFailed, socketSays } = showSection(null);
    await user.click(hush());
    // Another tab hushes for longer while this save is failing, which the socket brings first.
    socketSays(LATER);
    expect(onChanged).toHaveBeenLastCalledWith(LATER);
    // The failing save says why all the same, and the hush stays as the socket now has it, not as it was.
    await act(async () => answer(Response.json({ error: "Pick a time that hasn't passed yet" }, { status: 422 })));
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(onChanged).toHaveBeenLastCalledWith(LATER);
    expect(hush()).toBeChecked();
  });
});
