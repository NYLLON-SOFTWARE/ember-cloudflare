import { feature } from "@ember/parity";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppearanceMenu } from "./appearance-menu";

describe(feature("ui.appearance"), () => {
  it("offers Light, Dark and System, with the current choice checked", async () => {
    const user = userEvent.setup();
    render(<AppearanceMenu />);
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((o) => [o.textContent, o.getAttribute("aria-checked")])).toEqual([
      ["Light", "false"],
      ["Dark", "false"],
      ["System", "true"],
    ]);

    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("ember:appearance")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });
});
