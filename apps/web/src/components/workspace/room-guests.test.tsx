import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { RoomGuest } from "@ember/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomPerson, UserId } from "@ember/protocol";
import { RoomGuests } from "./room-guests";

// The guests panel of a room's settings: each guest marked with when their stay ends, a stay extended
// or ended in place, and a guest added with a name and a span. The panel is the workspace's to keep,
// as the room's settings are, so the harness here keeps the people as the page does.

/** How a stay's end reads here, as the panel shows it. */
const UNTIL_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const ada: RoomPerson = { id: "u1", name: "Ada Lovelace", member: true };
const pat: RoomPerson = { id: "g1", name: "Pat Doe", member: true, guestUntil: "2026-11-21T09:00:00.000Z" };
const guestAnswer = (untilAt: string): RoomGuest => ({ userId: "g2", name: "Nia", untilAt });

/** The panel, with `people` as the room's settings list them, keeping what its answers change. */
function showPanel(people: RoomPerson[] = []) {
  const [onSaved, onEnded, onFailed] = [vi.fn(), vi.fn(), vi.fn()];
  /** The people as the page has them now, how many answers have been heard counting as each is applied. */
  const page = { heard: 0, saved: (_: RoomGuest) => {}, ended: (_: UserId) => {} };
  function Panel() {
    const [people_, setPeople] = useState(people);
    const saved = (guest: RoomGuest) => {
      page.heard++;
      onSaved(guest);
      setPeople((listed) =>
        listed.some((person) => person.id === guest.userId)
          ? listed.map((person) => (person.id === guest.userId ? { ...person, member: true, guestUntil: guest.untilAt } : person))
          : [...listed, { id: guest.userId, name: guest.name, member: true, guestUntil: guest.untilAt }],
      );
    };
    const ended = (userId: UserId) => {
      page.heard++;
      onEnded(userId);
      setPeople((listed) => listed.map((person) => (person.id === userId ? { ...person, guestUntil: undefined } : person)));
    };
    page.saved = saved;
    page.ended = ended;
    return <RoomGuests roomId="design" guests={people_.filter((person) => person.guestUntil !== undefined)} onSaved={saved} onEnded={ended} onFailed={onFailed} />;
  }
  const { unmount } = render(<Panel />);
  const user = userEvent.setup();
  return {
    onSaved,
    onEnded,
    onFailed,
    unmount,
    user,
    /** The page hears of a stay's answer, or of its having ended. */
    pageSays: (guest: RoomGuest) => act(() => page.saved(guest)),
    pageEnded: (userId: UserId) => act(() => page.ended(userId)),
  };
}

const panel = () => screen.getByRole("region", { name: "Guests" });
const nameField = () => within(panel()).getByLabelText("Add a guest");
const spans = () => within(panel()).getByLabelText("Their stay ends");
const add = () => within(panel()).getByRole("button", { name: "Add guest" });
/** A guest's row, with their mark, their picker and their End. */
const rowOf = (name: string) => screen.getByText(name).closest("li")!;
const extendSpanOf = (name: string) => within(rowOf(name)).getByRole("combobox", { name: `Extend ${name}'s stay` });
const endOf = (name: string) => within(rowOf(name)).getByRole("button", { name: `End ${name}'s stay` });
/** What each way out sent, in order, as method and body or address. */
const stays = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)) as { name: string; until: string });
const extensions = () =>
  vi.mocked(fetch).mock.calls.filter(([input, init]) => init?.method === "PUT").map(([input, init]) => ({ path: String(input), until: (JSON.parse(String(init?.body)) as { until: string }).until }));
const endings = () => vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input).includes("/guests/") && init?.method === "DELETE").map(([input]) => String(input));

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (request === "POST /api/rooms/design/guests") {
      const { until } = JSON.parse(String(init?.body)) as { until: string };
      return Response.json({ guest: guestAnswer(until) } satisfies { guest: RoomGuest });
    }
    if (init?.method === "PUT") {
      const { until } = JSON.parse(String(init?.body)) as { until: string };
      return Response.json({ guest: { userId: "g1", name: "Pat Doe", untilAt: until } } satisfies { guest: RoomGuest });
    }
    if (init?.method === "DELETE" && String(input).includes("/guests/")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request for ${request}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Room guests", () => {
  it("says what a guest is and how they sign in, and marks each guest with when their stay ends", () => {
    showPanel([ada, pat]);
    expect(panel()).toHaveTextContent("A guest is in this room and nothing else, and signs in with just their name, until the stay you pick ends.");
    // The link names the sign-in page the app serves, which a guest's name opens the name form at.
    expect(panel()).toHaveTextContent(`${location.origin}/session/new?guest=1`);
    expect(within(rowOf("Pat Doe")).getByText(`Guest until ${UNTIL_FORMAT.format(new Date(pat.guestUntil!))}`)).toBeInTheDocument();
    // Who isn't one of the room's guests has no row here, which the room's people list above has.
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("adds a guest with the name given and the span picked, and clears the form once they're in", async () => {
    const { user, onSaved, pageSays } = showPanel([ada]);
    await user.type(nameField(), "Nia");
    await user.selectOptions(spans(), "24 hours");
    await user.click(add());
    await waitFor(() => expect(stays()).toHaveLength(1));
    // A day ahead, as the picker's pick has it.
    const until = new Date(stays()[0]!.until);
    expect(stays()[0]!.name).toBe("Nia");
    expect(until.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60_000);
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(25 * 60 * 60_000);
    await pageSays(guestAnswer(stays()[0]!.until));
    expect(onSaved).toHaveBeenCalledWith(guestAnswer(stays()[0]!.until));
    await waitFor(() => expect(nameField()).toHaveValue(""));
    // They're marked, as the page lists them now.
    expect(within(rowOf("Nia")).getByText(/Guest until/)).toBeInTheDocument();
  });

  it("adds no one without a name, and for a week or thirty days when those are picked", async () => {
    const { user } = showPanel([ada]);
    expect(add()).toBeDisabled();
    await user.type(nameField(), "Nia");
    expect(add()).toBeEnabled();
    await user.selectOptions(spans(), "A week");
    await user.click(add());
    await waitFor(() => expect(stays()).toHaveLength(1));
    const week = new Date(stays()[0]!.until);
    expect(week.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60_000);
    // The form cleared, so the next guest's name is typed again before they're added.
    expect(add()).toBeDisabled();
    await user.type(nameField(), "Nia");
    await user.selectOptions(spans(), "30 days");
    await user.click(add());
    await waitFor(() => expect(stays()).toHaveLength(2));
    const month = new Date(stays()[1]!.until);
    expect(month.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);
  });

  it("adds a guest until the custom time its field picks", async () => {
    const { user } = showPanel([ada]);
    await user.type(nameField(), "Nia");
    await user.selectOptions(spans(), "Custom…");
    const field = within(panel()).getByLabelText("Until a time of your own") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "2026-12-01T09:30" } });
    await user.click(add());
    await waitFor(() => expect(stays()).toHaveLength(1));
    // The field's time, in this device's time, is what the stay keeps.
    expect(new Date(stays()[0]!.until).toTimeString().slice(0, 5)).toBe(new Date(2026, 11, 1, 9, 30).toTimeString().slice(0, 5));
  });

  it("extends a guest's stay for the span their picker picks, or until its custom field's time", async () => {
    const { user } = showPanel([ada, pat]);
    await user.selectOptions(extendSpanOf("Pat Doe"), "30 days");
    await waitFor(() => expect(extensions()).toHaveLength(1));
    expect(extensions()[0]!.path).toBe("/api/rooms/design/guests/g1");
    const month = new Date(extensions()[0]!.until);
    expect(month.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);

    await user.selectOptions(extendSpanOf("Pat Doe"), "Custom…");
    const field = within(rowOf("Pat Doe")).getByLabelText("Extend Pat Doe's stay until a time of your own") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "2026-12-24T18:00" } });
    await waitFor(() => expect(extensions()).toHaveLength(2));
    expect(new Date(extensions()[1]!.until).toTimeString().slice(0, 5)).toBe(new Date(2026, 11, 24, 18, 0).toTimeString().slice(0, 5));
  });

  it("ends a guest's stay, which unmarks them as the page hears of it", async () => {
    const { user, onEnded, pageEnded } = showPanel([ada, pat]);
    await user.click(endOf("Pat Doe"));
    await waitFor(() => expect(endings()).toHaveLength(1));
    expect(endings()).toEqual(["/api/rooms/design/guests/g1"]);
    await pageEnded("g1");
    expect(onEnded).toHaveBeenCalledWith("g1");
    expect(within(panel()).queryByText(/Guest until/)).not.toBeInTheDocument();
  });

  it("says why a stay wasn't saved, and leaves the form to try again", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      `${init?.method} ${String(input)}` === "POST /api/rooms/design/guests" ? Response.json({ error: "Pat is already one of this room's guests" }, { status: 422 }) : (Response.error() as Response),
    );
    const { user, onFailed } = showPanel([ada]);
    await user.type(nameField(), "Pat");
    await user.selectOptions(spans(), "24 hours");
    await user.click(add());
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(within(panel()).queryByText(/Guest until/)).not.toBeInTheDocument();
    // The form keeps the name, and can be sent again.
    expect(nameField()).toHaveValue("Pat");
    expect(add()).toBeEnabled();
  });

  it("sends no second change of a guest's until theirs is answered", async () => {
    let answer = (_: Response) => {};
    vi.mocked(fetch).mockImplementation(
      async (input, init) =>
        new Promise((resolve) => {
          if (init?.method === "PUT") answer = resolve;
        }) as Promise<Response>,
    );
    const { user } = showPanel([ada, pat]);
    await user.selectOptions(extendSpanOf("Pat Doe"), "24 hours");
    expect(extendSpanOf("Pat Doe")).toBeDisabled();
    expect(endOf("Pat Doe")).toBeEnabled();
    expect(extensions()).toHaveLength(1);

    await act(async () => answer(Response.json({ guest: { userId: "g1", name: "Pat Doe", untilAt: "2026-11-21T09:00:00.000Z" } })));
    await waitFor(() => expect(extendSpanOf("Pat Doe")).toBeEnabled());
    await user.selectOptions(extendSpanOf("Pat Doe"), "A week");
    await waitFor(() => expect(extensions()).toHaveLength(2));
  });
});
