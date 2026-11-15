import type { SharedRoom } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SubRoomTitle } from "./sub-room-title";

describe("A sub-room's title", () => {
  it("reads Strata – Sales, its parent's name linking to the parent's room", () => {
    const sales: SharedRoom = { id: "sales", kind: "open", name: "Sales", icon: null, parent: { id: "strata", name: "Strata" } };
    render(
      <h1>
        <SubRoomTitle room={sales} />
      </h1>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Strata – Sales");
    expect(screen.getByRole("link", { name: "Strata" })).toHaveAttribute("href", "/rooms/strata");
  });

  it("is a room's own name when it isn't a sub-room", () => {
    render(
      <h1>
        <SubRoomTitle room={{ id: "general", kind: "open", name: "general", icon: null }} />
      </h1>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent(/^general$/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
