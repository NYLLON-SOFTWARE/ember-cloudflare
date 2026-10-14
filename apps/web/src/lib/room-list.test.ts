import { feature } from "@ember/parity";
import type { Room } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { withRoom } from "./room-list";

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
});

describe(feature("rooms.settings-page"), () => {
  it("moves a renamed room to its new place", () => {
    const rooms = [room("r1", "Design"), room("r2", "general")];
    expect(withRoom(rooms, room("r1", "Product design"))).toEqual([room("r2", "general"), room("r1", "Product design")]);
  });
});
