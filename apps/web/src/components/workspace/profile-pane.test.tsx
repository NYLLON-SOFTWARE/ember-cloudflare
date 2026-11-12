import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me, Person } from "@ember/protocol";
import { useShowPresence } from "@/hooks/use-shown-presence";
import { opensProfile, personOfLink, ProfilePanel, type ProfilePane } from "./profile-pane";

const linkTo = (href: string, attributes: Record<string, string> = {}) => {
  const link = document.createElement("a");
  link.href = href;
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
  return link;
};

describe("personOfLink", () => {
  it("names the person a link to someone's page is to", () => {
    expect(personOfLink(linkTo("/users/u2"))).toBe("u2");
    expect(personOfLink(linkTo("/users/a%20b"))).toBe("a b");
  });

  it("names nobody for your profile, other pages or other sites", () => {
    for (const href of ["/users/me", "/users/u2/profile", "/rooms/general", "https://example.com/users/u2"]) expect(personOfLink(linkTo(href)), href).toBeNull();
  });
});

describe("opensProfile", () => {
  const pane: ProfilePane = { userId: null, open: vi.fn(), close: vi.fn(), startDirect: vi.fn() };

  function clickIn(href: string, init: MouseEventInit = {}, paneShown: ProfilePane | null = pane) {
    vi.mocked(pane.open).mockClear();
    const onClick = vi.fn((event: React.MouseEvent) => event.defaultPrevented);
    const { unmount } = render(
      <div onClickCapture={(event) => opensProfile(paneShown, event)} onClick={onClick}>
        <a href={href} {...(href.includes("full") && { "data-full-page": "" })}>
          Grace
        </a>
      </div>,
    );
    fireEvent.click(screen.getByText("Grace"), init);
    unmount();
    return onClick.mock.results[0]?.value as boolean;
  }

  it("opens the profile in place of following a link to someone's page", () => {
    expect(clickIn("/users/u2")).toBe(true);
    expect(pane.open).toHaveBeenCalledWith("u2");
  });

  it("leaves a link opened elsewhere, the full page's link, and pages with no pane, to be followed", () => {
    expect(clickIn("/users/u2", { metaKey: true })).toBe(false);
    expect(clickIn("/users/u2?full")).toBe(false);
    expect(clickIn("/users/u2", {}, null)).toBe(false);
    expect(pane.open).not.toHaveBeenCalled();
  });
});

describe("ProfilePanel", () => {
  const me: Me = { id: "u1", name: "Ada", administrator: false };
  const grace: Person = { id: "u2", name: "Grace", bio: "Wrote the first compiler", role: "member", status: "active", avatarUrl: "/users/u2/avatar" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ person: grace })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  /** A room's page, with what it holds, and Grace's profile beside it while it's open, as a link to her page opens it. */
  function Page({ children, present = [] }: { children?: React.ReactNode; present?: Person[] }) {
    const [open, setOpen] = useState(false);
    useShowPresence(present);
    const pane: ProfilePane = { userId: open ? "u2" : null, open: () => setOpen(true), close: () => setOpen(false), startDirect: vi.fn() };
    return (
      <main tabIndex={-1} onClickCapture={(event) => opensProfile(pane, event)}>
        {children}
        <a href="/users/u2">Grace’s name</a>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        {open && <ProfilePanel userId="u2" me={me} pane={pane} placement="pane" />}
      </main>
    );
  }

  it("lines the photo up with what's under it, over a row of actions, with their full page and id in More", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    const profile = screen.getByRole("complementary", { name: "Profile" });
    expect(await within(profile).findByText("Wrote the first compiler")).toBeInTheDocument();
    expect(within(profile).getByRole("img", { name: "Grace’s photo" }).parentElement).not.toHaveClass("mx-auto");
    expect(within(profile).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["Close profile", "Message", "More actions"]);
    // Nobody's known to be here beside no room, and a profile has no link of its own to their page.
    expect(within(profile).queryByText("Active")).not.toBeInTheDocument();
    expect(within(profile).queryByRole("link")).not.toBeInTheDocument();
    expect(within(profile).queryByText("Contact information")).not.toBeInTheDocument();

    await userEvent.click(within(profile).getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy member ID" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("u2");
    await userEvent.click(within(profile).getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "View full profile" }));
    expect(location.pathname).toBe("/users/u2");
  });

  it("says they're active while they're in the room shown", async () => {
    render(<Page present={[grace]} />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(within(screen.getByRole("complementary", { name: "Profile" })).getByText("Active")).toBeInTheDocument();
  });

  it("puts focus back where it was as it opened, once it's closed", async () => {
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Close profile" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("puts focus back on the link it opened from, or on the page's content when that's gone too", async () => {
    function Dialog() {
      const [shown, setShown] = useState(true);
      return shown ? (
        <div role="dialog" onClickCapture={() => setTimeout(() => setShown(false))}>
          <a href="/users/u2">Grace in the dialog</a>
        </div>
      ) : null;
    }
    render(
      <Page>
        <Dialog />
      </Page>,
    );
    await userEvent.click(screen.getByRole("link", { name: "Grace’s name" }));
    await userEvent.click(screen.getByRole("button", { name: "Close profile" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Grace’s name" })).toHaveFocus());

    // The link was in a dialog that's closed since.
    await userEvent.click(screen.getByRole("link", { name: "Grace in the dialog" }));
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close profile" }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });
});
