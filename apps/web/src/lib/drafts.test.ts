import { describe, expect, it } from "vitest";
import { discardDraft, draftOf, draftsOf } from "./drafts";

describe("drafts", () => {
  it("reads a draft in a room, or in a thread, from where the composer keeps it", () => {
    expect(draftOf("u1", "composer-draft-u1-general", "<p>hi</p>")).toEqual({ key: "composer-draft-u1-general", roomId: "general", body: "<p>hi</p>" });
    expect(draftOf("u1", "composer-draft-u1-general/threads/m9", "<p>re</p>")).toEqual({ key: "composer-draft-u1-general/threads/m9", roomId: "general", threadId: "m9", body: "<p>re</p>" });
  });

  it("leaves out someone else's drafts, empty ones, and anything else kept", () => {
    expect(draftOf("u1", "composer-draft-u2-general", "<p>hi</p>")).toBeNull();
    expect(draftOf("u1", "composer-draft-u1-general", "  ")).toBeNull();
    expect(draftOf("u1", "ember:last-room", "general")).toBeNull();
  });

  it("lists someone's drafts from storage, and discards one", () => {
    localStorage.setItem("composer-draft-u1-general", "<p>one</p>");
    localStorage.setItem("composer-draft-u1-random/threads/m1", "<p>two</p>");
    localStorage.setItem("composer-draft-u2-general", "<p>not mine</p>");
    const drafts = draftsOf("u1");
    expect(drafts.map(({ roomId, threadId }) => [roomId, threadId]).sort()).toEqual([
      ["general", undefined],
      ["random", "m1"],
    ]);
    discardDraft(drafts.find(({ roomId }) => roomId === "general")!);
    expect(localStorage.getItem("composer-draft-u1-general")).toBeNull();
    expect(draftsOf("u1")).toHaveLength(1);
  });
});
