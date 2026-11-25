import { describe, expect, it } from "vitest";
import { UnreadCounts } from "./unread-counts.ts";

describe("UnreadCounts", () => {
  it("adds up every site's count, each once however many of its pages say it", () => {
    const counts = new UnreadCounts<string>();
    expect(counts.total()).toBe(0);
    counts.set("fernwood's window", "fernwood", 2);
    counts.set("a room fernwood's page opened", "fernwood", 2);
    counts.set("birchwood's window", "birchwood", 3);
    expect(counts.total()).toBe(5);

    // A page that hasn't heard yet that a conversation was read counts it until it does.
    counts.set("fernwood's window", "fernwood", 1);
    expect(counts.total()).toBe(5);
    counts.set("a room fernwood's page opened", "fernwood", 1);
    expect(counts.total()).toBe(4);
  });

  it("forgets a page that leaves or closes", () => {
    const counts = new UnreadCounts<string>();
    counts.set("fernwood's window", "fernwood", 2);
    counts.set("birchwood's window", "birchwood", 3);
    counts.drop("birchwood's window");
    expect(counts.total()).toBe(2);
    counts.drop("birchwood's window");
    counts.drop("fernwood's window");
    expect(counts.total()).toBe(0);
  });
});
