import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ONE_PANE, SplitPanes, usePaneStack, type Pane } from "./split-panes";

/** The row's width, as jsdom lays nothing out. */
let rowWidth = 1001;

beforeEach(() => {
  rowWidth = 1001;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => rowWidth);
});

const pane = (id: string, minWidth: number, defaultShare: number): Pane => ({ id, label: `Resize ${id}`, minWidth, defaultShare, content: <p>{id}</p> });
const flexOf = (text: string) => Number.parseFloat(screen.getByText(text).parentElement!.style.flex);

describe("SplitPanes", () => {
  it("shares the row as its panes start, with a separator between each two", () => {
    render(<SplitPanes layoutKey="test" panes={[pane("feed", 300, 0.4), pane("room", 300, 0.6)]} />);
    expect(flexOf("feed")).toBeCloseTo(0.4);
    expect(flexOf("room")).toBeCloseTo(0.6);
    const separator = screen.getByRole("separator", { name: "Resize room" });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "400");
    expect(separator).toHaveAttribute("aria-valuemin", "300");
  });

  it("moves with the arrow keys, Shift for bigger steps, and remembers the widths for the layout", async () => {
    const { unmount } = render(<SplitPanes layoutKey="keys" panes={[pane("feed", 300, 0.5), pane("room", 300, 0.5)]} />);
    const separator = screen.getByRole("separator");
    separator.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(flexOf("feed")).toBeCloseTo(0.516);
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(flexOf("feed")).toBeCloseTo(0.452);
    await userEvent.keyboard("{Home}");
    expect(flexOf("feed")).toBeCloseTo(0.3);
    unmount();

    render(<SplitPanes layoutKey="keys" panes={[pane("feed", 300, 0.5), pane("room", 300, 0.5)]} />);
    expect(flexOf("feed")).toBeCloseTo(0.3);
    // Three panes are another layout.
    render(<SplitPanes layoutKey="keys" panes={[pane("a", 100, 1), pane("b", 100, 1), pane("c", 100, 1)]} />);
    expect(flexOf("a")).toBeCloseTo(1 / 3);
  });

  it("sizes the pane after it where that pane says so, as a thread's beside a conversation, Home and End going as far as it goes", async () => {
    const panes = [pane("feed", 200, 0.3), pane("room", 300, 0.4), { ...pane("thread", 250, 0.3), sizedBySeparator: true }];
    rowWidth = 1002;
    render(<SplitPanes layoutKey="side" panes={panes} />);
    const separator = screen.getByRole("separator", { name: "Resize thread" });
    // The row's 1000px between its two separators: the thread's 300, room and thread 700 between them.
    expect(separator).toHaveAttribute("aria-valuenow", "300");
    expect(separator).toHaveAttribute("aria-valuemin", "250");
    expect(separator).toHaveAttribute("aria-valuemax", "400");
    separator.focus();
    await userEvent.keyboard("{Home}");
    expect(separator).toHaveAttribute("aria-valuenow", "250");
    await userEvent.keyboard("{End}");
    expect(separator).toHaveAttribute("aria-valuenow", "400");
    expect(flexOf("room")).toBeCloseTo(0.3);
    // The keys move the line: Left widens the pane after it.
    await userEvent.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "384");
  });

  it("keeps a pane's own width, as resized, as panes beside it open and close, the others sharing what's left", async () => {
    const feed: Pane = { ...pane("feed", 300, 0.5), width: 400 };
    const thread: Pane = { ...pane("thread", 250, 0.3), width: 300, widthKey: "side", sizedBySeparator: true };
    const { rerender } = render(<SplitPanes layoutKey="kept" panes={[feed, pane("room", 300, 0.5)]} />);
    expect(flexOf("feed")).toBeCloseTo(0.4);
    screen.getByRole("separator", { name: "Resize room" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(flexOf("feed")).toBeCloseTo(0.416);

    rerender(<SplitPanes layoutKey="kept" panes={[feed, pane("room", 250, 0.5), thread]} />);
    expect(flexOf("feed")).toBeCloseTo(0.416);
    expect(flexOf("thread")).toBeCloseTo(0.3);
    expect(flexOf("room")).toBeCloseTo(0.284);
  });

  it("follows a pointer dragging it", () => {
    render(<SplitPanes layoutKey="drag" panes={[pane("feed", 300, 0.5), pane("room", 300, 0.5)]} />);
    const separator = screen.getByRole("separator");
    separator.setPointerCapture = () => {};
    fireEvent.pointerDown(separator, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(flexOf("feed")).toBeCloseTo(0.6);
    // Released, it stays put.
    fireEvent.pointerMove(separator, { clientX: 700, pointerId: 1 });
    expect(flexOf("feed")).toBeCloseTo(0.6);
  });

  it("hides the first panes, keeping them, where the row's too narrow for them all", () => {
    rowWidth = 700;
    const collapsed = vi.fn();
    render(<SplitPanes layoutKey="narrow" panes={[pane("feed", 320, 1), pane("room", 380, 1), pane("thread", 300, 1)]} onCollapsed={collapsed} />);
    expect(screen.getByText("feed").parentElement).not.toBeVisible();
    expect(screen.getByText("room")).toBeVisible();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(collapsed).toHaveBeenLastCalledWith(1);
  });

  it("shows only the deepest pane on phones, and says which are open, with what closes the deepest", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === ONE_PANE, media, addEventListener() {}, removeEventListener() {} }));
    const layout = vi.fn();
    const closeThread = vi.fn();
    function Back() {
      const stack = usePaneStack();
      return <button onClick={stack?.back ?? undefined}>Back</button>;
    }
    const panes = [pane("feed", 320, 1), pane("room", 380, 1), { ...pane("thread", 300, 1), onClose: closeThread, content: <Back /> }];
    render(<SplitPanes layoutKey="phone" panes={panes} onLayout={layout} />);
    expect(screen.getByText("feed").parentElement).not.toBeVisible();
    expect(screen.getByText("room").parentElement).not.toBeVisible();
    expect(screen.queryAllByRole("separator")).toEqual([]);
    expect(layout).toHaveBeenLastCalledWith({ open: ["feed", "room", "thread"], shown: ["thread"], back: closeThread });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(closeThread).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
