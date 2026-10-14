import { feature } from "@ember/parity";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import alertSign from "./icons/campfire/alert.svg";
import { Flash } from "./flash";

describe(feature("ui.flash"), () => {
  it("alerts in white on red with Campfire's alert sign, fading in and out", () => {
    render(<Flash onDone={vi.fn()}>Too many requests or unauthorized.</Flash>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too many requests or unauthorized.");
    expect(alert).toHaveClass("animate-flash", "bg-negative", "text-white");
    expect(alert.querySelector("img")).toHaveAttribute("src", alertSign);
    expect(alert.querySelector("img")).toHaveClass("invert");
  });

  it("says when it has faded, so it can go", () => {
    const onDone = vi.fn();
    render(<Flash onDone={onDone}>Too many requests or unauthorized.</Flash>);
    fireEvent.animationEnd(screen.getByRole("alert"));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
