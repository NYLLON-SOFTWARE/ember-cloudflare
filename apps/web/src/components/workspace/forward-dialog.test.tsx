import type { Room } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { matching, threadOfLink, type Destination } from "./forward-dialog";

const portside: Room = { id: "portside", kind: "open", name: "Portside", icon: null };
const general: Room = { id: "general", kind: "open", name: "general", icon: null };
const rooms = [portside, general];

describe("Forward message's destinations", () => {
  const destinations: Destination[] = [portside, general].map((room) => ({ room, name: `#${room.name}` }));

  it("finds conversations by any part of their name, ignoring case and a leading #", () => {
    expect(matching(destinations, "PORT").map(({ room }) => room.id)).toEqual(["portside"]);
    expect(matching(destinations, "#gen").map(({ room }) => room.id)).toEqual(["general"]);
    expect(matching(destinations, "  ")).toEqual(destinations);
  });

  it("takes a pasted link to a message, or a reply, in a conversation you're in as its thread", () => {
    expect(threadOfLink(`${location.origin}/rooms/portside/@m1`, rooms)).toEqual({ room: portside, parentId: "m1" });
    expect(threadOfLink(`${location.origin}/rooms/portside/threads/p1/@r1`, rooms)).toEqual({ room: portside, parentId: "p1" });
    expect(threadOfLink(`${location.origin}/rooms/secret/@m1`, rooms)).toBeNull();
    expect(threadOfLink(`${location.origin}/rooms/portside`, rooms)).toBeNull();
    expect(threadOfLink("portside", rooms)).toBeNull();
    expect(threadOfLink("https://elsewhere.example/rooms/portside/@m1", rooms)).toBeNull();
  });
});
