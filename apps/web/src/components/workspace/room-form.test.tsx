import { feature } from "@ember/parity";
import { MAX_ROOM_NAME_LENGTH, type User } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { CheckMark, RoomForm } from "./room-form";

const people = (count: number): User[] => Array.from({ length: count }, (_, i) => ({ id: `u${i}`, name: `Person ${i}` }));
const grace = { id: "grace", name: "Grace Hopper" };

function renderForm(props: Partial<ComponentProps<typeof RoomForm<User>>> = {}) {
  const onSave = vi.fn();
  render(
    <RoomForm
      canAdminister
      name="Design"
      onNameChange={vi.fn()}
      everyone={null}
      groups={[people(3)]}
      mark={() => <CheckMark />}
      saving={false}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

/** The names listed, in order, not counting the avatars' initials. */
const names = () => screen.queryAllByRole("listitem").map((row) => row.querySelector("strong")!.textContent);

describe(feature("rooms.create-open"), () => {
  it("asks for the room's name, focused, and saves with Enter", async () => {
    const onNameChange = vi.fn();
    const { onSave, user } = renderForm({ onNameChange });
    const name = screen.getByRole("textbox", { name: "Room name" });
    expect(name).toHaveValue("Design");
    expect(name).toHaveFocus();
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("placeholder", "Name the room");
    expect(name).toHaveAttribute("maxlength", String(MAX_ROOM_NAME_LENGTH));
    await user.type(name, "s");
    expect(onNameChange).toHaveBeenLastCalledWith("Designs");
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("lists the people with what follows each name", () => {
    renderForm({ mark: (person) => person.id === "u1" && <span>marked</span> });
    expect(names()).toEqual(["Person 0", "Person 1", "Person 2"]);
    expect(screen.getByText("marked").closest("li")).toHaveTextContent("Person 1");
  });

  it("has a switch on the Everyone row when it can flip, named for what it would do", async () => {
    const onFlip = vi.fn();
    const { user } = renderForm({ everyone: { on: true, onFlip } });
    expect(names()[0]).toBe("Everyone");
    const everyone = screen.getByRole("switch", { name: "Give only some access to this room" });
    expect(everyone).toBeChecked();
    await user.click(everyone);
    expect(onFlip).toHaveBeenCalledOnce();
  });

  it("leaves the switch off the Everyone row when it can't flip", () => {
    renderForm({ everyone: { on: true } });
    expect(names()[0]).toBe("Everyone");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("disables Save while saving", () => {
    renderForm({ saving: true });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe(feature("rooms.create-closed"), () => {
  it("names the Everyone switch for opening the room when it's off", () => {
    renderForm({ everyone: { on: false, onFlip: vi.fn() } });
    expect(screen.getByRole("switch", { name: "Give everyone access to this room" })).not.toBeChecked();
  });

  it("lists each group by itself, with a line between", () => {
    renderForm({ groups: [[grace], [], people(2)] });
    expect(names()).toEqual(["Grace Hopper", "Person 0", "Person 1"]);
    // One line between the two groups that have anyone in them.
    expect(screen.getByRole("list").querySelectorAll(":scope > hr")).toHaveLength(1);
  });
});

describe(feature("rooms.settings-page"), () => {
  it("shows people who can't change the room its name as a heading, with no Save", () => {
    renderForm({ canAdminister: false, mark: () => null });
    expect(screen.getByRole("heading", { level: 2, name: "Design" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("filters a list of more than 20 people, by any part of their names whatever its case, once typing stops", async () => {
    const { user } = renderForm({ groups: [[grace], people(20)] });
    const filter = screen.getByRole("searchbox");
    expect(filter).toHaveAttribute("placeholder", "Filter…");
    await user.type(filter, "HOP");
    // Not yet: the filter waits for typing to stop.
    expect(names()).toHaveLength(21);
    await waitFor(() => expect(names()).toEqual(["Grace Hopper"]));
    await user.clear(filter);
    await waitFor(() => expect(names()).toHaveLength(21));
  });

  it("has no filter for 20 people or fewer", () => {
    renderForm({ groups: [people(20)] });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("doesn't save the form from the filter", async () => {
    const { onSave, user } = renderForm({ groups: [people(21)] });
    await user.type(screen.getByRole("searchbox"), "Person{Enter}");
    expect(onSave).not.toHaveBeenCalled();
    expect(within(screen.getByRole("list")).getByRole("searchbox")).toBeInTheDocument();
  });
});
