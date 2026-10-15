import { feature } from "@ember/parity";
import type { Message } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { displayBody } from "@ember/richtext/dom";
import { dayLabel, replyQuote, timeline } from "./messages";

const at = (iso: string, creatorId = "u1"): Message => ({
  id: iso,
  clientMessageId: iso,
  roomId: "general",
  creator: { id: creatorId, name: creatorId },
  body: "",
  plainText: "",
  mentions: [],
  createdAt: iso,
  updatedAt: iso,
  editedAt: null,
  boosts: [],
});

describe(feature("messages.grouping"), () => {
  it("threads quick follow-ups from the same person and separates days", () => {
    const items = timeline(
      [
        at("2026-10-11T12:00:00"),
        at("2026-10-12T09:00:00"),
        at("2026-10-12T09:02:00"),
        at("2026-10-12T09:03:00", "u2"),
        at("2026-10-12T09:30:00", "u2"),
      ],
      new Date("2026-10-12T18:00:00"),
    );
    expect(items.map((i) => i.daySeparator)).toEqual(["Yesterday", "Today", null, null, null]);
    expect(items.map((i) => i.threaded)).toEqual([false, false, true, false, false]);
  });
});

describe(feature("messages.day-separators"), () => {
  it("names older days", () => {
    expect(dayLabel(new Date("2026-10-01T12:00:00"), new Date("2026-10-12T12:00:00"))).toMatch(/October/);
  });
});

describe(feature("messages.reply"), () => {
  const MENTION = 'content-type="application/vnd.campfire.mention" sgid="0123456789abcdef"';

  it("quotes what the message shows, then cites its author with a link to it, leaving a line to write on", () => {
    const nodes = displayBody(`<p>Third time's a charm, <action-text-attachment ${MENTION}></action-text-attachment> &amp; https://example.com</p>`);
    const names: Record<string, string> = { "0123456789abcdef": "Grace <3" };
    expect(replyQuote(nodes, "Ada & co", "https://ember.test/rooms/general/@m%201", (userId) => names[userId]!)).toBe(
      "<blockquote><p>Third time's a charm, Grace &lt;3 &amp; " +
        '<a href="https://example.com">https://example.com</a></p></blockquote>' +
        '<cite>Ada &amp; co <a href="https://ember.test/rooms/general/@m%201">#</a></cite><p><br></p>',
    );
  });
});
