import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { navigate } from "@/hooks/use-route";
import { BackButton } from "./back-button";

afterEach(() => history.replaceState(null, "", "/"));

describe("Back on a phone", () => {
  it("goes back the way the person came", async () => {
    navigate("/activity", { replace: true });
    navigate("/rooms/general");
    render(<BackButton fallback="/" />);
    await userEvent.click(screen.getByRole("link", { name: "Back" }));
    await waitFor(() => expect(location.pathname).toBe("/activity"));
  });

  it("goes to the page it sits under when the app didn't open this one, and is a link to it", async () => {
    history.replaceState(null, "", "/rooms/general/threads/1");
    render(<BackButton fallback="/rooms/general" label="Back to general" />);
    const back = screen.getByRole("link", { name: "Back to general" });
    expect(back).toHaveAttribute("href", "/rooms/general");
    await userEvent.click(back);
    expect(location.pathname).toBe("/rooms/general");
  });
});
