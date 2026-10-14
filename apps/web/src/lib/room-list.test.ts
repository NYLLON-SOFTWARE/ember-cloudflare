import { feature } from "@ember/parity";
import type { Room, RoomList } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { NO_ROOM_LIST, roomListReducer, withRoom } from "./room-list";

const room = (id: string, name: string): Room => ({ id, kind: "open", name });

describe(feature("rooms.create-open"), () => {
  it("puts a new room in its place by name, as the server lists rooms", () => {
    const rooms = [room("r1", "Design"), room("r2", "general"), room("r3", "Zebra")];
    expect(withRoom(rooms, room("r4", "Finance")).map((r) => r.name)).toEqual(["Design", "Finance", "general", "Zebra"]);
  });

  it("orders names as SQLite's NOCASE does, folding only ASCII letters, then by id", () => {
    const rooms = [room("r2", "alpha"), room("r3", "Éclair")];
    expect(withRoom(rooms, room("r1", "ALPHA")).map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    // NOCASE leaves "É" as it is, which sorts after every ASCII letter.
    expect(withRoom(rooms, room("r4", "zed")).map((r) => r.name)).toEqual(["alpha", "zed", "Éclair"]);
  });

  it("orders names by code point, as SQLite orders UTF-8, which puts an emoji after full-width letters", () => {
    const rooms = [room("r1", "😀 Team"), room("r2", "Zebra")];
    expect(withRoom(rooms, room("r3", "Ａ Team")).map((r) => r.name)).toEqual(["Zebra", "Ａ Team", "😀 Team"]);
  });

  it("keeps a room saved before the list arrives, and adds it to the list when it does", () => {
    const list: RoomList = { rooms: [room("r2", "general")], invitation: null };
    const saved = roomListReducer(NO_ROOM_LIST, { type: "saved", room: room("r1", "Design") });
    expect(saved.list).toBeNull();
    expect(roomListReducer(saved, { type: "loaded", list })).toEqual({ list: { ...list, rooms: [room("r1", "Design"), room("r2", "general")] }, pending: [] });
  });
});

describe(feature("rooms.settings-page"), () => {
  it("moves a renamed room to its new place", () => {
    const rooms = [room("r1", "Design"), room("r2", "general")];
    expect(withRoom(rooms, room("r1", "Product design"))).toEqual([room("r2", "general"), room("r1", "Product design")]);
  });

  it("keeps a rename saved before the list arrives over the name the list has", () => {
    const list: RoomList = { rooms: [room("r1", "Design"), room("r2", "general")], invitation: null };
    const renamed = roomListReducer(NO_ROOM_LIST, { type: "saved", room: room("r1", "Product design") });
    expect(roomListReducer(renamed, { type: "loaded", list }).list!.rooms).toEqual([room("r2", "general"), room("r1", "Product design")]);
  });

  it("changes the list in place once it has arrived", () => {
    const loaded = roomListReducer(NO_ROOM_LIST, { type: "loaded", list: { rooms: [room("r1", "Design")], invitation: null } });
    expect(roomListReducer(loaded, { type: "saved", room: room("r1", "Product design") })).toEqual({
      list: { rooms: [room("r1", "Product design")], invitation: null },
      pending: [],
    });
  });
});
