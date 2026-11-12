import type { ReactNode } from "react";
import type { DirectoryUser, Me, Person, PersonAnswer, User } from "@ember/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { AccountContext, useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { PHONE_LAYOUT } from "@/hooks/use-phone-layout";
import { navigate } from "@/hooks/use-route";
import { PersonPage } from "../workspace/person-page";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const administrator: Me = { ...ada, administrator: true };
const grace: Person = {
  id: "u2",
  name: "Grace Hopper",
  bio: "Wrote the first compiler",
  role: "member",
  status: "active",
  avatarUrl: "/users/t2/avatar?v=1",
  emailAddress: "grace@example.com",
  timeZone: "America/New_York",
};
const banned: DirectoryUser = { ...grace, status: "banned" };
const TRANSFER_ID = "u2.mgk3x2a9.signature";

/** Answers the page's loads with `answer`, and a ban or its lifting with who they are then. */
function serve(answer: () => PersonAnswer, changed: () => DirectoryUser = () => banned) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) =>
    init?.method === "POST" || init?.method === "DELETE" ? Response.json({ user: changed() }) : Response.json(answer()),
  );
}

/** The account as the app has it, with huddles on or off. */
function Huddles({ on, children }: { on: boolean; children: ReactNode }) {
  return <AccountContext value={{ ...useAccount(), huddles: on }}>{children}</AccountContext>;
}

/** Someone's page on a phone, Grace's unless it's given another's id, as `me` sees it, with huddles on or off. */
function showPage({ me = ada, userId = grace.id, huddles = false }: { me?: Me; userId?: string; huddles?: boolean } = {}) {
  const onStartDirect = vi.fn<(person: User) => Promise<boolean>>(async () => true);
  render(
    <Huddles on={huddles}>
      <PeopleContext value={new Map()}>
        <Sheet>
          <PersonPage
            userId={userId}
            me={me}
            onStartDirect={onStartDirect}
            onPersonChanged={() => {}}
            reloadPeople={async () => {}}
            onMissing={() => {}}
            onFailed={() => {}}
          />
        </Sheet>
      </PeopleContext>
    </Huddles>,
  );
  return { onStartDirect, user: userEvent.setup() };
}

const heading = () => screen.findByRole("heading", { level: 1 });
const more = () => screen.getByRole("button", { name: "More actions" });
const sheet = () => within(screen.getByRole("dialog", { name: "More actions" }));
const follows = (earlier: Element, later: Element) => expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === PHONE_LAYOUT, media, addEventListener() {}, removeEventListener() {} }));
  history.replaceState(null, "", "/rooms/general");
  navigate(`/users/${grace.id}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
  document.title = "";
});

describe("Someone's profile on a phone", () => {
  it("reads as Slack's: name, then their local time, then Message and More, then the bio, then their email", async () => {
    serve(() => ({ person: grace }));
    showPage({ me: administrator });
    const name = await heading();
    expect(name).toHaveTextContent("Grace Hopper");
    const time = screen.getByText(/local time$/);
    const message = screen.getByRole("button", { name: "Message" });
    const bio = screen.getByText("Wrote the first compiler");
    const email = screen.getByRole("link", { name: "grace@example.com" });
    for (const [earlier, later] of [
      [name, time],
      [time, message],
      [message, more()],
      [more(), bio],
      [bio, email],
    ] as const)
      follows(earlier, later);
    expect(email).toHaveAttribute("href", "mailto:grace@example.com");
    expect(screen.queryByRole("button", { name: "Huddle" })).toBeNull();
  });

  it("says they're banned on the line their local time is on", async () => {
    serve(() => ({ person: banned }));
    showPage({ me: administrator });
    await heading();
    expect(screen.getByText(/local time$/).parentElement).toHaveTextContent(/^Banned · .+ local time$/);
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
  });

  it("starts the DM from Message", async () => {
    serve(() => ({ person: grace }));
    const { onStartDirect, user } = showPage();
    await heading();
    await user.click(screen.getByRole("button", { name: "Message" }));
    await waitFor(() => expect(onStartDirect).toHaveBeenCalledOnce());
  });

  it("has Huddle between Message and More while huddles are on, which says where they start", async () => {
    serve(() => ({ person: grace }));
    showPage({ huddles: true });
    await heading();
    const huddle = screen.getByRole("button", { name: "Huddle" });
    expect(huddle).toHaveAttribute("aria-disabled", "true");
    expect(huddle).toHaveAttribute("title", "Start a huddle from a room you’re both in");
    follows(screen.getByRole("button", { name: "Message" }), huddle);
    follows(huddle, more());
  });

  it("copies their member ID from More, which holds nothing else for members", async () => {
    serve(() => ({ person: grace }));
    const { user } = showPage();
    await heading();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(more());
    expect(sheet().getAllByRole("button").map((row) => row.textContent)).toEqual(["Copy member ID"]);
    await user.click(sheet().getByRole("button", { name: "Copy member ID" }));
    expect(writeText).toHaveBeenCalledWith("u2");
  });
});

describe("An administrator's view of someone's profile on a phone", () => {
  it("keeps the auto-login link and Ban out of the page, in More, with Ban in red last", async () => {
    serve(() => ({ person: grace, transferId: TRANSFER_ID }));
    const { user } = showPage({ me: administrator });
    await heading();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /ban/i })).toBeNull();

    await user.click(more());
    const rows = sheet().getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["Copy member ID", "Auto-login link", "Ban"]);
    expect(rows.at(-1)).toHaveClass("text-negative");
  });

  it("opens the auto-login link in its own sheet", async () => {
    serve(() => ({ person: grace, transferId: TRANSFER_ID }));
    const { user } = showPage({ me: administrator });
    await heading();
    await user.click(more());
    await user.click(sheet().getByRole("button", { name: "Auto-login link" }));
    const link = within(await screen.findByRole("dialog", { name: "Auto-login link" })).getByRole("textbox", { name: "Share to get them back into their account" });
    expect(link).toHaveValue(`http://localhost:3000/session/transfers#token=${TRANSFER_ID}`);
  });

  it("asks before banning, titled with what it does, and bans only once you've said Ban", async () => {
    const fetch = serve(() => ({ person: grace }));
    const { user } = showPage({ me: administrator });
    await heading();

    await user.click(more());
    await user.click(sheet().getByRole("button", { name: "Ban" }));
    let dialog = within(await screen.findByRole("alertdialog", { name: "Ban Grace Hopper" }));
    expect(dialog.getByText("This signs them out, deletes their messages and blocks their IP addresses.")).toBeVisible();
    expect(dialog.getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Ban"]);
    expect(dialog.getByRole("button", { name: "Ban" })).toHaveClass("bg-negative-button");
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fetch).toHaveBeenCalledOnce();

    await user.click(more());
    await user.click(sheet().getByRole("button", { name: "Ban" }));
    dialog = within(await screen.findByRole("alertdialog", { name: "Ban Grace Hopper" }));
    await user.click(dialog.getByRole("button", { name: "Ban" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/u2/ban", expect.objectContaining({ method: "POST" })));
  });

  it("offers Remove ban for someone banned, which asks first too", async () => {
    const fetch = serve(
      () => ({ person: banned }),
      () => grace,
    );
    const { user } = showPage({ me: administrator });
    await heading();
    await user.click(more());
    const row = sheet().getByRole("button", { name: "Remove ban" });
    expect(row).not.toHaveClass("text-negative");
    await user.click(row);
    const dialog = within(await screen.findByRole("alertdialog", { name: "Remove the ban on Grace Hopper" }));
    await user.click(dialog.getByRole("button", { name: "Remove ban" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/u2/ban", expect.objectContaining({ method: "DELETE" })));
  });

  it("has no Ban on your own page", async () => {
    serve(() => ({ person: { ...grace, id: ada.id, name: ada.name }, transferId: TRANSFER_ID }));
    const { user } = showPage({ me: administrator, userId: ada.id });
    await heading();
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
    await user.click(more());
    expect(sheet().getAllByRole("button").map((row) => row.textContent)).toEqual(["Copy member ID", "Auto-login link"]);
  });
});
