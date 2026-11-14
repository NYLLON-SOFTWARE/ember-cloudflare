import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShareWarning, type SharePlace } from "./share-warning";

const general: SharePlace = { label: "#general", direct: false };
const leadership: SharePlace = { label: "#leadership", direct: false, closed: true };

/** The warning's title and line, as screen readers read them, for `widening`. */
function warned(widening: { newViewers: number; names: string[] }, source = leadership, target = general, subject?: "file" | "message") {
  const view = render(<ShareWarning source={source} target={target} widening={{ widens: true, ...widening }} subject={subject} onShare={() => {}} onCancel={() => {}} />);
  const warning = screen.getByRole("alertdialog");
  const read = [warning.getAttribute("aria-labelledby") && document.getElementById(warning.getAttribute("aria-labelledby")!)?.textContent, screen.getByRole("alertdialog").querySelector("p")?.textContent];
  view.unmount();
  return read;
}

describe("Share warning", () => {
  it("says who'll be able to open the file, by name for up to three, as Slack does", () => {
    expect(warned({ newViewers: 1, names: ["Sam Rivera"] })).toEqual(["Share outside private leadership?", "Sam Rivera will be able to open this file in #general."]);
    expect(warned({ newViewers: 3, names: ["Ada", "Bea", "Cy"] })[1]).toBe("Ada, Bea, and Cy will be able to open this file in #general.");
    expect(warned({ newViewers: 5, names: ["Ada", "Bea", "Cy"] })[1]).toBe("5 people in #general aren’t in private leadership and will be able to open this file.");
    expect(warned({ newViewers: 1, names: ["Sam"] }, leadership, general, "message")[1]).toBe("Sam will be able to see this message in #general.");
  });

  it("names a private room after a lock, and a DM by its people", () => {
    render(<ShareWarning source={leadership} target={general} widening={{ widens: true, newViewers: 1, names: ["Sam"] }} onShare={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("alertdialog", { name: /^Share outside .*leadership\?$/ }).querySelector("h2 svg")).toBeInTheDocument();
    cleanup();
    expect(warned({ newViewers: 4, names: [] }, { label: "Grace", direct: true }, { label: "Grace and Linus", direct: true })).toEqual([
      "Share outside your DM with Grace?",
      "4 people in your DM with Grace and Linus aren’t in your DM with Grace and will be able to open this file.",
    ]);
  });

  it("asks with Cancel, which has focus, and the button that goes ahead, and nothing else", async () => {
    const [onShare, onCancel] = [vi.fn(), vi.fn()];
    render(<ShareWarning source={general} target={general} widening={{ widens: true, newViewers: 1, names: ["Sam"] }} confirm="Attach" onShare={onShare} onCancel={onCancel} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/^Share outside #general\?Sam will be able to open this file in #general\.CancelAttach$/);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    expect(onShare).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
