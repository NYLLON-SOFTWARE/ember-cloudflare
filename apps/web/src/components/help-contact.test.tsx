import { feature } from "@ember/parity";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpContact } from "./help-contact";

describe(feature("auth.help-contact"), () => {
  it("links to the first administrator's email, with Ember's version", () => {
    render(<HelpContact contact={{ name: "Ada Lovelace", emailAddress: "ada@example.com" }} version="1.2.3" />);
    const link = screen.getByRole("link", { name: "ada@example.com" });
    expect(link).toHaveAttribute("href", 'mailto:"Ada Lovelace" <ada@example.com>');
    expect(link).toHaveAttribute("title", "Email Ada Lovelace");
    expect(screen.getByText(/Ember™ version/)).toHaveTextContent("Ember™ version 1.2.3");
  });

  it("shows nothing until there's an administrator", () => {
    const { container } = render(<HelpContact contact={null} version="0.1" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe(feature("platform.version"), () => {
  it("shows the version in a badge", () => {
    render(<HelpContact contact={{ name: "Ada", emailAddress: "ada@example.com" }} version="abc123" />);
    expect(screen.getByText("abc123").tagName).toBe("SPAN");
  });
});
