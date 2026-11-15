import type { Me, NotificationSettings, SidebarRoom } from "@ember/protocol";
import { act, render, screen, within } from "@testing-library/react";
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
  it("goes back to your profile from its header, on a desktop too (D-R32-7)", async () => {
    showPage();
    await screen.findByRole("group", { name: "Notify me about" });
    expect(screen.getByRole("link", { name: "Back to your profile" })).toHaveAttribute("href", "/users/me/profile");
  });

  it("gives each default's row a fingertip's 48px and 16px type on a phone (E-R32-2)", async () => {
    showPage();
    const level = await screen.findByRole("group", { name: "Notify me about" });
    for (const radio of within(level).getAllByRole("radio")) {
      expect(radio.closest("label")).toHaveClass("min-h-11", "max-md:min-h-12", "max-md:text-base");
      expect(radio).toHaveClass("max-md:size-5");
    }
  });

  it("asks again as the tab shows or takes focus, for what another tab changed (E-R32-1)", async () => {
    showPage();
    expect(await screen.findByRole("combobox", { name: "Notifications for Design" })).toHaveValue("default");
    // Another tab picked a level for Design, and made nothing the default.
    serve({ level: "nothing", pausedUntil: null, chosen: [design.id] });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(() => expect(within(screen.getByRole("group", { name: "Notify me about" })).getByRole("radio", { name: "Nothing" })).toBeChecked());
    expect(levelOf("Design")).toHaveValue("mentions");

    serve({ level: "mentions", pausedUntil: null, chosen: [] });
    act(() => void window.dispatchEvent(new Event("focus")));
    await vi.waitFor(() => expect(levelOf("Design")).toHaveValue("default"));
  });

  it("makes each whole row its level's picker, saying the level at its end, muted while it follows the default (R32-2, R32-3)", async () => {
    serve({ level: "mentions", pausedUntil: null, chosen: [ops.id] });
    showPage();
    const design = await screen.findByRole("combobox", { name: "Notifications for Design" });
    const row = design.closest("li")!;
    expect(design).toHaveClass("absolute", "inset-0", "opacity-0");
    // Its level alone, not "Default (Mentions)", which stays in the picker.
    const shown = [...row.children].filter((child) => child.tagName !== "SELECT").map((child) => child.textContent).join("");
    expect(shown).toBe("#DesignMentions");
    expect(within(row).getByText("Mentions", { selector: "span" })).toHaveClass("text-muted-foreground");
    expect(within(levelOf("Ops").closest("li")!).getByText("Nothing", { selector: "span" })).toHaveClass("text-foreground");
  });

  it("gives every row's mark the same 18px slot, so the names line up whatever the mark (R32-7)", async () => {
    showPage();
    await screen.findByRole("combobox", { name: "Notifications for Design" });
    for (const select of screen.getAllByRole("combobox")) expect(select.closest("li")!.firstElementChild).toHaveClass("w-[18px]", "justify-center");
  });

  it("lists sub-rooms by the name they're shown by, their parent's first (D-R32-3)", async () => {
    const sub: SidebarRoom = { id: "sub", name: "Alpha", kind: "open", icon: null, unread: false, involvement: "mentions", parent: { id: "zoo", name: "Zoo" } };
    const zoo: SidebarRoom = { id: "zoo", name: "Zoo", kind: "open", icon: null, unread: false, involvement: "mentions" };
    showPage([sub, zoo, design]);
    await screen.findByRole("combobox", { name: "Notifications for Design" });
    expect(screen.getAllByRole("combobox").map((select) => select.getAttribute("aria-label"))).toEqual(["Notifications for Design", "Notifications for Zoo", "Notifications for Zoo – Alpha"]);
  });

  it("says when no room or DM matches the search (R32-6)", async () => {
    const { user } = showPage();
    await user.type(await screen.findByRole("searchbox", { name: "Find a room or DM" }), "zzz");
    expect(screen.getByText("No rooms or DMs match")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("puts Pause at the end of its row, and while paused, until when and Resume in that row (R32-5)", async () => {
    showPage();
    const pause = await screen.findByRole("button", { name: "Pause" });
    expect(pause.closest("section")).toHaveTextContent(/^Pause notificationsPause$/);
  });

  it("says notifications are back once a pause ends, without asking again (D-R32-5)", async () => {
    serve({ level: "mentions", pausedUntil: Date.now() + 300, chosen: [] });
    showPage();
    expect(await screen.findByRole("status")).toHaveTextContent(/^Paused until/);
    expect(await screen.findByRole("button", { name: "Pause" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

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
    const dialog = screen.getByRole("alertdialog", { name: "Reset every room and DM to the default?" });
    await user.click(within(dialog).getByRole("button", { name: "Reset all" }));
    expect(sent().at(-1)).toEqual(["POST", "/api/users/me/notifications/reset", undefined]);
    expect(await screen.findByRole("combobox", { name: "Notifications for Ops" })).toHaveValue("default");
  });
});
