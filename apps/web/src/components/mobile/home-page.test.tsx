import type { Account, DirectoryUser, LiveHuddle, Me, RoomId } from "@ember/protocol";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext } from "@/hooks/use-account";
import { DirectoryLoaded, PeopleContext } from "@/hooks/use-directory";
import { forgetSaved, heardSaved } from "@/lib/saved";
import { HomePage } from "./home-page";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const ACCOUNT = { name: "Analytical Engines", tagline: "Engines that think", logo: null, navigationIcons: {}, huddles: true } as unknown as Account;
const person = (id: string): DirectoryUser => ({ id, name: id, status: "active", role: "member" }) as unknown as DirectoryUser;

afterEach(() => {
  localStorage.clear();
  forgetSaved();
});

function renderHome({ huddles = {}, loaded = true }: { huddles?: Record<RoomId, LiveHuddle>; loaded?: boolean } = {}) {
  render(
    <AccountContext value={ACCOUNT}>
      <PeopleContext value={new Map([["u1", person("u1")], ["u2", person("u2")]])}>
        <DirectoryLoaded value={loaded}>
          {/* The layout's drawer, whose button the top bar has outside a phone. */}
          <Sheet>
            <HomePage me={ada} workspaceName={ACCOUNT.name} sidebar={<div />} huddles={huddles} newRelease={null} onNewDirect={() => {}} />
          </Sheet>
        </DirectoryLoaded>
      </PeopleContext>
    </AccountContext>,
  );
  return within(screen.getByRole("list", { name: "Shortcuts" }));
}

const cardTexts = (cards: ReturnType<typeof renderHome>) => cards.getAllByRole("listitem").map((card) => [...card.firstElementChild!.querySelectorAll("span")].map((line) => line.textContent));

describe("Home on a phone", () => {
  it("heads the page with the workspace's name alone, and your avatar", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Analytical Engines");
    expect(screen.queryByText("Engines that think")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^(Admin|Workspace)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Appearance/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "You" })).toBeInTheDocument();
  });

  it("says how much there is under a card only when there's a count to give", () => {
    const cards = renderHome();
    expect(cardTexts(cards)).toEqual([["Threads"], ["Drafts & sent"], ["People", "2 people"], ["Saved"], ["To-dos"], ["Huddles"]]);
    expect(cards.getByRole("link", { name: "Saved" }).querySelector("svg")).toHaveClass("iconoir-bookmark");
  });

  it("counts drafts, open to-dos and live huddles", () => {
    localStorage.setItem("composer-draft-u1-general", "<p>Hello</p>");
    const cards = renderHome({ huddles: { general: {} as LiveHuddle } });
    act(() => heardSaved({ marks: [], openTodos: 3 }));
    expect(cardTexts(cards)).toEqual([["Threads"], ["Drafts & sent", "1 draft"], ["People", "2 people"], ["Saved"], ["To-dos", "3 open"], ["Huddles", "1 live"]]);
    expect(cards.getByRole("link", { name: /^Huddles/ })).toHaveAttribute("href", "/rooms/general");
  });

  it("says nothing of People until the directory has loaded", () => {
    const cards = renderHome({ loaded: false });
    expect(cardTexts(cards)[2]).toEqual(["People"]);
  });
});
