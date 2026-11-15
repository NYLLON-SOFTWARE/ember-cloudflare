import type { Message, User } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { activityLabel, namesMatch, previewOf, unreadBadge } from "./direct-list";
import { timeLabel } from "./messages";

const [ada, grace, linus]: User[] = ["Ada", "Grace", "Linus"].map((name, i) => ({ id: `u${i + 1}`, name }));
const nameOf = (user: User) => user.name;
const message = (creator: User, plainText: string, deleted = false): Message => ({
  id: "m1",
  clientMessageId: "m1",
  roomId: "d1",
  creator,
  body: "",
  plainText,
  mentions: [],
  createdAt: "",
  updatedAt: "",
  editedAt: null,
  boosts: [],
  ...(deleted && { deleted }),
});

describe("activityLabel", () => {
  const now = new Date(2026, 10, 11, 15, 0);
  it("says the time today, Yesterday, the day of the week within a week, the month and day this year, or the full date", () => {
    const today = new Date(2026, 10, 11, 9, 5);
    expect(activityLabel(today, now)).toBe(timeLabel(today));
    expect(activityLabel(new Date(2026, 10, 10, 23, 59), now)).toBe("Yesterday");
    expect(activityLabel(new Date(2026, 10, 6, 12, 0), now)).toBe(new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(2026, 10, 6)));
    expect(activityLabel(new Date(2026, 10, 3, 12, 0), now)).toBe(new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date(2026, 10, 3)));
    expect(activityLabel(new Date(2025, 11, 31, 12, 0), now)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(2025, 11, 31)));
  });
});

describe("previewOf", () => {
  it("starts yours with You:, a group's with who wrote it, and leaves a one-to-one's as it is, on one line", () => {
    expect(previewOf(message(ada!, "on my\n way"), ada!.id, false, nameOf)).toBe("You: on my way");
    expect(previewOf(message(grace!, "hi"), ada!.id, true, nameOf)).toBe("Grace: hi");
    expect(previewOf(message(linus!, "  hi  "), ada!.id, false, nameOf)).toBe("hi");
  });

  it("says a deleted message was deleted", () => {
    expect(previewOf(message(grace!, "", true), ada!.id, false, nameOf)).toBe("This message was deleted.");
  });
});

describe("unreadBadge", () => {
  it("counts to 9, then says 9+", () => {
    expect([1, 9, 10, 100].map(unreadBadge)).toEqual(["1", "9", "9+", "9+"]);
  });
});

describe("namesMatch", () => {
  it("finds a DM by any name in it, whatever the case, and every DM for nothing typed", () => {
    expect(namesMatch([ada!, grace!], "GRA", nameOf)).toBe(true);
    expect(namesMatch([ada!, grace!], "lin", nameOf)).toBe(false);
    expect(namesMatch([ada!], "  ", nameOf)).toBe(true);
  });
});
