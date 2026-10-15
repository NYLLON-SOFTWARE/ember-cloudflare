import { feature } from "@ember/parity";
import type { Boost, Message, User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const editors = { open: vi.fn(() => setEditing(true)), close: vi.fn(() => setEditing(false)), returnFocus: vi.fn() };
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

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

/** Lays components out as they are on a phone, where nothing can hover. */
const onTouchScreen = () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(hover: none)", media, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
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
  it("offers Edit on your own messages, and on everyone's to administrators", () => {
    show(message(), { me: grace });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("puts Edit before More reactions, as ember-rust does, and Delete in the editor", () => {
    show(message({ creator: grace }), { administrator: true });
    const bar = screen.getByRole("group", { name: "Message actions" });
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Thumbs up",
      "Clapping",
      "Waving hand",
      "Edit",
      "More reactions",
    ]);
  });

  it("edits in place of the message, starting from its text, and Ctrl or Cmd+Enter saves", async () => {
    const { actions, editors, user, article } = show(message({ boosts: [boost("b1", grace, "👍")] }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
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

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await editBox(), " there{Meta>}{Enter}{/Meta}");
    expect(actions.edit).toHaveBeenLastCalledWith("m1", "<p>Hello there</p>");
  });

  it("starts a new line on Enter, and saves from Save changes too", async () => {
    const { actions, user } = show(message());
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await editBox(), "{Enter}again");
    expect(actions.edit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.edit).toHaveBeenCalledWith("m1", "<p>Hello<br>again</p>");
  });

  it("discards an edit on Escape or Close editor and discard changes, and ignores unchanged or blank edits", async () => {
    const { actions, editors, user } = show(message());
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await editBox(), " more{Escape}");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(editors.close).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await editBox(), " more");
    await user.click(screen.getByRole("button", { name: "Close editor and discard changes" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(await editBox(), "{Control>}{Enter}{/Control}");
    await user.click(screen.getByRole("button", { name: "Edit" }));
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
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(await editBox());
    await user.type(await editBox(), "hello{Control>}{Enter}{/Control}");
    expect(actions.edit).toHaveBeenCalledWith("m1", "<p>hello</p>");
    expect(await editBox()).toHaveValue("hello");
    expect(editors.close).not.toHaveBeenCalled();
  });

  it("shows the message again, not its editor, once nothing can be done to it", () => {
    const props = { message: message(), me: { ...ada, administrator: false }, threaded: false, editors: { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn() } };
    render(<MessageItem {...props} editing actions={null} />);
    expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe(feature("messages.actions"), () => {
  it("puts the options button before the actions it opens, so a keyboard reaches them", async () => {
    const { user } = show(message());
    const options = screen.getByRole("button", { name: "Message options" });
    const bar = screen.getByRole("group", { name: "Message actions" });
    expect(options.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // While editing there's no bar to open.
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();
  });

  it("closes the actions after a reaction and hands focus to Message options", () => {
    const { actions } = show(message());
    const options = optionsOn("Hello");
    fireEvent.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "👍");
    expect(options).toHaveAttribute("aria-expanded", "false");
    expect(options).toHaveFocus();
  });

  it("closes the actions on a click or focus anywhere else, so only one message has them open", () => {
    show(message());
    show(message({ id: "m2", clientMessageId: "c2", plainText: "there" }), { threaded: true });
    fireEvent.click(optionsOn("Hello"));
    fireEvent.click(screen.getByText("Hello"));
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(optionsOn("Hello"));
    fireEvent.click(optionsOn("there"));
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "false");
    expect(optionsOn("there")).toHaveAttribute("aria-expanded", "true");

    // A keyboard moving on to the other message closes them too.
    act(() => optionsOn("Hello").focus());
    expect(optionsOn("there")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a touch screen's actions beside the message from Message options, which closes them again", () => {
    onTouchScreen();
    const { actions, article } = show(message());
    const options = screen.getByRole("button", { name: "Message options" });
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();

    fireEvent.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    // They open beside the message, not over its button.
    expect(article.contains(screen.getByRole("group", { name: "Message actions" }))).toBe(false);
    fireEvent.click(options);
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();

    // Sending a reaction closes them, as on ember-rust.
    fireEvent.click(options);
    fireEvent.click(screen.getByRole("button", { name: "Thumbs up" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "👍");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
  });
});

describe(feature("messages.delete"), () => {
  it("deletes from the editor, after asking, and hands focus back", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { actions, editors, user } = show(message({ creator: grace }), { administrator: true });
    await user.click(screen.getByRole("button", { name: "Edit" }));
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
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete message" }));
    expect(actions.remove).toHaveBeenCalledWith("m1");
    expect(editors.returnFocus).not.toHaveBeenCalled();
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

  it("offers nothing where nothing can be done, as in a room that's gone", () => {
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn() };
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
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn() };
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
