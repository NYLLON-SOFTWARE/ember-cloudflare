import { feature } from "@ember/parity";
import type { Boost, Message, User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleContext } from "@/hooks/use-directory";
import type { PendingMessage } from "@/lib/room-state";
import { MessageItem } from "./message-item";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };

/** A message, whose body is its plain text as typed unless given. */
const message = (overrides: Partial<Message> = {}): Message => {
  const plainText = overrides.plainText ?? "Hello";
  return {
    id: "m1",
    clientMessageId: "c1",
    roomId: "general",
    creator: ada,
    body: bodyFromPlainText(plainText),
    plainText,
    mentions: [],
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    editedAt: null,
    boosts: [],
    ...overrides,
  };
};

const boost = (id: string, booster: User, content: string): Boost => ({ id, messageId: "m1", booster, content, createdAt: "" });

/**
 * Renders one message, opening and closing its editor as the room does, seen by `me`, who's an
 * administrator if `administrator`. `sent` is what an edit or deletion reports: false when there's no connection.
 */
function show(m: Message | PendingMessage, { me = ada, administrator = false, threaded = false, sent = true } = {}) {
  const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(() => sent), remove: vi.fn(() => sent) };
  let setEditing: (editing: boolean) => void = () => {};
  const editors = { open: vi.fn(() => setEditing(true)), close: vi.fn(() => setEditing(false)), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
  function Room() {
    const [editing, set] = useState(false);
    setEditing = set;
    return <MessageItem message={m} me={{ ...me, administrator }} threaded={threaded} editing={editing} actions={actions} editors={editors} />;
  }
  const { container } = render(<Room />);
  return { actions, editors, user: userEvent.setup(), article: within(container).getByRole("article") };
}

/** The editor Edit opens, test-setup.ts's stand-in for Lexxy, which shows a message's text. */
const editBox = () => screen.findByRole("textbox", { name: "Edit message" });

/** The Message options button on the message that says `body`. */
const optionsOn = (body: string) => within(screen.getByText(body).closest("article")!).getByRole("button", { name: "Message options" });

/** The open bar of a message's actions. */
const actionBar = () => screen.getByRole("group", { name: "Message actions" });

/** Presses one of the actions on the message that says `body`, opening them from its Message options. */
async function pressAction(user: UserEvent, name: string, body = "Hello") {
  await user.click(optionsOn(body));
  await user.click(within(actionBar()).getByRole("button", { name }));
}

// jsdom lays nothing out, so every box is put 100px down the window, where the bar can open in view.
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 40));
});
afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

/** Answers media queries as a page does where a mouse can hover. */
const withMouse = () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(hover: hover) and (pointer: fine)", media, addEventListener() {}, removeEventListener() {} }));
};

describe(feature("messages.create"), () => {
  it("shows the author, the time and the text", () => {
    const { article } = show(message({ plainText: "Line one\nLine two" }));
    expect(within(article).getByText("Ada")).toBeInTheDocument();
    expect(article.querySelector(".message-content")).toContainHTML("<p>Line one<br>Line two</p>");
    expect(article.querySelector("time")).toHaveAttribute("datetime", "2026-10-12T10:00:00.000Z");
  });
});

describe(feature("messages.unrenderable"), () => {
  it("shows a message whose text can't be shown as one that failed to load, with nothing to do to it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { article } = show(message({ body: `${"<b>".repeat(401)}deep`, plainText: "deep" }));
    expect(article).toHaveTextContent(/^Failed to load message content$/);
    expect(within(article).queryByText("Ada")).not.toBeInTheDocument();
    expect(within(article).queryByRole("button")).not.toBeInTheDocument();
    expect(error).toHaveBeenCalledWith("Could not show a message", expect.any(Error));
  });
});

describe(feature("messages.autolink"), () => {
  it("links the addresses in a message's text", () => {
    const { article } = show(message({ plainText: "Docs at www.example.com, or ask ada@example.com" }));
    expect(within(article).getByRole("link", { name: "www.example.com" })).toHaveAttribute("href", "http://www.example.com");
    expect(within(article).getByRole("link", { name: "ada@example.com" })).toHaveAttribute("href", "mailto:ada@example.com");
  });
});

describe(feature("messages.emoji-only"), () => {
  it("shows a message of nothing but emoji large, pending ones included", () => {
    const large = (m: Message | PendingMessage) => show(m).article.querySelector(".message-content")!.classList.contains("text-[2.4em]");
    expect(large(message({ plainText: "😄🤘" }))).toBe(true);
    expect(large({ ...message({ plainText: "😄🤘" }), pending: true })).toBe(true);
    expect(large(message({ plainText: "Haha! 😄🤘" }))).toBe(false);
    expect(large(message({ plainText: "🔥 💯" }))).toBe(false);
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
  it("offers Edit on your own messages, and on everyone's to administrators", async () => {
    const { user } = show(message(), { me: grace });
    await user.click(optionsOn("Hello"));
    expect(within(actionBar()).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("puts Edit before More reactions, as ember-rust does, and Delete in the editor", async () => {
    const { user } = show(message({ creator: grace }), { administrator: true });
    await user.click(optionsOn("Hello"));
    expect(within(actionBar()).getAllByRole("button").map((b) => b.title)).toEqual([
      "Thumbs up",
      "Clapping",
      "Waving hand",
      "Reply",
      "Copy link",
      "Edit",
      "More reactions",
    ]);
  });

  it("edits in place of the message, starting from its text, and Ctrl or Cmd+Enter saves", async () => {
    const { actions, editors, user, article } = show(message({ boosts: [boost("b1", grace, "👍")] }));
    await pressAction(user, "Edit");
    expect(editors.open).toHaveBeenCalledWith("m1");
    const editor = await editBox();
    expect(editor).toHaveValue("Hello");
    expect(editor).toHaveFocus();
    // Like ember-rust's, it takes the place of the author, the time and the reactions too.
    expect(within(article).queryByText("Ada")).not.toBeInTheDocument();
    expect(article.querySelector("time")).not.toBeInTheDocument();
    expect(within(article).queryByRole("list", { name: "Reactions" })).not.toBeInTheDocument();
    expect(within(article).queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();

    await user.clear(editor);
    await user.type(editor, "Hello again{Control>}{Enter}{/Control}");
    expect(actions.edit).toHaveBeenCalledWith("m1", "<p>Hello again</p>");
    expect(editors.close).toHaveBeenCalledWith("m1");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await pressAction(user, "Edit");
    await user.type(await editBox(), " there{Meta>}{Enter}{/Meta}");
    expect(actions.edit).toHaveBeenLastCalledWith("m1", "<p>Hello there</p>");
  });

  it("starts a new line on Enter, and saves from Save changes too", async () => {
    const { actions, user } = show(message());
    await pressAction(user, "Edit");
    await user.type(await editBox(), "{Enter}again");
    expect(actions.edit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.edit).toHaveBeenCalledWith("m1", "<p>Hello<br>again</p>");
  });

  it("discards an edit on Escape or Close editor and discard changes, and ignores unchanged or blank edits", async () => {
    const { actions, editors, user } = show(message());
    await pressAction(user, "Edit");
    await user.type(await editBox(), " more{Escape}");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(editors.close).toHaveBeenCalledTimes(1);

    await pressAction(user, "Edit");
    await user.type(await editBox(), " more");
    await user.click(screen.getByRole("button", { name: "Close editor and discard changes" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();

    await pressAction(user, "Edit");
    await user.type(await editBox(), "{Control>}{Enter}{/Control}");
    await pressAction(user, "Edit");
    await user.clear(await editBox());
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(actions.edit).not.toHaveBeenCalled();
  });

  it("marks an edited message, including one grouped under the message before it", () => {
    const edited = message({ updatedAt: "2026-10-12T10:05:00.000Z", editedAt: "2026-10-12T10:05:00.000Z" });
    expect(within(show(edited).article).getByText("(edited)")).toBeInTheDocument();
    // A grouped message has no header to hold the mark, so it ends the message's text.
    expect(within(show(edited, { threaded: true }).article).getByText("(edited)").closest("p")).toHaveTextContent("Hello (edited)");
  });

  it("keeps the editor and what's written when the edit can't be sent", async () => {
    const { actions, editors, user } = show(message(), { sent: false });
    await pressAction(user, "Edit");
    await user.clear(await editBox());
    await user.type(await editBox(), "hello{Control>}{Enter}{/Control}");
    expect(actions.edit).toHaveBeenCalledWith("m1", "<p>hello</p>");
    expect(await editBox()).toHaveValue("hello");
    expect(editors.close).not.toHaveBeenCalled();
  });

  it("hands the room its open editor, to focus again with what's written as Up Arrow does, until it closes", async () => {
    const { editors, user } = show(message());
    await pressAction(user, "Edit");
    await user.type(await editBox(), " there");
    expect(editors.attach).toHaveBeenLastCalledWith("m1", expect.anything());

    act(() => (document.activeElement as HTMLElement).blur());
    act(() => editors.attach.mock.lastCall![1].focus());
    expect(await editBox()).toHaveFocus();
    expect(await editBox()).toHaveValue("Hello there");

    await user.keyboard("{Escape}");
    expect(editors.attach).toHaveBeenLastCalledWith("m1", null);
  });

  it("shows the message again, not its editor, once nothing can be done to it", () => {
    const props = { message: message(), me: { ...ada, administrator: false }, threaded: false, editors: { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() } };
    render(<MessageItem {...props} editing actions={null} />);
    expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe(feature("messages.actions"), () => {
  it("opens the actions from Message options, with three quick reactions, Reply, Copy link and More reactions", async () => {
    const { user } = show(message(), { me: grace });
    const options = optionsOn("Hello");
    expect(options).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();

    await user.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    expect(options).toHaveAttribute("aria-controls", actionBar().id);
    expect(within(actionBar()).getAllByRole("button").map((b) => b.title)).toEqual(["Thumbs up", "Clapping", "Waving hand", "Reply", "Copy link", "More reactions"]);

    await user.click(options);
    expect(options).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
  });

  it("closes the actions after a reaction and hands focus to Message options", async () => {
    const { actions, user } = show(message());
    await pressAction(user, "Clapping");
    expect(actions.boost).toHaveBeenCalledWith("m1", "👏");
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
    expect(optionsOn("Hello")).toHaveFocus();
  });

  it("closes the actions on a click anywhere else or as focus leaves them, so only one message has them open", async () => {
    const { user } = show(message());
    show(message({ id: "m2", clientMessageId: "c2", plainText: "there" }), { threaded: true });
    await user.click(optionsOn("Hello"));
    await user.click(screen.getByText("Hello"));
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");

    await user.click(optionsOn("Hello"));
    await user.click(optionsOn("there"));
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
    expect(optionsOn("there")).toHaveAttribute("aria-expanded", "true");

    // A keyboard moving on to the other message closes them too.
    act(() => optionsOn("Hello").focus());
    expect(optionsOn("there")).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the tray on Escape, handing focus to More reactions, then the actions, handing it to Message options", async () => {
    const { user } = show(message());
    await pressAction(user, "More reactions");
    const more = within(actionBar()).getByRole("button", { name: "More reactions" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "More reactions" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "More reactions" })).not.toBeInTheDocument();
    expect(more).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
    expect(optionsOn("Hello")).toHaveFocus();
  });

  it("keeps actions the pointer opened as focus moves elsewhere, as when the composer takes it once it's ready", () => {
    withMouse();
    const { article } = show(message());
    render(<input aria-label="Composer" />);
    fireEvent.pointerEnter(article, { pointerType: "mouse" });
    act(() => screen.getByRole("textbox", { name: "Composer" }).focus());
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the actions on Escape from elsewhere, leaving focus where it is", () => {
    withMouse();
    const { article } = show(message());
    render(<input aria-label="Composer" />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    act(() => composer.focus());
    // Actions that opened as the pointer crossed the message, while you were writing.
    fireEvent.pointerEnter(article, { pointerType: "mouse" });
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
    expect(composer).toHaveFocus();
  });

  it("opens with a mouse as it crosses the message, and closes as it leaves, unless Message options kept it open", () => {
    vi.useFakeTimers();
    withMouse();
    const { article } = show(message());
    const options = optionsOn("Hello");
    fireEvent.pointerEnter(article, { pointerType: "mouse" });
    expect(options).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerLeave(article, { pointerType: "mouse" });
    // It waits a moment, for the pointer to reach the actions over the message's edge.
    act(() => vi.advanceTimersByTime(170));
    expect(options).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerEnter(actionBar(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(options).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerLeave(actionBar(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(options).toHaveAttribute("aria-expanded", "false");

    // Message options keeps actions that hovering opened, rather than closing them.
    fireEvent.pointerEnter(article, { pointerType: "mouse" });
    fireEvent.click(options);
    fireEvent.pointerLeave(article, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(options).toHaveAttribute("aria-expanded", "true");
    vi.useRealTimers();
  });

  it("opens as the pointer first moves over a message whose editor just shut under it, which it never left", async () => {
    withMouse();
    const { article, user } = show(message());
    await pressAction(user, "Edit");
    await user.click(screen.getByRole("button", { name: "Close editor and discard changes" }));
    const options = optionsOn("Hello");
    expect(options).toHaveAttribute("aria-expanded", "false");
    fireEvent.pointerMove(article, { pointerType: "mouse" });
    expect(options).toHaveAttribute("aria-expanded", "true");

    // After that, as in ember-rust, only the pointer coming back to the message opens them again.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerMove(article, { pointerType: "mouse" });
    expect(options).toHaveAttribute("aria-expanded", "false");
    fireEvent.pointerEnter(article, { pointerType: "mouse" });
    expect(options).toHaveAttribute("aria-expanded", "true");
  });

  it("opens only from Message options on a touch screen, or when a finger crosses the message", () => {
    show(message());
    fireEvent.pointerEnter(screen.getByRole("article"), { pointerType: "mouse" });
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
    withMouse();
    fireEvent.pointerEnter(screen.getByRole("article"), { pointerType: "touch" });
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
  });

  it("closes as its message leaves the timeline's sight", async () => {
    const { user } = show(message());
    await user.click(optionsOn("Hello"));
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(0, -100, 200, 40));
    fireEvent.scroll(document);
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
  });

  it("has no actions while the message's editor is open", async () => {
    const { user } = show(message());
    await pressAction(user, "Edit");
    expect(screen.queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();
  });
});

describe(feature("messages.reply"), () => {
  it("writes a reply in the composer, quoting the message and citing its author with a link to it, and closes the actions", async () => {
    const { editors, user } = show(message({ plainText: "Third time's a charm." }), { me: grace });
    await pressAction(user, "Reply", "Third time's a charm.");
    expect(editors.reply).toHaveBeenCalledWith(
      `<blockquote><p>Third time's a charm.</p></blockquote><cite>Ada <a href="${location.origin}/rooms/general/@m1">#</a></cite><p><br></p>`,
    );
    expect(optionsOn("Third time's a charm.")).toHaveAttribute("aria-expanded", "false");
  });

  it("names the author, and those the message mentions, as the people directory lists them now", async () => {
    const listed = (user: User, name: string) => [user.id, { ...user, name, bio: null, role: "member", status: "active", avatarUrl: "" }] as const;
    const body = `<p>Thanks <action-text-attachment content-type="application/vnd.campfire.mention" sgid="0123456789abcdef"></action-text-attachment>!</p>`;
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
    const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
    render(
      <PeopleContext value={new Map([listed(ada, "Ada King"), listed({ id: "0123456789abcdef", name: "Grace" }, "Grace Hopper")])}>
        <MessageItem message={message({ body, plainText: "Thanks @Grace!" })} me={{ ...grace, administrator: false }} threaded={false} editing={false} actions={actions} editors={editors} />
      </PeopleContext>,
    );
    await pressAction(userEvent.setup(), "Reply", "Ada King");
    expect(editors.reply.mock.lastCall![0]).toMatch(/^<blockquote><p>Thanks Grace Hopper!<\/p><\/blockquote><cite>Ada King <a /);
  });
});

describe(feature("messages.copy-link"), () => {
  it("copies the message's address and turns Copy link green, keeping the actions open", async () => {
    const { user } = show(message());
    await pressAction(user, "Copy link");
    expect(await navigator.clipboard.readText()).toBe(`${location.origin}/rooms/general/@m1`);
    const copy = within(actionBar()).getByRole("button", { name: "Copy link" });
    expect(copy).toHaveClass("text-positive");
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves Copy link as it was when the clipboard refuses", async () => {
    const { user } = show(message());
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    await pressAction(user, "Copy link");
    expect(within(actionBar()).getByRole("button", { name: "Copy link" })).not.toHaveClass("text-positive");
  });
});

describe(feature("messages.delete"), () => {
  it("deletes from the editor, after asking, and hands focus back", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { actions, editors, user } = show(message({ creator: grace }), { administrator: true });
    await pressAction(user, "Edit");
    await user.click(screen.getByRole("button", { name: "Delete message" }));
    expect(confirm).toHaveBeenCalledWith("Are you sure you want to delete this message?");
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete message" }));
    expect(actions.remove).toHaveBeenCalledWith("m1");
    expect(editors.returnFocus).toHaveBeenCalled();
    // The editor stays until the message goes, as ember-rust's does.
    expect(editors.close).not.toHaveBeenCalled();
    expect(await editBox()).toBeInTheDocument();
  });

  it("keeps focus in the editor when the deletion can't be sent", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { actions, editors, user } = show(message(), { sent: false });
    await pressAction(user, "Edit");
    await user.click(screen.getByRole("button", { name: "Delete message" }));
    expect(actions.remove).toHaveBeenCalledWith("m1");
    expect(editors.returnFocus).not.toHaveBeenCalled();
  });
});

describe(feature("boosts.add"), () => {
  it("offers three quick reactions on every message", async () => {
    const { actions, user } = show(message(), { me: grace });
    await user.click(optionsOn("Hello"));
    const quick = within(actionBar()).getByRole("group", { name: "Quick reactions" });
    expect(within(quick).getAllByRole("button").map((b) => b.textContent)).toEqual(["👍Thumbs up", "👏Clapping", "👋Waving hand"]);
    await user.click(within(quick).getByRole("button", { name: "Clapping" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "👏");
  });

  it("keeps the other reactions in a tray", async () => {
    const { actions, user } = show(message(), { me: grace });
    await pressAction(user, "More reactions");
    const tray = screen.getByRole("group", { name: "More reactions" });
    expect(tray).toHaveTextContent(/^More reactions/);
    expect(within(tray).getAllByRole("button").map((b) => b.title)).toEqual(["Muscle", "Red heart", "Face with tears of joy", "Party popper", "Fire"]);
    await user.click(within(tray).getByRole("button", { name: "Fire" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "🔥");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
    expect(optionsOn("Hello")).toHaveFocus();
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

  it("offers nothing where nothing can be done, as in a room that's gone", () => {
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
    render(<MessageItem message={message({ boosts: [boost("b1", grace, "👍")] })} me={{ ...ada, administrator: true }} threaded={false} editing={false} actions={null} editors={editors} />);
    expect(screen.queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Reactions" })).getByRole("button", { name: /👍/ })).toBeDisabled();
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
    expect(highlighted(show(message({ creator: grace, plainText: "Thanks @ada!" })).article)).toBe(true);
  });

  it.each([
    ["your own messages", ada, "Note to self @Ada"],
    ["other names that start with yours", grace, "Ask @Adam"],
    ["your name without an @", grace, "Ada said so"],
  ])("leaves %s alone", (_, creator, plainText) => {
    expect(highlighted(show(message({ creator, plainText })).article)).toBe(false);
  });
});

describe(feature("users.profile"), () => {
  it("names the author and whoever reacted as the people directory lists them now, so a rename shows on messages sent before it", () => {
    const listed = (user: User, name: string) => [user.id, { ...user, name, bio: null, role: "member", status: "active", avatarUrl: `/users/${user.id}/avatar` }] as const;
    const m = message({ boosts: [boost("b1", grace, "👍"), boost("b2", { id: "u3", name: "Linus" }, "👍")] });
    const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
    render(
      <PeopleContext value={new Map([listed(ada, "Ada King"), listed(grace, "Grace Hopper")])}>
        <MessageItem message={m} me={{ ...ada, administrator: false }} threaded={false} editing={false} actions={actions} editors={editors} />
      </PeopleContext>,
    );
    expect(screen.getByText("Ada King")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    // Someone the directory doesn't list keeps the name the boost was given.
    expect(within(screen.getByRole("list", { name: "Reactions" })).getByRole("button", { name: /👍/ })).toHaveAttribute("title", "Grace Hopper, Linus");
  });
});
