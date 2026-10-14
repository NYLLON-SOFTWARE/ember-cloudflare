import { feature } from "@ember/parity";
import type { RoomIconName } from "@ember/protocol";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalog from "@/components/icons/lucide/catalog.json";
import { IconPicker } from "./icon-picker";

// Part of the catalog: the icons whose names start with "a", which no popular icon's does, and a few others.
const icons = catalog.filter(({ name }) => name.startsWith("a") || ["hash", "coffee", "rocket", "gamepad", "gamepad-2", "gamepad-directional"].includes(name));

// The picker keeps each catalog it loads for the page, so every test loads its own.
let catalogUrl: string;
beforeEach(() => {
  catalogUrl = `/catalog-${crypto.randomUUID()}.json`;
});
afterEach(() => vi.restoreAllMocks());

/** Answers the catalog with `responses` in turn, then with the icons. */
function serveCatalog(...responses: Array<() => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => (responses.shift() ?? (() => Response.json(icons)))());
}

function showPicker(icon: RoomIconName | null = null, { disabled = false } = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn((event: Event) => event.preventDefault());
  render(
    <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
      <IconPicker icon={icon} onChange={onChange} disabled={disabled} catalogUrl={catalogUrl} />
    </form>,
  );
  return { onChange, onSubmit, user: userEvent.setup() };
}

const trigger = () => screen.getByRole("button", { name: "Choose room icon" });
/** The picker, open or closed: closed, it has no name to be found by. */
const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
const grid = () => within(dialog()).getByRole("group", { name: "Room icons" });
/** The icons the grid shows, by name, in order. */
const shown = () => within(grid()).queryAllByRole("button").map((button) => button.dataset.icon);
const status = () => within(dialog()).getByRole("status");
/** What the footer says Use icon would apply. */
const staged = () => dialog().querySelector("footer")!.textContent;

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  await waitFor(() => expect(within(dialog()).getByRole("group", { name: "Room icons" })).not.toHaveAttribute("aria-busy"));
}

describe(feature("rooms.icon-picker"), () => {
  it("shows the room's icon and its name on the button that opens the picker", () => {
    showPicker("coffee");
    expect(screen.getByText("Room icon")).toBeInTheDocument();
    expect(trigger()).toHaveTextContent("CoffeeChoose from Lucide icons");
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger().querySelector('[data-icon="coffee"]')).toBeInTheDocument();
    expect(screen.getByText("Shown beside this room for everyone in the workspace.")).toBeInTheDocument();
  });

  it("says Default hashtag for a room with `#`", () => {
    showPicker(null);
    expect(trigger()).toHaveTextContent("#Default hashtagChoose from Lucide icons");
  });

  it("opens on every icon, the popular ones first, with the room's icon picked and the search box focused", async () => {
    const fetch = serveCatalog();
    const { user } = showPicker("rocket");
    await user.click(trigger());
    expect(screen.getByRole("dialog", { name: "Choose a room icon" })).toHaveAttribute("open");
    expect(within(dialog()).getByRole("searchbox", { name: "Search icons" })).toHaveFocus();
    await waitFor(() => expect(status()).toHaveTextContent(`${icons.length} icons · 72 shown`));
    expect(fetch).toHaveBeenCalledWith(catalogUrl, { credentials: "same-origin" });
    expect(shown().slice(0, 5)).toEqual(["hash", "coffee", "rocket", "gamepad-2", "a-arrow-down"]);
    expect(within(grid()).getByRole("button", { name: "Use Rocket icon", pressed: true })).toHaveAttribute("tabindex", "0");
    expect(within(grid()).getByRole("button", { name: "Use Hash icon" })).toHaveAttribute("tabindex", "-1");
    expect(staged()).toContain("Rocket");
  });

  it("says it's loading until the icons come", async () => {
    let answer = (_: Response) => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { user } = showPicker();
    await user.click(trigger());
    expect(status()).toHaveTextContent("Loading icons…");
    expect(grid()).toHaveAttribute("aria-busy", "true");
    await act(async () => answer(Response.json(icons)));
    expect(status()).toHaveTextContent(`${icons.length} icons`);
  });

  it("finds the icons whose name holds every word searched for", async () => {
    serveCatalog();
    const { user } = showPicker();
    await open(user);
    const search = within(dialog()).getByRole("searchbox", { name: "Search icons" });
    await user.type(search, "gamepad 2");
    expect(shown()).toEqual(["gamepad-2"]);
    expect(status()).toHaveTextContent(/^1 icon$/);
    await user.clear(search);
    await user.type(search, "Gamepad");
    expect(shown()).toEqual(["gamepad", "gamepad-2", "gamepad-directional"]);
    await user.type(search, "zz");
    expect(shown()).toEqual([]);
    expect(status()).toHaveTextContent("No icons match your search. Try another word.");
  });

  it("opens on every icon again after a search", async () => {
    serveCatalog();
    const { user } = showPicker();
    await open(user);
    await user.type(within(dialog()).getByRole("searchbox", { name: "Search icons" }), "gamepad");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await open(user);
    expect(within(dialog()).getByRole("searchbox", { name: "Search icons" })).toHaveValue("");
    expect(status()).toHaveTextContent(`${icons.length} icons · 72 shown`);
    expect(shown().slice(0, 3)).toEqual(["hash", "coffee", "rocket"]);
  });

  it("applies the icon picked only with Use icon, and hands focus back to the button", async () => {
    serveCatalog();
    const { onChange, onSubmit, user } = showPicker("coffee");
    await open(user);
    await user.click(within(grid()).getByRole("button", { name: "Use Rocket icon" }));
    expect(within(grid()).getByRole("button", { name: "Use Rocket icon" })).toHaveAttribute("aria-pressed", "true");
    expect(staged()).toContain("Rocket");
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(dialog()).getByRole("button", { name: "Use icon" }));
    expect(onChange).toHaveBeenCalledWith("rocket");
    expect(dialog()).not.toHaveAttribute("open");
    expect(trigger()).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("goes back to `#` with Use default icon", async () => {
    serveCatalog();
    const { onChange, user } = showPicker("coffee");
    await open(user);
    const useDefault = within(dialog()).getByRole("button", { name: "Use default icon" });
    expect(useDefault).toHaveAttribute("aria-pressed", "false");
    await user.click(useDefault);
    expect(useDefault).toHaveAttribute("aria-pressed", "true");
    expect(staged()).toContain("Default hashtag");
    await user.click(within(dialog()).getByRole("button", { name: "Use icon" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it.each([
    ["Cancel", () => fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }))],
    ["Close", () => fireEvent.click(within(dialog()).getByRole("button", { name: "Close icon picker" }))],
    ["Escape", () => fireEvent(dialog(), new Event("cancel", { cancelable: true }))],
    ["a click outside it", () => fireEvent.click(dialog(), { clientX: -10, clientY: -10 })],
  ])("keeps the icon as it was with %s, and picks it again next time", async (_, close) => {
    serveCatalog();
    const { onChange, user } = showPicker("coffee");
    await open(user);
    await user.click(within(grid()).getByRole("button", { name: "Use Rocket icon" }));
    close();
    expect(dialog()).not.toHaveAttribute("open");
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();

    await open(user);
    expect(within(grid()).getByRole("button", { name: "Use Coffee icon" })).toHaveAttribute("aria-pressed", "true");
    expect(staged()).toContain("Coffee");
  });

  it("picks the first icon found with Enter, without applying it or sending the form", async () => {
    serveCatalog();
    const { onChange, onSubmit, user } = showPicker();
    await open(user);
    await user.type(within(dialog()).getByRole("searchbox", { name: "Search icons" }), "rock{Enter}");
    expect(staged()).toContain("Rocket");
    expect(dialog()).toHaveAttribute("open");
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows 72 icons at a time, and Show more icons focuses the first it adds", async () => {
    serveCatalog();
    const { user } = showPicker();
    await open(user);
    expect(shown()).toHaveLength(72);
    await user.click(within(dialog()).getByRole("button", { name: "Show more icons" }));
    expect(shown()).toHaveLength(icons.length);
    expect(status()).toHaveTextContent(new RegExp(`^${icons.length} icons$`));
    expect(within(grid()).getAllByRole("button")[72]).toHaveFocus();
    expect(within(dialog()).queryByRole("button", { name: "Show more icons" })).not.toBeInTheDocument();
  });

  it("moves through the icons with the arrow keys, a row at a time up and down, and Home and End", async () => {
    // jsdom lays nothing out, so the grid says it has 8 columns, as it does on a wide screen.
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = getComputedStyle(element, pseudo);
      if (element.getAttribute("aria-label") === "Room icons") Object.defineProperty(style, "gridTemplateColumns", { value: Array(8).fill("66px").join(" ") });
      return style;
    });
    serveCatalog();
    const { user } = showPicker();
    await open(user);
    const button = (index: number) => within(grid()).getAllByRole("button")[index]!;
    button(0).focus();
    await user.keyboard("{ArrowRight}");
    expect(button(1)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(button(9)).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(button(0)).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(button(0)).toHaveFocus();
    await user.keyboard("{End}");
    expect(button(71)).toHaveFocus();
    expect(button(71)).toHaveAttribute("tabindex", "0");
    expect(button(0)).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{Home}");
    expect(button(0)).toHaveFocus();
  });

  it("says when the icons can't load, keeping the room's icon, and tries again", async () => {
    serveCatalog(() => new Response("", { status: 500 }));
    const { onChange, user } = showPicker("coffee");
    await user.click(trigger());
    await waitFor(() => expect(status()).toHaveTextContent("Icons couldn’t load. Try again; your current icon is unchanged."));
    expect(shown()).toEqual([]);
    await user.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(shown()).toHaveLength(72));
    expect(within(dialog()).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loads the icons once for every picker on the page", async () => {
    const fetch = serveCatalog();
    const { user } = showPicker();
    await open(user);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await open(user);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("can't be opened while the form saves", () => {
    showPicker("coffee", { disabled: true });
    expect(trigger()).toBeDisabled();
  });
});
