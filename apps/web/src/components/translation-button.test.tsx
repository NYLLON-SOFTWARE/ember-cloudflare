import { feature } from "@ember/parity";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@ember/protocol";
import { AccountContext } from "@/hooks/use-account";
import { TRANSLATIONS } from "@/lib/translations";
import { TranslationButton } from "./translation-button";

/** A workspace whose administrator has shown translation buttons. */
const shown: Account = { name: "Ember", hideTranslationButtons: false, customStyles: "" };

/** The workspace name's button, after a field, in `account`. */
function showButton(account = shown) {
  render(
    <AccountContext value={account}>
      <input aria-label="Workspace name" />
      <TranslationButton translations="account_name" />
    </AccountContext>,
  );
  return userEvent.setup();
}

const globe = () => screen.getByText("Translate").closest("summary")!;
const isOpen = () => globe().closest("details")!.open;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe(feature("accounts.translation-buttons"), () => {
  it("is left out while the workspace hides translation buttons, as it does until an administrator shows them", () => {
    showButton({ ...shown, hideTranslationButtons: true });
    expect(screen.queryByText("Translate")).not.toBeInTheDocument();
  });

  it("lists what its field asks in seven languages, each after its country's flag, under a globe", async () => {
    const user = showButton();
    expect(isOpen()).toBe(false);
    await user.click(globe());
    await waitFor(() => expect(isOpen()).toBe(true));
    const list = globe().closest("details")!.querySelector("dl")!;
    expect([...list.querySelectorAll("dt")].map((flag) => flag.textContent)).toEqual(["🇺🇸", "🇪🇸", "🇫🇷", "🇮🇳", "🇩🇪", "🇧🇷", "🇯🇵"]);
    expect([...list.querySelectorAll("dd")].map((text) => text.textContent)).toEqual(TRANSLATIONS.account_name.map(([, text]) => text));
    expect(list).toHaveTextContent("Name this account");
  });

  it("can't be reached with Tab, as ember-rust's can't", async () => {
    const user = showButton();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveFocus();
    await user.tab();
    expect(globe()).not.toHaveFocus();
    expect(globe()).toHaveAttribute("tabindex", "-1");
  });

  it("closes with Escape, or a click anywhere but in it", async () => {
    const user = showButton();
    await user.click(globe());
    await waitFor(() => expect(isOpen()).toBe(true));
    await user.keyboard("{Escape}");
    expect(isOpen()).toBe(false);

    await user.click(globe());
    await waitFor(() => expect(isOpen()).toBe(true));
    await user.click(screen.getByText("Name this account"));
    expect(isOpen()).toBe(true);
    await user.click(screen.getByRole("textbox", { name: "Workspace name" }));
    expect(isOpen()).toBe(false);
  });

  it("keeps its list to the room on its right on the screen, measured as it opens, though a phone widens the window to fit it", async () => {
    // A 320px phone whose window has grown to fit a list too wide for it, as a phone's does.
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(320);
    vi.stubGlobal("innerWidth", 401);
    const user = showButton();
    await user.click(globe());
    await waitFor(() => expect(isOpen()).toBe(true));
    const menu = globe().nextElementSibling as HTMLElement;
    expect(menu.style.getPropertyValue("--max-width")).toBe(`${320 - menu.getBoundingClientRect().left}px`);
  });
});
