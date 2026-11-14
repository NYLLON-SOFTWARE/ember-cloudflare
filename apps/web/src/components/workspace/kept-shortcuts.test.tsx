import { describe, expect, it } from "vitest";
import { KEPT_SHORTCUTS } from "./kept-shortcuts";

const [todos, saved] = KEPT_SHORTCUTS;

describe("To-dos and Saved shortcuts", () => {
  it("link to their pages with a check and a bookmark", () => {
    expect(KEPT_SHORTCUTS.map(({ title, href, Icon }) => [title, href, Icon.name])).toEqual([
      ["To-dos", "/todos", "CheckCircle"],
      ["Saved", "/saved", "Bookmark"],
    ]);
  });

  it("say how many to-dos are open, and overdue when any are, and how many items are saved", () => {
    expect(todos!.detail({ openTodos: 3, overdueTodos: 0, savedItems: 0 })).toBe("3 open");
    expect(todos!.detail({ openTodos: 3, overdueTodos: 1, savedItems: 0 })).toBe("3 open · 1 overdue");
    expect(todos!.badge({ openTodos: 3, overdueTodos: 1, savedItems: 0 })).toBe(1);
    expect(saved!.detail({ openTodos: 0, overdueTodos: 0, savedItems: 1 })).toBe("1 item");
    expect(saved!.detail({ openTodos: 0, overdueTodos: 0, savedItems: 12 })).toBe("12 items");
  });
});
