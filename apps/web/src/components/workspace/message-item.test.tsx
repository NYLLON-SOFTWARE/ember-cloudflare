import { feature } from "@ember/parity";
import type { Boost, Message, StoredFile, User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryLoaded, PeopleContext, type People } from "@/hooks/use-directory";
import { RefusedUnboosts, RoomConnection } from "@/hooks/use-room";
import type { PendingMessage, PendingUpload } from "@/lib/room-state";
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

const report: StoredFile = {
  id: "k1",
  name: "Q3 report.pdf",
  contentType: "application/pdf",
  byteSize: 1234,
  url: "/files/k1/s1/Q3%20report.pdf",
  downloadUrl: "/files/k1/s1/Q3%20report.pdf?disposition=attachment",
};

/** A file message, whose text is empty and whose plain text is its file's name, as the room posts it. */
const fileMessage = (overrides: Partial<Message> = {}) => message({ body: "", plainText: report.name, attachment: report, ...overrides });

/**
 * Renders one message, opening and closing its editor as the room does, seen by `me`, who's an
 * administrator if `administrator`. `sent` is what a reaction, edit or deletion reports: false when there's
 * no connection. `update` hands it a new copy of the message, as the room does when the message changes,
 * `reconnect` lets the page into the room again, and `refuse` has the room refuse to delete a reaction.
 */
function show(m: Message | PendingMessage, { me = ada, administrator = false, threaded = false, sent = true } = {}) {
  const actions = { boost: vi.fn(() => sent), unboost: vi.fn(() => sent), edit: vi.fn(() => sent), remove: vi.fn(() => sent) };
  let setEditing: (editing: boolean) => void = () => {};
  let setMessage: (message: Message | PendingMessage) => void = () => {};
  let setConnections: (update: (connections: number) => number) => void = () => {};
  let setRefusals: (update: (refusals: number) => number) => void = () => {};
  const editors = { open: vi.fn(() => setEditing(true)), close: vi.fn(() => setEditing(false)), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
  function Room() {
    const [editing, set] = useState(false);
    const [shown, setShown] = useState(m);
    const [connections, setConnected] = useState(1);
    const [refusals, setRefused] = useState(0);
    setEditing = set;
    setMessage = setShown;
    setConnections = setConnected;
    setRefusals = setRefused;
    return (
      <RoomConnection value={connections}>
        <RefusedUnboosts value={refusals}>
          <MessageItem message={shown} me={{ ...me, administrator }} threaded={threaded} editing={editing} actions={actions} editors={editors} />
        </RefusedUnboosts>
      </RoomConnection>
    );
  }
  const { container } = render(<Room />);
  const update = (next: Message | PendingMessage) => act(() => setMessage(next));
  const reconnect = () => act(() => setConnections((connections) => connections + 1));
  const refuse = () => act(() => setRefusals((refusals) => refusals + 1));
  return { actions, editors, update, reconnect, refuse, user: userEvent.setup(), article: within(container).getByRole("article") };
}

/** The editor Edit opens, test-setup.ts's stand-in for Lexxy, which shows a message's text. */
const editBox = () => screen.findByRole("textbox", { name: "Edit message" });

/** The Message options button on the message that says `body`. */
const optionsOn = (body: string) => within(screen.getByText(body).closest("article")!).getByRole("button", { name: "Message options" });

/** The open bar of a message's actions. */
const actionBar = () => screen.getByRole("group", { name: "Message actions" });

/** The reactions under the one message shown. */
const reactions = () => within(screen.getByRole("list", { name: "Reactions" }));

/** The Custom reaction form's field. */
const customField = () => screen.getByRole("textbox", { name: "Custom reaction" });

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

describe(feature("attachments.previews"), () => {
  it("shows a file message's file in place of its text: its icon, its name and Download", () => {
    for (const threaded of [false, true]) {
      const { article } = show(fileMessage(), { threaded });
      expect(article.querySelector(".message-content")).not.toBeInTheDocument();
      expect(within(article).getByText("Q3 report.pdf")).toBeInTheDocument();
      // Hidden in Ember added to an iPhone's or iPad's home screen, which can't download.
      const download = within(article).getByRole("link", { name: "Download Q3 report.pdf" });
      expect(download).toHaveAttribute("href", report.downloadUrl);
      expect(download).toHaveClass("ios-pwa:hidden");
      cleanup();
    }
  });
});

describe(feature("attachments.progress"), () => {
  /** A file on its way to becoming a message, as its upload's card shows it. */
  const uploading = (upload: Partial<PendingUpload> = {}): PendingMessage => ({
    ...message({ id: "c1", body: "", plainText: "moon.jpg" }),
    pending: true,
    upload: { name: "moon.jpg", size: 2_500_000, percent: 42, ...upload },
  });

  it("shows a file's upload card in place of its text, unfaded and without actions, until the room has posted it", () => {
    for (const threaded of [false, true]) {
      const { article, update } = show(uploading(), { threaded });
      expect(within(article).getByRole("group", { name: "Upload moon.jpg" })).toBeInTheDocument();
      expect(article.querySelector(".message-content")).not.toBeInTheDocument();
      expect(article).not.toHaveClass("opacity-60");
      // Busy, so screen readers don't read out every step it takes.
      expect(article).toHaveAttribute("aria-busy", "true");
      expect(within(article).queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();

      update(fileMessage({ id: "m1" }));
      expect(within(article).queryByRole("group", { name: "Upload moon.jpg" })).not.toBeInTheDocument();
      expect(within(article).getByText("Q3 report.pdf")).toBeInTheDocument();
      expect(article).not.toHaveAttribute("aria-busy");
      cleanup();
    }
  });

  it("stops being busy once its upload fails, so screen readers say why", () => {
    const { article } = show(uploading({ error: "Upload failed. Please attach the file and try again." }));
    expect(article).not.toHaveAttribute("aria-busy");
    expect(within(article).getByRole("alert")).toHaveTextContent("Upload failed. Please attach the file and try again.");
    expect(screen.queryByText("Not sent")).not.toBeInTheDocument();
  });
});

describe(feature("attachments.download-share"), () => {
  it("offers Download in place of Reply among a file message's actions", async () => {
    const { user } = show(fileMessage(), { me: grace });
    await user.click(optionsOn("Q3 report.pdf"));
    const bar = actionBar().firstElementChild!;
    expect([...bar.querySelectorAll("button, a")].map((control) => control.getAttribute("title"))).toEqual([
      "Thumbs up",
      "Clapping",
      "Waving hand",
      "Download",
      "Copy link",
      "More reactions",
    ]);
    const download = within(actionBar()).getByRole("link", { name: "Download" });
    expect(download).toHaveAttribute("href", report.downloadUrl);
    expect(download).toHaveClass("ios-pwa:hidden");
  });
});

describe(feature("messages.edit"), () => {
  it("edits a file message as its file and Delete message alone, which it focuses as it opens, and the room as it would the text", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { actions, editors, user, article } = show(fileMessage());
    await pressAction(user, "Edit", "Q3 report.pdf");
    expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(within(article).getByText("Q3 report.pdf")).toBeInTheDocument();
    expect(within(article).getByRole("link", { name: "Download Q3 report.pdf" })).toBeInTheDocument();

    const remove = screen.getByRole("button", { name: "Delete message" });
    expect(remove).toHaveFocus();
    act(() => remove.blur());
    expect(editors.attach).toHaveBeenLastCalledWith("m1", expect.anything());
    act(() => editors.attach.mock.lastCall![1].focus());
    expect(remove).toHaveFocus();
    await user.click(remove);
    expect(confirm).toHaveBeenCalledWith("Are you sure you want to delete this message?");
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(remove);
    expect(actions.remove).toHaveBeenCalledWith("m1");
    expect(editors.returnFocus).toHaveBeenCalled();
  });

  it("closes a file message's editor on Escape or Close editor and discard changes", async () => {
    const { editors, user } = show(fileMessage());
    await pressAction(user, "Edit", "Q3 report.pdf");
    await user.click(screen.getByRole("button", { name: "Close editor and discard changes" }));
    expect(editors.close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Delete message" })).not.toBeInTheDocument();

    await pressAction(user, "Edit", "Q3 report.pdf");
    await user.keyboard("{Escape}");
    expect(editors.close).toHaveBeenCalledTimes(2);
    expect(editors.attach).toHaveBeenLastCalledWith("m1", null);
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

describe(feature("messages.layout"), () => {
  it("heads a message with its author and time, and a follow-up with its time alone", () => {
    const { article } = show(message({ createdAt: "2026-10-12T15:04:00" }));
    const heading = within(article).getByRole("heading", { level: 3 });
    expect(within(heading).getByText("Ada")).toBeInTheDocument();
    expect(within(heading).getByRole("link", { name: "3:04 PM" })).toBeInTheDocument();
    cleanup();

    const followUp = within(show(message({ createdAt: "2026-10-12T15:04:00" }), { threaded: true }).article);
    expect(followUp.getByRole("heading", { level: 3 })).toHaveTextContent(/^3:04 PM$/);
  });

  it("titles the author with their bio as the people directory lists it, or with just their name", () => {
    const listed = (user: User, name: string, bio: string | null) => [user.id, { ...user, name, bio, role: "member", status: "active", avatarUrl: "" }] as const;
    const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
    const by = (creator: User) => message({ id: creator.id, clientMessageId: creator.id, creator });
    render(
      <PeopleContext value={new Map([listed(ada, "Ada King", "Countess of Lovelace"), listed(grace, "Grace Hopper", " ")])}>
        {[ada, grace, { id: "u3", name: "Linus" }].map((creator) => (
          <MessageItem key={creator.id} message={by(creator)} me={{ ...ada, administrator: false }} threaded={false} editing={false} actions={actions} editors={editors} />
        ))}
      </PeopleContext>,
    );
    expect(screen.getByText("Ada King")).toHaveAttribute("title", "Ada King – Countess of Lovelace");
    expect(screen.getByText("Grace Hopper")).toHaveAttribute("title", "Grace Hopper");
    // Someone the directory doesn't list keeps the name the message was given.
    expect(screen.getByText("Linus")).toHaveAttribute("title", "Linus");
  });
});

describe(feature("messages.follow-up-times"), () => {
  it("links each message's time to the message, with its date and time on hover", () => {
    const { article } = show(message({ id: "m 1", createdAt: "2026-10-12T15:04:00" }));
    const time = within(article).getByRole("link", { name: "3:04 PM" });
    expect(time).toHaveAttribute("href", "/rooms/general/@m%201");
    expect(time.querySelector("time")).toHaveAttribute("title", "10/12/26, 3:04 PM");
  });

  it("puts a follow-up's time after its text, and a message's on its way unlinked", () => {
    const { article } = show(message({ createdAt: "2026-10-12T15:04:00" }), { threaded: true });
    const time = within(article).getByRole("link", { name: "3:04 PM" });
    expect(time.compareDocumentPosition(within(article).getByText("Hello"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(time).toHaveClass("col-start-2", "opacity-0");
    cleanup();

    const pending = show({ ...message({ createdAt: "2026-10-12T15:04:00" }), pending: true });
    expect(within(pending.article).getByText("3:04 PM").closest("a")).toBeNull();
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

  it("keeps the other reactions and New boost in a tray", async () => {
    const { actions, user } = show(message(), { me: grace });
    await pressAction(user, "More reactions");
    const tray = screen.getByRole("group", { name: "More reactions" });
    expect(tray).toHaveTextContent(/^More reactions/);
    expect(within(tray).getAllByRole("button").map((b) => b.title)).toEqual(["Muscle", "Red heart", "Face with tears of joy", "Party popper", "Fire", "New boost"]);
    await user.click(within(tray).getByRole("button", { name: "Fire" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "🔥");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
    expect(optionsOn("Hello")).toHaveFocus();
  });

  it("lists reactions oldest first, each with its booster's avatar, and emoji larger than words", () => {
    show(message({ boosts: [boost("b1", grace, "👍"), boost("b2", ada, "🎉"), boost("b3", grace, "Nice one!"), boost("b4", ada, "👍")] }));
    const pills = reactions().getAllByRole("listitem");
    expect(pills.map((pill) => within(pill).getByRole("img").getAttribute("alt"))).toEqual([
      "Grace boosted 👍",
      "Ada boosted 🎉",
      "Grace boosted Nice one!",
      "Ada boosted 👍",
    ]);
    expect(pills.map((pill) => pill.textContent)).toEqual(["👍", "🎉", "Nice one!", "👍"]);
    expect(within(pills[0]!).getByText("👍")).toHaveClass("text-base");
    expect(within(pills[2]!).getByText("Nice one!")).toHaveClass("text-[0.8rem]");
  });

  it("opens the bar with More reactions from Add a boost, focusing the first, and Escape hands focus back", async () => {
    const { actions, user } = show(message({ boosts: [boost("b1", grace, "👍")] }));
    const add = screen.getByRole("button", { name: "Add a boost" });
    await user.click(add);
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("group", { name: "More reactions" })).getByRole("button", { name: "Muscle" })).toHaveFocus();
    // Clicking it again leaves them open.
    await user.click(add);
    expect(optionsOn("Hello")).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
    expect(add).toHaveFocus();

    await user.click(add);
    await user.click(screen.getByRole("button", { name: "Party popper" }));
    expect(actions.boost).toHaveBeenCalledWith("m1", "🎉");
    expect(optionsOn("Hello")).toHaveFocus();
  });

  it("shows Add a boost only once a message has a reaction", () => {
    show(message());
    expect(screen.queryByRole("list", { name: "Reactions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a boost" })).not.toBeInTheDocument();
  });

  it("lists reactions, but offers nothing, where nothing can be done, as in a room that's gone", () => {
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
    render(<MessageItem message={message({ boosts: [boost("b1", ada, "👍")] })} me={{ ...ada, administrator: true }} threaded={false} editing={false} actions={null} editors={editors} />);
    expect(reactions().getByRole("img", { name: "Ada boosted 👍" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe(feature("boosts.custom"), () => {
  /** Opens New boost's form on the message, from its bar's tray. */
  async function newBoost(user: UserEvent) {
    await pressAction(user, "More reactions");
    await user.click(screen.getByRole("button", { name: "New boost" }));
  }

  it("adds a reaction of your own from New boost's form, then hands focus to Message options", async () => {
    const { actions, user } = show(message());
    await newBoost(user);
    expect(screen.queryByRole("group", { name: "Message actions" })).not.toBeInTheDocument();
    const field = customField();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("placeholder", "Emoji or a short message");
    expect(field).toHaveAttribute("maxlength", "16");
    expect(field).toHaveAccessibleDescription("Up to 16 characters.");

    await user.type(field, "Ship it{Enter}");
    expect(actions.boost).toHaveBeenCalledWith("m1", "Ship it");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(optionsOn("Hello")).toHaveFocus();
  });

  it("won't add a blank reaction, or one that starts with a space", async () => {
    const { actions, user } = show(message());
    await newBoost(user);
    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    await user.type(customField(), " hi{Enter}");
    expect(actions.boost).not.toHaveBeenCalled();
    expect(customField()).toBeInvalid();
  });

  it("cancels on Cancel or Escape, handing focus to Message options", async () => {
    const { actions, user } = show(message({ boosts: [boost("b1", grace, "👍")] }));
    await newBoost(user);
    // The form takes Add a boost's place.
    expect(screen.queryByRole("button", { name: "Add a boost" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(optionsOn("Hello")).toHaveFocus();

    await newBoost(user);
    await user.type(customField(), "Nope{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a boost" })).toBeInTheDocument();
    expect(optionsOn("Hello")).toHaveFocus();
    expect(actions.boost).not.toHaveBeenCalled();
  });

  it("keeps the form and what's written when the reaction can't be sent", async () => {
    const { actions, user } = show(message(), { sent: false });
    await newBoost(user);
    await user.type(customField(), "LGTM{Enter}");
    expect(actions.boost).toHaveBeenCalledWith("m1", "LGTM");
    expect(customField()).toHaveValue("LGTM");
  });

  it("keeps what's written as others edit or react to the message, and goes as its editor opens", async () => {
    const { update, user } = show(message());
    await newBoost(user);
    await user.type(customField(), "Wow");
    update(message({ plainText: "Hello, edited", boosts: [boost("b1", grace, "👍")] }));
    expect(customField()).toHaveValue("Wow");
    expect(customField()).toHaveFocus();

    await pressAction(user, "Edit", "Hello, edited");
    expect(await editBox()).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Custom reaction" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Custom reaction" })).not.toBeInTheDocument();
  });

  it("focuses the form open already, keeping what's written, when New boost is chosen again", async () => {
    const { user } = show(message());
    await newBoost(user);
    await user.type(customField(), "Wow");
    await newBoost(user);
    expect(customField()).toHaveValue("Wow");
    expect(customField()).toHaveFocus();
  });
});

describe(feature("boosts.remove"), () => {
  it("reveals Delete this boost as you click your own reaction, or press Enter on it, focusing it", async () => {
    const { user } = show(message({ boosts: [boost("b1", grace, "👍"), boost("b2", ada, "🎉")] }));
    // Only your own reactions do anything.
    expect(reactions().getAllByRole("button").map((b) => b.textContent)).toEqual(["🎉"]);
    const mine = reactions().getByRole("button", { name: "🎉" });
    expect(mine).toHaveAccessibleDescription("Press enter to delete this boost");
    expect(mine).toHaveAttribute("aria-expanded", "false");

    await user.click(mine);
    expect(mine).toHaveAttribute("aria-expanded", "true");
    expect(reactions().getByRole("button", { name: "Delete this boost" })).toHaveFocus();
    await user.click(mine);
    expect(reactions().queryByRole("button", { name: "Delete this boost" })).not.toBeInTheDocument();

    act(() => mine.focus());
    await user.keyboard("{Enter}");
    expect(reactions().getByRole("button", { name: "Delete this boost" })).toHaveFocus();
  });

  it("deletes your reaction, shrinking it away, and hands focus to Message options", async () => {
    const { actions, user } = show(message({ boosts: [boost("b1", ada, "👍")] }));
    await user.click(reactions().getByRole("button", { name: "👍" }));
    await user.click(reactions().getByRole("button", { name: "Delete this boost" }));
    expect(actions.unboost).toHaveBeenCalledWith("b1");
    expect(reactions().getByRole("listitem")).toHaveClass("animate-scale-fade-out");
    expect(optionsOn("Hello")).toHaveFocus();
  });

  it("keeps your reaction when its deletion can't be sent, or brings it back when the page reconnects before it goes", async () => {
    const mine = boost("b1", ada, "👍");
    const { actions, update, reconnect, user } = show(message({ boosts: [mine] }), { sent: false });
    await user.click(reactions().getByRole("button", { name: "👍" }));
    const remove = reactions().getByRole("button", { name: "Delete this boost" });
    await user.click(remove);
    expect(actions.unboost).toHaveBeenCalledWith("b1");
    expect(reactions().getByRole("listitem")).not.toHaveClass("animate-scale-fade-out");
    expect(remove).toHaveFocus();

    // Sent, but lost, as when the connection drops before the room hears of it.
    actions.unboost.mockReturnValue(true);
    await user.click(remove);
    expect(reactions().getByRole("listitem")).toHaveClass("animate-scale-fade-out");
    // Someone editing the message doesn't bring it back, while the room may still delete it.
    update(message({ plainText: "Hello, edited", boosts: [{ ...mine }] }));
    expect(reactions().getByRole("listitem")).toHaveClass("animate-scale-fade-out");
    // A reconnect that doesn't delete it does, even when the room's copy of the message is the same object.
    reconnect();
    expect(reactions().getByRole("listitem")).not.toHaveClass("animate-scale-fade-out");
    expect(reactions().getByRole("button", { name: "Delete this boost" })).toBeInTheDocument();
  });

  it("brings your reactions back when the room refuses to delete one, as it doesn't say which", async () => {
    const { refuse, user } = show(message({ boosts: [boost("b1", ada, "👍"), boost("b2", ada, "🎉")] }));
    const going = () => reactions().getAllByRole("listitem").map((pill) => pill.classList.contains("animate-scale-fade-out"));
    for (const pill of reactions().getAllByRole("listitem")) {
      await user.click(within(pill).getByRole("button", { name: pill.textContent! }));
      await user.click(within(pill).getByRole("button", { name: "Delete this boost" }));
    }
    expect(going()).toEqual([true, true]);
    // As a room does from a banned address.
    refuse();
    expect(going()).toEqual([false, false]);

    // A deletion sent after it shows as going, as the room hasn't answered it yet.
    await user.click(reactions().getAllByRole("button", { name: "Delete this boost" })[0]!);
    expect(going()).toEqual([true, false]);
  });
});

describe(feature("mentions.highlight"), () => {
  const highlight = (article: HTMLElement) => article.querySelector(".border-mention");

  it("highlights a message that mentions you, wiggling it as it shows unless motion is reduced", () => {
    const { article } = show(message({ creator: grace, plainText: "Thanks @Ada!", mentions: [ada] }));
    expect(highlight(article)).toHaveClass("animate-wiggle", "motion-reduce:animate-none");
  });

  it("highlights your own messages that mention you too", () => {
    expect(highlight(show(message({ plainText: "Note to self @Ada", mentions: [grace, ada] })).article)).not.toBeNull();
  });

  it.each([
    ["mentions of others", [grace]],
    ["your name typed without mentioning you", []],
  ])("leaves %s alone", (_, mentions) => {
    expect(highlight(show(message({ creator: grace, plainText: "Thanks @Ada", mentions })).article)).toBeNull();
  });
});

describe(feature("mentions.render"), () => {
  const mention = (id: string) => `<action-text-attachment content-type="application/vnd.campfire.mention" sgid="${id}"></action-text-attachment>`;
  const hopper: User = { id: "0123456789abcdef", name: "Grace" };
  const listed = { ...hopper, name: "Grace Hopper", bio: null, role: "member", status: "active", avatarUrl: "" } as const;

  /** A message open in its editor, seen by Ada with `people` in the people directory, which has `loaded`. */
  const editing = (m: Message, people: People, loaded = true) => {
    const actions = { boost: vi.fn(), unboost: vi.fn(), edit: vi.fn(), remove: vi.fn() };
    const editors = { open: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), attach: vi.fn(), reply: vi.fn() };
    return (
      <PeopleContext value={people}>
        <DirectoryLoaded value={loaded}>
          <MessageItem message={m} me={{ ...ada, administrator: false }} threaded={false} editing actions={actions} editors={editors} />
        </DirectoryLoaded>
      </PeopleContext>
    );
  };

  it("edits a message with its mentions as the people directory lists them now, dropping those of no one", async () => {
    const body = `<p>Thanks ${mention(hopper.id)} and ${mention("fedcba9876543210")}!</p>`;
    render(editing(message({ body, plainText: "Thanks @Grace and !", mentions: [hopper] }), new Map([[hopper.id, listed]])));
    expect(await editBox()).toHaveValue("Thanks @Grace Hopper and !");
  });

  it("waits for the people directory to edit a message from before messages named the people they mention", async () => {
    const old = message({ body: `<p>Thanks ${mention(hopper.id)}!</p>`, plainText: "Thanks @Grace!", mentions: [{ id: hopper.id, name: "" }] });
    // Before it loads, the directory may hold someone the workspace socket said had changed.
    const changed = { ...ada, bio: null, role: "member", status: "active", avatarUrl: "" } as const;
    const { rerender } = render(editing(old, new Map([[ada.id, changed]]), false));
    await act(() => Promise.resolve());
    expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument();
    rerender(editing(old, new Map([[ada.id, changed], [hopper.id, listed]])));
    expect(await editBox()).toHaveValue("Thanks @Grace Hopper!");
  });
});

describe(feature("users.avatar-links"), () => {
  afterEach(() => history.replaceState(null, "", "/"));

  it("links the author's avatar to their page, titled with their name, and goes there in place", async () => {
    const { article, user } = show(message());
    const link = within(article).getByRole("link", { name: "Ada" });
    expect(link).toHaveAttribute("href", "/users/u1");
    expect(link.querySelector("img")).toHaveAttribute("aria-hidden", "true");
    await user.click(link);
    expect(location.pathname).toBe("/users/u1");
  });

  it("links each reaction's avatar to whoever added it, named by their reaction, yours as well as others'", async () => {
    const { user } = show(message({ boosts: [boost("b1", grace, "👍"), boost("b2", ada, "🎉")] }));
    const theirs = reactions().getByRole("link", { name: "Grace boosted 👍" });
    expect(theirs).toHaveAttribute("href", "/users/u2");
    expect(theirs).toHaveAttribute("title", "Grace");
    await user.click(reactions().getByRole("link", { name: "Ada boosted 🎉" }));
    expect(location.pathname).toBe("/users/u1");
    expect(reactions().getByRole("button", { name: "🎉" })).toHaveAttribute("aria-expanded", "false");
  });

  it("has no avatar on a message grouped under the one before, whose only link is its time's", () => {
    const { article } = show(message(), { threaded: true });
    expect(within(article).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/rooms/general/@m1"]);
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
    expect(reactions().getAllByRole("img").map((avatar) => avatar.getAttribute("alt"))).toEqual(["Grace Hopper boosted 👍", "Linus boosted 👍"]);
  });
});
