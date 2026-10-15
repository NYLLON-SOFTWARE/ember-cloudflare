import { feature } from "@ember/parity";
import type { Favorites, Room, Sidebar, SidebarRoom } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { inSidebarOrder, markedUnread, NO_ROOM_LIST, roomListReducer, withRoom } from "./room-list";

const room = (id: string, name: string, unread = false): SidebarRoom => ({ id, kind: "open", name, icon: null, unread });
const unstarred: Favorites = { rooms: [], version: 0 };
/** The sidebar's list of `rooms`, starred as `favorites` says. */
const sidebar = (rooms: SidebarRoom[], favorites = unstarred): Sidebar => ({ rooms, favorites, invitation: null });

describe(feature("rooms.create-open"), () => {
  it("puts a new room last, as the room made most recently, and the sidebar in its place by name", () => {
    const rooms = withRoom([room("r1", "Design"), room("r2", "general"), room("r3", "Zebra")], room("r4", "Finance"));
    expect(rooms.map((r) => r.name)).toEqual(["Design", "general", "Zebra", "Finance"]);
    expect(inSidebarOrder(rooms, []).map((r) => r.name)).toEqual(["Design", "Finance", "general", "Zebra"]);
  });

  it("keeps a room saved before the list arrives, and adds it to the list when it does", () => {
    const list = sidebar([room("r2", "general")]);
    const saved = roomListReducer(NO_ROOM_LIST, { type: "saved", room: room("r1", "Design") });
    expect(saved.list).toBeNull();
    expect(roomListReducer(saved, { type: "loaded", list })).toEqual({ list: sidebar([room("r2", "general"), room("r1", "Design")]), pending: null });
  });
});

describe(feature("rooms.settings-page"), () => {
  it("keeps a renamed room in its place, and the sidebar moves it to its new name's", () => {
    const rooms = withRoom([room("r1", "Design"), room("r2", "general")], room("r1", "Product design"));
    expect(rooms).toEqual([room("r1", "Product design"), room("r2", "general")]);
    expect(inSidebarOrder(rooms, [])).toEqual([room("r2", "general"), room("r1", "Product design")]);
  });

  it("keeps a rename saved before the list arrives over the name the list has", () => {
    const list = sidebar([room("r1", "Design"), room("r2", "general")]);
    const renamed = roomListReducer(NO_ROOM_LIST, { type: "saved", room: room("r1", "Product design") });
    expect(roomListReducer(renamed, { type: "loaded", list }).list!.rooms).toEqual([room("r1", "Product design"), room("r2", "general")]);
  });

  it("changes the list in place once it has arrived", () => {
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: sidebar([room("r1", "Design")]) });
    expect(roomListReducer(loaded, { type: "saved", room: room("r1", "Product design") })).toEqual({
      list: sidebar([room("r1", "Product design")]),
      pending: null,
    });
  });
});

describe(feature("rooms.show"), () => {
  const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: sidebar([room("r1", "Design")]) });

  it("keeps the list while it's asked for again, and the changes made meanwhile once the new one arrives", () => {
    const asked = roomListReducer(loaded, { type: "asked" });
    expect(asked.list).toEqual(loaded.list);
    const saved = roomListReducer(asked, { type: "saved", room: room("r3", "Finance") });
    expect(saved.list!.rooms.map((r) => r.id)).toEqual(["r1", "r3"]);
    // Asked for before Finance was made, the new list hasn't got it.
    const list = sidebar([room("r1", "Design"), room("r2", "general")]);
    expect(roomListReducer(saved, { type: "loaded", list })).toEqual({ list: sidebar([...list.rooms, room("r3", "Finance")]), pending: null });
  });

  it("keeps the list it has when asking again fails", () => {
    expect(roomListReducer(roomListReducer(loaded, { type: "asked" }), { type: "unanswered" })).toEqual(loaded);
  });

  it("shows no rooms, rather than loading for good, when the first list fails to arrive", () => {
    expect(roomListReducer(NO_ROOM_LIST, { type: "unanswered" })).toEqual({ list: sidebar([]), pending: null });
  });
});

describe(feature("rooms.members"), () => {
  it("takes a room that's gone for this person out of the list, even one the list hadn't arrived with yet", () => {
    const list = sidebar([room("r1", "Design"), room("r2", "general")]);
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list });
    expect(roomListReducer(loaded, { type: "gone", roomId: "r1" }).list!.rooms).toEqual([room("r2", "general")]);
    const early = roomListReducer(NO_ROOM_LIST, { type: "gone", roomId: "r1" });
    expect(roomListReducer(early, { type: "loaded", list }).list!.rooms).toEqual([room("r2", "general")]);
  });
});

describe(feature("sidebar.unread"), () => {
  const list = sidebar([room("r1", "Design"), room("r2", "general", true)]);
  const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list });

  it("marks a room unread or read, and keeps its mark when it's saved, as a new room has none", () => {
    const marked = roomListReducer(loaded, { type: "marked", roomId: "r1", unread: true });
    expect(marked.list!.rooms).toEqual([room("r1", "Design", true), room("r2", "general", true)]);
    expect(roomListReducer(marked, { type: "marked", roomId: "r2", unread: false }).list!.rooms).toEqual([room("r1", "Design", true), room("r2", "general")]);

    const renamed: Room = { id: "r1", kind: "open", name: "Product design", icon: null };
    expect(withRoom(marked.list!.rooms, renamed)).toEqual([room("r1", "Product design", true), room("r2", "general", true)]);
    const finance: Room = { id: "r3", kind: "open", name: "Finance", icon: null };
    expect(withRoom(marked.list!.rooms, finance).at(-1)).toEqual(room("r3", "Finance"));
  });

  it("marks a room's row unread unless the tab shows the room", () => {
    expect(markedUnread(room("r1", "Design", true), null)).toBe(true);
    expect(markedUnread(room("r1", "Design", true), "r2")).toBe(true);
    expect(markedUnread(room("r1", "Design", true), "r1")).toBe(false);
    expect(markedUnread(room("r1", "Design"), null)).toBe(false);
  });

  it("keeps a mark made while a list is on its way over the one the list has", () => {
    const asked = roomListReducer(loaded, { type: "asked" });
    const read = roomListReducer(asked, { type: "marked", roomId: "r2", unread: false });
    expect(roomListReducer(read, { type: "loaded", list }).list!.rooms).toEqual([room("r1", "Design"), room("r2", "general")]);
  });
});

describe(feature("accounts.regenerate-join-link"), () => {
  const invited: Sidebar = { ...sidebar([room("r1", "All Talk")]), invitation: { roomId: "r1", joinCode: "aB3d-Ef5h-iJ7k" } };

  it("gives the welcome card the join link's new code, even over a list asked for before it was made", () => {
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: invited });
    const regenerated = roomListReducer(roomListReducer(loaded, { type: "asked" }), { type: "join code", joinCode: "Zy9x-Wv8u-Ts7r" });
    expect(regenerated.list!.invitation).toEqual({ roomId: "r1", joinCode: "Zy9x-Wv8u-Ts7r" });
    expect(roomListReducer(regenerated, { type: "loaded", list: invited }).list!.invitation).toEqual({ roomId: "r1", joinCode: "Zy9x-Wv8u-Ts7r" });
  });

  it("gives no invitation to someone the welcome card isn't for", () => {
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: sidebar([room("r2", "Design")]) });
    expect(roomListReducer(loaded, { type: "join code", joinCode: "Zy9x-Wv8u-Ts7r" }).list!.invitation).toBeNull();
  });
});

/** Four rooms, in the order they were made. */
const four = [room("r1", "Design"), room("r2", "general"), room("r3", "Ops"), room("r4", "Zebra")];

describe(feature("sidebar.room-order"), () => {
  it("lists the starred rooms first, in the order they were starred, then the rest by name", () => {
    expect(inSidebarOrder(four, ["r4", "r2"]).map((r) => r.name)).toEqual(["Zebra", "general", "Design", "Ops"]);
  });

  it("passes over stars on rooms the list hasn't got", () => {
    expect(inSidebarOrder(four, ["gone", "r3"]).map((r) => r.name)).toEqual(["Ops", "Design", "general", "Zebra"]);
  });

  it("orders names as the browser's language does, whatever their case, then by id", () => {
    const rooms = [room("r4", "zed"), room("r2", "alpha"), room("r3", "Éclair"), room("r1", "ALPHA")];
    expect(inSidebarOrder(rooms, []).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe(feature("sidebar.favorites"), () => {
  it("keeps the newest stars, from a star's answer, the socket or the list, whichever arrives last", () => {
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: sidebar(four, { rooms: ["r1"], version: 2 }) });
    const starred = roomListReducer(loaded, { type: "starred", favorites: { rooms: ["r1", "r2"], version: 3 } });
    expect(starred.list!.favorites).toEqual({ rooms: ["r1", "r2"], version: 3 });
    // The answer to the star, arriving after the socket's news of the unstar that followed it.
    expect(roomListReducer(starred, { type: "starred", favorites: { rooms: ["r1"], version: 2 } }).list).toBe(starred.list);
    expect(roomListReducer(starred, { type: "starred", favorites: { rooms: ["r2"], version: 3 } }).list).toBe(starred.list);
  });

  it("keeps stars saved while a list is on its way over the list's, unless the list's are newer", () => {
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: sidebar(four) });
    const starred = roomListReducer(roomListReducer(loaded, { type: "asked" }), { type: "starred", favorites: { rooms: ["r3"], version: 1 } });
    expect(roomListReducer(starred, { type: "loaded", list: sidebar(four) }).list!.favorites).toEqual({ rooms: ["r3"], version: 1 });
    const newer = { rooms: ["r3", "r4"], version: 2 };
    expect(roomListReducer(starred, { type: "loaded", list: sidebar(four, newer) }).list!.favorites).toEqual(newer);
  });

  it("starts with none when the first list fails to arrive, so the next star counts", () => {
    const unanswered = roomListReducer(NO_ROOM_LIST, { type: "unanswered" });
    expect(unanswered.list!.favorites).toEqual(unstarred);
    expect(roomListReducer(unanswered, { type: "starred", favorites: { rooms: ["r1"], version: 1 } }).list!.favorites.rooms).toEqual(["r1"]);
  });
});
