import { act, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FlashProvider, useOptionalFlash } from "@/components/flash";
import { flashNotLoaded, NOT_LOADED, RELOAD_TO_LOAD, retryingImport, useOpenedRarePage, useRetryingLoad } from "./rare-pages";

let fail: () => void = () => {};

/** A sheet that loads with the pages, as the phone's sheets do: in the page once opened, until it can't load. */
function Sheet() {
  const [open, setOpen] = useState(false);
  const [opened, failed] = useOpenedRarePage(open, () => setOpen(false));
  fail = failed;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <p>{`${open ? "open" : "shut"}, ${opened ? "in the page" : "not in the page"}`}</p>
    </>
  );
}

describe("What loads with the pages", () => {
  it("stays in the page once opened, until the pages don't load, when it closes and says so, so opening it again tries again", () => {
    render(
      <FlashProvider>
        <Sheet />
      </FlashProvider>,
    );
    expect(screen.getByText("shut, not in the page")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Open" }).click());
    expect(screen.getByText("open, in the page")).toBeInTheDocument();

    act(() => fail());
    expect(screen.getByText("shut, not in the page")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(NOT_LOADED);

    act(() => screen.getByRole("button", { name: "Open" }).click());
    expect(screen.getByText("open, in the page")).toBeInTheDocument();
  });
});

describe("Loading the pages again after they failed to load", () => {
  const chromium = (address: string) => new TypeError(`Failed to fetch dynamically imported module: ${address}`);

  it("asks for the module at an address of its own, as the browser keeps the failed one failed, until it loads", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(chromium("https://ember.test/assets/pages-a1.js"));
    const loadAt = vi.fn<(address: string) => Promise<string>>().mockRejectedValueOnce(chromium("https://ember.test/assets/pages-a1.js?retry=1")).mockResolvedValue("pages");
    const reload = vi.fn();
    const importPages = retryingImport(load, loadAt, reload);

    await expect(importPages()).rejects.toThrow();
    await expect(importPages()).rejects.toThrow();
    await expect(importPages()).resolves.toBe("pages");
    expect(load).toHaveBeenCalledOnce();
    expect(loadAt.mock.calls).toEqual([["https://ember.test/assets/pages-a1.js?retry=1"], ["https://ember.test/assets/pages-a1.js?retry=2"]]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("asks for the module again where the browser didn't say which failed, and says it's stuck should that fail too, as in WebKit", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new TypeError("Importing a module script failed."));
    const loadAt = vi.fn<(address: string) => Promise<string>>();
    const stuck = vi.fn();
    const importPages = retryingImport(load, loadAt, stuck);

    await expect(importPages()).rejects.toThrow();
    expect(stuck).not.toHaveBeenCalled();
    await expect(importPages()).rejects.toThrow();
    expect(stuck).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
    expect(loadAt).not.toHaveBeenCalled();
  });

  it("loads the module where asking again works, without being stuck", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new TypeError("Importing a module script failed.")).mockResolvedValue("pages");
    const stuck = vi.fn();
    const importPages = retryingImport(load, vi.fn(), stuck);

    await expect(importPages()).rejects.toThrow();
    await expect(importPages()).resolves.toBe("pages");
    expect(stuck).not.toHaveBeenCalled();
  });
});

describe("Saying what was opened couldn't load", () => {
  it("says Ember can't be reached, without offering to load the page again, where the browser isn't stuck on the failure", () => {
    const flash = vi.fn();
    flashNotLoaded(flash);
    expect(flash).toHaveBeenCalledWith("alert", NOT_LOADED);
  });
});

describe("A flash that offers to do something", () => {
  it("stays until it's done or dismissed, with its action and Dismiss", async () => {
    const reload = vi.fn();
    function Offer() {
      const flash = useOptionalFlash()!;
      return (
        <button type="button" onClick={() => flash("alert", RELOAD_TO_LOAD, { label: "Reload", onClick: reload })}>
          Fail
        </button>
      );
    }
    render(
      <FlashProvider>
        <Offer />
      </FlashProvider>,
    );
    act(() => screen.getByRole("button", { name: "Fail" }).click());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(RELOAD_TO_LOAD);
    act(() => within(alert).getByRole("button", { name: "Reload" }).click());
    expect(reload).toHaveBeenCalledOnce();
    act(() => within(alert).getByRole("button", { name: "Dismiss" }).click());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Whatever loads with the pages, should they fail to load", () => {
  /** What a page, dialog or sheet that loads with the pages shows, as RarePage does. */
  function Loaded({ load, failed }: { load: () => Promise<string>; failed: () => void }) {
    return <p>{useRetryingLoad(undefined, load, failed) ?? "loading"}</p>;
  }

  it("says so, and tries again with the next press or key, as on what opened it, until they load", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue("the page");
    const failed = vi.fn();
    render(<Loaded load={load} failed={failed} />);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(screen.getByText("loading")).toBeInTheDocument();

    act(() => void window.dispatchEvent(new Event("pointerdown")));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
    expect(await screen.findByText("the page")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });
});
