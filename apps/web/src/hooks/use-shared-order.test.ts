import { describe, expect, it } from "vitest";
import { headingOf, sectionOfHeading, withSectionMoved } from "./use-shared-order";

describe("Sidebar sections in Rooms and permissions", () => {
  const [one, two, three] = ["s1", "s2", "s3"].map(headingOf);
  // A room in none, then sections one, with two rooms, two, with none, and three, with one.
  const rows = ["a", one!, "b", "c", two!, three!, "d"];

  it("moves a section's heading among the others with its rooms, wherever a drag leaves it among them", () => {
    expect(withSectionMoved(rows, ["a", "b", "c", two!, one!, three!, "d"], one!)).toEqual(["a", two, one, "b", "c", three, "d"]);
    // Dropped among its own rooms, it stays.
    expect(withSectionMoved(rows, ["a", "b", one!, "c", two!, three!, "d"], one!)).toEqual(rows);
    expect(withSectionMoved(rows, ["a", "b", "c", two!, three!, "d", one!], one!)).toEqual(["a", two, three, "d", one, "b", "c"]);
    // Never above the rooms in none.
    expect(withSectionMoved(rows, [three!, "a", one!, "b", "c", two!, "d"], three!)).toEqual(["a", three, "d", one, "b", "c", two]);
  });

  it("tells a heading's row from a room's", () => {
    expect(sectionOfHeading(headingOf("s1"))).toBe("s1");
    expect(sectionOfHeading("r1")).toBeNull();
  });
});
