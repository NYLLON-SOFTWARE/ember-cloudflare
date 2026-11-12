import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { opensProfile, personOfLink, type ProfilePane } from "./profile-pane";

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
