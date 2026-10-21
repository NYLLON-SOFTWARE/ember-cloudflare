import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { MAX_CARDS, parseCards, type CardAddress } from "./cards";
import { MAX_MESSAGE_HTML_LENGTH } from "./index";

/** Keeps https addresses on example.com, as the room's rule keeps addresses on named hosts. */
const address: CardAddress = (url) => (url.startsWith("https://example.com/") ? url : undefined);

const card = (parts: unknown[], rest: Record<string, unknown> = {}) => ({ source: "attachment", parts, ...rest });

describe(feature("bots.cards"), () => {
  it("keeps a card with every part an attachment shows", () => {
    const whole = card(
      [
        { kind: "author", name: "Alertmanager", href: "https://example.com/am", icon: "https://example.com/am.png" },
        { kind: "title", text: "[FIRING:1] HighErrorRate", href: "https://example.com/alerts" },
        { kind: "text", html: "<p>5xx responses are at <strong>7.2%</strong></p>" },
        { kind: "fields", fields: [{ title: "Severity", html: "<p>critical</p>", short: true }, { html: "<p>untitled</p>", short: false }] },
        { kind: "image", image: { url: "https://example.com/graph.png", alt: "Error rate" } },
        { kind: "buttons", buttons: [{ text: "Runbook", href: "https://example.com/runbook", style: "primary" }, { text: "Silence", href: "https://example.com/silence" }] },
        { kind: "footer", text: "Prometheus", icon: "https://example.com/p.png", at: 1792612211 },
      ],
      { color: "danger", pretext: "<p>Alert</p>", thumb: { url: "https://example.com/thumb.png", alt: "" } },
    );
    expect(parseCards([whole], address)).toEqual([whole]);
  });

  it("keeps Slack's colors and six hex digits in lowercase, leaving out any other color, and an address the rule doesn't keep", () => {
    expect(parseCards(["#36a64f", "#ABCDEF", "DANGER", "DaNgEr"].map((color) => card([{ kind: "title", text: "Hi" }], { color })), address)).toEqual(
      ["#36a64f", "#abcdef", "danger", "danger"].map((color) => card([{ kind: "title", text: "Hi" }], { color })),
    );
    for (const color of ["red", "#fff", "#36a64f; background: url(x)", "javascript:alert(1)", 7]) {
      expect(parseCards([card([{ kind: "title", text: "Hi" }], { color })], address)).toEqual([card([{ kind: "title", text: "Hi" }])]);
    }
    const parts = [
      { kind: "author", name: "Ada", href: "javascript:alert(1)", icon: "http://example.com/a.png" },
      { kind: "title", text: "Title", href: "https://elsewhere.test/" },
      { kind: "image", image: { url: "data:image/png;base64,AAAA", alt: "" } },
      { kind: "buttons", buttons: [{ text: "Go", href: "mailto:ada@example.com" }] },
      { kind: "footer", text: "Footer", icon: 7 },
    ];
    expect(parseCards([card(parts, { thumb: { url: "ftp://example.com/t.png" } })], address)).toEqual([
      card([
        { kind: "author", name: "Ada" },
        { kind: "title", text: "Title" },
        { kind: "footer", text: "Footer" },
      ]),
    ]);
  });

  it("leaves out parts of kinds it doesn't know, malformed ones and ones too long, and a card left with nothing", () => {
    const parts = [
      { kind: "header", text: "Not yet" },
      { kind: "title", text: "   " },
      { kind: "title", text: "x".repeat(3001) },
      { kind: "text", html: "x".repeat(MAX_MESSAGE_HTML_LENGTH + 1) },
      { kind: "text", html: 7 },
      { kind: "fields", fields: [{ short: true }, "field", { title: "Kept", short: "yes" }] },
      { kind: "footer", text: "", at: Number.NaN },
      { kind: "footer", at: 1e20 },
      "part",
      null,
    ];
    expect(parseCards([card(parts)], address)).toEqual([card([{ kind: "fields", fields: [{ title: "Kept", html: "", short: false }] }])]);
    expect(parseCards([card([{ kind: "title", text: "" }]), card([], { pretext: "<p>Only this</p>" }), { source: "blocks", parts: [{ kind: "title", text: "Hi" }] }, "card"], address)).toEqual([
      card([], { pretext: "<p>Only this</p>" }),
    ]);
    expect(parseCards({ source: "attachment" }, address)).toEqual([]);
  });

  it("keeps up to a message's cards", () => {
    const cards = Array.from({ length: MAX_CARDS + 1 }, (_, index) => card([{ kind: "title", text: `Card ${index}` }]));
    expect(parseCards(cards, address)).toEqual(cards.slice(0, MAX_CARDS));
  });
});
