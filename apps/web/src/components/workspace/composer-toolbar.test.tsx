import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerToolbar } from "./composer-toolbar";
import { NO_FORMATS, PHONE_TOOL_GROUPS, TOOL_GROUPS } from "./formatting";

const FORMATS = NO_FORMATS;

/**
 * Lays the toolbar out `width` wide, its tools 30px apart and each group's rule 10px more, as a browser
 * would: Bold ends at 30, Paragraph style at 150, Link at 190, Bulleted list at 250, Divider at 380.
 */
function layOut(width: number) {
  const starts = new Set(TOOL_GROUPS.slice(1).map((_, index) => TOOL_GROUPS.slice(0, index + 1).flat().length));
  const ends: number[] = [];
  TOOL_GROUPS.flat().forEach((_, at) => ends.push((ends[at - 1] ?? 0) + 30 + (starts.has(at) ? 10 : 0)));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "toolbar" ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const at = this.dataset.at === undefined ? null : Number(this.dataset.at);
    const right = this.getAttribute("role") === "toolbar" ? width : at === null ? 0 : ends[at]!;
    return { left: 0, right, width: right, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  });
}

function renderToolbar(props: Partial<Parameters<typeof ComposerToolbar>[0]> = {}) {
  const onFormat = vi.fn();
  const onLinkOpenChange = vi.fn();
  render(
    <ComposerToolbar
      formats={FORMATS}
      onFormat={onFormat}
      onBlock={() => {}}
      onLink={() => {}}
      linkDraft={() => ({ text: "", url: "" })}
      linkOpen={false}
      onLinkOpenChange={onLinkOpenChange}
      onReturnFocus={() => {}}
      {...props}
    />,
  );
  return { onFormat, onLinkOpenChange };
}

const shownTools = () => [...screen.getByRole("toolbar", { name: "Formatting" }).querySelectorAll("[data-tool]")].map((tool) => tool.getAttribute("data-tool"));

describe("ComposerToolbar in a narrow pane", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows every tool, without ⋯, where they fit", () => {
    layOut(380);
    renderToolbar();
    expect(shownTools()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "More formatting" })).toBeNull();
  });

  it("folds the tools from the end into ⋯, which formats with them", async () => {
    // ⋯ takes 40px past the last tool shown: Code ends at 320, so Code block and Divider fold.
    layOut(360);
    const { onFormat } = renderToolbar({ formats: { ...FORMATS, quote: true } });
    expect(shownTools()).toEqual(["bold", "italic", "underline", "strikethrough", "block", "link", "numberedList", "bulletList", "quote", "code", "more"]);
    await userEvent.click(screen.getByRole("button", { name: "More formatting" }));
    const menu = screen.getByRole("menu", { name: "More formatting" });
    expect([...menu.querySelectorAll("[data-menu-item]")].map((item) => item.getAttribute("aria-label"))).toEqual(["Code block", "Divider"]);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Divider" }));
    expect(onFormat).toHaveBeenCalledWith("divider");
  });

  it("folds Link too where the pane is narrower still, opening the Link field from ⋯", async () => {
    layOut(220);
    const { onLinkOpenChange } = renderToolbar();
    expect(shownTools()).toEqual(["bold", "italic", "underline", "strikethrough", "block", "more"]);
    await userEvent.click(screen.getByRole("button", { name: "More formatting" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Link" }));
    expect(onLinkOpenChange).toHaveBeenCalledWith(true);
  });

  it("keeps a phone's fewer tools, which scroll, unfolded", () => {
    layOut(150);
    renderToolbar({ groups: PHONE_TOOL_GROUPS });
    expect(shownTools()).toEqual(PHONE_TOOL_GROUPS.flat().map(({ tool }) => tool));
  });
});
