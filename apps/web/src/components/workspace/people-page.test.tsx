import type { DirectoryUser } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { DirectoryLoaded, PeopleContext } from "@/hooks/use-directory";
import { PeoplePage, personMatches } from "./people-page";

const person = (id: string, name: string, changes: Partial<DirectoryUser> = {}): DirectoryUser => ({ id, name, bio: null, role: "member", status: "active", avatarUrl: `/users/${id}/avatar`, ...changes });
const people = [
  person("u2", "Grace Hopper", { bio: "Rear admiral" }),
  person("u1", "Ada Lovelace", { bio: "Analyst" }),
  person("u3", "Build Bot", { role: "bot" }),
  person("u4", "Charles Babbage", { status: "deactivated" }),
];

function showPage() {
  render(
    <PeopleContext value={new Map(people.map((p) => [p.id, p]))}>
      <DirectoryLoaded value={true}>
        <Sheet>
          <PeoplePage />
        </Sheet>
      </DirectoryLoaded>
    </PeopleContext>,
  );
}

const cards = () => within(screen.getByRole("list", { name: "People" })).getAllByRole("link");

describe("People page", () => {
  it("shows a card for each active person, by name, with their photo, name and bio, linking to their page", () => {
    showPage();
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    expect(cards().map((card) => [card.textContent, card.getAttribute("href")])).toEqual([
      ["Ada LovelaceAnalyst", "/users/u1"],
      ["Grace HopperRear admiral", "/users/u2"],
    ]);
    expect(cards()[0]!.querySelector("img")).toHaveClass("aspect-square", "w-full");
  });

  it("shows only the people whose name or bio has what's searched for", async () => {
    showPage();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search for people" }), "admiral");
    expect(cards().map((card) => card.getAttribute("href"))).toEqual(["/users/u2"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search for people" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search for people" }), "zzz");
    expect(screen.queryByRole("list", { name: "People" })).not.toBeInTheDocument();
    expect(screen.getByText("No one matches that search.")).toBeInTheDocument();
  });
});

describe("personMatches", () => {
  it("matches a name or bio, whatever the case, and everyone for nothing", () => {
    expect(personMatches({ name: "Ada", bio: null }, "ADA")).toBe(true);
    expect(personMatches({ name: "Ada", bio: "Analyst" }, "anal")).toBe(true);
    expect(personMatches({ name: "Ada", bio: null }, "grace")).toBe(false);
    expect(personMatches({ name: "Ada", bio: null }, " ")).toBe(true);
  });
});
