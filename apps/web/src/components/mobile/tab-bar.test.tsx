import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenSearchContext } from "../workspace/search-box";
import { TabBar } from "./tab-bar";

afterEach(() => history.replaceState(null, "", "/"));

describe("Tab bar", () => {
  it("links to each tab's page, marks the one shown, and dots the ones with something waiting", () => {
    render(<TabBar current="dms" notices={{ home: "Unread rooms", activity: "2 unread" }} roomId={null} />);
    const tabs = within(screen.getByRole("navigation", { name: "Tabs" }));
    expect(tabs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Home", "/"],
      ["DMs", "/dms"],
      ["Activity", "/activity"],
      ["Files", "/files"],
      ["", "/searches"],
    ]);
    expect(tabs.getByRole("link", { name: "DMs" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(tabs.getByRole("link", { name: "Home" })).toHaveAccessibleDescription("Unread rooms");
    expect(tabs.getByRole("link", { name: "Activity" })).toHaveAccessibleDescription("2 unread");
    expect(tabs.getByRole("link", { name: "Files" })).not.toHaveAccessibleDescription();
  });

  it("goes to a tab's page in place, and opens the search box from Search, in the room shown", async () => {
    const openSearch = vi.fn();
    render(
      <OpenSearchContext value={openSearch}>
        <TabBar current="home" notices={{}} roomId="general" />
      </OpenSearchContext>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Activity" }));
    expect(location.pathname).toBe("/activity");
    await user.click(screen.getByRole("link", { name: "Search" }));
    expect(openSearch).toHaveBeenCalledWith({ opener: screen.getByRole("link", { name: "Search" }), roomId: "general" });
    expect(location.pathname).toBe("/activity");
  });

  it("makes way for the keyboard while a text field has focus, and comes back a moment after it loses it", () => {
    vi.useFakeTimers();
    render(
      <>
        <textarea aria-label="Draft" />
        <TabBar current="home" notices={{}} roomId={null} />
      </>,
    );
    const bar = screen.getByRole("navigation", { name: "Tabs" });
    expect(bar).not.toHaveAttribute("data-typing");
    act(() => screen.getByRole("textbox", { name: "Draft" }).focus());
    expect(bar).toHaveAttribute("data-typing");
    act(() => screen.getByRole("textbox", { name: "Draft" }).blur());
    expect(bar).toHaveAttribute("data-typing");
    act(() => vi.advanceTimersByTime(400));
    expect(bar).not.toHaveAttribute("data-typing");
    vi.useRealTimers();
  });
});
