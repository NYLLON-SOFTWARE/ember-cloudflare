import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAccountLogo } from "./use-account-logo";

const LOGO = "/account/logo?v=20261017120000";

/** The page's icons and Apple touch icon links, as index.html has them. */
beforeEach(() => {
  document.head.insertAdjacentHTML(
    "beforeend",
    '<link rel="icon" type="image/png" sizes="48x48" href="/logos/app-icon-48.png"><link rel="icon" type="image/svg+xml" href="/logos/app-icon.svg"><link rel="apple-touch-icon" href="/logos/apple-touch-icon.png">',
  );
});

afterEach(() => {
  for (const link of document.head.querySelectorAll("link")) link.remove();
});

const icons = () => document.head.querySelectorAll('link[rel="icon"]');
const pngIcon = () => icons()[0]!;
const svgIcon = () => icons()[1]!;
const touchIcon = () => document.head.querySelector('link[rel="apple-touch-icon"]')!;

/** Expects the page's icons to be Ember's own, as index.html has them. */
function expectEmbersIcons() {
  expect(pngIcon()).toHaveAttribute("href", "/logos/app-icon-48.png");
  expect(pngIcon()).toHaveAttribute("type", "image/png");
  expect(pngIcon()).toHaveAttribute("sizes", "48x48");
  expect(svgIcon()).toHaveAttribute("href", "/logos/app-icon.svg");
  expect(svgIcon()).toHaveAttribute("type", "image/svg+xml");
  expect(touchIcon()).toHaveAttribute("href", "/logos/apple-touch-icon.png");
}

describe("Workspace logo", () => {
  it("makes the workspace's logo each of the page's icons, its small variant, and Apple touch icon", () => {
    const { unmount } = renderHook(() => useAccountLogo(LOGO));
    for (const icon of [pngIcon(), svgIcon()]) {
      expect(icon).toHaveAttribute("href", `${LOGO}&size=small`);
      expect(icon).toHaveAttribute("type", "image/png");
      expect(icon).not.toHaveAttribute("sizes");
    }
    expect(touchIcon()).toHaveAttribute("href", LOGO);
    unmount();
    expectEmbersIcons();
  });

  it("follows the logo as it changes, keeping Ember's icons while there's none", () => {
    const { rerender, unmount } = renderHook(({ logo }) => useAccountLogo(logo), { initialProps: { logo: null as string | null } });
    expectEmbersIcons();
    rerender({ logo: LOGO });
    expect(pngIcon()).toHaveAttribute("href", `${LOGO}&size=small`);
    rerender({ logo: "/account/logo?v=20261017130000" });
    expect(pngIcon()).toHaveAttribute("href", "/account/logo?v=20261017130000&size=small");
    expect(svgIcon()).toHaveAttribute("href", "/account/logo?v=20261017130000&size=small");
    expect(touchIcon()).toHaveAttribute("href", "/account/logo?v=20261017130000");
    rerender({ logo: null });
    expectEmbersIcons();
    unmount();
  });
});

describe("Custom CSS", () => {
  it("marks the page's body account-has-logo while the workspace has a logo", () => {
    const { rerender, unmount } = renderHook(({ logo }) => useAccountLogo(logo), { initialProps: { logo: LOGO as string | null } });
    expect(document.body).toHaveClass("account-has-logo");
    rerender({ logo: null });
    expect(document.body).not.toHaveClass("account-has-logo");
    rerender({ logo: LOGO });
    unmount();
    expect(document.body).not.toHaveClass("account-has-logo");
  });
});
