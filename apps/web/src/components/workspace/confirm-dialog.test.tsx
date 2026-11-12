import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConfirm } from "./confirm-dialog";

const TITLE = "Delete Design";

/** A button that asks, titled `TITLE`, with `options`, then shows the answer and does `after`, or goes as it asks, if it `removes` itself. */
function Asker({ options, removes = false, after }: { options?: Parameters<ReturnType<typeof useConfirm>[0]>[1]; removes?: boolean; after?: () => void }) {
  const [ask, dialog] = useConfirm();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [shown, setShown] = useState(true);
  const go = async () => {
    if (removes) setShown(false);
    const yes = await ask(TITLE, options);
    setAnswer(yes);
    after?.();
  };
  return (
    <>
      {shown && (
        <button type="button" onClick={() => void go()}>
          Delete
        </button>
      )}
      <input aria-label="Elsewhere" />
      <output>{answer === null ? "unanswered" : String(answer)}</output>
      {dialog}
    </>
  );
}

const asked = () => screen.findByRole("alertdialog", { name: TITLE });

describe("useConfirm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks in the app's own dialog, titled alone, with Cancel focused, and says yes once it's confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<Asker options={{ confirm: "Delete", destructive: true }} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await asked();
    expect(dialog).not.toHaveAccessibleDescription();
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Delete"]);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toHaveClass("bg-negative-button");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("status")).toHaveTextContent("true");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("says what going ahead does under the title, when it's told", async () => {
    const user = userEvent.setup();
    render(<Asker options={{ body: "This can’t be undone.", confirm: "Delete", destructive: true }} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await asked()).toHaveAccessibleDescription("This can’t be undone.");
  });

  it("goes ahead with OK, not red, unless it's told otherwise", async () => {
    const user = userEvent.setup();
    render(<Asker />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const ok = within(await asked()).getByRole("button", { name: "OK" });
    expect(ok).not.toHaveClass("bg-negative-button");
  });

  it.each([
    ["Cancel", (user: ReturnType<typeof userEvent.setup>) => user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))],
    ["Escape", (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ])("says no on %s, handing focus back to what asked", async (_, answer) => {
    const user = userEvent.setup();
    render(<Asker options={{ confirm: "Delete", destructive: true }} />);
    const opener = screen.getByRole("button", { name: "Delete" });
    await user.click(opener);
    await asked();
    await answer(user);
    expect(await screen.findByRole("status")).toHaveTextContent("false");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("hands focus back before the answer comes, so the asker can move it", async () => {
    const user = userEvent.setup();
    render(<Asker options={{ confirm: "Delete" }} after={() => screen.getByRole("textbox", { name: "Elsewhere" }).focus()} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(await asked()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Elsewhere" })).toHaveFocus());
  });

  it("leaves focus be when what asked has gone", async () => {
    const user = userEvent.setup();
    render(<Asker options={{ confirm: "Delete" }} removes />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(await asked()).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("status")).toHaveTextContent("true");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});
