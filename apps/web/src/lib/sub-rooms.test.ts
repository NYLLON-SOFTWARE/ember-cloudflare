import type { ParentChoice, SharedRoom } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { collapsedRooms, flattened, keepCollapsed, leavingFor, peopleIn, roomDisplayName, roomTree } from "./sub-rooms";

const room = (id: string, name: string, parent?: SharedRoom): SharedRoom => ({
  id,
  kind: "open",
  name,
  icon: null,
  ...(parent && { parent: { id: parent.id, name: parent.name } }),
});
const strata = room("strata", "Strata");
const [sales, titling] = [room("sales", "Sales", strata), room("titling", "Titling", strata)];
const general = room("general", "general");

describe("Sub-rooms", () => {
  it("nests each sub-room under its parent, in the order given, and leaves one whose parent isn't listed in its own place", () => {
    expect(roomTree([titling, general, strata, sales])).toEqual([
      { room: general, subRooms: [] },
      { room: strata, subRooms: [titling, sales] },
    ]);
    expect(roomTree([general, sales])).toEqual([
      { room: general, subRooms: [] },
      { room: sales, subRooms: [] },
    ]);
    expect(flattened(roomTree([titling, general, strata, sales]))).toEqual(["general", "strata", "titling", "sales"]);
  });

  it("names a sub-room on its own with its parent's name, as the rooms have it now", () => {
    expect(roomDisplayName(sales)).toBe("Strata – Sales");
    expect(roomDisplayName(sales, [{ ...strata, name: "Strata Motors" }])).toBe("Strata Motors – Sales");
    expect(roomDisplayName(general, [strata])).toBe("general");
  });

  it("offers a sub-room only its parent's people, and says who moving a room under a private parent would take out", () => {
    const people = [
      { id: "ada", name: "Ada" },
      { id: "grace", name: "Grace" },
    ];
    const closed: ParentChoice = { id: "strata", name: "Strata", icon: null, everyone: false, memberIds: ["ada"] };
    expect(peopleIn(people, closed)).toEqual([people[0]]);
    expect(peopleIn(people, { ...closed, everyone: true })).toEqual(people);
    expect(peopleIn(people, null)).toEqual(people);
    expect(leavingFor(["ada", "grace"], closed)).toEqual(["grace"]);
    expect(leavingFor(["ada", "grace"], null)).toEqual([]);
  });

  describe("collapsed parents", () => {
    beforeEach(() => localStorage.clear());

    it("remembers the parents collapsed in this browser, and forgets storage that holds anything else", () => {
      expect(collapsedRooms()).toEqual(new Set());
      keepCollapsed(new Set(["strata"]));
      expect(collapsedRooms()).toEqual(new Set(["strata"]));
      localStorage.setItem("ember:collapsed-rooms", "{not json");
      expect(collapsedRooms()).toEqual(new Set());
    });
  });
});
