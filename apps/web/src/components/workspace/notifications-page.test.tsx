import type { Me, NotificationSettings, SidebarRoom } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { NotificationsPage } from "./notifications-page";

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const design: SidebarRoom = { id: "design", name: "Design", kind: "open", icon: null, unread: false, involvement: "mentions" };
const ops: SidebarRoom = { id: "ops", name: "Ops", kind: "open", icon: null, unread: false, involvement: "nothing" };
const hidden: SidebarRoom = { id: "attic", name: "Attic", kind: "open", icon: null, unread: false, involvement: "invisible" };
const dm: SidebarRoom = { id: "dm", kind: "direct", members: [ada, { id: "u2", name: "Grace" }], activeAt: "2026-11-14T09:00:00.000Z", unread: false, involvement: "everything" };

/** What each request to the notification endpoints sent, in order: method, path and body. */
const sent = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method && init.method !== "GET")
    .map(([input, init]) => [init!.method, String(input), init!.body ? JSON.parse(String(init!.body)) : undefined]);

/** Answers the settings, as they are, and each change with them changed, as the server does. */
function serve(settings: NotificationSettings) {
  let current = settings;
  vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === "/api/users/me/notifications" && init?.method === "PATCH") current = { ...current, ...(JSON.parse(String(init.body)) as Partial<NotificationSettings>) };
    if (path === "/api/users/me/notifications/reset") current = { ...current, chosen: current.chosen.filter((id) => id === hidden.id) };
    if (path.endsWith("/involvement")) {
      const { involvement } = JSON.parse(String(init!.body)) as { involvement: string };
      return Response.json({ involvement: involvement === "default" ? "mentions" : involvement });
    }
    return Response.json(current);
  });
}

function showPage(rooms: SidebarRoom[] = [design, ops, hidden, dm]) {
  const [answered, onFailed] = [vi.fn(), vi.fn()];
  render(
    <Sheet>
      <NotificationsPage me={ada} rooms={rooms} askForRoom={() => answered} onFailed={onFailed} />
    </Sheet>,
  );
  return { answered, onFailed, user: userEvent.setup() };
}

const levelOf = (name: string) => screen.getByRole("combobox", { name: `Notifications for ${name}` });

beforeEach(() => serve({ level: "mentions", pausedUntil: null, chosen: [] }));

describe("Notifications page", () => {
  it("says what you're notified about, and changes it", async () => {
    const { user } = showPage();
    const level = await screen.findByRole("group", { name: "Notify me about" });
    expect(within(level).getAllByRole("radio").map((radio) => radio.closest("label")!.textContent)).toEqual(["All new messages", "DMs, mentions and threads I follow", "Nothing"]);
    expect(within(level).getByRole("radio", { name: "DMs, mentions and threads I follow" })).toBeChecked();

    await user.click(within(level).getByRole("radio", { name: "All new messages" }));
    expect(sent()).toEqual([["PATCH", "/api/users/me/notifications", { level: "everything" }]]);
    expect(within(level).getByRole("radio", { name: "All new messages" })).toBeChecked();
  });

  it("shows the level picked at once, and the one before if it couldn't be saved", async () => {
    const { onFailed, user } = showPage();
    const level = await screen.findByRole("group", { name: "Notify me about" });
    vi.mocked(fetch).mockImplementation(async () => Response.json({ error: "Something went wrong" }, { status: 500 }));
    await user.click(within(level).getByRole("radio", { name: "Nothing" }));
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(within(level).getByRole("radio", { name: "DMs, mentions and threads I follow" })).toBeChecked();
  });

  it("pauses notifications for a while, says until when, and resumes them", async () => {
    const { user } = showPage();
    await user.click(await screen.findByRole("button", { name: "Pause" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["30 minutes", "1 hour", "Until tomorrow", "Custom…"]);
    const before = Date.now();
    await user.click(screen.getByRole("menuitem", { name: "1 hour" }));
    const [[, , body]] = sent() as [[string, string, { pausedUntil: number }]];
    expect(body.pausedUntil - before).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(body.pausedUntil - before).toBeLessThan(61 * 60 * 1000);
    expect(await screen.findByRole("status")).toHaveTextContent(/^Paused until today at /);

    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(sent().at(-1)).toEqual(["PATCH", "/api/users/me/notifications", { pausedUntil: null }]);
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("lists your rooms, then your DMs, each with its level, Default where you haven't picked one", async () => {
    serve({ level: "mentions", pausedUntil: null, chosen: [ops.id, hidden.id] });
    showPage();
    expect(await screen.findByRole("combobox", { name: "Notifications for Design" })).toHaveValue("default");
    expect(screen.getAllByRole("combobox").map((select) => select.getAttribute("aria-label"))).toEqual([
      "Notifications for Attic",
      "Notifications for Design",
      "Notifications for Ops",
      "Notifications for Grace",
    ]);
    expect(levelOf("Ops")).toHaveValue("nothing");
    expect(levelOf("Attic")).toHaveValue("invisible");
    expect(within(levelOf("Design")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Default (Mentions)", "All messages", "Mentions", "Nothing", "Hidden"]);
    // A DM follows all messages by default, and has no @mentions or hiding of its own.
    expect(within(levelOf("Grace")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Default (All messages)", "All messages", "Nothing"]);
  });

  it("saves a level picked for a room, and Default to follow what you're notified about there again", async () => {
    const { answered, user } = showPage();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Notifications for Design" }), "nothing");
    expect(sent()).toEqual([["PUT", "/api/rooms/design/involvement", { involvement: "nothing" }]]);
    expect(answered).toHaveBeenCalledWith({ type: "involved", roomId: "design", involvement: "nothing" });

    await user.selectOptions(levelOf("Design"), "default");
    expect(sent().at(-1)).toEqual(["PUT", "/api/rooms/design/involvement", { involvement: "default" }]);
    expect(answered).toHaveBeenLastCalledWith({ type: "involved", roomId: "design", involvement: "mentions" });
  });

  it("finds a room or DM by name", async () => {
    const { user } = showPage();
    await user.type(await screen.findByRole("searchbox", { name: "Find a room or DM" }), "gra");
    expect(screen.getAllByRole("combobox").map((select) => select.getAttribute("aria-label"))).toEqual(["Notifications for Grace"]);
  });

  it("resets every level you picked, but in the rooms you've hidden, once you say so", async () => {
    serve({ level: "mentions", pausedUntil: null, chosen: [hidden.id] });
    const { user } = showPage();
    await screen.findByRole("combobox", { name: "Notifications for Design" });
    // A hidden room alone is nothing to reset.
    expect(screen.queryByRole("button", { name: "Reset all" })).not.toBeInTheDocument();

    serve({ level: "mentions", pausedUntil: null, chosen: [ops.id, hidden.id] });
    await user.selectOptions(levelOf("Design"), "everything");
    await user.click(screen.getByRole("button", { name: "Reset all" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reset every room to the default?" });
    await user.click(within(dialog).getByRole("button", { name: "Reset all" }));
    expect(sent().at(-1)).toEqual(["POST", "/api/users/me/notifications/reset", undefined]);
    expect(await screen.findByRole("combobox", { name: "Notifications for Ops" })).toHaveValue("default");
  });
});
