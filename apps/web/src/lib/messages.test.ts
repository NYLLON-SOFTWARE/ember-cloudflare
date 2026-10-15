import { feature } from "@ember/parity";
import type { Message } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { displayBody } from "@ember/richtext/dom";
import { dateLabel, dateTimeLabel, replyQuote, timeLabel, timeline } from "./messages";

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
  it("threads a person's messages up to five minutes apart, either way, and no further", () => {
    const items = timeline([
      at("2026-10-12T09:00:00"),
      at("2026-10-12T09:05:00"),
      at("2026-10-12T09:10:01"),
      // Before the one above it, as a page can hold a message whose clock ran behind.
      at("2026-10-12T09:07:00"),
      at("2026-10-12T09:07:30", "u2"),
      at("2026-10-12T09:08:00", "u2"),
    ]);
    expect(items.map((i) => i.threaded)).toEqual([false, true, false, true, false, true]);
  });

  it("keeps a follow-up just after midnight threaded, under its day's separator", () => {
    const items = timeline([at("2026-10-12T23:58:00"), at("2026-10-13T00:01:00")]);
    expect(items.map((i) => [i.firstOfDay, i.threaded])).toEqual([
      [true, false],
      [true, true],
    ]);
  });
});

describe(feature("messages.day-separators"), () => {
  it("starts a day at the first message and wherever the date changes in the reader's time zone", () => {
    const items = timeline([at("2026-10-11T23:59:59"), at("2026-10-12T00:00:00", "u2"), at("2026-10-12T18:00:00"), at("2026-10-14T08:00:00")]);
    expect(items.map((i) => i.firstOfDay)).toEqual([true, true, false, true]);
  });

  it("writes the date out, with the date and time on hover, as local_time_controller.js does", () => {
    const date = new Date("2026-10-12T15:04:00");
    expect(dateLabel(date)).toBe("October 12, 2026");
    expect(dateTimeLabel(date)).toBe("10/12/26, 3:04 PM");
    expect(timeLabel(date)).toBe("3:04 PM");
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
