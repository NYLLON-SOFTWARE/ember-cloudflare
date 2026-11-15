import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PHONE_LAYOUT } from "@/hooks/use-phone-layout";
import { EmojiButton } from "./workspace/composer-menus";
import { EmojiPicker } from "./emoji-picker";

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

function showPicker() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const view = render(<EmojiPicker onPick={onPick} onClose={onClose} />);
  return { onPick, onClose, view, user: userEvent.setup() };
}

const searchBox = () => screen.getByLabelText("Search emoji");
const grid = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Emoji"]')!;
// By selector rather than role: working out the role and name of each of some 1,900 emoji is slow.
const buttonsIn = (element: HTMLElement) => [...element.querySelectorAll<HTMLButtonElement>("button")];
/** The emoji a section shows, in order. */
const emojiIn = (name: string) => buttonsIn(screen.getByText(name).parentElement!).map((button) => button.textContent);
/** Every emoji shown, in order. */
const shown = () => buttonsIn(grid()).map((button) => button.textContent);
const emoji = (text: string) => buttonsIn(grid()).find((button) => button.textContent === text)!;

describe("Emoji picker", () => {
  it("opens on the search, the reactions as the emoji used most, then every category", () => {
    showPicker();
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveAttribute("type", "search");
    expect(searchBox()).toHaveAttribute("placeholder", "Search emoji");
    // The browser's own clear button stays hidden.
    expect(searchBox()).toHaveClass("[&::-webkit-search-cancel-button]:appearance-none");
    expect(emojiIn("Frequently used")).toEqual(["👍", "👏", "👋", "💪", "❤️", "😂", "🎉", "🔥"]);
    expect(screen.getByRole("group", { name: "Smileys & People" })).toBeInTheDocument();
    expect([...grid().querySelectorAll('[role="group"]')].map((group) => document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Frequently used",
      "Smileys & People",
      "Animals & Nature",
      "Food & Drink",
      "Activities",
      "Travel & Places",
      "Objects",
      "Symbols",
      "Flags",
    ]);
    expect(emojiIn("Smileys & People").slice(0, 3)).toEqual(["😀", "😃", "😄"]);
    expect(emoji("🎉")).toHaveAttribute("title", ":tada:");
  });

  it("finds emoji by their short names, the name itself first, then those starting with it, then a word of theirs", async () => {
    const { user } = showPicker();
    await user.type(searchBox(), "tada");
    expect(shown()).toEqual(["🎉"]);
    expect(screen.queryByText("Frequently used")).not.toBeInTheDocument();

    await user.clear(searchBox());
    await user.type(searchBox(), "thumbs");
    expect(shown().slice(0, 2)).toEqual(["👍", "👎"]);

    // As a shortcode is written, and with spaces for its underscores.
    await user.clear(searchBox());
    await user.type(searchBox(), ":+1:");
    expect(shown()[0]).toBe("👍");
    await user.clear(searchBox());
    await user.type(searchBox(), "Slightly smiling");
    expect(shown()).toEqual(["🙂"]);

    await user.clear(searchBox());
    await user.type(searchBox(), "zzzzz");
    expect(shown()).toEqual([]);
    expect(screen.getByText("No emoji match")).toBeInTheDocument();

    await user.clear(searchBox());
    expect(emojiIn("Frequently used")[0]).toBe("👍");
  });

  it("picks an emoji, which comes first among those used most, here and next time", async () => {
    const { onPick, user, view } = showPicker();
    await user.type(searchBox(), "fox_face");
    await user.click(emoji("🦊"));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("🦊");
    view.unmount();

    const next = showPicker();
    expect(emojiIn("Frequently used")).toEqual(["🦊", "👍", "👏", "👋", "💪", "❤️", "😂", "🎉", "🔥"]);
    // Used twice, the party popper goes ahead of the fox, used once.
    await next.user.click(emoji("🎉"));
    await next.user.click(emoji("🎉"));
    expect(emojiIn("Frequently used").slice(0, 3)).toEqual(["🎉", "🦊", "👍"]);
  });

  it("starts with the reactions where storage can't be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is off");
    });
    const { onPick } = showPicker();
    expect(emojiIn("Frequently used")[0]).toBe("👍");
    emoji("🔥").click();
    expect(onPick).toHaveBeenCalledWith("🔥");
  });

  it("moves through the rows with the arrows, from the search and back, and picks on Enter", async () => {
    const { onPick, user } = showPicker();
    await user.keyboard("{ArrowDown}");
    expect(emoji("👍")).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(emoji("👋")).toHaveFocus();
    // From the reactions' row to the third smiley, below the waving hand.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("😄");
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(emoji("👏")).toHaveFocus();
    // Tab leaves the grid, and comes back to the emoji it left, after the categories' one stop.
    await user.keyboard("{ArrowUp}");
    expect(searchBox()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Smileys & People" })).toHaveFocus();
    await user.tab();
    expect(emoji("👏")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledExactlyOnceWith("👏");
  });

  it("moves right from a category's last emoji to the next's first, and left back", async () => {
    const { user } = showPicker();
    await user.keyboard("{ArrowDown}");
    for (let step = 0; step < 7; step++) await user.keyboard("{ArrowRight}");
    expect(emoji("🔥")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(emojiIn("Smileys & People")[0]).toBe(document.activeElement?.textContent);
    await user.keyboard("{ArrowLeft}");
    expect(emoji("🔥")).toHaveFocus();
  });

  it("sends what's typed on an emoji to the search, and picks the first match on Enter there", async () => {
    const { onPick, user } = showPicker();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("ta");
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("ta");
    await user.keyboard("da{Enter}");
    expect(onPick).toHaveBeenCalledExactlyOnceWith("🎉");
  });

  it("keeps the width of its rows whatever a search finds", async () => {
    const { user } = showPicker();
    const rows = grid().firstElementChild as HTMLElement;
    expect(rows).toHaveClass("min-w-[calc(var(--columns)*2.25rem)]", "touch:min-w-[calc(var(--columns)*2.75rem)]");
    expect(rows.style.getPropertyValue("--columns")).toBe("8");
    await user.type(searchBox(), "zzzzz");
    expect(grid().firstElementChild).toBe(rows);
  });

  it("fits as many 44px emoji to a row as its rows' width holds, less their padding, in a sheet, as the screen turns", () => {
    // A landscape phone's sheet, whose sides the safe areas widen past what the screen's width says.
    const width = { rows: 440 };
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "Emoji" ? width.rows : 0;
    });
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<EmojiPicker columns={12} fit onPick={() => {}} />);
    grid().style.padding = "0 8px";
    const columns = () => grid().querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns;
    // Measured before the padding was set, as jsdom has no style sheet: 440px holds 10.
    expect(columns()).toBe("repeat(10, 1fr)");
    expect((grid().firstElementChild as HTMLElement).style.getPropertyValue("--columns")).toBe("10");

    width.rows = 320;
    act(() => resized());
    // 320px less 16px of padding holds 6, as a 320px phone's sheet does.
    expect(columns()).toBe("repeat(6, 1fr)");
  });

  it("keeps the columns it's given where it isn't asked to fit them", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    render(<EmojiPicker columns={12} onPick={() => {}} />);
    expect(grid().querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe("repeat(12, 1fr)");
  });

  it("jumps to a category from its first emoji, out of a search, and Tab then reaches the category's first", async () => {
    const { user } = showPicker();
    const categories = screen.getByRole("toolbar", { name: "Categories" });
    expect(buttonsIn(categories).map((button) => [button.getAttribute("aria-label"), button.textContent])).toEqual([
      ["Smileys & People", "😀"],
      ["Animals & Nature", "🐵"],
      ["Food & Drink", "🍇"],
      ["Activities", "🎃"],
      ["Travel & Places", "🌍"],
      ["Objects", "👓"],
      ["Symbols", "🏧"],
      ["Flags", "🏁"],
    ]);
    await user.type(searchBox(), "tada");
    await user.click(within(categories).getByRole("button", { name: "Flags" }));
    expect(searchBox()).toHaveValue("");
    expect(emojiIn("Frequently used")[0]).toBe("👍");
    await user.tab();
    expect(document.activeElement?.textContent).toBe("🏁");

    // From the keyboard: one stop for the categories, which the arrows move between.
    await user.click(searchBox());
    await user.tab();
    expect(within(categories).getByRole("button", { name: "Flags" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowRight}");
    expect(within(categories).getByRole("button", { name: "Animals & Nature" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(document.activeElement?.textContent).toBe("🐵");
  });

  it("closes on Escape", async () => {
    const { onClose, user } = showPicker();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Emoji button", () => {
  // The picker loads with the pages few visits need, which take a while to import in a test.
  beforeAll(() => import("./workspace/pages"), 120_000);

  /** A phone `width` wide, whose layout the page uses. */
  const phone = (width: number) => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === PHONE_LAYOUT, media, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("innerWidth", width);
  };

  it("opens the picker, writes the emoji picked, and gives the text its focus back", async () => {
    const onPick = vi.fn();
    const onReturnFocus = vi.fn();
    const user = userEvent.setup();
    render(<EmojiButton onPick={onPick} onReturnFocus={onReturnFocus} />);
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Search emoji" })).toHaveFocus());
    await user.keyboard("tada{Enter}");
    expect(onPick).toHaveBeenCalledExactlyOnceWith("🎉");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(onReturnFocus).toHaveBeenCalled();
  });

  it("opens a sheet on phones, as many 44px emoji to a row as fit within its gutters, keeping the keyboard down", async () => {
    phone(320);
    const onPick = vi.fn();
    const onReturnFocus = vi.fn();
    const user = userEvent.setup();
    render(<EmojiButton onPick={onPick} onReturnFocus={onReturnFocus} />);
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    const sheet = await screen.findByRole("dialog", { name: "Emoji" });
    await waitFor(() => expect(within(sheet).getByLabelText("Search emoji")).toBeInTheDocument());
    expect(sheet).toHaveFocus();
    // It sits on the on-screen keyboard, which iOS lays over the page, as tall as the room above it allows.
    expect(sheet).toHaveClass("bottom-[var(--keyboard-inset,0px)]", "w-full", "px-2");
    expect(grid().parentElement).toHaveClass("h-[min(22rem,calc(100dvh-var(--keyboard-inset,0px)-4rem))]");
    expect(grid().querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe("repeat(6, 1fr)");
    await user.click(emoji("🎉"));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("🎉");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onReturnFocus).toHaveBeenCalled();

    vi.stubGlobal("innerWidth", 375);
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    await waitFor(() => expect(grid().querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe("repeat(7, 1fr)"));
  });
});
