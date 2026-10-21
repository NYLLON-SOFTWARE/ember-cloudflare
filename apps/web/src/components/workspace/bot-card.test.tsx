import { feature } from "@ember/parity";
import type { Card, CardPart } from "@ember/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dateTimeLabel } from "@/lib/messages";
import { BotCards } from "./bot-card";

const card = (parts: CardPart[], rest: Partial<Card> = {}): Card => ({ source: "attachment", parts, ...rest });

/** Shows `cards` as a message shows them, answering the frames they're drawn in. */
function show(...cards: Card[]) {
  render(<BotCards cards={cards} />);
  return screen.getAllByRole("article");
}

/** The bar down a card's frame. */
const barOf = (frame: HTMLElement) => frame.querySelector<HTMLElement>(":scope > span[aria-hidden]")!;

describe(feature("bots.cards"), () => {
  it("shows an attachment's pretext above its frame, then its author, title, text, fields, image, buttons and footer, with its thumbnail beside them", () => {
    const at = 1792612211;
    const [frame] = show(
      card(
        [
          { kind: "author", name: "Alertmanager", href: "https://example.com/am", icon: "https://example.com/am.png" },
          { kind: "title", text: "[FIRING:1] HighErrorRate", href: "https://example.com/alerts" },
          { kind: "text", html: "<p>5xx responses are at <strong>7.2%</strong></p>" },
          {
            kind: "fields",
            fields: [
              { title: "Severity", html: "<p>critical</p>", short: true },
              { title: "Summary", html: "<p>Errors are up</p>", short: false },
            ],
          },
          { kind: "image", image: { url: "https://example.com/graph.png", alt: "" } },
          { kind: "buttons", buttons: [{ text: "Runbook", href: "https://example.com/runbook" }] },
          { kind: "footer", text: "Prometheus", icon: "https://example.com/p.png", at },
        ],
        { color: "danger", pretext: "<p>An alert, <em>firing</em></p>", thumb: { url: "https://example.com/thumb.png", alt: "" } },
      ),
    );
    expect(frame).toHaveAccessibleName("[FIRING:1] HighErrorRate");
    expect(frame!.previousElementSibling).toHaveTextContent("An alert, firing");

    const inFrame = within(frame!);
    expect(inFrame.getByRole("link", { name: "Alertmanager" })).toHaveAttribute("href", "https://example.com/am");
    expect(inFrame.getByRole("heading", { name: "[FIRING:1] HighErrorRate" })).toContainElement(inFrame.getByRole("link", { name: "[FIRING:1] HighErrorRate" }));
    expect(inFrame.getByRole("link", { name: "[FIRING:1] HighErrorRate" })).toHaveAttribute("target", "_blank");
    expect(inFrame.getByText("7.2%").tagName).toBe("STRONG");
    expect(inFrame.getByText("Severity").nextElementSibling).toHaveTextContent("critical");
    expect(inFrame.getByText("Severity").parentElement).not.toHaveClass("col-span-full");
    expect(inFrame.getByText("Summary").parentElement).toHaveClass("col-span-full");
    expect(inFrame.getByRole("link", { name: "Image from example.com" })).toHaveAttribute("href", "https://example.com/graph.png");
    expect(inFrame.getByRole("link", { name: "Runbook" })).toHaveAttribute("href", "https://example.com/runbook");
    expect(inFrame.getByText("Prometheus").parentElement!.querySelector("time")).toHaveAttribute("datetime", new Date(at * 1000).toISOString());
    expect(inFrame.getByText(dateTimeLabel(new Date(at * 1000)))).toBeInTheDocument();
    expect([...frame!.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      "https://example.com/am.png",
      "https://example.com/graph.png",
      "https://example.com/p.png",
      "https://example.com/thumb.png",
    ]);
  });

  it("draws the bar in Ember's colors for Slack's good, warning and danger, a hex color as it's given, and the border's color without one", () => {
    const frames = show(...["good", "warning", "danger", "#36a64f", undefined].map((color) => card([{ kind: "title", text: "Hi" }], color === undefined ? {} : { color })));
    expect(frames.map((frame) => [...barOf(frame).classList].find((name) => name.startsWith("bg-")) ?? barOf(frame).style.backgroundColor)).toEqual([
      "bg-positive",
      "bg-warning",
      "bg-negative",
      "rgb(54, 166, 79)",
      "bg-border",
    ]);
  });

  it("fills a primary button, and draws a danger one red, as Delete is", () => {
    show(
      card([
        {
          kind: "buttons",
          buttons: [
            { text: "Approve", href: "https://example.com/approve", style: "primary" },
            { text: "Roll back", href: "https://example.com/rollback", style: "danger" },
            { text: "Details", href: "https://example.com/details" },
          ],
        },
      ]),
    );
    expect(screen.getByRole("link", { name: "Approve" })).toHaveClass("bg-primary");
    expect(screen.getByRole("link", { name: "Roll back" })).toHaveClass("bg-negative-button", "text-white");
    expect(screen.getByRole("link", { name: "Details" })).toHaveClass("border", "bg-background");
  });

  it("leaves out links, images and icons on the page's own host, keeping their text", () => {
    const own = `https://${location.hostname}/files/1`;
    const [frame] = show(
      card(
        [
          { kind: "author", name: "Ada", href: own, icon: own },
          { kind: "title", text: "Deploy", href: own },
          { kind: "image", image: { url: own, alt: "" } },
          { kind: "buttons", buttons: [{ text: "Open", href: own }] },
          { kind: "footer", text: "CI", icon: own },
        ],
        { thumb: { url: own, alt: "" } },
      ),
    );
    expect(within(frame!).queryAllByRole("link")).toEqual([]);
    expect(frame!.querySelectorAll("img")).toHaveLength(0);
    expect(frame).toHaveTextContent("AdaDeployCI");
  });

  it("folds text past 700 characters or 5 line breaks behind Show more", async () => {
    const user = userEvent.setup();
    const text = (html: string) => card([{ kind: "text", html }]);
    show(text(`<p>${"x".repeat(700)}</p>`), text("<p>1<br>2<br>3<br>4<br>5<br>6</p>"), text(`<p>${"x".repeat(701)}</p>`), text("<p>1</p><p>2<br>3<br>4<br>5<br>6<br>7</p>"));
    const buttons = screen.getAllByRole("button", { name: "Show more" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.previousElementSibling).toHaveClass("max-h-[5lh]", "overflow-hidden");

    await user.click(buttons[0]!);
    expect(buttons[0]).toHaveAccessibleName("Show less");
    expect(buttons[0]).toHaveAttribute("aria-expanded", "true");
    expect(buttons[0]!.previousElementSibling).not.toHaveClass("max-h-[5lh]");
  });
});
