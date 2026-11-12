import { MAX_FILE_NAME_LENGTH, MAX_FILE_SIZE, MAX_SCHEDULE_AHEAD_MS, type ClientFrame, type LinkPreview, type Message, type ServerFrame, type ShareWidening, type StoredFile, type User } from "@ember/protocol";
import { OPENGRAPH_EMBED_CONTENT_TYPE, previewContent } from "@ember/richtext/dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PeopleContext } from "@/hooks/use-directory";
import { PHONE_LAYOUT } from "@/hooks/use-phone-layout";
import type { RoomFrames } from "@/hooks/use-room";
import { dateValue } from "@/lib/schedule-times";
import type { Sendable } from "@/lib/uploads";
import { createRef, useState } from "react";
import { Composer, RoomGoneNotice, type ComposerEdit, type ComposerHandle } from "./composer";
import { editorLoaded } from "./editor";
import { loadRarePages } from "./rare-pages";
import { UNDO_MS } from "./schedule-send";

// The editor here is test-setup.ts's stand-in for Lexxy, a text box whose lines are one paragraph,
// and every test starts before its code has loaded.
vi.mock("./editor", async (importOriginal) => ({ ...(await importOriginal<typeof import("./editor")>()), editorLoaded: vi.fn(() => false) }));

// What opens here loads with the pages few visits need, which take a while to import in a test.
beforeAll(() => loadRarePages(), 120_000);

async function showComposer({ typing = [] as User[], disabled = false, roomId = "r1", threadId = undefined as string | undefined, direct = false, closed = false, autoFocus = true } = {}) {
  const onSend = vi.fn((_body: string, _alsoSend: boolean) => true);
  const onSendFiles = vi.fn((_files: Sendable[], _alsoSend: boolean) => {});
  const onTyping = vi.fn();
  const composer = createRef<ComposerHandle>();
  const view = render(
    <Composer
      ref={composer}
      roomId={roomId}
      roomName="general"
      direct={direct}
      closed={closed}
      userId="u1"
      typing={typing}
      disabled={disabled}
      threadId={threadId}
      onSend={onSend}
      onSendFiles={onSendFiles}
      onTyping={onTyping}
      autoFocus={autoFocus}
    />,
  );
  // The editor loads as the first composer shows.
  const input = await screen.findByRole("textbox", { name: threadId === undefined ? "Write a message" : "Write a reply" });
  return { onSend, onSendFiles, onTyping, composer, view, user: userEvent.setup(), input };
}

function touchScreen() {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(pointer: coarse)", media, addEventListener() {}, removeEventListener() {} }));
}

const sendButton = () => screen.getByRole("button", { name: "Send Message" });
const formattingOptions = () => screen.getByRole("button", { name: /Formatting/ });
const attachFiles = () => screen.getByLabelText("Attach a file");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(editorLoaded).mockReturnValue(false);
});

describe("Composer", () => {
  it("names a private room without a `#` in its placeholder, as its lock in the header shows it", async () => {
    const { input } = await showComposer({ closed: true });
    expect(input).toHaveAttribute("placeholder", "Message general");
  });

  it("has the formatting toolbar on top, then the text box, then +, Aa, Emoji and @, and Send with its schedule menu", async () => {
    const { input, view } = await showComposer();
    expect(input).toHaveAttribute("placeholder", "Message #general");
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(toolbar.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Paragraph style",
      "Link",
      "Numbered list",
      "Bulleted list",
      "Blockquote",
      "Code",
      "Code block",
      "Divider",
    ]);
    const below = [...view.container.querySelectorAll("form button")].filter((button) => !toolbar.contains(button)).map((button) => button.textContent);
    expect(below).toEqual(["Attach", "AaFormatting", "Emoji", "Mention someone", "Send Message", "Schedule for later"]);
    expect(formattingOptions()).toHaveAttribute("title", "Hide formatting");
    expect(sendButton()).toHaveAttribute("title", "Send message");
    expect(attachFiles()).toHaveAttribute("type", "file");
  });

  it("focuses the text box as the room opens", async () => {
    const { input } = await showComposer();
    expect(input).toHaveFocus();
  });

  it("waits for a tap on touch screens, whose keyboard would cover the room", async () => {
    touchScreen();
    const { input } = await showComposer();
    expect(input).not.toHaveFocus();
  });

  const room = { roomId: "r1", roomName: "general", userId: "u1", typing: [], disabled: false, onSend: () => true, onSendFiles: () => {}, onTyping: () => {} };

  it("holds the editor back while the room's first messages are on their way, which loading it would delay", async () => {
    // React has the editor's code from an earlier composer, so it would show at once if it weren't held back.
    (await showComposer()).view.unmount();
    const view = render(<Composer {...room} deferEditor />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Message #general")).toBeInTheDocument();

    view.rerender(<Composer {...room} deferEditor={false} />);
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveFocus();
  });

  it("shows the editor at once when it has loaded for a room before", async () => {
    vi.mocked(editorLoaded).mockReturnValue(true);
    render(<Composer {...room} deferEditor />);
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveFocus();
  });

  it("leaves focus where it's been put while the editor was held back", async () => {
    (await showComposer()).view.unmount();
    const page = (deferEditor: boolean) => (
      <>
        <button type="button">Elsewhere</button>
        <Composer {...room} deferEditor={deferEditor} />
      </>
    );
    const view = render(page(true));
    screen.getByRole("button", { name: "Elsewhere" }).focus();

    view.rerender(page(false));
    expect(await screen.findByRole("textbox", { name: "Write a message" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("takes focus from the last room's composer, which goes as this one opens", async () => {
    const { view } = await showComposer();
    view.rerender(<Composer key="r2" {...room} roomId="r2" />);
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveFocus();
  });
});

describe("Group DMs and DM names", () => {
  it("asks for a message to the others in a DM by name, without the #", async () => {
    render(<Composer roomId="d1" roomName="Grace and Linus" direct userId="u1" typing={[]} disabled={false} onSend={() => true} onSendFiles={() => {}} onTyping={() => {}} />);
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message Grace and Linus");
  });
});

describe("Formatting toolbar", () => {
  const tool = (name: string) => within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name });

  it("shows the toolbar until Aa hides it, keeping focus in the text, and remembers that in this browser", async () => {
    const { input, user, view } = await showComposer();
    const form = view.container.querySelector("form")!;
    expect(formattingOptions()).toHaveAttribute("aria-pressed", "true");
    expect(form).toHaveAttribute("data-toolbar");

    await user.click(formattingOptions());
    expect(formattingOptions()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(form).not.toHaveAttribute("data-toolbar");
    expect(input).toHaveFocus();

    view.unmount();
    await showComposer();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("hides the toolbar on touch screens until Aa shows it", async () => {
    touchScreen();
    const { user } = await showComposer();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    await user.click(formattingOptions());
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("turns formats on and off, showing which are on at the cursor, and keeps focus in the text", async () => {
    const { input, user } = await showComposer();
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Blockquote", "Bulleted list"]) {
      expect(tool(name)).toHaveAttribute("aria-pressed", "false");
      await user.click(tool(name));
      expect(tool(name), name).toHaveAttribute("aria-pressed", "true");
      expect(input).toHaveFocus();
    }
    await user.click(tool("Numbered list"));
    expect(tool("Numbered list")).toHaveAttribute("aria-pressed", "true");
    expect(tool("Bulleted list")).toHaveAttribute("aria-pressed", "false");
    expect(tool("Bold")).toHaveAttribute("title", "Bold (Ctrl+B)");
  });

  it("is one stop for Tab, whose arrow keys, Home and End move between the buttons that work", async () => {
    const { user, input } = await showComposer();
    const tools = within(screen.getByRole("toolbar", { name: "Formatting" })).getAllByRole("button");
    expect(tools.filter((tool) => tool.tabIndex === 0)).toEqual([tool("Bold")]);
    await user.click(input);
    await user.tab({ shift: true });
    expect(tool("Bold")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tool("Italic")).toHaveFocus();
    await user.keyboard("{End}");
    expect(tool("Divider")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tool("Bold")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tool("Divider")).toHaveFocus();
    // Tab leaves from the button last focused, which it comes back to.
    expect(tools.filter((tool) => tool.tabIndex === 0)).toEqual([tool("Divider")]);

    // In code, where only Code block works, that's the stop.
    await user.click(tool("Code block"));
    expect(within(screen.getByRole("toolbar", { name: "Formatting" })).getAllByRole("button").filter((tool) => tool.tabIndex === 0)).toEqual([tool("Code block")]);
  });

  it("strikes through on Ctrl+Shift+X", async () => {
    const { user } = await showComposer();
    await user.keyboard("{Control>}{Shift>}x{/Shift}{/Control}");
    expect(tool("Strikethrough")).toHaveAttribute("aria-pressed", "true");
  });

  it("turns the lines at the cursor into a heading from the paragraph style menu", async () => {
    const { user } = await showComposer();
    await user.click(tool("Paragraph style"));
    await user.click(await screen.findByRole("menuitemradio", { name: "Heading" }));
    expect(tool("Paragraph style")).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves only the button that turns code off working inside code, where it shows code as on", async () => {
    const { user } = await showComposer();
    await user.click(tool("Code block"));
    expect(tool("Code block")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Bold", "Link", "Code", "Bulleted list", "Divider"]) expect(tool(name), name).toBeDisabled();
    await user.click(tool("Code block"));
    expect(tool("Bold")).toBeEnabled();

    await user.click(tool("Code"));
    expect(tool("Code")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Bold", "Italic", "Code block", "Blockquote"]) expect(tool(name), name).toBeDisabled();
    expect(tool("Code")).toBeEnabled();
  });

  it("has every button working again once code is sent, in the empty box left", async () => {
    const { onSend, input, user } = await showComposer();
    const everyTool = () => within(screen.getByRole("toolbar", { name: "Formatting" })).getAllByRole("button");
    await user.click(tool("Code block"));
    await user.type(input, "let a = 1;{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledOnce();
    expect(input).toHaveValue("");
    for (const button of everyTool()) {
      expect(button, button.getAttribute("aria-label")!).toBeEnabled();
      expect(button, button.getAttribute("aria-label")!).not.toHaveAttribute("aria-pressed", "true");
    }

    await user.click(tool("Code"));
    await user.type(input, "x{Enter}");
    expect(onSend).toHaveBeenCalledTimes(2);
    for (const button of everyTool()) expect(button, button.getAttribute("aria-label")!).toBeEnabled();
    await user.type(input, "plain");
    expect(tool("Bold")).toBeEnabled();
  });

  it("keeps formatting what's written while the room is disconnected, which holds it to send", async () => {
    const { input, user } = await showComposer({ disabled: true });
    await user.click(tool("Bold"));
    expect(tool("Bold")).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveFocus();
    for (const name of ["Formatting", "Emoji", "Mention someone"]) expect(screen.getByRole("button", { name: new RegExp(name) }), name).toBeEnabled();
    for (const name of ["Attach", "Schedule for later"]) expect(screen.getByRole("button", { name }), name).toBeDisabled();
    expect(sendButton()).toBeEnabled();
  });

  it("starts a new line on Enter in a code block, and a new item in a list, where Ctrl+Enter sends", async () => {
    const { onSend, input, user } = await showComposer();
    await user.click(tool("Code block"));
    await user.type(input, "one{Enter}two");
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>one<br>two</p>", false);
    expect(tool("Code block")).toHaveAttribute("aria-pressed", "false");

    await user.click(tool("Bulleted list"));
    await user.type(input, "a{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("links what's selected to an address from Link, or Ctrl+K, giving one without a scheme https://", async () => {
    const { input, user } = await showComposer();
    await user.type(input, "the plan");
    (input as HTMLTextAreaElement).setSelectionRange(4, 8);
    await user.keyboard("{Control>}k{/Control}");
    const field = await screen.findByRole("textbox", { name: "Link" });
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue("plan");
    expect(field).toHaveFocus();
    await user.type(field, "not an address{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a web address");

    await user.clear(field);
    await user.type(field, "example.com/a{Enter}");
    expect(screen.queryByRole("textbox", { name: "Link" })).not.toBeInTheDocument();
    expect(input).toHaveAttribute("data-link", "https://example.com/a");
    expect(input).toHaveAttribute("data-link-text", "plan");
    expect(tool("Link")).toHaveAttribute("aria-pressed", "true");

    // Editing the link starts from its address, and Cancel leaves it.
    await user.click(tool("Link"));
    expect(await screen.findByRole("textbox", { name: "Link" })).toHaveValue("https://example.com/a");
    await user.type(screen.getByRole("textbox", { name: "Text" }), " B");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Link" })).not.toBeInTheDocument();
    expect(input).toHaveAttribute("data-link-text", "plan");

    await user.click(tool("Link"));
    await user.click(await screen.findByRole("button", { name: "Remove link" }));
    expect(input).toHaveAttribute("data-link", "");
  });
});

describe("Insert", () => {
  it("writes an emoji at the cursor from Emoji, and an @ from Mention someone", async () => {
    const { input, user } = await showComposer();
    await user.type(input, "Hi ");
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    await user.click(within(await screen.findByRole("group", { name: "Emoji" })).getAllByRole("button")[0]!);
    await user.click(screen.getByRole("button", { name: "Mention someone" }));
    expect(input).toHaveValue("Hi 👍@");
    expect(input).toHaveFocus();
  });
});

describe("Send from the keyboard", () => {
  it("sends what's written on Enter, then empties the box and keeps focus", async () => {
    const { onSend, input, user } = await showComposer();
    await user.type(input, "Hello there{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Hello there</p>", false);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("starts a new line on Shift+Enter instead of sending", async () => {
    const { onSend, input, user } = await showComposer();
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");

    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledWith("<p>line one<br>line two</p>", false);
  });

  it("sends on Enter while the toolbar shows, as Slack does, and keeps the toolbar", async () => {
    const { onSend, input, user } = await showComposer();
    await user.type(input, "one{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>one</p>", false);
    expect(formattingOptions()).toHaveAttribute("aria-pressed", "true");
  });

  it("sends only from the Send button on touch screens", async () => {
    touchScreen();
    const { onSend, input, user } = await showComposer();
    await user.type(input, "Hi{Enter}");
    expect(onSend).not.toHaveBeenCalled();

    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledOnce();
    expect(input).toHaveFocus();
  });

  it("won't send a blank message, though Send stays enabled", async () => {
    const { onSend, input, user } = await showComposer();
    expect(sendButton()).toBeEnabled();
    await user.type(input, "   {Enter}");
    await user.click(sendButton());
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it("keeps what's written when the room won't take it, as when it's too long", async () => {
    const { onSend, input, user } = await showComposer();
    onSend.mockReturnValue(false);
    await user.type(input, "Too much{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Too much</p>", false);
    expect(input).toHaveValue("Too much");
    expect(input).toHaveFocus();
    expect(localStorage.getItem("composer-draft-u1-r1")).toBe("<p>Too much</p>");
  });

  it("sends what's written while the room is disconnected, to wait for it, as Slack does, keeping files picked for when it's back", async () => {
    const { onSend, onSendFiles, input, user, view } = await showComposer({ disabled: true });
    fireEvent.drop(view.container.querySelector("form")!, { dataTransfer: { files: [fileOf("plan.txt")] } });
    await user.type(input, "Are you there?{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Are you there?</p>", false);
    expect(onSendFiles).not.toHaveBeenCalled();
    expect(chips()).toEqual(["Remove plan.txt"]);
    expect(input).toHaveValue("");
    expect(sendButton()).toBeEnabled();
  });
});

/** A file named `name` of `size` bytes, as the browser gives it, which says it's that size without holding them. */
function fileOf(name: string, { type = "text/plain", size = 3 } = {}) {
  const file = new File(["abc"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** What's pasted: `files`, and no text. */
const clipboard = (...files: File[]) => ({ files, getData: () => "" });

/** The files waiting to be sent, by their chips' names. */
const chips = () => screen.queryAllByRole("button", { name: /^Remove / }).map((chip) => chip.getAttribute("aria-label"));

/** Makes the thumbnails' addresses `blob:<name>`, answering those made and those let go. */
function thumbnails() {
  const made: string[] = [];
  const revoked: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
    made.push(`blob:${(file as File).name}`);
    return made.at(-1)!;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(url));
  return { made, revoked };
}

describe("Attach files", () => {
  afterEach(() => vi.restoreAllMocks());

  it("waits to send the files picked with Attach files, in order of their names, however often they're picked", async () => {
    const { user } = await showComposer();
    expect(attachFiles()).toHaveAttribute("type", "file");
    expect(attachFiles()).toHaveAttribute("multiple");
    await user.upload(attachFiles(), [fileOf("b.txt"), fileOf("A.pdf"), fileOf("a.txt")]);
    expect(chips()).toEqual(["Remove A.pdf", "Remove a.txt", "Remove b.txt"]);

    await user.upload(attachFiles(), fileOf("a.txt"));
    expect(chips()).toEqual(["Remove A.pdf", "Remove a.txt", "Remove a.txt", "Remove b.txt"]);
    expect(attachFiles()).toHaveValue("");
  });

  it("keeps Send's two halves in ink together with files alone, which can't be scheduled", async () => {
    const { user } = await showComposer();
    const send = screen.getByRole("button", { name: "Send Message" });
    expect(send.parentElement).not.toHaveAttribute("data-sendable");
    await user.upload(attachFiles(), fileOf("a.txt"));
    expect(send).toBeEnabled();
    expect(screen.getByRole("button", { name: "Schedule for later" })).toBeDisabled();
    // The chevron's dimming is for a pair with nothing to send.
    expect(send.parentElement).toHaveAttribute("data-sendable");
  });

  it("offers Upload a file and Files in Ember in an action sheet on phones, which leaves focus where it goes", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === PHONE_LAYOUT || media === "(pointer: coarse)", media, addEventListener() {}, removeEventListener() {} }));
    await import("./pages");
    const { user } = await showComposer();
    const click = vi.spyOn(attachFiles(), "click");
    await user.click(screen.getByRole("button", { name: "Attach" }));
    const sheet = await screen.findByRole("dialog", { name: "Attach" });
    expect(within(sheet).getAllByRole("button").map((button) => button.textContent)).toEqual(["Upload a file", "Files in Ember"]);
    await user.click(within(sheet).getByRole("button", { name: "Upload a file" }));
    expect(click).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Attach" })).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Write a message" })).not.toHaveFocus();
    vi.unstubAllGlobals();
  });

  it("shows the files picked inside the card under the text: a picture's thumbnail, and anything else's icon, name, type and size", async () => {
    const { made } = thumbnails();
    const { input, user } = await showComposer();
    await user.upload(attachFiles(), [fileOf("moon.jpg", { type: "image/jpeg" }), fileOf("archive.tar.gz", { type: "application/gzip", size: 12_300 }), fileOf("README")]);

    const list = screen.getByRole("list", { name: "Files to send" });
    expect(input.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(sendButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(made).toEqual(["blob:moon.jpg"]);
    expect(within(list).getByRole("img", { name: "moon.jpg" })).toHaveAttribute("src", "blob:moon.jpg");
    const archive = screen.getByRole("button", { name: "Remove archive.tar.gz" }).closest("li")!;
    expect(archive.querySelector("img")).toBeNull();
    expect(archive.querySelector("svg")).toHaveClass("iconoir-page");
    // The name runs to an ellipsis at its end.
    expect(within(archive).getByText("archive.tar.gz")).toHaveClass("truncate");
    expect(archive).toHaveTextContent("GZ · 13 KB");
    expect(screen.getByRole("button", { name: "Remove README" }).closest("li")).toHaveTextContent("File · 3 B");
  });

  it("moves focus to the next file's remove button as one's removed, or to the text after the last", async () => {
    const { user, input } = await showComposer();
    await user.upload(attachFiles(), [fileOf("a.txt"), fileOf("b.txt")]);
    await user.click(screen.getByRole("button", { name: "Remove a.txt" }));
    expect(screen.getByRole("button", { name: "Remove b.txt" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Remove b.txt" }));
    expect(input).toHaveFocus();
  });

  it("takes a file back out when its chip is pressed, letting go of its thumbnail", async () => {
    const { revoked } = thumbnails();
    const { user, onSendFiles } = await showComposer();
    await user.upload(attachFiles(), [fileOf("moon.jpg", { type: "image/jpeg" }), fileOf("notes.txt")]);
    await user.click(screen.getByRole("button", { name: "Remove moon.jpg" }));
    expect(chips()).toEqual(["Remove notes.txt"]);
    expect(revoked).toEqual(["blob:moon.jpg"]);

    await user.click(sendButton());
    expect(onSendFiles).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: "notes.txt" })], false);
  });

  it("sends the files, each as a message of its own, before what's written, and empties the list", async () => {
    const { onSend, onSendFiles, input, user } = await showComposer();
    const [b, a] = [fileOf("b.txt"), fileOf("a.txt")];
    await user.upload(attachFiles(), [b, a]);
    await user.type(input, "Here they are{Enter}");
    expect(onSendFiles).toHaveBeenCalledExactlyOnceWith([a, b], false);
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Here they are</p>", false);
    expect(onSendFiles.mock.invocationCallOrder[0]).toBeLessThan(onSend.mock.invocationCallOrder[0]!);
    expect(chips()).toEqual([]);
    expect(input).toHaveFocus();
  });

  it("sends the files picked before the editor shows, as its code loads, which what's written waits for", async () => {
    (await showComposer()).view.unmount();
    const onSendFiles = vi.fn();
    const user = userEvent.setup();
    render(<Composer roomId="r1" roomName="general" userId="u1" typing={[]} disabled={false} deferEditor onSend={() => true} onSendFiles={onSendFiles} onTyping={() => {}} />);
    await user.upload(attachFiles(), fileOf("a.txt"));
    await user.click(sendButton());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onSendFiles).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: "a.txt" })], false);
    expect(chips()).toEqual([]);
  });

  it("sends files with nothing written", async () => {
    const { onSend, onSendFiles, user } = await showComposer();
    await user.upload(attachFiles(), fileOf("a.txt"));
    await user.click(sendButton());
    expect(onSendFiles).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();

    // Nor anything at all with nothing picked.
    await user.click(sendButton());
    expect(onSendFiles).toHaveBeenCalledOnce();
  });

  it("holds on to the files while the room is disconnected, when files can't be picked", async () => {
    const { onSendFiles, composer, input, user } = await showComposer({ disabled: true });
    expect(attachFiles()).toBeDisabled();
    act(() => composer.current!.addFiles([fileOf("a.txt")]));
    await user.type(input, "{Enter}");
    expect(onSendFiles).not.toHaveBeenCalled();
    expect(chips()).toEqual(["Remove a.txt"]);
  });

  it("waits to send the files dropped on the composer, the text box included, as a copy", async () => {
    const { input, view } = await showComposer();
    const form = view.container.querySelector("form")!;
    const dataTransfer = { files: [fileOf("dropped.txt")], dropEffect: "none" };
    // Each is cancelled, so the browser doesn't open the file in place of the page.
    expect(fireEvent.dragEnter(form, { dataTransfer })).toBe(false);
    expect(fireEvent.dragOver(form, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(fireEvent.drop(form, { dataTransfer })).toBe(false);
    expect(chips()).toEqual(["Remove dropped.txt"]);

    expect(fireEvent.drop(input, { dataTransfer: { files: [fileOf("on the text.txt")] } })).toBe(false);
    expect(chips()).toEqual(["Remove dropped.txt", "Remove on the text.txt"]);
    expect(input).toHaveValue("");
  });

  it("waits to send the files dropped on the room's messages, which the room hands over", async () => {
    const { composer } = await showComposer();
    act(() => composer.current!.addFiles([fileOf("b.txt"), fileOf("a.txt")]));
    expect(chips()).toEqual(["Remove a.txt", "Remove b.txt"]);
  });
});

describe("Pasting into the composer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("waits to send pasted files rather than writing them, and leaves pasted text to the editor", async () => {
    thumbnails();
    const { input } = await showComposer();
    expect(fireEvent.paste(input, { clipboardData: clipboard(fileOf("pasted.png", { type: "image/png" })) })).toBe(false);
    expect(chips()).toEqual(["Remove pasted.png"]);
    expect(input).toHaveValue("");

    expect(fireEvent.paste(input, { clipboardData: clipboard() })).toBe(true);
    expect(chips()).toEqual(["Remove pasted.png"]);
  });
});

describe("250 MB file limit", () => {
  const tooLarge = (name: string) => `${name} is too large. Choose a file that’s 250 MB or smaller.`;

  it("leaves out files over 250 MB, saying so under the others until more are picked, dropped or pasted", async () => {
    const { input, user, view, onSendFiles } = await showComposer();
    await user.upload(attachFiles(), [
      fileOf("huge.mov", { size: MAX_FILE_SIZE + 1 }),
      fileOf("fits.mov", { size: MAX_FILE_SIZE }),
      fileOf("vast.iso", { size: MAX_FILE_SIZE + 1 }),
    ]);
    expect(chips()).toEqual(["Remove fits.mov"]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`${tooLarge("huge.mov")} ${tooLarge("vast.iso")}`, { normalizeWhitespace: false });
    expect(alert).toHaveClass("w-full", "text-negative");

    // It stays through sending and removing files.
    await user.click(sendButton());
    expect(onSendFiles).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: "fits.mov" })], false);
    expect(screen.getByRole("alert")).toBe(alert);

    // Picking more says only what's wrong with them.
    await user.upload(attachFiles(), fileOf("enormous.zip", { size: MAX_FILE_SIZE + 1 }));
    expect(screen.getByRole("alert")).toHaveTextContent(tooLarge("enormous.zip"), { normalizeWhitespace: false });
    fireEvent.drop(view.container.querySelector("form")!, { dataTransfer: { files: [fileOf("small.txt")] } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Pasting anything clears it, even text.
    await user.upload(attachFiles(), fileOf("enormous.zip", { size: MAX_FILE_SIZE + 1 }));
    fireEvent.paste(input, { clipboardData: clipboard() });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves out a file whose name is too long to keep, saying so, as the room wouldn't take it", async () => {
    await showComposer();
    const user = userEvent.setup();
    await user.upload(attachFiles(), [fileOf(`${"a".repeat(MAX_FILE_NAME_LENGTH)}.txt`), fileOf("short.txt")]);
    expect(chips()).toEqual(["Remove short.txt"]);
    expect(screen.getByRole("alert")).toHaveTextContent(`A file’s name is too long. Rename it to ${MAX_FILE_NAME_LENGTH} characters or fewer.`);
  });
});

describe("Keep drafts", () => {
  const draft = (roomId = "r1") => localStorage.getItem(`composer-draft-u1-${roomId}`);

  it("keeps what's written in this browser until it's sent", async () => {
    const { input, user } = await showComposer();
    await user.type(input, "Hello");
    expect(draft()).toBe("<p>Hello</p>");

    await user.keyboard("{Enter}");
    expect(draft()).toBeNull();
  });

  it("forgets it once the box is emptied", async () => {
    const { input, user } = await showComposer();
    await user.type(input, "Hello");
    await user.clear(input);
    expect(draft()).toBeNull();
  });

  it("brings it back, with the cursor at the end, when the room opens again", async () => {
    localStorage.setItem("composer-draft-u1-r1", "<p>Where was I</p>");
    const { input } = await showComposer();
    expect(input).toHaveValue("Where was I");
    expect(input).toHaveFocus();
    expect((input as HTMLTextAreaElement).selectionStart).toBe("Where was I".length);
  });

  it("keeps each room's apart", async () => {
    localStorage.setItem("composer-draft-u1-r2", "<p>For the other room</p>");
    const { input } = await showComposer({ roomId: "r1" });
    expect(input).toHaveValue("");
  });

  it("keeps each person's apart, so whoever signs in on this browser next doesn't see it", async () => {
    localStorage.setItem("composer-draft-u2-r1", "<p>Grace's own</p>");
    const { input } = await showComposer({ roomId: "r1" });
    expect(input).toHaveValue("");
  });
});

describe("Reply in a thread", () => {
  const alsoSend = () => screen.getByRole("checkbox", { name: "Also send to #general" });

  it("asks for a reply, with Also send to the room, unticked, before Send", async () => {
    const { input } = await showComposer({ threadId: "m1" });
    expect(input).toHaveAttribute("placeholder", "Reply…");
    expect(alsoSend()).not.toBeChecked();
    expect(alsoSend().compareDocumentPosition(sendButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers to send it as a direct message too in a DM", async () => {
    await showComposer({ threadId: "m1", direct: true });
    expect(screen.getByRole("checkbox", { name: "Also send as direct message" })).not.toBeChecked();
  });

  it("sends a reply to the thread alone, or to the room too while Also send is ticked, which sending unticks", async () => {
    const { onSend, input, user } = await showComposer({ threadId: "m1" });
    await user.type(input, "Just here{Enter}");
    expect(onSend).toHaveBeenLastCalledWith("<p>Just here</p>", false);

    await user.click(alsoSend());
    await user.type(input, "Everywhere{Enter}");
    expect(onSend).toHaveBeenLastCalledWith("<p>Everywhere</p>", true);
    expect(alsoSend()).not.toBeChecked();
  });

  it("sends files to the room too while Also send is ticked", async () => {
    const { onSendFiles, user } = await showComposer({ threadId: "m1" });
    await user.upload(attachFiles(), new File(["hi"], "notes.txt", { type: "text/plain" }));
    await user.click(alsoSend());
    await user.click(sendButton());
    expect(onSendFiles).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: "notes.txt" })], true);
    expect(alsoSend()).not.toBeChecked();
  });

  it("keeps a thread's draft apart from its room's", async () => {
    localStorage.setItem("composer-draft-u1-r1", "<p>For the room</p>");
    const { input, user } = await showComposer({ threadId: "m1" });
    expect(input).toHaveValue("");
    await user.type(input, "For the thread");
    expect(localStorage.getItem("composer-draft-u1-r1/threads/m1")).toBe("<p>For the thread</p>");
    expect(localStorage.getItem("composer-draft-u1-r1")).toBe("<p>For the room</p>");
  });

  it("leaves focus be as the room opens with a thread beside it, which takes it", async () => {
    const { input } = await showComposer({ autoFocus: false });
    expect(input).not.toHaveFocus();
  });
});

describe("Reply with a quote", () => {
  it("writes a reply in place of what's written, with the cursor at its end, keeping it as the draft", async () => {
    const composer = createRef<ComposerHandle>();
    const onTyping = vi.fn();
    render(
      <Composer ref={composer} roomId="r1" roomName="general" userId="u1" typing={[]} disabled={false} onSend={() => true} onSendFiles={() => {}} onTyping={onTyping} />,
    );
    const input = await screen.findByRole("textbox", { name: "Write a message" });
    await userEvent.setup().type(input, "Unsent");
    act(() => (input as HTMLTextAreaElement).blur());

    // The stand-in holds a quote as Action Text's plain text, in quotation marks.
    act(() => composer.current!.replace("<blockquote><p>Third time's a charm.</p></blockquote><cite>Ada</cite><p><br></p>"));
    const written = "“Third time's a charm.”\n\nAda";
    expect(input).toHaveValue(written);
    expect(input).toHaveFocus();
    expect((input as HTMLTextAreaElement).selectionStart).toBe(written.length);
    expect(localStorage.getItem("composer-draft-u1-r1")).toBe("<p>“Third time's a charm.”<br><br>Ada</p>");
    expect(onTyping).toHaveBeenLastCalledWith(true);
  });

  it("opens the editor with a reply written while its code loaded, taking focus, even on touch screens", async () => {
    (await showComposer()).view.unmount();
    touchScreen();
    const composer = createRef<ComposerHandle>();
    const onTyping = vi.fn();
    const page = (deferEditor: boolean) => (
      <Composer
        ref={composer}
        roomId="r1"
        roomName="general"
        userId="u1"
        typing={[]}
        disabled={false}
        deferEditor={deferEditor}
        onSend={() => true}
        onSendFiles={() => {}}
        onTyping={onTyping}
      />
    );
    const view = render(page(true));
    const quote = "<blockquote><p>Third time's a charm.</p></blockquote><cite>Ada</cite><p><br></p>";
    act(() => composer.current!.replace(quote));
    expect(localStorage.getItem("composer-draft-u1-r1")).toBe(quote);
    expect(onTyping).toHaveBeenLastCalledWith(true);

    view.rerender(page(false));
    const input = await screen.findByRole("textbox", { name: "Write a message" });
    expect(input).toHaveValue("“Third time's a charm.”\n\nAda");
    expect(input).toHaveFocus();
  });
});

describe("Link previews while writing", () => {
  const basecamp: LinkPreview = { title: "Basecamp", url: "https://basecamp.com/", image: "https://basecamp.com/og.png", description: "Calm & organized" };

  /** Answers each ask for a link's preview with what `answer` gives for its address. */
  function previews(answer: (url: string) => Response | Promise<Response>) {
    const fetch = vi.fn(async (_path: string, init: RequestInit) => answer(JSON.parse(init.body as string).url));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  /** The link previews the composer shows. */
  const shownPreviews = (view: ReturnType<typeof render>) => view.container.querySelectorAll(`action-text-attachment[content-type="${OPENGRAPH_EMBED_CONTENT_TYPE}"]`);

  it("adds the preview of a pasted link's page below it, which goes with the message", async () => {
    const fetch = previews(() => Response.json(basecamp));
    const { onSend, user } = await showComposer();
    await user.paste("https://basecamp.com");
    expect(await screen.findByRole("link", { name: "Basecamp" })).toHaveAttribute("href", "https://basecamp.com/");
    expect(fetch).toHaveBeenCalledWith("/api/unfurl", expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://basecamp.com" }) }));

    await user.keyboard("{Enter}");
    const sent = new DOMParser().parseFromString(onSend.mock.calls[0]![0], "text/html").body;
    expect(sent.querySelector("p")!.textContent).toBe("https://basecamp.com");
    const attachment = sent.querySelector("action-text-attachment")!;
    expect(attachment.getAttribute("content-type")).toBe(OPENGRAPH_EMBED_CONTENT_TYPE);
    expect(attachment.getAttribute("content")).toBe(
      previewContent({ href: "https://basecamp.com/", url: "https://basecamp.com/og.png", filename: "Basecamp", description: "Calm & organized" }),
    );
  });

  it("adds nothing for a page without a preview, or a preview that can't be had", async () => {
    const answers: Record<string, Response> = {
      "https://example.com/none": new Response(null, { status: 204 }),
      "https://example.com/limited": Response.json({ error: "Too many link previews. Try again in a minute." }, { status: 429 }),
      "https://example.com/untitled": Response.json({ ...basecamp, title: "" }),
    };
    const fetch = previews((url) => answers[url]!);
    const { user, view } = await showComposer();
    for (const url of Object.keys(answers)) await user.paste(url);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(shownPreviews(view)).toHaveLength(0);
  });

  it("forgets the preview of a link once another is pasted, or the composer goes", async () => {
    let answerFirst!: () => void;
    const firstAnswered = new Promise<void>((resolve) => (answerFirst = resolve));
    const fetch = previews(async (url) => {
      if (url.endsWith("first")) await firstAnswered;
      return Response.json({ ...basecamp, title: url });
    });
    const { user, view } = await showComposer();
    await user.paste("https://example.com/first");
    await user.paste("https://example.com/second");
    expect(await screen.findByRole("link", { name: "https://example.com/second" })).toBeInTheDocument();
    expect(fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
    await act(async () => answerFirst());
    expect(shownPreviews(view)).toHaveLength(1);

    await user.paste("https://example.com/third");
    view.unmount();
    expect(fetch.mock.calls[2]![1].signal!.aborted).toBe(true);
  });
});

describe("Typing indicator", () => {
  it("reports typing while there's text, and stops when it's cleared, but not when the box loses focus", async () => {
    const { onTyping, input, user } = await showComposer();
    await user.type(input, "Hi");
    expect(onTyping).toHaveBeenLastCalledWith(true);
    await user.clear(input);
    expect(onTyping).toHaveBeenLastCalledWith(false);
    await user.type(input, "Hi");
    onTyping.mockClear();
    await user.tab();
    expect(onTyping).not.toHaveBeenCalled();
  });

  it("leaves it to the message, whose arrival stops the others showing you typing", async () => {
    const { onTyping, input, user } = await showComposer();
    await user.type(input, "Hi{Enter}");
    expect(onTyping).not.toHaveBeenCalledWith(false);
  });

  const typist = (name: string, i: number): User => ({ id: `u${i}`, name });

  it.each([
    [["Ada"], "Ada"],
    [["Grace", "Ada"], "Ada, Grace"],
    [["Linus", "Grace", "Ada", "Ken"], "Ada, Grace, Ken, Linus"],
    // Sorted by code unit, as JavaScript sorts strings, so capitals come first.
    [["ada", "Bob"], "Bob, ada"],
  ])("names whoever is typing after a spinner, sorted and comma-separated: %j", async (names, line) => {
    const { view } = await showComposer({ typing: names.map(typist) });
    const indicator = view.container.querySelector(".spinner")!;
    expect(indicator).toHaveTextContent(line, { normalizeWhitespace: false });
    expect(indicator).not.toHaveClass("hidden");
    expect(indicator.parentElement).not.toHaveClass("opacity-0");
    expect(indicator.closest("[aria-live]")).toBeNull();
  });

  it("names them as the people directory lists them now, which follows a rename since the room heard them", async () => {
    const grace = { id: "u2", name: "Grace Hopper", bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" } as const;
    const { container } = render(
      <PeopleContext value={new Map([[grace.id, grace]])}>
        <Composer
          roomId="r1"
          roomName="general"
          userId="u1"
          typing={[typist("Linus", 1), typist("Grace", 2)]}
          disabled={false}
          onSend={vi.fn(() => true)}
          onSendFiles={vi.fn()}
          onTyping={vi.fn()}
        />
      </PeopleContext>,
    );
    await screen.findByRole("textbox", { name: "Write a message" });
    expect(container.querySelector(".spinner")).toHaveTextContent("Grace Hopper, Linus", { normalizeWhitespace: false });
  });

  it("shows nothing while nobody is typing, and fades in when someone starts", async () => {
    const { view } = await showComposer();
    const indicator = view.container.querySelector(".spinner")!;
    expect(indicator).toHaveTextContent("");
    expect(indicator).toHaveClass("hidden");
    expect(indicator.parentElement).toHaveClass("opacity-0", "transition-opacity", "duration-300");
  });
});

describe("Only members see a room", () => {
  it("says a room that's gone was deleted, in red, shaking once where motion is welcome", () => {
    render(<RoomGoneNotice gone="deleted" />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("This room was deleted.");
    expect(notice).toHaveClass("text-negative", "border-negative", "motion-safe:animate-shake");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("says someone taken out of a room that's still there no longer has access to it", () => {
    render(<RoomGoneNotice gone="lost access" />);
    expect(screen.getByRole("alert")).toHaveTextContent("You no longer have access to this room.");
  });
});

/**
 * The Worker as Files in Ember asks it: a search for files that finds `file`, shared in room `roomId`, and
 * the share check, answering `widening`, or failing for null.
 */
function filesInEmber(file: StoredFile, widening: ShareWidening | null, { roomId = "r9", kind = "open" }: { roomId?: string; kind?: string } = {}) {
  const fetch = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path === "/api/share-check") return widening ? Response.json(widening) : new Response(null, { status: 500 });
    return Response.json({
      search: { q: "", hasFile: true },
      matches: [{ message: { id: "m1", roomId, creator: { id: "u2", name: "Grace" }, attachment: file, createdAt: "2026-11-01T10:00:00Z" }, words: [] }],
      next: null,
      rooms: [{ id: roomId, kind, name: "design", icon: null }],
      recent: [],
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A room's socket as the composer hears it: what it sends, and frames for it to hear. */
function roomFrames() {
  const listeners = new Set<(frame: ServerFrame) => void>();
  const send = vi.fn((_frame: ClientFrame) => true);
  const frames: RoomFrames = { send, listen: (listener) => (listeners.add(listener), () => void listeners.delete(listener)) };
  const hear = (frame: ServerFrame) => act(() => listeners.forEach((listener) => listener(frame)));
  return { frames, send, hear };
}

async function showScheduling({ roomId, threadId }: { roomId: string; threadId?: string }) {
  const { frames, send, hear } = roomFrames();
  const onSend = vi.fn(() => true);
  render(
    <Composer roomId={roomId} roomName="general" userId="u1" typing={[]} disabled={false} threadId={threadId} frames={frames} onSend={onSend} onSendFiles={() => {}} onTyping={() => {}} />,
  );
  const input = await screen.findByRole("textbox", { name: threadId === undefined ? "Write a message" : "Write a reply" });
  return { send, hear, onSend, input, user: userEvent.setup() };
}

const scheduleMenu = () => screen.getByRole("button", { name: "Schedule for later" });

describe("Attach", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers Upload from your computer, which opens the browser's file picker, and Files in Ember", async () => {
    const { user } = await showComposer();
    const picker = vi.spyOn(attachFiles(), "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Attach" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Upload from your computer", "Files in Ember"]);
    await user.click(screen.getByRole("menuitem", { name: "Upload from your computer" }));
    expect(picker).toHaveBeenCalledOnce();
  });

  it("attaches a file shared in a room you're in, picked from Files in Ember, to send as a file of its own", async () => {
    const file = { id: "f1", name: "plan.pdf", contentType: "application/pdf", byteSize: 1, url: "/rails/active_storage/blobs/f1/plan.pdf", downloadUrl: "/d" };
    const fetch = filesInEmber(file, { widens: false, newViewers: 0, names: [] });
    const { input, user, onSend, onSendFiles } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    const dialog = await screen.findByRole("dialog", { name: "Files in Ember" });
    const pick = await within(dialog).findByRole("button", { name: /plan\.pdf/ });
    expect(pick).toHaveTextContent("#design");
    expect(fetch.mock.calls[0]![0]).toContain("has=file");

    await user.click(pick);
    await screen.findByRole("button", { name: "Remove plan.pdf" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(chips()).toEqual(["Remove plan.pdf"]);

    await user.type(input, "The plan{Enter}");
    // Asked again who'd see it, it goes.
    await vi.waitFor(() => expect(onSendFiles).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ roomId: "r9", file })], false));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>The plan</p>", false);
    expect(chips()).toEqual([]);
  });

  it("warns before attaching a file that would reach people who can't see the room it's from, where Cancel attaches nothing", async () => {
    const file = { id: "f1", name: "plan.pdf", contentType: "application/pdf", byteSize: 1, url: "/files/f1/plan.pdf", downloadUrl: "/d" };
    const fetch = filesInEmber(file, { widens: true, newViewers: 2, names: ["Grace", "Linus"] }, { kind: "closed" });
    const { user } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    const pick = await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ });

    // Who shared it and its size tell it apart, and a private room's shows a lock in place of its #.
    expect(pick).toHaveTextContent("design · Grace · 1 B · Nov 1, 2026");
    expect(pick).not.toHaveTextContent("#");
    expect(within(pick).getByRole("img", { name: "Private" })).toBeInTheDocument();

    await user.click(pick);
    // A private room's name follows a lock, and the warning says who'll be able to open the file.
    const warning = await screen.findByRole("alertdialog", { name: /^Share outside .*design$/ });
    expect(warning).toHaveAccessibleDescription("Grace and Linus will be able to open this file in #general.");
    expect(fetch).toHaveBeenCalledWith("/api/share-check", expect.objectContaining({ method: "POST", body: JSON.stringify({ sourceRoomId: "r9", targetRoomId: "r1" }) }));
    await user.click(within(warning).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Files in Ember" })).toBeInTheDocument();
    expect(pick).toHaveFocus();
    expect(chips()).toEqual([]);

    await user.click(pick);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Files in Ember" })).toBeInTheDocument();
    expect(chips()).toEqual([]);

    await user.click(pick);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Attach" }));
    expect(await screen.findByRole("button", { name: "Remove plan.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks again as Attach is pressed, showing a new count where the room's people changed", async () => {
    const file = { id: "f1", name: "plan.pdf", contentType: "application/pdf", byteSize: 1, url: "/files/f1/plan.pdf", downloadUrl: "/d" };
    const fetch = filesInEmber(file, { widens: true, newViewers: 2, names: ["Grace", "Linus"] }, { kind: "closed" });
    const { user } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ }));
    await screen.findByRole("alertdialog");

    filesInEmber(file, { widens: true, newViewers: 5, names: ["Grace", "Linus", "Mary"] }, { kind: "closed" });
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Attach" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("5 people in #general aren’t in private design and will be able to open this file.");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Attach" }));
    expect(await screen.findByRole("button", { name: "Remove plan.pdf" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalled();
  });

  it("asks again on Send, warning only where more people would now see the file than when it was attached", async () => {
    const file = { id: "f1", name: "plan.pdf", contentType: "application/pdf", byteSize: 1, url: "/files/f1/plan.pdf", downloadUrl: "/d" };
    filesInEmber(file, { widens: true, newViewers: 2, names: ["Grace", "Linus"] }, { kind: "closed" });
    const { user, onSendFiles } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Attach" }));
    await screen.findByRole("button", { name: "Remove plan.pdf" });

    // As many as it was attached knowing: it goes.
    await user.click(sendButton());
    await vi.waitFor(() => expect(onSendFiles).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // More, as someone joined since: it asks again, and goes on Send.
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Attach" }));
    await screen.findByRole("button", { name: "Remove plan.pdf" });
    filesInEmber(file, { widens: true, newViewers: 5, names: ["Grace", "Linus", "Mary"] }, { kind: "closed" });
    await user.click(sendButton());
    const warning = await screen.findByRole("alertdialog");
    expect(warning).toHaveTextContent("5 people in #general");
    expect(onSendFiles).toHaveBeenCalledOnce();
    await user.click(within(warning).getByRole("button", { name: "Send" }));
    expect(onSendFiles).toHaveBeenCalledTimes(2);
  });

  it("asks again on Send where someone else would now see the file in place of someone it named", async () => {
    const file = { id: "f1", name: "plan.pdf", contentType: "application/pdf", byteSize: 1, url: "/files/f1/plan.pdf", downloadUrl: "/d" };
    filesInEmber(file, { widens: true, newViewers: 2, names: ["Grace", "Linus"] }, { kind: "closed" });
    const { user, onSendFiles } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Attach" }));
    await screen.findByRole("button", { name: "Remove plan.pdf" });

    filesInEmber(file, { widens: true, newViewers: 2, names: ["Grace", "Mary"] }, { kind: "closed" });
    await user.click(sendButton());
    expect(await screen.findByRole("alertdialog")).toHaveAccessibleDescription("Grace and Mary will be able to open this file in #general.");
    expect(onSendFiles).not.toHaveBeenCalled();
  });

  it("attaches a file from the room it's for without asking, and says so when it can't check who'd see one", async () => {
    const file = { id: "f1", name: "plan.pdf", contentType: "application/pdf", byteSize: 1, url: "/files/f1/plan.pdf", downloadUrl: "/d" };
    const fetch = filesInEmber(file, null, { roomId: "r1" });
    const { user } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ }));
    expect(await screen.findByRole("button", { name: "Remove plan.pdf" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/share-check", expect.anything());

    filesInEmber(file, null);
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /plan\.pdf/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check who can see that file. Try again.");
    await user.keyboard("{Escape}");
    expect(chips()).toEqual(["Remove plan.pdf"]);
  });

  it("shows an SVG picked from Files in Ember by its icon, as it's served as a download", async () => {
    filesInEmber({ id: "f3", name: "logo.svg", contentType: "image/svg+xml", byteSize: 1, url: "/files/f3/logo.svg", downloadUrl: "/d" }, { widens: false, newViewers: 0, names: [] });
    const { user } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /logo\.svg/ }));
    const chip = (await screen.findByRole("button", { name: "Remove logo.svg" })).closest("li")!;
    expect(chip.querySelector("img")).toBeNull();
    expect(chip).toHaveTextContent("SVG · 1 B");
  });

  it("shows a picture picked from Files in Ember by its preview", async () => {
    const file = { id: "f2", name: "moon.jpg", contentType: "image/jpeg", byteSize: 1, url: "/files/f2/moon.jpg", downloadUrl: "/d", previewUrl: "/previews/f2/moon.webp" };
    filesInEmber(file, { widens: false, newViewers: 0, names: [] });
    const { user } = await showComposer();
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.click(await screen.findByRole("menuitem", { name: "Files in Ember" }));
    await user.click(await within(await screen.findByRole("dialog", { name: "Files in Ember" })).findByRole("button", { name: /moon\.jpg/ }));
    expect(await screen.findByRole("img", { name: "moon.jpg" })).toHaveAttribute("src", "/previews/f2/moon.webp");
  });
});

describe("Schedule for later", () => {
  /** `days` from today, at `hours`:`minutes` in this browser's time zone. */
  const inDays = (days: number, hours: number, minutes = 0) => {
    const at = new Date();
    at.setDate(at.getDate() + days);
    at.setHours(hours, minutes, 0, 0);
    return at;
  };
  /** A phone: a narrow screen, touched. */
  const phoneScreen = () =>
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(width < 48rem)" || media === "(pointer: coarse)", media, addEventListener() {}, removeEventListener() {} }));

  it("schedules what's written for tomorrow at 9:00 AM, taking it out of the box", async () => {
    const { send, input, user, onSend } = await showScheduling({ roomId: "s1" });
    expect(scheduleMenu()).toBeDisabled();
    await user.type(input, "Morning all");
    await user.click(scheduleMenu());
    await user.click(await screen.findByRole("menuitem", { name: /^Tomorrow at 9:00/ }));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "scheduled.create", clientMessageId: expect.any(String) as string, body: "<p>Morning all</p>", sendAt: tomorrow.getTime() });
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  it("has every formatting button working again once code is scheduled", async () => {
    const { input, user } = await showScheduling({ roomId: "s4" });
    const tool = (name: string) => within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name });
    await user.click(tool("Code block"));
    await user.type(input, "later();");
    expect(tool("Bold")).toBeDisabled();
    await user.click(scheduleMenu());
    await user.click(await screen.findByRole("menuitem", { name: /^Tomorrow at 9:00/ }));
    expect(input).toHaveValue("");
    expect(tool("Bold")).toBeEnabled();
    expect(tool("Code block")).toHaveAttribute("aria-pressed", "false");
  });

  it("opens its menu on the menu itself from a pointer, and on its first time from the keyboard, giving focus back as it closes", async () => {
    const { input, user } = await showScheduling({ roomId: "s5" });
    await user.type(input, "Later");
    await user.click(scheduleMenu());
    expect(await screen.findByRole("menu", { name: "Schedule message" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /^Tomorrow at 9:00/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(input).toHaveFocus();

    scheduleMenu().focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: /^Tomorrow at 9:00/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(scheduleMenu()).toHaveFocus();
  });

  it("schedules a reply in its thread, and puts back what the room wouldn't schedule, saying why", async () => {
    const { send, hear, input, user } = await showScheduling({ roomId: "s2", threadId: "m1" });
    await user.type(input, "Later");
    await user.click(scheduleMenu());
    await user.click(await screen.findByRole("menuitem", { name: "Custom time" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule message" });
    const date = within(dialog).getByLabelText("Date");
    expect(date).toHaveFocus();
    expect(date).toHaveAttribute("max", dateValue(new Date(Date.now() + MAX_SCHEDULE_AHEAD_MS)));
    // Date and time fields take a value whole, as their pickers give it.
    fireEvent.change(date, { target: { value: "2020-01-01" } });
    await user.click(within(dialog).getByRole("button", { name: "Schedule message" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Pick a time in the future.");
    fireEvent.change(date, { target: { value: dateValue(inDays(130, 9)) } });
    await user.click(within(dialog).getByRole("button", { name: "Schedule message" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Pick a time in the next 120 days.");
    expect(send).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: dateValue(inDays(10, 9)) } });
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "14:30" } });
    await user.click(within(dialog).getByRole("button", { name: "Schedule message" }));
    const frame = send.mock.calls[0]![0] as Extract<ClientFrame, { type: "scheduled.create" }>;
    expect(frame).toMatchObject({ body: "<p>Later</p>", sendAt: inDays(10, 14, 30).getTime(), parentId: "m1", alsoSend: false });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();

    hear({ type: "error", message: "Pick a time in the next 120 days.", clientMessageId: frame.clientMessageId, failed: "scheduled.create" });
    expect(input).toHaveValue("Later");
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a time in the next 120 days.");
  });

  it("says how many messages are scheduled here, listing them to send now, move or delete", async () => {
    const { send, hear, input } = await showScheduling({ roomId: "s3" });
    const user = userEvent.setup();
    const sendAt = inDays(10, 9).getTime();
    hear({
      type: "scheduled",
      messages: [
        { id: "a", body: "<p>First</p>", sendAt },
        { id: "b", body: "<p>Second</p>", sendAt: sendAt + 1000 },
        { id: "c", body: "<p>In a thread</p>", sendAt, parentId: "m1", alsoSend: false },
      ],
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 scheduled messages");

    await user.click(screen.getByRole("button", { name: "See all" }));
    const dialog = await screen.findByRole("dialog", { name: "Scheduled messages" });
    const items = within(dialog).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("p:nth-child(2)")!.textContent)).toEqual(["First", "Second"]);
    // It opens on Edit time, so Enter can't send a message by accident.
    expect(within(items[0]!).getByRole("button", { name: "Edit time" })).toHaveFocus();
    await user.click(within(items[0]!).getByRole("button", { name: "Send now" }));
    await user.click(within(items[1]!).getByRole("button", { name: "Delete" }));
    expect(send.mock.calls.map(([frame]) => frame)).toEqual([
      { type: "scheduled.send", id: "a" },
      { type: "scheduled.delete", id: "b" },
    ]);
    expect(items[1]).toHaveTextContent("Scheduled message deleted");
    expect(within(items[1]!).getByRole("button", { name: "Undo" })).toHaveFocus();

    await user.click(within(items[0]!).getByRole("button", { name: "Edit time" }));
    const moving = await screen.findByRole("dialog", { name: "Edit time" });
    fireEvent.change(within(moving).getByLabelText("Time"), { target: { value: "10:15" } });
    await user.click(within(moving).getByRole("button", { name: "Save" }));
    expect(send).toHaveBeenLastCalledWith({ type: "scheduled.update", id: "a", sendAt: inDays(10, 10, 15).getTime() });

    // Closing the list gives the composer its focus back.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(input).toHaveFocus();

    // Opening the room again says nothing until it hears what's scheduled.
    hear({ type: "welcome", you: { id: "u1", name: "Ada" }, present: [], seq: 0, messages: [], hasMore: false, hasNewer: false, around: null });
    expect(screen.queryByText(/scheduled message/)).not.toBeInTheDocument();
  });

  it("says when its one message goes as the menu does: tomorrow, or a weekday's name", async () => {
    const { hear } = await showScheduling({ roomId: "s6" });
    hear({ type: "scheduled", messages: [{ id: "a", body: "<p>Hi</p>", sendAt: inDays(1, 9).getTime() }] });
    expect(screen.getByRole("status")).toHaveTextContent(/^1 scheduled message, tomorrow at 9:00/);
    hear({ type: "scheduled", messages: [{ id: "a", body: "<p>Hi</p>", sendAt: inDays(3, 9).getTime() }] });
    expect(screen.getByRole("status")).toHaveTextContent(/^1 scheduled message, [A-Z][a-z]+day at 9:00/);
  });

  it("brings a deleted one back with Undo, in its thread at its time, for 5 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { send, hear } = await showScheduling({ roomId: "s7", threadId: "m1" });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const sendAt = inDays(2, 9).getTime();
      const listed = [
        { id: "a", body: "<p>One</p>", sendAt, parentId: "m1", alsoSend: true },
        { id: "b", body: "<p>Two</p>", sendAt: sendAt + 1000, parentId: "m1", alsoSend: false },
      ];
      hear({ type: "scheduled", messages: listed });
      await user.click(screen.getByRole("button", { name: "See all" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Scheduled messages" })).getAllByRole("button", { name: "Delete" })[0]!);
      hear({ type: "scheduled", messages: listed.slice(1) });
      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(send).toHaveBeenLastCalledWith({ type: "scheduled.create", clientMessageId: expect.any(String) as string, body: "<p>One</p>", sendAt, parentId: "m1", alsoSend: true });

      // The last one goes, and Undo shows over the composer, until its time's up.
      hear({ type: "scheduled", messages: listed.slice(1) });
      await user.click(within(screen.getByRole("dialog", { name: "Scheduled messages" })).getByRole("button", { name: "Delete" }));
      hear({ type: "scheduled", messages: [] });
      await user.keyboard("{Escape}");
      expect(screen.getByRole("status")).toHaveTextContent("Scheduled message deleted");
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(UNDO_MS));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why one couldn't be sent when it was due, to send again, write in the composer again or delete", async () => {
    const { send, hear, input, user } = await showScheduling({ roomId: "s8" });
    const failed = { id: "f", body: "<p>Lost</p>", sendAt: inDays(-1, 9).getTime(), failed: "Its thread was deleted." };
    hear({ type: "scheduled", messages: [failed] });
    expect(screen.getByRole("status")).toHaveTextContent("Not sent: Its thread was deleted.");

    await user.click(screen.getByRole("button", { name: "See all" }));
    let row = within(within(await screen.findByRole("dialog", { name: "Scheduled messages" })).getByRole("listitem"));
    expect(row.getByText("Not sent:").parentElement).toHaveTextContent("Not sent: Its thread was deleted.");
    expect(row.queryByRole("button", { name: "Edit time" })).not.toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "Send now" }));
    expect(send).toHaveBeenLastCalledWith({ type: "scheduled.send", id: "f" });

    hear({ type: "scheduled", messages: [failed] });
    row = within(within(screen.getByRole("dialog", { name: "Scheduled messages" })).getByRole("listitem"));
    await user.click(row.getByRole("button", { name: "Edit" }));
    expect(send).toHaveBeenLastCalledWith({ type: "scheduled.delete", id: "f" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(input).toHaveValue("Lost");
    expect(input).toHaveFocus();
    // Nothing offers to bring back what's written again.
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("lists them on a phone as a sheet, offering what can be done with one when it's tapped", async () => {
    phoneScreen();
    const { send, hear, user } = await showScheduling({ roomId: "s9" });
    const sendAt = inDays(3, 9).getTime();
    hear({ type: "scheduled", messages: [{ id: "a", body: "<p>Morning</p>", sendAt }] });
    expect(screen.getByRole("status")).toHaveTextContent(/^Scheduled · [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, 9:00\sAM$/);

    await user.click(screen.getByRole("button", { name: "See all" }));
    const list = await screen.findByRole("dialog", { name: "Scheduled messages" });
    // The sheet itself takes focus, rather than ringing its first row.
    expect(list).toHaveFocus();
    expect(within(list).queryByRole("button", { name: "Send now" })).not.toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /^Morning/ }));
    const sheet = await screen.findByRole("dialog", { name: "Morning" });
    expect(within(sheet).getAllByRole("button").map((button) => button.textContent)).toEqual(["Send now", "Edit time", "Delete", "Cancel"]);
    await user.click(within(sheet).getByRole("button", { name: "Delete" }));
    expect(send).toHaveBeenLastCalledWith({ type: "scheduled.delete", id: "a" });
    expect(screen.queryByRole("dialog", { name: "Morning" })).not.toBeInTheDocument();
  });
});

describe("Layouts of the composer", () => {
  it("hides the toolbar until Aa shows it when its layout asks, and places the layout's own buttons after @", async () => {
    render(
      <Composer
        roomId="l1"
        roomName="general"
        userId="u1"
        typing={[]}
        disabled={false}
        toolbarByDefault={false}
        extraButtons={<button type="button">Shortcuts</button>}
        onSend={() => true}
        onSendFiles={() => {}}
        onTyping={() => {}}
      />,
    );
    await screen.findByRole("textbox", { name: "Write a message" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    const buttons = [...document.querySelectorAll("form button")].map((button) => button.textContent);
    expect(buttons.indexOf("Shortcuts")).toBe(buttons.indexOf("Mention someone") + 1);

    await userEvent.setup().click(formattingOptions());
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("opens Schedule message when Send is held down, rather than sending", async () => {
    const { send, input, user, onSend } = await showScheduling({ roomId: "l2" });
    await user.type(input, "Later");
    fireEvent.pointerDown(sendButton(), { button: 0 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    fireEvent.pointerUp(sendButton());
    fireEvent.click(sendButton());
    expect(onSend).not.toHaveBeenCalled();
    expect(await screen.findByRole("menu", { name: "Schedule message" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /^Tomorrow at 9:00/ }));
    expect(send).toHaveBeenCalledOnce();
    expect(input).toHaveValue("");

    // A short press sends, as ever.
    await user.type(input, "Now");
    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledOnce();
  });
});

describe("Edit a message in the composer", () => {
  const mine: Message = {
    id: "m1",
    clientMessageId: "c1",
    roomId: "r1",
    creator: { id: "u1", name: "Ada" },
    body: "<p>Hello</p>",
    plainText: "Hello",
    mentions: [],
    createdAt: "2026-11-12T10:00:00Z",
    updatedAt: "2026-11-12T10:00:00Z",
    editedAt: null,
    boosts: [],
  };

  /** A room whose composer edits `mine` while `edit()` is called, as a phone's layout has it, and stops as it answers. */
  async function editing({ saves = true, message: edited = mine } = {}) {
    const onSave = vi.fn((_body: string) => saves);
    const onCancel = vi.fn();
    let edit = () => {};
    function Room() {
      const [message, setMessage] = useState<Message | null>(null);
      edit = () => setMessage(edited);
      const done = () => setMessage(null);
      const editing: ComposerEdit | null = message && {
        message,
        onSave: (body) => {
          const saved = onSave(body);
          if (saved) done();
          return saved;
        },
        onCancel: () => {
          onCancel();
          done();
        },
      };
      return <Composer roomId="r1" roomName="general" userId="u1" typing={[]} disabled={false} editing={editing} onSend={() => true} onSendFiles={() => {}} onTyping={() => {}} />;
    }
    render(<Room />);
    const input = await screen.findByRole("textbox", { name: "Write a message" });
    return { input, onSave, onCancel, edit: () => act(edit), user: userEvent.setup() };
  }

  it("writes the message in place of what's written, saves on Enter, and gives what was written back", async () => {
    const { input, onSave, edit, user } = await editing();
    await user.type(input, "Draft");
    edit();
    await vi.waitFor(() => expect(input).toHaveValue("Hello"));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
    // What's edited isn't the room's draft.
    expect(localStorage.getItem("composer-draft-u1-r1")).toBe("<p>Draft</p>");

    await user.type(input, " again{Enter}");
    expect(onSave).toHaveBeenCalledExactlyOnceWith("<p>Hello again</p>");
    await vi.waitFor(() => expect(input).toHaveValue("Draft"));
    expect(screen.getByRole("button", { name: "Send Message" })).toBeInTheDocument();
  });

  it("edits only a forward's note, keeping its quote", async () => {
    const quote = '<blockquote><p>Lunch at noon?</p></blockquote><cite>Grace · <time datetime="2026-11-12T09:00:00Z">9:00 AM</time> <a href="/rooms/r2/@m0">#</a></cite>';
    const { input, onSave, edit, user } = await editing({ message: { ...mine, body: `<p>See this</p>${quote}` } });
    edit();
    await vi.waitFor(() => expect(input).toHaveValue("See this"));
    // The quote and its cite show under the note, to read rather than edit, until the edit's done.
    const form = input.closest("form")!;
    expect(form.querySelector(".message-content blockquote")).toHaveTextContent("Lunch at noon?");
    expect(form.querySelector(".message-content cite")).toHaveTextContent(/^Grace · /);
    expect(input).not.toContainElement(form.querySelector("blockquote"));
    await user.type(input, " now{Enter}");
    expect(onSave).toHaveBeenCalledExactlyOnceWith(`<p>See this now</p>${quote}`);
    await vi.waitFor(() => expect(input).toHaveValue(""));
    expect(form.querySelector("blockquote")).not.toBeInTheDocument();
  });

  it("cancels on Escape, or as it's saved unchanged, and stays where the change didn't go", async () => {
    const { input, onSave, onCancel, edit, user } = await editing({ saves: false });
    edit();
    await vi.waitFor(() => expect(input).toHaveValue("Hello"));
    await user.type(input, "{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(input).toHaveValue(""));

    edit();
    await vi.waitFor(() => expect(input).toHaveValue("Hello"));
    await user.type(input, "{Enter}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();

    edit();
    await vi.waitFor(() => expect(input).toHaveValue("Hello"));
    await user.type(input, "!{Enter}");
    expect(onSave).toHaveBeenCalledExactlyOnceWith("<p>Hello!</p>");
    expect(input).toHaveValue("Hello!");
  });
});

describe("Compact composer", () => {
  it("is one line with Send's arrow in the box and nothing else, sending on Enter", async () => {
    const onSend = vi.fn(() => true);
    const { container } = render(
      <Composer roomId="r1" roomName="general" userId="u1" typing={[]} disabled={false} threadId="m1" compact onSend={onSend} onSendFiles={() => {}} onTyping={() => {}} />,
    );
    const input = await screen.findByRole("textbox", { name: "Write a reply" });
    expect(input).toHaveAttribute("rows", "1");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    for (const name of ["Attach", "Emoji", "Mention someone", "Schedule for later"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(container.querySelector("form")).toHaveAttribute("data-compact");
    const user = userEvent.setup();
    await user.type(input, "Sounds good{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Sounds good</p>", false);
    expect(screen.getByRole("button", { name: "Send Message" })).toBeVisible();
  });
});

describe("Also send to the room", () => {
  it("names a private room after its lock, rather than a #", async () => {
    render(<Composer roomId="r1" roomName="QA Lab" closed userId="u1" typing={[]} disabled={false} threadId="m1" onSend={() => true} onSendFiles={() => {}} onTyping={() => {}} />);
    await screen.findByRole("textbox", { name: "Write a reply" });
    const label = screen.getByRole("checkbox").closest("label")!;
    expect(label).toHaveTextContent(/^Also send to QA Lab$/);
    expect(label.querySelector("strong svg")).toBeInTheDocument();
  });
});
