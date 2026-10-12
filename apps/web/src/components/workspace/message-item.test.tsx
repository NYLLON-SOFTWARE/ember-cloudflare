import { feature } from "@ember/parity";
import { MAX_MESSAGE_LENGTH, type Boost, type Message, type User } from "@ember/protocol";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingMessage } from "@/lib/room-state";
import { MessageItem } from "./message-item";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  clientMessageId: "c1",
  roomId: "general",
  creator: ada,
  body: "Hello",
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  boosts: [],
  ...overrides,
});

const boost = (id: string, booster: User, content: string): Boost => ({ id, messageId: "m1", booster, content, createdAt: "" });

function show(m: Message | PendingMessage, { me = ada, threaded = false } = {}) {
  const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
  render(<MessageItem message={m} me={me} threaded={threaded} actions={actions} />);
  return { actions, user: userEvent.setup(), article: screen.getByRole("article") };
}

afterEach(() => vi.restoreAllMocks());

describe(feature("messages.create"), () => {
  it("shows the author, the time and the text", () => {
    const { article } = show(message({ body: "Line one\nLine two" }));
    expect(within(article).getByText("Ada")).toBeInTheDocument();
    expect(within(article).getByText(/Line one\s+Line two/)).toBeInTheDocument();
    expect(article.querySelector("time")).toHaveAttribute("datetime", "2026-10-12T10:00:00.000Z");
  });
});

describe(feature("messages.optimistic"), () => {
  it("shows an unconfirmed message as busy, without actions", () => {
    const { article } = show({ ...message(), pending: true });
    expect(article).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Not sent")).not.toBeInTheDocument();
  });

  it("says when a message couldn't be sent", () => {
    show({ ...message(), pending: true, failed: true });
    expect(screen.getByText("Not sent")).toBeInTheDocument();
  });
});

describe(feature("messages.grouping"), () => {
  it("shows a follow-up without repeating the author", () => {
    const { article } = show(message(), { threaded: true });
    expect(within(article).queryByText("Ada")).not.toBeInTheDocument();
    expect(article.querySelector("time")).toBeInTheDocument();
  });
});

describe(feature("messages.edit"), () => {
  it("offers Edit and Delete on your own messages only", () => {
    show(message(), { me: grace });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("edits in place: Enter saves the trimmed text", async () => {
    const { actions, user } = show(message());
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox");
    expect(editor).toHaveValue("Hello");
    expect(editor).toHaveFocus();
    await user.clear(editor);
    await user.type(editor, "  Hello again {Enter}");
    expect(actions.edit).toHaveBeenCalledWith("m1", "Hello again");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cancels an edit on Escape and ignores unchanged or blank edits", async () => {
    const { actions, user } = show(message());
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox"), " more{Escape}");
    expect(screen.getByText("Hello")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox"), "{Enter}");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(actions.edit).not.toHaveBeenCalled();
  });

  it("marks edited messages", () => {
    show(message({ updatedAt: "2026-10-12T10:05:00.000Z" }));
    expect(screen.getByText("(edited)")).toBeInTheDocument();
  });

  it("caps edits at the length the server accepts", async () => {
    const { user } = show(message());
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", String(MAX_MESSAGE_LENGTH));
  });

  it("doesn't save on the Enter that confirms an input method's word", async () => {
    const { actions, user } = show(message());
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "こんにちは" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(actions.edit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(actions.edit).toHaveBeenCalledWith("m1", "こんにちは");
  });
});

describe(feature("messages.delete"), () => {
  it("asks before deleting your message", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { actions, user } = show(message());
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith("Delete this message?");
    expect(actions.remove).toHaveBeenCalledWith("m1");
  });
});

describe(feature("boosts.add"), () => {
  it("offers three quick reactions on every message", async () => {
    const { actions, user } = show(message(), { me: grace });
    const toolbar = screen.getByRole("group", { name: "Message actions" });
    expect(within(toolbar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Thumbs up",
      "Clapping",
      "Waving hand",
      "More reactions",
    ]);
    await user.click(within(toolbar).getByRole("button", { name: "Clapping" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "👏");
  });

  it("keeps the other reactions in a tray", async () => {
    const { actions, user } = show(message(), { me: grace });
    await user.click(screen.getByRole("button", { name: "More reactions" }));
    const tray = screen.getByRole("menu");
    expect(within(tray).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["💪", "❤️", "😂", "🎉", "🔥"]);
    await user.click(within(tray).getByRole("menuitem", { name: "Fire" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "🔥");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("groups reactions by emoji with a count and who reacted", async () => {
    const { actions, user } = show(
      message({ boosts: [boost("b1", grace, "👍"), boost("b2", ada, "🎉"), boost("b3", { id: "u3", name: "Linus" }, "👍")] }),
      { me: ada },
    );
    const chips = within(screen.getByRole("list", { name: "Reactions" })).getAllByRole("button");
    expect(chips.map((chip) => [chip.textContent, chip.title, chip.getAttribute("aria-pressed")])).toEqual([
      ["👍2", "Grace, Linus", "false"],
      ["🎉1", "Ada", "true"],
    ]);
    await user.click(chips[0]!);
    expect(actions.boost).toHaveBeenCalledWith("m1", "👍");
  });
});

describe(feature("boosts.remove"), () => {
  it("takes back your reaction when you click its chip", async () => {
    const { actions, user } = show(message({ boosts: [boost("b1", grace, "👍"), boost("b2", ada, "👍")] }), { me: ada });
    await user.click(screen.getByRole("button", { name: /👍/, pressed: true }));
    expect(actions.unboost).toHaveBeenCalledWith("b2");
    expect(actions.boost).not.toHaveBeenCalled();
  });
});

describe(feature("mentions.highlight"), () => {
  const highlighted = (article: HTMLElement) => article.querySelector(".border-mention") !== null;

  it("highlights messages from others that mention you by name", () => {
    expect(highlighted(show(message({ creator: grace, body: "Thanks @ada!" })).article)).toBe(true);
  });

  it.each([
    ["your own messages", ada, "Note to self @Ada"],
    ["other names that start with yours", grace, "Ask @Adam"],
    ["your name without an @", grace, "Ada said so"],
  ])("leaves %s alone", (_, creator, body) => {
    expect(highlighted(show(message({ creator, body })).article)).toBe(false);
  });
});
