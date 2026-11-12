import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { FlashProvider } from "@/components/flash";
import { NOT_LOADED, useOpenedRarePage } from "./rare-pages";

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
