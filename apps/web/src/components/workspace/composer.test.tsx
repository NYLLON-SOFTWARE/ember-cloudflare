import { feature } from "@ember/parity";
import type { User } from "@ember/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleContext } from "@/hooks/use-directory";
import { Composer, RoomDeleted } from "./composer";
import { editorLoaded } from "./editor";

// The editor here is test-setup.ts's stand-in for Lexxy, a text box whose lines are one paragraph,
// and every test starts before its code has loaded.
vi.mock("./editor", async (importOriginal) => ({ ...(await importOriginal<typeof import("./editor")>()), editorLoaded: vi.fn(() => false) }));

async function showComposer({ typing = [] as User[], disabled = false, roomId = "r1" } = {}) {
  const onSend = vi.fn((_body: string) => true);
  const onTyping = vi.fn();
  const view = render(<Composer roomId={roomId} roomName="general" userId="u1" typing={typing} disabled={disabled} onSend={onSend} onTyping={onTyping} />);
  // The editor loads as the first composer shows.
  const input = await screen.findByRole("textbox", { name: "Write a message" });
  return { onSend, onTyping, view, user: userEvent.setup(), input };
}

function touchScreen() {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(pointer: coarse)", media, addEventListener() {}, removeEventListener() {} }));
}

const sendButton = () => screen.getByRole("button", { name: "Send Message" });
const formattingOptions = () => screen.getByRole("button", { name: "Rich text" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(editorLoaded).mockReturnValue(false);
});

describe(feature("composer.layout"), () => {
  it("has the text box on top, with Formatting options and Send below", async () => {
    const { input } = await showComposer();
    expect(input).toHaveAttribute("placeholder", "Message #general");
    expect(formattingOptions()).toHaveAttribute("title", "Formatting options");
    expect(sendButton()).toHaveAttribute("title", "Send message");
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

  const room = { roomId: "r1", roomName: "general", userId: "u1", typing: [], disabled: false, onSend: () => true, onTyping: () => {} };

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

describe(feature("composer.formatting-toolbar"), () => {
  it("shows the toolbar while Formatting options is pressed, keeping focus in the text", async () => {
    const { input, user, view } = await showComposer();
    const form = view.container.querySelector("form")!;
    await user.click(formattingOptions());
    expect(formattingOptions()).toHaveAttribute("aria-pressed", "true");
    expect(form).toHaveAttribute("data-toolbar");
    expect(input).toHaveFocus();

    await user.click(formattingOptions());
    expect(formattingOptions()).toHaveAttribute("aria-pressed", "false");
    expect(form).not.toHaveAttribute("data-toolbar");
  });
});

describe(feature("composer.send"), () => {
  it("sends what's written on Enter, then empties the box and keeps focus", async () => {
    const { onSend, input, user } = await showComposer();
    await user.type(input, "Hello there{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Hello there</p>");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("starts a new line on Shift+Enter instead of sending", async () => {
    const { onSend, input, user } = await showComposer();
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");

    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledWith("<p>line one<br>line two</p>");
  });

  it("starts a new line on Enter while the toolbar shows, sends on Ctrl+Enter, and then hides the toolbar", async () => {
    const { onSend, input, user } = await showComposer();
    await user.click(formattingOptions());
    await user.type(input, "one{Enter}two");
    expect(onSend).not.toHaveBeenCalled();

    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>one<br>two</p>");
    expect(formattingOptions()).toHaveAttribute("aria-pressed", "false");
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
    expect(onSend).toHaveBeenCalledExactlyOnceWith("<p>Too much</p>");
    expect(input).toHaveValue("Too much");
    expect(input).toHaveFocus();
    expect(localStorage.getItem("composer-draft-u1-r1")).toBe("<p>Too much</p>");
  });

  it("holds on to the text while the room is disconnected", async () => {
    const { onSend, input, user } = await showComposer({ disabled: true });
    await user.type(input, "Are you there?{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("Are you there?");
    expect(sendButton()).toBeDisabled();
  });
});

describe(feature("composer.draft"), () => {
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

describe(feature("realtime.typing"), () => {
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
        <Composer roomId="r1" roomName="general" userId="u1" typing={[typist("Linus", 1), typist("Grace", 2)]} disabled={false} onSend={vi.fn(() => true)} onTyping={vi.fn()} />
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

describe(feature("rooms.member-only-access"), () => {
  it("says a room that's gone was deleted, in red, shaking once where motion is welcome", () => {
    render(<RoomDeleted />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("This room was deleted.");
    expect(notice).toHaveClass("text-negative", "border-negative", "motion-safe:animate-shake");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
