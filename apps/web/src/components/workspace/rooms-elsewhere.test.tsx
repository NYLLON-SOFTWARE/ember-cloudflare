import { ROOMS_ELSEWHERE_PATH, type SharedRoom } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerConfirm } from "@/test-confirm";
import { RoomsElsewhere } from "./rooms-elsewhere";

const stuck: SharedRoom = { id: "stuck", kind: "closed", name: "Stuck", icon: null };
const sales: SharedRoom = { id: "sales", kind: "closed", name: "Sales", icon: null, parent: { id: "strata", name: "Strata" } };

/** Answers the rooms the administrator isn't in, `rooms`, and each deletion as `deleted` says. */
function serve(rooms: SharedRoom[], deleted = 204) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") return deleted === 204 ? new Response(null, { status: 204 }) : Response.json({ error: "Nope" }, { status: deleted });
    expect(input).toBe(ROOMS_ELSEWHERE_PATH);
    return Response.json({ rooms });
  });
}

const deletions = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE").map(([input]) => input);

afterEach(() => vi.restoreAllMocks());

describe("Rooms you're not in", () => {
  it("lists them for an administrator, a sub-room with its parent, and deletes one once they confirm", async () => {
    serve([stuck, sales]);
    const user = userEvent.setup();
    render(<RoomsElsewhere onFailed={vi.fn()} />);
    const list = await screen.findByRole("region", { name: "Rooms you’re not in" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Stuck", "Strata – Sales"]);

    await user.click(within(list).getByRole("button", { name: "Delete Stuck" }));
    await answerConfirm(user, "Delete Stuck", "Cancel");
    expect(deletions()).toEqual([]);

    await user.click(within(list).getByRole("button", { name: "Delete Stuck" }));
    await answerConfirm(user, "Delete Stuck", "Delete");
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(deletions()).toEqual(["/api/rooms/stuck"]);
  });

  it("shows nothing while there are none", async () => {
    serve([]);
    render(<RoomsElsewhere onFailed={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("says why a deletion failed, keeping the room listed", async () => {
    serve([stuck], 500);
    const onFailed = vi.fn();
    const user = userEvent.setup();
    render(<RoomsElsewhere onFailed={onFailed} />);
    await user.click(await screen.findByRole("button", { name: "Delete Stuck" }));
    await answerConfirm(user, "Delete Stuck", "Delete");
    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Delete Stuck" })).toBeEnabled();
  });
});
