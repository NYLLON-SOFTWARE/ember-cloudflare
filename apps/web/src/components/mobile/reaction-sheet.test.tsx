import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactionSheet } from "./reaction-sheet";

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Add reaction's sheet", () => {
  it("fits its rows of 44px emoji to the width inside the sheet's safe areas, above the on-screen keyboard", () => {
    // A landscape phone: the screen's 844px less the 32px of gutters would hold 18, but the sheet stops at
    // 560px, and its sides grow past their 8px with the safe areas, leaving its rows 424px.
    vi.stubGlobal("innerWidth", 844);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "Emoji" ? 424 : 0;
    });
    render(<ReactionSheet open onOpenChange={() => {}} onReact={() => {}} onNewBoost={() => {}} />);
    const rows = screen.getByRole("group", { name: "Emoji" });
    expect(rows.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe("repeat(9, 1fr)");
    expect(rows.parentElement).toHaveClass("h-[min(22rem,calc(100dvh-var(--keyboard-inset,0px)-10rem))]");
  });
});
